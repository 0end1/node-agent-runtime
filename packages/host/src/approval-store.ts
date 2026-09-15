// C8 host：审批审计 + always 白名单的 Storage 实现（P3.3）。
import type {
  ApprovalQuery,
  ApprovalRecord,
  ApprovalStore,
  Storage,
  ToolGrant,
} from "@node-agent-runtime/types";
import { newId } from "@node-agent-runtime/types";

/**
 * `ApprovalStore` backed by `Storage`.
 *
 * Layout:
 *   - one doc per governance decision in the `approval` domain (keyed by a
 *     fresh id, ordered by `decidedAt` when listed);
 *   - one doc per granted tool in the `grant` domain, keyed by the encoded
 *     tool name so grants are overwrite/revoke idempotent across restarts.
 *
 * Audit rows intentionally keep only `argumentsFingerprint` — never the raw
 * tool arguments (P3.2 redaction / P3.3 don't-copy-secrets).
 */
export class StorageApprovalStore implements ApprovalStore {
  constructor(private readonly storage: Storage) {}

  async append(record: ApprovalRecord): Promise<void> {
    await this.storage.saveDoc("approval", newId("approval"), record);
  }

  async list(query?: ApprovalQuery): Promise<ApprovalRecord[]> {
    let rows = await this.storage.listDocs<ApprovalRecord>("approval");
    if (query) {
      const keys: ReadonlyArray<"runId" | "sessionId" | "taskId" | "toolName"> = [
        "runId",
        "sessionId",
        "taskId",
        "toolName",
      ];
      for (const key of keys) {
        const wanted = query[key];
        if (wanted !== undefined) rows = rows.filter((row) => row[key] === wanted);
      }
    }
    return rows.sort((a, b) => a.decidedAt - b.decidedAt);
  }

  async grants(): Promise<ToolGrant[]> {
    return this.storage.listDocs<ToolGrant>("grant");
  }

  async grantTool(grant: ToolGrant): Promise<void> {
    await this.storage.saveDoc("grant", grantId(grant.toolName), grant);
  }

  async revokeTool(toolName: string): Promise<void> {
    await this.storage.deleteDoc("grant", grantId(toolName));
  }
}

/** Doc id for a grant row — tool names are arbitrary strings, so encode them. */
function grantId(toolName: string): string {
  return `grant_${encodeURIComponent(toolName)}`;
}
