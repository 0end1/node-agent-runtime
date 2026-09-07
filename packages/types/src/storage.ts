/**
 * Storage contract (see docs/architecture.md §9).
 *
 * M6 拆包前置：契约由 C2 `core/src/store/types.ts` **下沉至 C1**，让 C3
 *（memory/artifact）等外置包只依赖 types，从而消除 core ↔ 子包的循环依赖
 *（决策见 `docs/remaining-tasks.md` §3 C1/C3）。
 *
 * The engine never touches disk/SQLite directly. Everything that needs to
 * survive a process restart goes through this single interface.
 */

/** Document domains: one JSON document per id, overwritten atomically. */
export type DocDomain =
  | "session"
  | "task"
  | "run"
  | "agent"
  /** M2: run/step snapshots used by resume (docs/architecture.md §9). */
  | "checkpoint"
  /** M2: long-term fact memory, one KV document per session (§8.2). */
  | "memory"
  /** M4: artifact metadata rows (§8.1); payloads live in the blob domain. */
  | "artifact";

/** Stream domains: append-only lines (messages, event logs…). */
export type StreamDomain = "message";

export interface Storage {
  // ---- Document domain: id -> JSON document ----
  saveDoc<T extends object>(domain: DocDomain, id: string, doc: T): Promise<void>;
  loadDoc<T extends object>(domain: DocDomain, id: string): Promise<T | undefined>;
  listDocs<T extends object>(domain: DocDomain, filter?: Partial<T>): Promise<T[]>;
  deleteDoc(domain: DocDomain, id: string): Promise<void>;

  // ---- Blob domain: binary artifacts (Artifact payloads, M4) ----
  putBlob(key: string, data: Uint8Array): Promise<void>;
  getBlob(key: string): Promise<Uint8Array | undefined>;
  deleteBlob(key: string): Promise<void>;

  // ---- Stream domain: append-only log per id ----
  appendStream(domain: StreamDomain, id: string, line: string): Promise<void>;
  readStream(domain: StreamDomain, id: string): Promise<string[]>;
  deleteStream(domain: StreamDomain, id: string): Promise<void>;
}
