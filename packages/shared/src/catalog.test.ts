import { describe, it, expect } from "bun:test";
import {
  ALL_STATUSES,
  CLAIM_RULES,
  COMPOUND_ROLES,
  REVERT_FALLBACK,
  RESOLVE_TARGETS,
  ROLES,
  STATUS_INFO,
  TRANSITIONS,
  TaskStatus,
  UNBLOCK_TARGET,
  canTransition,
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

  it("every queued status has a role that claims it", () => {
    const claimable = new Set(CLAIM_RULES.flatMap((r) => r.from));
    for (const status of ALL_STATUSES.filter((s) => STATUS_INFO[s].kind === "queued")) {
      expect({ status, claimable: claimable.has(status) }).toEqual({ status, claimable: true });
    }
  });

  it("roles are the base roles plus the compound ones", () => {
    const base = new Set(CLAIM_RULES.map((r) => r.role));
    for (const role of ROLES) {
      expect(base.has(role) || !!COMPOUND_ROLES[role]).toBe(true);
    }
    for (const members of Object.values(COMPOUND_ROLES)) {
      for (const member of members) expect(base.has(member)).toBe(true);
    }
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
