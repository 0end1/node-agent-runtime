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
 * Schema:
 *   docs     (domain, id)          -> body TEXT (JSON doc)
 *   blobs    (key)                 -> data BLOB
 *   streams  (domain, id, seq)     -> line TEXT (append-only)
 */
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import type { DocDomain, Storage, StreamDomain } from "@agent-runtime/core";

export interface SQLiteStorageOptions {
  /** Database file path. Parent directories are created if missing. */
  file?: string;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS docs (
  domain TEXT NOT NULL,
  id     TEXT NOT NULL,
  body   TEXT NOT NULL,
  PRIMARY KEY (domain, id)
);
CREATE TABLE IF NOT EXISTS blobs (
  key  TEXT PRIMARY KEY,
  data BLOB NOT NULL
);
CREATE TABLE IF NOT EXISTS streams (
  domain TEXT NOT NULL,
  id     TEXT NOT NULL,
  seq    INTEGER NOT NULL,
  line   TEXT NOT NULL,
  PRIMARY KEY (domain, id, seq)
);
`;

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

  constructor(options: SQLiteStorageOptions = {}) {
    const file = options.file ?? ":memory:";
    if (file !== ":memory:") {
      mkdirSync(dirname(resolve(file)), { recursive: true });
    }
    const db = new DatabaseSync(file);
    db.exec("PRAGMA journal_mode = WAL;");
    db.exec(SCHEMA);

    this.db = db;
    this.upsertDocStmt = db.prepare(
      `INSERT INTO docs (domain, id, body) VALUES (?, ?, ?)
       ON CONFLICT (domain, id) DO UPDATE SET body = excluded.body`
    );
    this.loadDocStmt = db.prepare(`SELECT body FROM docs WHERE domain = ? AND id = ?`);
    this.listDocStmt = db.prepare(`SELECT body FROM docs WHERE domain = ?`);
    this.deleteDocStmt = db.prepare(`DELETE FROM docs WHERE domain = ? AND id = ?`);
    this.putBlobStmt = db.prepare(
      `INSERT INTO blobs (key, data) VALUES (?, ?)
       ON CONFLICT (key) DO UPDATE SET data = excluded.data`
    );
    this.getBlobStmt = db.prepare(`SELECT data FROM blobs WHERE key = ?`);
    this.deleteBlobStmt = db.prepare(`DELETE FROM blobs WHERE key = ?`);
    this.nextSeqStmt = db.prepare(
      `SELECT COALESCE(MAX(seq), 0) + 1 AS next FROM streams WHERE domain = ? AND id = ?`
    );
    this.appendLineStmt = db.prepare(
      `INSERT INTO streams (domain, id, seq, line) VALUES (?, ?, ?, ?)`
    );
    this.readStreamStmt = db.prepare(
      `SELECT line FROM streams WHERE domain = ? AND id = ? ORDER BY seq ASC`
    );
    this.deleteStreamStmt = db.prepare(`DELETE FROM streams WHERE domain = ? AND id = ?`);
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
    const rows = this.listDocStmt.all(domain) as { body: string }[];
    const out: T[] = [];
    for (const row of rows) {
      const doc = JSON.parse(row.body) as T;
      if (
        !filter ||
        Object.entries(filter).every(
          ([key, expected]) => (doc as Record<string, unknown>)[key] === expected
        )
      ) {
        out.push(doc);
      }
    }
    return out;
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
