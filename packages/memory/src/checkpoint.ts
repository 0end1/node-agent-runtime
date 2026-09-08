import type { AnyTool, Storage } from "@agent-runtime/types";
import type { ChatMessage, RunUsage } from "@agent-runtime/types";
import { newId } from "@agent-runtime/types";

/**
 * Checkpoint (docs/architecture.md §9).
 *
 * A checkpoint is a *step-granular snapshot* of a running run: the full
 * message transcript, the accumulated usage, and a fingerprint of the agent
 * recipe that produced it. The host writes one per completed step, so an
 * interruption (abort, crash, network loss) can be resumed by replaying the
 * snapshot instead of restarting the task.
 *
 * The engine stays checkpoint-agnostic: it only exposes a per-step snapshot
 * hook (`RunOptions.onStepEnd`); everything here is host-side persistence.
 */

/**
 * Minimal structural view of an agent recipe used for checkpoint fingerprinting.
 * Structured typing (not the `Agent` class) keeps this module independent of the
 * engine, so it can live outside the core (M6 P1 review, P2).
 */
export interface ToolSurface {
  name: string;
  tools: readonly AnyTool[];
}

export interface AgentSnapshot {
  agentId: string;
  /** Fingerprint of the tool surface, verified before a resume. */
  toolsHash: string;
}

export interface Checkpoint {
  readonly id: string;
  runId: string;
  sessionId: string;
  taskId: string;
  /** Steps completed at snapshot time (1-based). */
  step: number;
  /** The user input this run was answering (kept so a resume can re-use it). */
  input: string;
  /** Full transcript up to and including `step`. */
  messages: ChatMessage[];
  usage: RunUsage;
  agentSnapshot: AgentSnapshot;
  createdAt: number;
}

export type CheckpointSeed = Omit<Checkpoint, "id" | "createdAt"> & { id?: string };

/** Thrown when a checkpoint cannot be replayed by the current agent recipe. */
export class CheckpointMismatchError extends Error {
  constructor(
    readonly checkpointId: string,
    message: string,
  ) {
    super(message);
    this.name = "CheckpointMismatchError";
  }
}

export interface CheckpointStoreOptions {
  storage: Storage;
  now?: () => number;
}

export class CheckpointStore {
  private readonly storage: Storage;
  private readonly now: () => number;

  constructor(options: CheckpointStoreOptions) {
    this.storage = options.storage;
    this.now = options.now ?? (() => Date.now());
  }

  async save(seed: CheckpointSeed): Promise<Checkpoint> {
    const checkpoint: Checkpoint = {
      ...seed,
      id: seed.id?.trim() ? seed.id.trim() : newId("ckpt"),
      createdAt: this.now(),
    };
    await this.storage.saveDoc("checkpoint", checkpoint.id, checkpoint);
    return checkpoint;
  }

  async load(id: string): Promise<Checkpoint | undefined> {
    return this.storage.loadDoc<Checkpoint>("checkpoint", id);
  }

  async listByRun(runId: string): Promise<Checkpoint[]> {
    const all = await this.storage.listDocs<Checkpoint>("checkpoint", { runId });
    return all.sort((a, b) => a.step - b.step || a.createdAt - b.createdAt);
  }

  async listByTask(taskId: string): Promise<Checkpoint[]> {
    const all = await this.storage.listDocs<Checkpoint>("checkpoint", { taskId });
    return all.sort((a, b) => a.createdAt - b.createdAt);
  }

  /** The most advanced step persisted for a run. */
  async latest(runId: string): Promise<Checkpoint | undefined> {
    const list = await this.listByRun(runId);
    return list.at(-1);
  }

  async delete(id: string): Promise<void> {
    await this.storage.deleteDoc("checkpoint", id);
  }
}

/**
 * Fingerprint of an agent's tool surface (name + parameter schema, order
 * independent). A resume refuses to replay a checkpoint whose tools have
 * changed, because the transcript would no longer match the recipe.
 */
export function computeToolsHash(agent: ToolSurface): string {
  const canonical = JSON.stringify({
    tools: [...agent.tools]
      .map((tool) => ({ name: tool.name, parameters: tool.parameters ?? null }))
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)),
  });
  return fnv1a32(canonical);
}

/** Guard a resume: the recipe that produced the checkpoint must still match. */
export function assertResumable(checkpoint: Checkpoint, agent: ToolSurface): void {
  const hash = computeToolsHash(agent);
  if (hash !== checkpoint.agentSnapshot.toolsHash) {
    throw new CheckpointMismatchError(
      checkpoint.id,
      `checkpoint ${checkpoint.id} 的工具集已变化（toolsHash ${checkpoint.agentSnapshot.toolsHash} → ${hash}），无法续跑`,
    );
  }
  if (agent.name !== checkpoint.agentSnapshot.agentId) {
    throw new CheckpointMismatchError(
      checkpoint.id,
      `checkpoint ${checkpoint.id} 属于 Agent "${checkpoint.agentSnapshot.agentId}"，与当前配方 "${agent.name}" 不一致`,
    );
  }
}

/** FNV-1a 32-bit, hex encoded: tiny, dependency-free and stable across runs. */
function fnv1a32(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}
