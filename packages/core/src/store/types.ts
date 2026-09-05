/**
 * Storage abstraction (see docs/architecture.md §9).
 *
 * The engine never touches disk/SQLite directly. Everything that needs to
 * survive a process restart goes through this single interface. The core
 * ships an in-memory implementation; a Node file implementation is provided
 * for single-machine desktop use.
 */

/** Document domains: one JSON document per id, overwritten atomically. */
export type DocDomain = "session" | "task" | "run" | "agent";

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
