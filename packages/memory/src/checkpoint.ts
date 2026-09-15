import type { AnyTool, Storage } from "@node-agent-runtime/types";
import type { ChatMessage, RunUsage } from "@node-agent-runtime/types";
import { newId, ErrorCode } from "@node-agent-runtime/types";

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
  /**
   * M7-5: fingerprint of the recipe instructions. Absent in checkpoints written
   * before M7-5 (and in hosts that do not use `compileAgent()`), in which case
   * resumability falls back to `toolsHash` + `agentId` only (§8-12).
   */
  instructionsHash?: string;
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
  /**
   * M7-6a: the tool surface of the step that produced this checkpoint
   * (`declared` / `used`). Independent of `toolsHash` (which fingerprints the
   * agent recipe for resume safety) — a change here must not trip resumability.
   */
  toolSurface?: { declared: readonly string[]; used: readonly string[] };
  createdAt: number;
}

export type CheckpointSeed = Omit<Checkpoint, "id" | "createdAt"> & { id?: string };

/** Thrown when a checkpoint cannot be replayed by the current agent recipe. */
export class CheckpointMismatchError extends Error {
  readonly code = ErrorCode.CHECKPOINT_MISMATCH;
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

/**
 * Fingerprint of a recipe's instructions (M7-5, §8-12).
 *
 * Deliberately separate from `computeToolsHash`: a tool-set change makes the
 * recorded transcript impossible to replay (hard failure), whereas an
 * instructions change only drifts the semantics — still blocked by default,
 * but a host may explicitly accept it.
 */
export function computeInstructionsHash(agent: { instructions?: string }): string {
  return fnv1a32(JSON.stringify({ instructions: agent.instructions ?? "" }));
}

export interface AssertResumableOptions {
  /**
   * Accept a recipe whose instructions changed (M7-5 §8-12).
   * The tool set is still checked — this only relaxes the semantic-drift guard.
   */
  allowInstructionChange?: boolean;
}

/** Guard a resume: the recipe that produced the checkpoint must still match. */
export function assertResumable(
  checkpoint: Checkpoint,
  agent: ToolSurface & { instructions?: string },
  options: AssertResumableOptions = {},
): void {
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
  const expectedInstructions = checkpoint.agentSnapshot.instructionsHash;
  if (expectedInstructions !== undefined && !options.allowInstructionChange) {
    const actual = computeInstructionsHash(agent);
    if (actual !== expectedInstructions) {
      throw new CheckpointMismatchError(
        checkpoint.id,
        `checkpoint ${checkpoint.id} 的配方指令已变化（instructionsHash ${expectedInstructions} → ${actual}），无法续跑；确认接受语义漂移时传 { allowInstructionChange: true }`,
      );
    }
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
