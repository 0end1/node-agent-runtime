// ---- C9 optional SQLite storage backend ----
// Implements the core Storage trait; opt-in only, never imported by the engine.
export { SQLiteStorage, SCHEMA_VERSION } from "./sqlite.js";
export type { SQLiteStorageOptions } from "./sqlite.js";
