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
