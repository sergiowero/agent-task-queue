import { describe, it, expect, afterAll } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { analyzeDiff, diffRiskReasons, mergeDiffReasons, protectedFiles } from "./diff.js";
import { resolveProfile } from "./profile.js";

const hasGit = !!Bun.which("git");
const root = mkdtempSync(join(tmpdir(), "agentq-diff-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

let n = 0;
function run(cwd: string, ...args: string[]) {
  const out = Bun.spawnSync(["git", "-C", cwd, "-c", "user.email=t@t", "-c", "user.name=t", ...args]);
  if (out.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${out.stderr.toString()}`);
}

function apply(repo: string, files: Record<string, string | null>) {
  for (const [file, content] of Object.entries(files)) {
    if (content === null) rmSync(join(repo, file));
    else {
      mkdirSync(dirname(join(repo, file)), { recursive: true });
      writeFileSync(join(repo, file), content);
    }
  }
  run(repo, "add", "-A");
  run(repo, "commit", "-q", "-m", "change");
}

/** A repo whose `main` holds `base`, with HEAD on a branch that applies `change`. */
function diffOf(base: Record<string, string>, change: Record<string, string | null>) {
  const repo = join(root, `r${++n}`);
  mkdirSync(repo, { recursive: true });
  run(repo, "init", "-q", "-b", "main");
  apply(repo, { "README.md": "x\n", ...base });
  run(repo, "switch", "-q", "-c", "feat");
  apply(repo, change);
  return analyzeDiff(repo, "main")!;
}

describe("diff risk reasons", () => {
  const profile = resolveProfile({ protectedPaths: ["migrations/**"], maxDiffLines: 10 });

  it("names protected paths and a diff over the limit", () => {
    expect(diffRiskReasons(["migrations/1.sql"], { files: 2, insertions: 8, deletions: 3 }, profile)).toEqual([
      "Touches protected paths: migrations/1.sql",
      "Diff of 11 lines exceeds the project's 10",
    ]);
    expect(diffRiskReasons([], { files: 1, insertions: 10, deletions: 0 }, profile)).toEqual([]);
  });

  it("a newer reason of the same kind replaces the older one; only new kinds are announced", () => {
    const first = mergeDiffReasons(["The plan touches protected paths: migrations/1.sql"], ["Touches protected paths: migrations/1.sql"]);
    expect(first.added).toEqual(["Touches protected paths: migrations/1.sql"]);
    const next = mergeDiffReasons(first.riskReasons, ["Touches protected paths: migrations/1.sql, migrations/2.sql", "Diff of 50 lines exceeds the project's 10"]);
    expect(next.riskReasons).toEqual([
      "The plan touches protected paths: migrations/1.sql",
      "Touches protected paths: migrations/1.sql, migrations/2.sql",
      "Diff of 50 lines exceeds the project's 10",
    ]);
    expect(next.added).toEqual(["Diff of 50 lines exceeds the project's 10"]);
  });
});

describe.skipIf(!hasGit)("analyzeDiff", () => {
  it("flags skip variants of the common test runners", () => {
    const d = diffOf(
      { "src/a.test.ts": "it('a', () => {});\n", "tests/test_b.py": "def test_b(): pass\n", "tests/it.rs": "fn t() {}\n" },
      {
        "src/a.test.ts": "it.skip.each([1])('a %i', () => {});\ntest.concurrent.skip('b', () => {});\nit.skipIf(true)('c', () => {});\n",
        "tests/test_b.py": "import pytest\n@pytest.mark.xfail\ndef test_b(): pass\n@unittest.skip('later')\ndef test_c(): pass\n",
        "tests/it.rs": "#[ignore]\nfn t() {}\n",
      },
    );
    expect(d.tampering).toEqual([
      "skipped or focused test added in src/a.test.ts: it.skip.each([1])('a %i', () => {});",
      "skipped or focused test added in src/a.test.ts: test.concurrent.skip('b', () => {});",
      "skipped or focused test added in src/a.test.ts: it.skipIf(true)('c', () => {});",
      "ignored Rust test added in tests/it.rs: #[ignore]",
      "skipped pytest added in tests/test_b.py: @pytest.mark.xfail",
      "skipped unittest added in tests/test_b.py: @unittest.skip('later')",
    ]);
  });

  it("a test moved out of the test paths counts; a rename between test files does not", () => {
    const body = "it('a', () => { expect(1).toBe(1); });\n".repeat(5);
    const moved = diffOf({ "src/a.test.ts": body }, { "src/a.test.ts": null, "attic/a.ts": body });
    expect(moved.tampering).toEqual(["test file src/a.test.ts moved out of the tests to attic/a.ts"]);
    const renamed = diffOf({ "src/a.test.ts": body }, { "src/a.test.ts": null, "src/b.test.ts": body });
    expect(renamed.tampering).toEqual([]);
  });

  it("lists both sides of a rename, so moving a file into a protected path is caught", () => {
    const body = "create table x (id int);\n".repeat(5);
    const d = diffOf({ "db/001.sql": body }, { "db/001.sql": null, "migrations/001.sql": body });
    expect(d.changedFiles.sort()).toEqual(["db/001.sql", "migrations/001.sql"]);
    expect(d.diffStats.files).toBe(1);
    expect(protectedFiles(d.changedFiles, resolveProfile({ protectedPaths: ["migrations/**"] }))).toEqual(["migrations/001.sql"]);
  });

  it("detects lowered and removed coverage thresholds, including Python's fail_under", () => {
    const lowered = diffOf(
      { "pyproject.toml": "[tool.coverage.report]\nfail_under = 90\n" },
      { "pyproject.toml": "[tool.coverage.report]\nfail_under = 50\n" },
    );
    expect(lowered.tampering).toEqual(["coverage fail_under lowered from 90 to 50 in pyproject.toml"]);

    const removed = diffOf(
      { "vitest.config.ts": "export default {\n  coverage: {\n    lines: 90,\n  },\n};\n" },
      { "vitest.config.ts": "export default {\n  coverage: {\n  },\n};\n" },
    );
    expect(removed.tampering).toEqual(["coverage lines threshold (90) removed from vitest.config.ts"]);

    const deleted = diffOf({ ".coveragerc": "[report]\nfail_under = 80\n" }, { ".coveragerc": null });
    expect(deleted.tampering).toEqual(["coverage fail_under threshold (80) removed from .coveragerc"]);

    const movedElsewhere = diffOf(
      { "vitest.config.ts": "export default { coverage: { lines: 90 } };\n", "bunfig.toml": "[test]\n" },
      { "vitest.config.ts": "export default {};\n", "bunfig.toml": "[test]\nlines = 90\n" },
    );
    expect(movedElsewhere.tampering).toEqual([]);
  });

  it("raising a threshold or editing non-test code is fine", () => {
    const d = diffOf(
      { "vitest.config.ts": "export default { coverage: { lines: 80 } };\n", "src/x.ts": "export const skip = 1;\n" },
      { "vitest.config.ts": "export default { coverage: { lines: 95 } };\n", "src/x.ts": "it.skip('not a test file');\n" },
    );
    expect(d.tampering).toEqual([]);
    expect(d.diffStats).toEqual({ files: 2, insertions: 2, deletions: 2 });
  });
});
