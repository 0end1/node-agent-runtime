/**
 * Artifact — user-visible / referenceable outputs of tools & agents
 * (docs/architecture.md §8.1, M4).
 *
 * An Artifact is a metadata document plus a payload:
 *
 *   - `text`/`file`/`chart` payloads go to the Storage blob domain; the
 *     `locator` is `blob:<key>` and reads are transparent to the caller.
 *   - `url` artifacts carry no payload; `locator` is the URL itself.
 *
 * Metadata rows live in the `artifact` doc domain so they can be listed per
 * session/run by the host UI without touching payload bytes.
 */

import { newId } from "@agent-runtime/types";
import type { Storage } from "./store/types.js";

export type ArtifactKind = "text" | "file" | "chart" | "mcp-resource" | "url";

export interface Artifact {
  readonly id: string;
  kind: ArtifactKind;
  /** Display name shown in the host UI. */
  name: string;
  /** Media type normalized from the kind unless explicitly overridden. */
  mime: string;
  /**
   * Opaque payload locator the store resolves:
   * `blob:<key>` for stored payloads, a plain URL for `url` artifacts.
   */
  locator: string;
  meta: Record<string, unknown>;
  sessionId: string;
  runId?: string;
  createdAt: number;
}

const BLOB_PREFIX = "blob:";

export const MIME_BY_KIND: Record<ArtifactKind, string> = {
  text: "text/plain",
  file: "application/octet-stream",
  chart: "image/svg+xml",
  "mcp-resource": "application/octet-stream",
  url: "text/html",
};

export function blobKeyOf(locator: string): string | undefined {
  return locator.startsWith(BLOB_PREFIX) ? locator.slice(BLOB_PREFIX.length) : undefined;
}

export interface ArtifactInput {
  sessionId: string;
  runId?: string;
  kind: ArtifactKind;
  name: string;
  /** Override the kind-derived media type. */
  mime?: string;
  /** Payload for `text`/`file`/`chart`/`mcp-resource`. */
  content?: string | Uint8Array;
  /** Target URL for `url` artifacts. */
  url?: string;
  meta?: Record<string, unknown>;
  /** Explicit id (host references like resource URIs). Defaults to a fresh one. */
  id?: string;
}

export interface ArtifactManagerOptions {
  storage: Storage;
  /** Clock injectable for deterministic tests. */
  now?: () => number;
}

export class ArtifactError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArtifactError";
  }
}

/**
 * CRUD for artifacts over a Storage. Saving upserts by id; removing frees both
 * the metadata doc and (when present) the blob payload.
 */
export class ArtifactManager {
  private readonly storage: Storage;
  private readonly now: () => number;

  constructor(options: ArtifactManagerOptions) {
    this.storage = options.storage;
    this.now = options.now ?? (() => Date.now());
  }

  async save(input: ArtifactInput): Promise<Artifact> {
    if (!input.sessionId) throw new ArtifactError("artifact 需要 sessionId");
    if (!input.name?.trim()) throw new ArtifactError("artifact 需要一个非空 name");
    const id = input.id?.trim() ? input.id.trim() : newId("artifact");

    let locator: string;
    if (input.kind === "url") {
      if (!input.url?.trim()) throw new ArtifactError("url artifact 需要 url");
      locator = input.url.trim();
    } else {
      const key = `artifact:${id}`;
      locator = `${BLOB_PREFIX}${key}`;
      await this.storage.putBlob(key, toBytes(input.content));
    }

    const artifact: Artifact = {
      id,
      kind: input.kind,
      name: input.name.trim(),
      mime: input.mime?.trim() || MIME_BY_KIND[input.kind],
      locator,
      meta: input.meta ?? {},
      sessionId: input.sessionId,
      ...(input.runId ? { runId: input.runId } : {}),
      createdAt: this.now(),
    };
    await this.storage.saveDoc("artifact", id, artifact);
    return artifact;
  }

  async get(id: string): Promise<Artifact | undefined> {
    return this.storage.loadDoc<Artifact>("artifact", id);
  }

  /** List a session's artifacts, newest first; optional run filter. */
  async list(sessionId: string, runId?: string): Promise<Artifact[]> {
    const all = await this.storage.listDocs<Artifact>("artifact", { sessionId });
    const filtered = runId ? all.filter((a) => a.runId === runId) : all;
    return filtered.sort((a, b) => b.createdAt - a.createdAt);
  }

  /** Raw payload bytes of a stored artifact (undefined for url or missing). */
  async readBytes(id: string): Promise<Uint8Array | undefined> {
    const artifact = await this.get(id);
    if (!artifact) return undefined;
    const key = blobKeyOf(artifact.locator);
    if (!key) return undefined;
    return this.storage.getBlob(key);
  }

  /** Payload decoded as UTF-8 text (undefined for url or missing). */
  async readText(id: string): Promise<string | undefined> {
    const bytes = await this.readBytes(id);
    return bytes === undefined ? undefined : new TextDecoder().decode(bytes);
  }

  /** Delete metadata + payload. Safe to call twice / on unknown ids. */
  async remove(id: string): Promise<void> {
    const artifact = await this.get(id);
    const key = artifact ? blobKeyOf(artifact.locator) : undefined;
    if (key) await this.storage.deleteBlob(key);
    await this.storage.deleteDoc("artifact", id);
  }
}

function toBytes(content: string | Uint8Array | undefined): Uint8Array {
  if (content === undefined || content === null) return new Uint8Array(0);
  return typeof content === "string" ? new TextEncoder().encode(content) : content;
}
