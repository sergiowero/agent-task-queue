/**
 * Test helpers: put a task in any status without walking the workflow, the way
 * an agent's claim would leave it. Exported as `@agentq/shared/testing`.
 */
import { randomUUID } from "crypto";
import { getTaskById, patchTask } from "./database.js";
import type { TaskStatus } from "./catalog.js";
import { STATUS_INFO } from "./catalog.js";
import type { AgentReference, Task } from "./types.js";

export interface ForceStatusOptions {
  /** Hold the task with a claim token (default: true for active statuses). */
  claim?: boolean;
  agent?: AgentReference;
}

export function forceStatus(
  taskId: string,
  status: TaskStatus,
  opts: ForceStatusOptions = {},
): { task: Task; claimToken: string | null } {
  const claim = opts.claim ?? STATUS_INFO[status].kind === "active";
  const claimToken = claim ? randomUUID() : null;
  patchTask(taskId, {
    status,
    claimToken,
    assignedAgent: claim ? (opts.agent ?? { name: "test", tool: "test", model: "test", agentId: "test@1|test" }) : null,
  });
  return { task: getTaskById(taskId)!, claimToken };
}
