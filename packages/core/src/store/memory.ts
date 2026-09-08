import type { DocDomain, Storage, StreamDomain } from "@agent-runtime/types";

/**
 * In-memory Storage — the zero-I/O implementation bundled with the core.
 * Used by tests, offline demos and as a building block for hot paths where
 * persistence is deferred to the host.
 */
export class MemoryStorage implements Storage {
  private docs = new Map<DocDomain, Map<string, unknown>>();
  private blobs = new Map<string, Uint8Array>();
  private streams = new Map<`${StreamDomain}:${string}`, string[]>();

  async saveDoc<T extends object>(domain: DocDomain, id: string, doc: T): Promise<void> {
    let bucket = this.docs.get(domain);
    if (!bucket) {
      bucket = new Map();
      this.docs.set(domain, bucket);
    }
    // Store a deep copy so later mutations of the caller's object cannot
    // corrupt what was persisted (round-trip through JSON also keeps the
    // stored shape consistent with a file-backed store).
    bucket.set(id, structuredClone(doc));
  }

  async loadDoc<T extends object>(domain: DocDomain, id: string): Promise<T | undefined> {
    return this.docs.get(domain)?.get(id) as T | undefined;
  }

  async listDocs<T extends object>(domain: DocDomain, filter?: Partial<T>): Promise<T[]> {
    const bucket = this.docs.get(domain);
    if (!bucket) return [];
    const all = [...bucket.values()] as T[];
    if (!filter) return all;
    return all.filter((doc) =>
      Object.entries(filter).every(
        ([key, expected]) => (doc as Record<string, unknown>)[key] === expected,
      ),
    );
  }

  async deleteDoc(domain: DocDomain, id: string): Promise<void> {
    this.docs.get(domain)?.delete(id);
  }

  async putBlob(key: string, data: Uint8Array): Promise<void> {
    this.blobs.set(key, new Uint8Array(data));
  }

  async getBlob(key: string): Promise<Uint8Array | undefined> {
    return this.blobs.get(key);
  }

  async deleteBlob(key: string): Promise<void> {
    this.blobs.delete(key);
  }

  async appendStream(domain: StreamDomain, id: string, line: string): Promise<void> {
    const key: `${StreamDomain}:${string}` = `${domain}:${id}`;
    const bucket = this.streams.get(key) ?? [];
    bucket.push(line);
    this.streams.set(key, bucket);
  }

  async readStream(domain: StreamDomain, id: string): Promise<string[]> {
    return [...(this.streams.get(`${domain}:${id}`) ?? [])];
  }

  async deleteStream(domain: StreamDomain, id: string): Promise<void> {
    this.streams.delete(`${domain}:${id}`);
  }
}
