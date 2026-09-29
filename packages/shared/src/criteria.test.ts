import { describe, it, expect } from "bun:test";
import { criteriaFromStored, formatCriterionLine, normalizeCriteria, parseCriterionLine } from "./criteria.js";
import { globToRegExp, matchesAny } from "./profile.js";

describe("acceptance criteria", () => {
  it("turns strings into criteria with ids and a review check", () => {
    expect(normalizeCriteria(["Toggle persists", "  ", "Works on mobile $ bun test mobile"])).toEqual([
      { id: "AC1", text: "Toggle persists", verify: { kind: "review" }, status: "pending", evidenceIds: [] },
      { id: "AC2", text: "Works on mobile", verify: { kind: "command", command: "bun test mobile" }, status: "pending", evidenceIds: [] },
    ]);
  });

  it("keeps ids, status and evidence of unchanged criteria when edited", () => {
    const before = normalizeCriteria(["a", "b"]).map((c) => (c.id === "AC1" ? { ...c, status: "met" as const, evidenceIds: ["E1"] } : c));
    const after = normalizeCriteria(["b", "a", "c"], before);
    expect(after.map((c) => [c.id, c.text, c.status, c.evidenceIds])).toEqual([
      ["AC2", "b", "pending", []],
      ["AC1", "a", "met", ["E1"]],
      ["AC3", "c", "pending", []],
    ]);
  });

  it("a reworded criterion keeps its id; its status and evidence start over", () => {
    const before = normalizeCriteria(["a $ bun test a", "b"]).map((c) => ({ ...c, status: "met" as const, evidenceIds: [`E-${c.id}`] }));
    expect(normalizeCriteria(["a2 $ bun test a", "b"], before).map((c) => [c.id, c.text, c.status, c.evidenceIds, c.verify])).toEqual([
      ["AC1", "a2", "pending", [], { kind: "command", command: "bun test a" }],
      ["AC2", "b", "met", ["E-AC2"], { kind: "review" }],
    ]);
    // Moved and reworded (or one removed and one added): exact text first, the rest gets a new id.
    expect(normalizeCriteria(["b2", "a $ bun test a"], before).map((c) => [c.id, c.text])).toEqual([
      ["AC3", "b2"],
      ["AC1", "a"],
    ]);
    expect(normalizeCriteria(["b", "c"], before).map((c) => c.id)).toEqual(["AC2", "AC3"]);
    // One added (or one removed): the count changes, so a new criterion gets a new id.
    expect(normalizeCriteria(["a $ bun test a", "b", "c"], before).map((c) => c.id)).toEqual(["AC1", "AC2", "AC3"]);
    expect(normalizeCriteria(["c"], before).map((c) => c.id)).toEqual(["AC3"]);
  });

  it("a line without its command drops it; checks a line cannot show are kept", () => {
    const before = normalizeCriteria([
      "persists $ bun test theme",
      { text: "looks right", verify: { kind: "manual", notes: "375px" } },
      { text: "covered", verify: { kind: "test", command: "bun test cover" } },
    ]);
    // What the portal's one-line editor sends back (the schema turns lines into objects).
    const after = normalizeCriteria(
      [{ text: "persists" }, { text: "looks right" }, { text: "covered", verify: { kind: "command", command: "bun test cover" } }],
      before,
    );
    expect(after.map((c) => c.verify)).toEqual([
      { kind: "review" },
      { kind: "manual", notes: "375px" },
      { kind: "test", command: "bun test cover" },
    ]);
    // An agent naming the criterion by id without a check leaves the check alone.
    expect(normalizeCriteria([{ id: "AC1", text: "persists" }], before)[0].verify).toEqual({ kind: "command", command: "bun test theme" });
  });

  it("reads rows stored as strings or as objects", () => {
    expect(criteriaFromStored(["x"])[0]).toMatchObject({ id: "AC1", text: "x" });
    const stored = normalizeCriteria(["y"]);
    expect(criteriaFromStored(stored)).toEqual(stored);
    expect(criteriaFromStored(null)).toEqual([]);
  });

  it("round-trips the one-line format", () => {
    expect(parseCriterionLine("fast $ bun test perf")).toEqual({ text: "fast", command: "bun test perf" });
    expect(formatCriterionLine(normalizeCriteria(["fast $ bun test perf"])[0])).toBe("fast $ bun test perf");
  });
});

describe("protected path globs", () => {
  it("matches folders, extensions and nested paths", () => {
    expect(matchesAny("migrations/001.sql", ["migrations/**"])).toBe(true);
    expect(matchesAny("db/migrations/001.sql", ["**/migrations/**"])).toBe(true);
    expect(matchesAny(".github/workflows/ci.yml", [".github/"])).toBe(true);
    expect(matchesAny("src/auth/login.ts", ["auth"])).toBe(true);
    expect(matchesAny("src/author.ts", ["auth"])).toBe(false);
    expect(matchesAny("src/a.ts", ["*.sql"])).toBe(false);
    expect(globToRegExp("*.sql").test("db/x.sql")).toBe(true);
  });
});
