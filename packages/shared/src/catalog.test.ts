import { describe, it, expect } from "bun:test";
import {
  ALL_STATUSES,
  CLAIM_RULES,
  DEFAULT_ROLES,
  REVERT_FALLBACK,
  RESOLVE_TARGETS,
  ROLES,
  SEPARATION,
  STATUS_INFO,
  TRANSITIONS,
  TaskStatus,
  UNBLOCK_TARGET,
  canTransition,
  claimRuleFor,
  isPlaceholderSessionId,
  modelKey,
  normalizeRoles,
  normalizeStatus,
  sessionIdentity,
  toolKey,
} from "./catalog.js";

describe("status catalog", () => {
  it("describes every status", () => {
    for (const status of ALL_STATUSES) {
      const info = STATUS_INFO[status];
      expect(info.label.length).toBeGreaterThan(0);
      expect(info.hint.length).toBeGreaterThan(0);
    }
  });

  it("gives every active status a revert target and an unblock target", () => {
    for (const status of ALL_STATUSES.filter((s) => STATUS_INFO[s].kind === "active")) {
      expect({ status, revert: REVERT_FALLBACK[status] }).toMatchObject({ revert: expect.any(String) });
      expect({ status, unblock: UNBLOCK_TARGET[status] }).toMatchObject({ unblock: expect.any(String) });
      expect(canTransition(status, TaskStatus.NeedsHuman)).toBe(true);
    }
  });

  it("claim rules move queued statuses into active ones", () => {
    for (const rule of CLAIM_RULES) {
      expect(STATUS_INFO[rule.to].kind).toBe("active");
      for (const from of rule.from) {
        expect(STATUS_INFO[from].kind).toBe("queued");
        expect(canTransition(from, rule.to)).toBe(true);
      }
    }
  });

  it("every queued status is claimed by exactly one role", () => {
    for (const status of ALL_STATUSES.filter((s) => STATUS_INFO[s].kind === "queued")) {
      const roles = CLAIM_RULES.filter((r) => r.from.includes(status)).map((r) => r.role);
      expect({ status, roles: roles.length }).toEqual({ status, roles: 1 });
      expect(claimRuleFor(status)!.role).toBe(roles[0]);
    }
    expect(claimRuleFor(TaskStatus.Coding)).toBeNull();
  });

  it("each role is one phase with one claim rule", () => {
    expect(CLAIM_RULES.map((r) => r.role)).toEqual([...ROLES]);
    for (const rule of CLAIM_RULES) {
      // The pull-request phase is "merge" (its statuses and skill keep that name).
      expect(STATUS_INFO[rule.to].phase).toBe(rule.role === "pr" ? "merge" : rule.role);
    }
  });

  it("agents that name no roles do everything but verify", () => {
    expect(DEFAULT_ROLES).toEqual(["refine", "plan", "plan_review", "code", "review", "pr"]);
  });

  it("normalizes a role list: known roles, no duplicates, catalog order", () => {
    expect(normalizeRoles(["review", "plan", "review", "boss"])).toEqual(["plan", "review"]);
    expect(normalizeRoles([])).toEqual([]);
  });

  it("finished tasks go nowhere; needs_human goes only to resolve targets (and split, for a plan sent on)", () => {
    expect(TRANSITIONS[TaskStatus.Complete]).toEqual([]);
    expect(TRANSITIONS[TaskStatus.Canceled]).toEqual([]);
    const targets = new Set([...Object.values(RESOLVE_TARGETS).flat(), TaskStatus.Split]);
    expect(new Set(TRANSITIONS[TaskStatus.NeedsHuman])).toEqual(targets);
  });

  it("a blocker in coding, verification or review can send the task back to planning", () => {
    for (const phase of ["code", "verify", "review"] as const) {
      expect(RESOLVE_TARGETS[phase]).toContain(TaskStatus.PlanChangesRequested);
    }
    expect(canTransition(TaskStatus.WaitingCodeReview, TaskStatus.PlanChangesRequested)).toBe(true);
  });

  it("maps the legacy ready-for-code spelling", () => {
    expect(normalizeStatus("ready for code")).toBe(TaskStatus.ReadyForCode);
  });
});

describe("identities for separation of duties", () => {
  it("keeps whoever produced a plan or code off its critique, verification and review", () => {
    expect(SEPARATION).toEqual({
      [TaskStatus.PlanReviewRequested]: "plan",
      [TaskStatus.VerifyRequested]: "code",
      [TaskStatus.CodeReviewRequested]: "code",
    });
    for (const status of Object.keys(SEPARATION) as TaskStatus[]) expect(STATUS_INFO[status].kind).toBe("queued");
  });

  it("spells each tool one way", () => {
    expect(["claude", "Claude Code", "claude-code", " CLAUDE_CODE "].map(toolKey)).toEqual(Array(4).fill("claude"));
    expect(["gemini-cli", "codex-cli", "opencode", "Kimi"].map(toolKey)).toEqual(["gemini", "codex", "opencode", "kimi"]);
    expect(toolKey("")).toBe("unknown");
  });

  it("normalizes models; a model-less claim is its tool's default", () => {
    const table: [string, string | null, string][] = [
      ["claude", null, "claude:default"],
      ["claude", "", "claude:default"],
      ["Claude Code", "default", "claude:default"],
      ["codex", "default", "codex:default"],
      ["agentq-verifier", "none", "agentq-verifier:default"],
      ["claude", "sonnet", "claude-sonnet"],
      ["claude", "Sonnet", "claude-sonnet"],
      ["opencode", "anthropic/sonnet", "claude-sonnet"],
      ["claude", "claude-sonnet-5", "claude-sonnet"],
      ["claude", "claude-sonnet-4-5-20250929", "claude-sonnet"],
      ["claude", "claude-sonnet-4@20250514", "claude-sonnet"],
      ["claude", "claude-3-5-sonnet-latest", "claude-sonnet"],
      ["custom", "us.anthropic.claude-sonnet-4-20250514-v1:0", "claude-sonnet"],
      ["claude", "opus", "claude-opus"],
      ["claude", "claude-opus-4-5[1m]", "claude-opus"],
      ["claude", "haiku", "claude-haiku"],
      ["claude", "opusplan", "opusplan"],
      ["codex", "gpt-5", "gpt-5"],
      ["opencode", "openai/GPT-5", "gpt-5"],
      ["codex", "gpt-5-codex", "gpt-5-codex"],
      ["codex", "gpt-4o-2024-08-06", "gpt-4o"],
      ["gemini", "models/gemini-2.5-pro", "gemini-2.5-pro"],
    ];
    for (const [tool, model, key] of table) {
      expect({ tool, model, key: modelKey(tool, model) }).toEqual({ tool, model, key });
      // A key is its own key, so producers' keys and new claims compare alike.
      expect(modelKey(tool, key)).toBe(key);
    }
  });

  it("names a conversation by tool and sessionId, unless the sessionId is a placeholder", () => {
    expect(sessionIdentity("Claude Code", " 3f2a-c9 ")).toBe("session:claude:3f2a-c9");
    expect(sessionIdentity("codex", "3f2a-c9")).toBe("session:codex:3f2a-c9");
    const placeholders = [
      "",
      " ",
      "unknown",
      "N/A",
      "none",
      "session",
      "session-id",
      "sessionId",
      "<sessionId>",
      "{sessionId}",
      "${SESSION_ID}",
      "00000000-0000-0000-0000-000000000000",
      "current",
    ];
    for (const id of placeholders) {
      expect({ id, placeholder: isPlaceholderSessionId(id) }).toEqual({ id, placeholder: true });
      expect(sessionIdentity("claude", id)).toBeNull();
    }
    for (const id of ["session-mcp", "abc", "0b1c", "7d9e2c4a-1f"]) expect(isPlaceholderSessionId(id)).toBe(false);
  });
});
