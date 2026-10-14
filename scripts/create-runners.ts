#!/usr/bin/env bun
/**
 * Creates or updates the token-optimized runner fleet over REST.
 *
 * Assumes the MoonlightQ server is already running and claude, codex, opencode and copilot
 * are installed and logged in. The Copilot runner is a `custom` runner, so the server
 * must have been started with MOONLIGHTQ_ALLOW_CUSTOM_RUNNERS=1 (otherwise it is rejected).
 *
 * Idempotent: runners are matched by name. A missing runner is created; an existing one
 * gets only the fields that differ from the definition below (nothing is sent when it
 * already matches). `enabled` is applied on creation only, so re-running never starts or
 * stops a runner you toggled by hand.
 *
 * Env overrides:
 *   MOONLIGHTQ_URL   server base URL            (default http://localhost:3000)
 *   PROJECT_ID       scope every runner to one project (default: any project)
 *   SONNET_MODEL     (default claude-sonnet-5-5)
 *   OPUS_MODEL       (default claude-opus-5-5)
 *   HAIKU_MODEL      (default claude-haiku-5-5)
 *   LUNA_MODEL       Codex model id for GPT-6 Luna (default gpt-6-luna)
 *   MIMO_MODEL       (default opencode/mimo-v2.6-flash-free)
 *
 * Usage: bun scripts/create-runners.ts [--dry-run]
 */

import type { CreateRunnerInput, UpdateRunnerInput } from "../packages/shared/src/schemas";
import type { Runner } from "../packages/shared/src/types";

const env = process.env;
const baseUrl = (env.MOONLIGHTQ_URL ?? "http://localhost:3000").replace(/\/$/, "");
const projectId = env.PROJECT_ID || null;
const dryRun = process.argv.includes("--dry-run");

const SONNET = env.SONNET_MODEL ?? "claude-sonnet-5-5";
const OPUS = env.OPUS_MODEL ?? "claude-opus-5-5";
const HAIKU = env.HAIKU_MODEL ?? "claude-haiku-5-5";
const LUNA = env.LUNA_MODEL ?? "gpt-6-luna";
const MIMO = env.MIMO_MODEL ?? "opencode/mimo-v2.6-flash-free";

// The custom runner appends the prompt as the last argv entry (it becomes $0 for sh -c)
// and exposes it as $MOONLIGHTQ_PROMPT; the job's MCP config path is in $MOONLIGHTQ_MCP_CONFIG.
// No --model: Copilot Free does not allow choosing one.
const copilotCmd = 'copilot -p "$MOONLIGHTQ_PROMPT" --allow-all-tools --additional-mcp-config "@$MOONLIGHTQ_MCP_CONFIG"';

type Desired = Required<Omit<CreateRunnerInput, "enabled">> & { enabled: boolean };

const runners: Desired[] = [
  // Claude Pro: only the phases where quality pays off. Concurrency 1 protects the usage window.
  { name: "sonnet-planner", tool: "claude", model: SONNET, effort: "high", roles: ["plan"], concurrency: 1, enabled: true },
  { name: "sonnet-coder", tool: "claude", model: SONNET, effort: "medium", roles: ["code"], concurrency: 1, enabled: true },
  { name: "opus-architect", tool: "claude", model: OPUS, effort: "high", roles: ["plan"], concurrency: 1, enabled: false },

  // ChatGPT Free: independent critic on a different vendor than the planner/coder.
  { name: "luna-critic", tool: "codex", model: LUNA, effort: "medium", roles: ["plan_review", "review"], concurrency: 1, enabled: true },

  // Copilot Free: second review pool, fallback when Luna is rate-limited. Uses Copilot's default model.
  { name: "copilot-reviewer", tool: "custom", roles: ["review"], concurrency: 1, extraArgs: ["sh", "-c", copilotCmd], enabled: true },

  // OpenCode free model: mechanical, high-volume phases.
  { name: "mimo-worker", tool: "opencode", model: MIMO, effort: "low", roles: ["refine", "verify", "pr"], concurrency: 2, enabled: true },

  // Claude fallback for the mechanical phases if MiMo is down.
  { name: "haiku-fallback", tool: "claude", model: HAIKU, effort: "low", roles: ["verify", "pr"], concurrency: 1, enabled: false },
].map((r) => ({
  model: null,
  effort: null,
  extraArgs: null,
  permissionMode: "safe",
  pollIntervalSec: 5,
  projectId,
  ...r,
}) as Desired);

const COMPARED = ["tool", "roles", "projectId", "model", "effort", "concurrency", "pollIntervalSec", "permissionMode", "extraArgs"] as const;

/** The fields of `want` that differ from `have` (empty when the runner already matches). */
function diff(have: Runner, want: Desired): UpdateRunnerInput {
  const patch: Record<string, unknown> = {};
  for (const key of COMPARED) {
    if (JSON.stringify(have[key] ?? null) !== JSON.stringify(want[key] ?? null)) patch[key] = want[key];
  }
  return patch as UpdateRunnerInput;
}

async function api(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
}

async function existingRunners(): Promise<Map<string, Runner>> {
  const res = await api("/api/runners");
  if (!res.ok) throw new Error(`GET /api/runners failed: ${res.status} ${await res.text()}`);
  const byName = new Map<string, Runner>();
  for (const r of (await res.json()) as Runner[]) {
    if (byName.has(r.name)) console.warn(`warning: several runners named ${r.name}; updating the first`);
    else byName.set(r.name, r);
  }
  return byName;
}

async function main(): Promise<void> {
  let existing = new Map<string, Runner>();
  try {
    existing = await existingRunners();
  } catch (err) {
    if (!dryRun) throw err;
    console.warn(`server not reachable at ${baseUrl}; dry run treats every runner as new`);
  }
  let failed = 0;

  for (const want of runners) {
    const have = existing.get(want.name);
    let res: Response;

    if (have) {
      const patch = diff(have, want);
      const fields = Object.keys(patch);
      if (fields.length === 0) {
        console.log(`ok      ${want.name} (up to date)`);
        continue;
      }
      if (dryRun) {
        console.log(`dry-run update ${want.name}`, JSON.stringify(patch));
        continue;
      }
      res = await api(`/api/runners/${have.id}`, { method: "PUT", body: JSON.stringify(patch) });
      if (res.ok) console.log(`updated ${want.name} (${fields.join(", ")})`);
    } else {
      if (dryRun) {
        console.log(`dry-run create ${want.name}`, JSON.stringify(want));
        continue;
      }
      res = await api("/api/runners", { method: "POST", body: JSON.stringify(want) });
      if (res.ok) {
        console.log(`created ${want.name} [${want.tool} ${want.model ?? "default model"}] ${want.enabled ? "enabled" : "disabled"}`);
      }
    }

    if (!res.ok) {
      failed++;
      console.error(`failed  ${want.name}: ${res.status} ${await res.text()}`);
    }
  }

  if (failed) process.exit(1);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
