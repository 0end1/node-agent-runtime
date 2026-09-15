/**
 * Artifact contracts (docs/architecture.md §8.1, M4).
 *
 * M6 C3 决策：Artifact **类型下沉 C1**，实现（`ArtifactManager`）并入 C3
 * `@node-agent-runtime/memory`——二者同为 Storage 读写，且下沉后 C3 只依赖 types，
 * 不会与 core 形成循环（决策见 `docs/remaining-tasks.md` §3 C3）。
 *
 * An Artifact is a metadata document plus a payload:
 *   - `text`/`file`/`chart` payloads go to the Storage blob domain; the
 *     `locator` is `blob:<key>` and reads are transparent to the caller.
 *   - `url` artifacts carry no payload; `locator` is the URL itself.
 */

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
