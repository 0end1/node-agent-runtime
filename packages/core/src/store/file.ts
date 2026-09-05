import { appendFile, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { DocDomain, Storage, StreamDomain } from "./types.js";

const DOC_EXT = ".json";
const STREAM_EXT = ".ndjson";

/**
 * FileStorage — a directory-backed Storage for single-machine desktop use.
 *
 * Layout under the root dir:
 *   <root>/<domain>/<id>.json     one JSON document per id
 *   <root>/blob/<key>             raw binary artifacts
 *   <root>/<domain>.stream/<id>.ndjson   append-only lines per id
 *
 * Writes are atomic-ish: docs are written to a temp file then renamed.
 */
export class FileStorage implements Storage {
  constructor(private readonly root: string) {}

  async saveDoc<T extends object>(domain: DocDomain, id: string, doc: T): Promise<void> {
    const file = join(this.root, domain, `${safe(id)}${DOC_EXT}`);
    await mkdir(dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
    await writeFile(tmp, JSON.stringify(doc, null, 2), "utf8");
    await rm(file, { force: true });
    await rename(tmp, file);
  }

  async loadDoc<T extends object>(domain: DocDomain, id: string): Promise<T | undefined> {
    try {
      const file = join(this.root, domain, `${safe(id)}${DOC_EXT}`);
      const raw = await readFile(file, "utf8");
      return JSON.parse(raw) as T;
    } catch {
      return undefined;
    }
  }

  async listDocs<T extends object>(domain: DocDomain, filter?: Partial<T>): Promise<T[]> {
    const dir = join(this.root, domain);
    let files: string[];
    try {
      files = await readdir(dir);
    } catch {
      return [];
    }
    const out: T[] = [];
    for (const f of files) {
      if (!f.endsWith(DOC_EXT)) continue;
      try {
        const doc = JSON.parse(await readFile(join(dir, f), "utf8")) as T;
        if (
          !filter ||
          Object.entries(filter).every(
            ([key, expected]) => (doc as Record<string, unknown>)[key] === expected
          )
        ) {
          out.push(doc);
        }
      } catch {
        // skip corrupt/unreadable files instead of failing the whole list
      }
    }
    return out;
  }

  async deleteDoc(domain: DocDomain, id: string): Promise<void> {
    await rm(join(this.root, domain, `${safe(id)}${DOC_EXT}`), { force: true });
  }

  async putBlob(key: string, data: Uint8Array): Promise<void> {
    const file = join(this.root, "blob", safe(key));
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, data);
  }

  async getBlob(key: string): Promise<Uint8Array | undefined> {
    try {
      return await readFile(join(this.root, "blob", safe(key)));
    } catch {
      return undefined;
    }
  }

  async deleteBlob(key: string): Promise<void> {
    await rm(join(this.root, "blob", safe(key)), { force: true });
  }

  async appendStream(domain: StreamDomain, id: string, line: string): Promise<void> {
    const file = join(this.root, `${domain}.stream`, `${safe(id)}${STREAM_EXT}`);
    await mkdir(dirname(file), { recursive: true });
    await appendFile(file, line + "\n", "utf8");
  }

  async readStream(domain: StreamDomain, id: string): Promise<string[]> {
    try {
      const raw = await readFile(
        join(this.root, `${domain}.stream`, `${safe(id)}${STREAM_EXT}`),
        "utf8"
      );
      return raw.split("\n").filter((l) => l.trim().length > 0);
    } catch {
      return [];
    }
  }

  async deleteStream(domain: StreamDomain, id: string): Promise<void> {
    await rm(join(this.root, `${domain}.stream`, `${safe(id)}${STREAM_EXT}`), { force: true });
  }
}

/** Keep ids filesystem-friendly (ids are internally generated, this is belt & braces). */
function safe(segment: string): string {
  return segment.replace(/[^a-zA-Z0-9._-]/g, "_");
}
