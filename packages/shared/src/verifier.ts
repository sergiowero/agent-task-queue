/**
 * Who verifies submitted code. The server's built-in verifier (no LLM) runs the project's
 * commands while it is online. A project can hand verification to an agent with the `verify`
 * role instead (`policy.verifier: "agent"`), and while the built-in verifier is offline an
 * enabled runner with that role takes over, so code still reaches `verify_requested`.
 */
import { modelKey } from "./catalog.js";
import { getAppState, getRunners, setAppState } from "./database.js";
import type { PolicySettings } from "./policy.js";
import type { Runner, Task } from "./types.js";

/** Minutes after which the built-in verifier's heartbeat counts as gone. */
const VERIFIER_STALE_MS = 2 * 60_000;
/** The web server beats every minute (its sweep); it counts as gone after three missed beats. */
const SERVER_STALE_MS = 3 * 60_000;
/** Minutes code may wait for the built-in verifier once it stopped beating (it may be restarting). */
export const VERIFY_WAIT_MIN = 5;

function beatWithin(key: string, maxAgeMs: number, now: number): boolean {
  const beat = getAppState(key);
  if (!beat) return false;
  const at = new Date(beat.value).getTime();
  return now - (Number.isFinite(at) ? at : new Date(beat.updatedAt).getTime()) < maxAgeMs;
}

/** Whether the built-in verifier (the web server's worker) is running. */
export function verifierOnline(now = Date.now()): boolean {
  return beatWithin("verifier_heartbeat", VERIFIER_STALE_MS, now);
}

/** The web server says it is up (it runs the runners); called by its sweep, every minute. */
export function recordServerHeartbeat(now = new Date()): void {
  setAppState("server_heartbeat", now.toISOString());
}

/** The web server is going down: its runners go with it, so none of them counts as available any more. */
export function markServerOffline(): void {
  recordServerHeartbeat(new Date(0));
}

/** Whether the web server, and so its runners, is up. */
export function serverOnline(now = Date.now()): boolean {
  return beatWithin("server_heartbeat", SERVER_STALE_MS, now);
}

/** Whether `runner` may verify the task's code: it is not the one that wrote it, nor (when required) on its model. */
function runnerMayVerify(runner: Runner, task: Task, requireDifferentModel: boolean): boolean {
  const code = task.producers.code;
  const authors = code?.identities ?? [code?.sessionKey];
  if (authors.includes(`runner:${runner.id}`)) return false;
  if (!requireDifferentModel) return true;
  const models = code?.modelKeys ?? [code?.model ? modelKey(code.tool, code.model) : null];
  return !models.includes(modelKey(runner.tool, runner.model));
}

/**
 * Whether an enabled runner with the `verify` role, on the task's project, may take its
 * verification (separation of duties included) and the server that runs it is up.
 */
export function agentVerifierAvailable(
  task: Task,
  policy: Pick<PolicySettings, "requireDifferentModel">,
  now = Date.now(),
): boolean {
  if (!serverOnline(now)) return false;
  return getRunners().some(
    (r) =>
      r.enabled &&
      r.roles.includes("verify") &&
      (r.projectId === null || r.projectId === task.projectId) &&
      runnerMayVerify(r, task, policy.requireDifferentModel),
  );
}

/**
 * Who will verify code submitted now, or null when nobody can (it goes to review, unverified).
 * A project set to `agent` always waits for an agent, by configuration: with or without project
 * commands, whatever the built-in verifier does. Any other project has the built-in verifier when
 * there is something to run and it is online, else a runner with the verify role that may take it.
 */
export function verifierFor(
  task: Task,
  policy: Pick<PolicySettings, "verifier" | "requireDifferentModel">,
  hasCommands: boolean,
  now = Date.now(),
): "builtin" | "agent" | null {
  if (policy.verifier === "agent") return "agent";
  if (!hasCommands) return null;
  if (verifierOnline(now)) return "builtin";
  return agentVerifierAvailable(task, policy, now) ? "agent" : null;
}

/** How long code waits in `verify_requested` for its verifier, and which one it waits for. */
export interface VerifyWait {
  minutes: number;
  by: "builtin" | "agent";
}

/**
 * How long a task waiting in `verify_requested` may wait before its code goes on to review,
 * unverified; null: it keeps waiting. The built-in verifier, while it beats, is given all the time
 * it needs. Once it stopped, it gets a few minutes (it may be restarting). An agent verifier (the
 * project's choice, or the runner that took over) gets the project's `reviewStarvationMin`, the
 * same wait as a review for its reviewer (0 = never hand it over).
 */
export function verifyWait(
  task: Task,
  policy: Pick<PolicySettings, "verifier" | "requireDifferentModel" | "reviewStarvationMin">,
  now = Date.now(),
): VerifyWait | null {
  const agent: VerifyWait | null =
    policy.reviewStarvationMin > 0 ? { minutes: policy.reviewStarvationMin, by: "agent" } : null;
  if (policy.verifier === "agent") return agent;
  if (verifierOnline(now)) return null;
  return agentVerifierAvailable(task, policy, now) ? agent : { minutes: VERIFY_WAIT_MIN, by: "builtin" };
}
