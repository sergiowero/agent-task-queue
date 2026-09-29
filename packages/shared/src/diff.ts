/**
 * What a task's diff says, independent of any command: the files it changes,
 * its size, and tests that were deleted, skipped or had their coverage
 * thresholds lowered. The built-in verifier uses it.
 */
import { git } from "./git.js";
import type { DiffStats } from "./types.js";

const TEST_FILE = /(^|\/)(__tests__|tests?|spec)\/|\.(test|spec)\.[cm]?[jt]sx?$|_test\.(go|py)$|(^|\/)test_[^/]+\.py$/;
const SKIP_PATTERNS: [RegExp, string][] = [
  [/\b(it|test|describe)\.(skip|only|todo)\s*\(/, "skipped or focused test"],
  [/\b(xit|xtest|xdescribe|fit|fdescribe)\s*\(/, "skipped or focused test"],
  [/@pytest\.mark\.skip|pytest\.skip\(/, "skipped pytest"],
  [/\bt\.Skip(Now|f)?\(/, "skipped Go test"],
  [/@Disabled\b|@Ignore\b/, "disabled JUnit test"],
];
const COVERAGE_FILE = /(jest|vitest|vite)\.config\.[cm]?[jt]s$|\.nycrc|bunfig\.toml$|\.c8rc|codecov\.ya?ml$|package\.json$/;
const THRESHOLD = /(threshold|lines|branches|functions|statements|coverage)["']?\s*[:=]\s*(\d+(?:\.\d+)?)/i;

export interface DiffAnalysis {
  diffStats: DiffStats;
  changedFiles: string[];
  tampering: string[];
  headSha: string | null;
}

/** Diff of HEAD against where it branched off the merge branch; null when git cannot tell. */
export function analyzeDiff(cwd: string, mergeBranch: string): DiffAnalysis | null {
  const headSha = git(cwd, ["rev-parse", "HEAD"]);
  const base =
    git(cwd, ["merge-base", "HEAD", `origin/${mergeBranch}`]) ?? git(cwd, ["merge-base", "HEAD", mergeBranch]);
  if (!base) return headSha ? { diffStats: { files: 0, insertions: 0, deletions: 0 }, changedFiles: [], tampering: [], headSha } : null;

  const numstat = git(cwd, ["diff", "--numstat", base, "HEAD"]) ?? "";
  let insertions = 0;
  let deletions = 0;
  const changedFiles: string[] = [];
  for (const line of numstat.split("\n").filter(Boolean)) {
    const [add, del, ...path] = line.split("\t");
    insertions += Number(add) || 0;
    deletions += Number(del) || 0;
    changedFiles.push(path.join("\t"));
  }

  const tampering: string[] = [];
  const status = git(cwd, ["diff", "--name-status", base, "HEAD"]) ?? "";
  for (const line of status.split("\n").filter(Boolean)) {
    const [kind, path] = line.split("\t");
    if (kind === "D" && TEST_FILE.test(path)) tampering.push(`deleted test file ${path}`);
  }

  const patch = git(cwd, ["diff", "-U0", base, "HEAD"]) ?? "";
  let file = "";
  const removedThresholds = new Map<string, number>();
  for (const line of patch.split("\n")) {
    if (line.startsWith("+++ ")) {
      file = line.replace(/^\+\+\+ (b\/)?/, "");
      continue;
    }
    if (line.startsWith("--- ")) continue;
    const added = line.startsWith("+");
    const removed = line.startsWith("-");
    if (!added && !removed) continue;
    const text = line.slice(1);
    if (added && TEST_FILE.test(file)) {
      for (const [pattern, label] of SKIP_PATTERNS) {
        if (pattern.test(text)) tampering.push(`${label} added in ${file}: ${text.trim().slice(0, 120)}`);
      }
    }
    if (COVERAGE_FILE.test(file)) {
      const m = text.match(THRESHOLD);
      if (!m) continue;
      const key = `${file}:${m[1].toLowerCase()}`;
      if (removed) removedThresholds.set(key, Number(m[2]));
      else if (removedThresholds.has(key) && Number(m[2]) < removedThresholds.get(key)!) {
        tampering.push(`coverage ${m[1]} lowered from ${removedThresholds.get(key)} to ${m[2]} in ${file}`);
      }
    }
  }
  return { diffStats: { files: changedFiles.length, insertions, deletions }, changedFiles, tampering, headSha };
}
