import { describe, it, expect } from "bun:test";
import {
  ALL_STATUSES,
  CLAIM_RULES,
  DEFAULT_ROLES,
  REVERT_FALLBACK,
  RESOLVE_TARGETS,
  ROLES,
  STATUS_INFO,
  TRANSITIONS,
  TaskStatus,
  UNBLOCK_TARGET,
  canTransition,
  claimRuleFor,
  normalizeRoles,
  normalizeStatus,
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

  it("finished tasks go nowhere; needs_human goes only to resolve targets", () => {
    expect(TRANSITIONS[TaskStatus.Complete]).toEqual([]);
    expect(TRANSITIONS[TaskStatus.Canceled]).toEqual([]);
    const targets = new Set(Object.values(RESOLVE_TARGETS).flat());
    expect(new Set(TRANSITIONS[TaskStatus.NeedsHuman])).toEqual(targets);
  });

  it("maps the legacy ready-for-code spelling", () => {
    expect(normalizeStatus("ready for code")).toBe(TaskStatus.ReadyForCode);
  });
});
