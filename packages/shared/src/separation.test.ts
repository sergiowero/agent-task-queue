import { describe, it, expect } from "bun:test";
import type { Role } from "./catalog.js";
import { separationGaps, verifyRunners, type SeparationProject, type SeparationRunner } from "./separation.js";

const runner = (
  id: string,
  roles: Role[],
  over: Partial<SeparationRunner> = {},
): SeparationRunner => ({
  id,
  tool: "claude",
  model: null,
  roles,
  projectId: null,
  enabled: true,
  ...over,
});

const project = (over: Partial<SeparationProject> = {}): SeparationProject => ({
  id: "p",
  autonomy: 2,
  ...over,
});

describe("separationGaps", () => {
  it("a runner that codes and reviews alone leaves its code with no reviewer, and its plans with no critic", () => {
    const all = runner("solo", ["plan", "plan_review", "code", "review"]);
    expect(separationGaps([all], [project()])).toEqual([
      { projectId: "p", check: "plan_review", reason: "separation", authors: ["solo"] },
      { projectId: "p", check: "review", reason: "separation", authors: ["solo"] },
    ]);
    // A coder with no review runner at all is the same gap.
    expect(separationGaps([runner("coder", ["code"])], [project({ autonomy: 1 })])).toEqual([
      { projectId: "p", check: "review", reason: "separation", authors: ["coder"] },
    ]);
  });

  it("a second runner with the checking role closes the gap, unless it is disabled or works another project", () => {
    const both = [
      runner("a", ["code", "review"]),
      runner("b", ["code", "review"], { tool: "codex" }),
    ];
    expect(separationGaps(both, [project()])).toEqual([]);
    const off = [both[0]!, { ...both[1]!, enabled: false }];
    expect(separationGaps(off, [project()])).toEqual([
      { projectId: "p", check: "review", reason: "separation", authors: ["a"] },
    ]);
    const elsewhere = [both[0]!, { ...both[1]!, projectId: "other" }];
    expect(separationGaps(elsewhere, [project()])).toEqual([
      { projectId: "p", check: "review", reason: "separation", authors: ["a"] },
    ]);
  });

  it("under requireDifferentModel, checkers on the author's model do not count; a blank model is its tool's default", () => {
    const strict = project({ policy: { requireDifferentModel: true } });
    const sonnet = [
      runner("coder", ["code"], { model: "claude-sonnet-4-5" }),
      runner("reviewer", ["review"], { model: "anthropic/Sonnet" }),
    ];
    expect(separationGaps(sonnet, [project()])).toEqual([]);
    expect(separationGaps(sonnet, [strict])).toEqual([
      { projectId: "p", check: "review", reason: "model", authors: ["coder"] },
    ]);
    // Two blank-model runners of different tools run different models.
    const defaults = [runner("claude", ["code"]), runner("codex", ["review"], { tool: "codex" })];
    expect(separationGaps(defaults, [strict])).toEqual([]);
    expect(separationGaps([runner("c1", ["code"]), runner("c2", ["review"])], [strict])).toEqual([
      { projectId: "p", check: "review", reason: "model", authors: ["c1"] },
    ]);
  });

  it("verification is checked only in projects set to agent verification; the built-in verifier always may verify the others", () => {
    const agentVerified = project({ policy: { verifier: "agent" } });
    const runners = [runner("a", ["code", "review", "verify"]), runner("b", ["code", "review"], { tool: "codex" })];
    expect(separationGaps(runners, [project()])).toEqual([]);
    // Nobody else may verify a's code: the built-in verifier is not the one that takes it here.
    expect(separationGaps(runners, [agentVerified])).toEqual([
      { projectId: "p", check: "verify", reason: "separation", authors: ["a"] },
    ]);
    // No runner has the verify role at all.
    const noVerifier = [runner("b", ["code", "review"]), runner("r", ["review"], { tool: "codex" })];
    expect(separationGaps(noVerifier, [agentVerified])).toEqual([
      { projectId: "p", check: "verify", reason: "separation", authors: ["b"] },
    ]);
    const closed = [...runners, runner("v", ["verify"], { tool: "codex" })];
    expect(separationGaps(closed, [agentVerified])).toEqual([]);
  });

  it("a verify runner on the coder's model does not count when the project requires another", () => {
    const strict = project({ policy: { verifier: "agent", requireDifferentModel: true } });
    const runners = [
      runner("coder", ["code", "review"], { model: "claude-sonnet-4-5" }),
      runner("reviewer", ["review"], { tool: "codex", model: "gpt-5" }),
      runner("verifier", ["verify"], { model: "Sonnet" }),
    ];
    expect(separationGaps(runners, [strict])).toEqual([
      { projectId: "p", check: "verify", reason: "model", authors: ["coder"] },
    ]);
    const other = [...runners.slice(0, 2), runner("verifier", ["verify"], { model: "opus" })];
    expect(separationGaps(other, [strict])).toEqual([]);
  });

  it("only gates an agent decides are checked: no AI review under L0, no AI plan critique under L1", () => {
    const solo = [runner("solo", ["plan", "plan_review", "code", "review"])];
    expect(separationGaps(solo, [project({ autonomy: 0 })])).toEqual([]);
    expect(separationGaps(solo, [project({ autonomy: 1 })]).map((g) => g.check)).toEqual([
      "review",
    ]);
  });
});

describe("verifyRunners", () => {
  it("lists the enabled runners with the verify role that work the project", () => {
    const runners = [
      runner("anywhere", ["verify"]),
      runner("here", ["code", "verify"], { projectId: "p" }),
      runner("elsewhere", ["verify"], { projectId: "other" }),
      runner("off", ["verify"], { enabled: false }),
      runner("reviewer", ["review"]),
    ];
    expect(verifyRunners(runners, "p").map((r) => r.id)).toEqual(["anywhere", "here"]);
    expect(verifyRunners([], "p")).toEqual([]);
  });
});
