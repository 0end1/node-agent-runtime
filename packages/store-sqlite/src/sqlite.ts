/**
 * SQLiteStorage — C9 optional Storage backend for the Agent runtime.
 *
 * Implements the same Storage trait as the core-bundled MemoryStorage /
 * FileStorage, but backed by a single SQLite database. The engine never
 * depends on this package: hosts opt in by passing an instance as the
 * SessionManager `storage` option.
 *
 * Engine: `node:sqlite` (DatabaseSync), bundled with Node >= 22.13 — no
 * third-party native dependency, so this package keeps "optional packages may
 * bring their own engine" true without forcing a prebuilt binary.
 *
 * Schema (versioned, see `SCHEMA_VERSION` / `MIGRATIONS`):
 *   docs     (domain, id)          -> body TEXT (JSON doc)
 *   blobs    (key)                 -> data BLOB
 *   streams  (domain, id, seq)     -> line TEXT (append-only)
 *
 * v2 adds expression indexes over the hot query paths (session/task/run
 * lookups and approval-audit ordering) so large session volumes do not force a
 * full table scan (P5.5 production baseline).
 */
import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import type { DocDomain, Storage, StreamDomain } from "@agent-runtime/core";

export interface SQLiteStorageOptions {
  /** Database file path. Parent directories are created if missing. */
  file?: string;
}

/**
 * Current schema version (P5.5). Bump it together with a new entry in
 * `MIGRATIONS` — the value is persisted in `PRAGMA user_version`.
 */
export const SCHEMA_VERSION = 2;

/**
 * Forward-only migrations keyed by **target** version. Every statement must be
 * idempotent (`IF NOT EXISTS`) so a run interrupted halfway can simply start
 * again — "迁移脚本可重复" is part of the P5.5 acceptance criteria.
 */
const MIGRATIONS: Record<number, string[]> = {
  1: [
    `CREATE TABLE IF NOT EXISTS docs (
       domain TEXT NOT NULL,
       id     TEXT NOT NULL,
       body   TEXT NOT NULL,
       PRIMARY KEY (domain, id)
     )`,
    `CREATE TABLE IF NOT EXISTS blobs (
       key  TEXT PRIMARY KEY,
       data BLOB NOT NULL
     )`,
    `CREATE TABLE IF NOT EXISTS streams (
       domain TEXT NOT NULL,
       id     TEXT NOT NULL,
       seq    INTEGER NOT NULL,
       line   TEXT NOT NULL,
       PRIMARY KEY (domain, id, seq)
     )`,
  ],
  // v2: query paths for large session volumes (session/task/run lookups and
  // approval-audit time ordering) become index lookups instead of full scans.
  2: [
    `CREATE INDEX IF NOT EXISTS idx_docs_session_id ON docs(domain, json_extract(body, '$.sessionId'))`,
    `CREATE INDEX IF NOT EXISTS idx_docs_task_id ON docs(domain, json_extract(body, '$.taskId'))`,
    `CREATE INDEX IF NOT EXISTS idx_docs_run_id ON docs(domain, json_extract(body, '$.runId'))`,
    `CREATE INDEX IF NOT EXISTS idx_docs_decided_at ON docs(domain, json_extract(body, '$.decidedAt'))`,
  ],
};

/**
 * Document fields promoted to a real SQL index. Only these are pushed down
 * into the WHERE clause (the names are whitelisted, never user SQL).
 */
const INDEXED_DOC_FIELDS: readonly string[] = ["sessionId", "taskId", "runId", "decidedAt"];

/** Apply pending migrations and stamp `user_version` (P5.5). */
function applyMigrations(db: DatabaseSync): void {
  const row = db.prepare("PRAGMA user_version").get() as { user_version?: number } | undefined;
  const current = Number(row?.user_version ?? 0);
  if (current > SCHEMA_VERSION) {
    throw new Error(
      `SQLite schema 版本 ${current} 高于本程序支持的 ${SCHEMA_VERSION}：请升级 @agent-runtime/store-sqlite 后再打开该数据库`,
    );
  }
  for (let v = current + 1; v <= SCHEMA_VERSION; v++) {
    for (const sql of MIGRATIONS[v] ?? []) db.exec(sql);
  }
  if (current !== SCHEMA_VERSION) {
    db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
  }
}

/** In-memory pass for the non-indexed part of a `listDocs` filter. */
function matchesFilter<T extends object>(doc: T, filter: Partial<T>): boolean {
  return Object.entries(filter as Record<string, unknown>).every(
    ([key, expected]) =>
      expected === undefined || (doc as Record<string, unknown>)[key] === expected,
  );
}

export class SQLiteStorage implements Storage {
  private readonly db: DatabaseSync;
  private readonly upsertDocStmt: StatementSync;
  private readonly loadDocStmt: StatementSync;
  private readonly listDocStmt: StatementSync;
  private readonly deleteDocStmt: StatementSync;
  private readonly putBlobStmt: StatementSync;
  private readonly getBlobStmt: StatementSync;
  private readonly deleteBlobStmt: StatementSync;
  private readonly nextSeqStmt: StatementSync;
  private readonly appendLineStmt: StatementSync;
  private readonly readStreamStmt: StatementSync;
  private readonly deleteStreamStmt: StatementSync;
  /** Cached `listDocs` statements, keyed by the indexed-field combination (P5.5). */
  private readonly filterStmtCache = new Map<string, StatementSync>();

  constructor(options: SQLiteStorageOptions = {}) {
    const file = options.file ?? ":memory:";
    if (file !== ":memory:") {
      mkdirSync(dirname(resolve(file)), { recursive: true });
    }
    const db = new DatabaseSync(file);
    // WAL: readers never block the writer (P5.5 production baseline).
    db.exec("PRAGMA journal_mode = WAL;");
    db.exec("PRAGMA synchronous = NORMAL;");
    applyMigrations(db);

    this.db = db;
    this.upsertDocStmt = db.prepare(
      `INSERT INTO docs (domain, id, body) VALUES (?, ?, ?)
       ON CONFLICT (domain, id) DO UPDATE SET body = excluded.body`,
    );
    this.loadDocStmt = db.prepare(`SELECT body FROM docs WHERE domain = ? AND id = ?`);
    this.listDocStmt = db.prepare(`SELECT body FROM docs WHERE domain = ?`);
    this.deleteDocStmt = db.prepare(`DELETE FROM docs WHERE domain = ? AND id = ?`);
    this.putBlobStmt = db.prepare(
      `INSERT INTO blobs (key, data) VALUES (?, ?)
       ON CONFLICT (key) DO UPDATE SET data = excluded.data`,
    );
    this.getBlobStmt = db.prepare(`SELECT data FROM blobs WHERE key = ?`);
    this.deleteBlobStmt = db.prepare(`DELETE FROM blobs WHERE key = ?`);
    this.nextSeqStmt = db.prepare(
      `SELECT COALESCE(MAX(seq), 0) + 1 AS next FROM streams WHERE domain = ? AND id = ?`,
    );
    this.appendLineStmt = db.prepare(
      `INSERT INTO streams (domain, id, seq, line) VALUES (?, ?, ?, ?)`,
    );
    this.readStreamStmt = db.prepare(
      `SELECT line FROM streams WHERE domain = ? AND id = ? ORDER BY seq ASC`,
    );
    this.deleteStreamStmt = db.prepare(`DELETE FROM streams WHERE domain = ? AND id = ?`);
  }

  /** Persisted schema version (`PRAGMA user_version`) — for ops/migration checks. */
  get schemaVersion(): number {
    const row = this.db.prepare("PRAGMA user_version").get() as { user_version?: number } | undefined;
    return Number(row?.user_version ?? 0);
  }

  /**
   * Consistent online backup (P5.5): `VACUUM INTO` snapshots the database
   * without stopping writers. It refuses to overwrite an existing file, so
   * restore is just "point the service at the copy".
   */
  backup(dest: string): void {
    const target = resolve(dest);
    if (existsSync(target)) {
      throw new Error(`备份目标已存在，拒绝覆盖：${target}`);
    }
    mkdirSync(dirname(target), { recursive: true });
    // VACUUM INTO takes a string literal (no bound parameters) — escape quotes.
    this.db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
  }

  close(): void {
    this.db.close();
  }

  // ---- Document domain ----

  async saveDoc<T extends object>(domain: DocDomain, id: string, doc: T): Promise<void> {
    this.upsertDocStmt.run(domain, id, JSON.stringify(doc));
  }

  async loadDoc<T extends object>(domain: DocDomain, id: string): Promise<T | undefined> {
    const row = this.loadDocStmt.get(domain, id) as { body: string } | undefined;
    return row ? (JSON.parse(row.body) as T) : undefined;
  }

  async listDocs<T extends object>(domain: DocDomain, filter?: Partial<T>): Promise<T[]> {
    const rows = this.queryDocs(domain, filter);
    const out: T[] = [];
    for (const row of rows) {
      const doc = JSON.parse(row.body) as T;
      if (!filter || matchesFilter(doc, filter)) out.push(doc);
    }
    return out;
  }

  /**
   * Push indexed fields down into SQL; whatever is left is filtered in memory
   * (P5.5). Whitelisted field names only — never interpolated from user input.
   */
  private queryDocs<T extends object>(
    domain: DocDomain,
    filter?: Partial<T>,
  ): { body: string }[] {
    const entries = filter
      ? Object.entries(filter as Record<string, unknown>)
          .filter(
            (entry): entry is [string, string | number | bigint] =>
              INDEXED_DOC_FIELDS.includes(entry[0]) &&
              (typeof entry[1] === "string" ||
                typeof entry[1] === "number" ||
                typeof entry[1] === "bigint"),
          )
          .sort(([a], [b]) => (a < b ? -1 : 1))
      : [];
    if (entries.length === 0) return this.listDocStmt.all(domain) as { body: string }[];

    const cacheKey = entries.map(([key]) => key).join(",");
    let stmt = this.filterStmtCache.get(cacheKey);
    if (!stmt) {
      const where = entries.map(([key]) => `json_extract(body, '$.${key}') = ?`).join(" AND ");
      stmt = this.db.prepare(`SELECT body FROM docs WHERE domain = ? AND ${where}`);
      this.filterStmtCache.set(cacheKey, stmt);
    }
    return stmt.all(domain, ...entries.map(([, value]) => value)) as { body: string }[];
  }

  async deleteDoc(domain: DocDomain, id: string): Promise<void> {
    this.deleteDocStmt.run(domain, id);
  }

  // ---- Blob domain ----

  async putBlob(key: string, data: Uint8Array): Promise<void> {
    this.putBlobStmt.run(key, data);
  }

  async getBlob(key: string): Promise<Uint8Array | undefined> {
    const row = this.getBlobStmt.get(key) as { data: Uint8Array } | undefined;
    return row?.data;
  }

  async deleteBlob(key: string): Promise<void> {
    this.deleteBlobStmt.run(key);
  }

  // ---- Stream domain ----

  async appendStream(domain: StreamDomain, id: string, line: string): Promise<void> {
    const { next } = this.nextSeqStmt.get(domain, id) as { next: number };
    this.appendLineStmt.run(domain, id, next, line);
  }

  async readStream(domain: StreamDomain, id: string): Promise<string[]> {
    const rows = this.readStreamStmt.all(domain, id) as { line: string }[];
    return rows.map((r) => r.line);
  }

  async deleteStream(domain: StreamDomain, id: string): Promise<void> {
    this.deleteStreamStmt.run(domain, id);
  }
}
