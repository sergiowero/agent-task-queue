/**
 * What a task's diff says, independent of any command: the files it changes,
 * its size, and tests that were deleted, skipped or had their coverage
 * thresholds lowered. The built-in verifier uses it, and so do submit_code and
 * submit_verification, so the guards hold whether or not the verifier runs.
 */
import { git } from "./git.js";
import { matchesAny, type ProjectProfile } from "./profile.js";
import type { DiffStats } from "./types.js";

const TEST_FILE = /(^|\/)(__tests__|tests?|spec)\/|\.(test|spec)\.[cm]?[jt]sx?$|_test\.(go|py)$|(^|\/)test_[^/]+\.py$/;
const SKIP_PATTERNS: [RegExp, string][] = [
  // it.skip(, it.skip.each, test.concurrent.skip, it.skipIf(...), describe.only.each, ...
  [/\b(it|test|describe|suite)(\.(concurrent|sequential|each|failing))*\.(skip|only|todo|skipIf|runIf)\b/, "skipped or focused test"],
  [/\b(it|test|describe)\.if\s*\(/, "skipped or focused test"],
  [/\b(xit|xtest|xdescribe|fit|fdescribe)\s*\(/, "skipped or focused test"],
  [/@pytest\.mark\.(skip|skipif|xfail)\b|pytest\.(skip|xfail)\s*\(/, "skipped pytest"],
  [/@unittest\.skip(If|Unless)?\b|\.skipTest\s*\(/, "skipped unittest"],
  [/\bt\.Skip(Now|f)?\(/, "skipped Go test"],
  [/@Disabled\b|@Ignore\b/, "disabled JUnit test"],
  [/#\[ignore\b/, "ignored Rust test"],
];
const COVERAGE_FILE =
  /(jest|vitest|vite)\.config\.[cm]?[jt]s$|\.nycrc|bunfig\.toml$|\.c8rc|codecov\.ya?ml$|package\.json$|pyproject\.toml$|\.coveragerc$|setup\.cfg$|tox\.ini$|pytest\.ini$/;
const THRESHOLD = /(threshold|lines|branches|functions|statements|coverage|fail[_-]under)["']?\s*[:=]\s*(\d+(?:\.\d+)?)/i;

export interface DiffAnalysis {
  diffStats: DiffStats;
  /** Every path the diff touches (both sides of a rename). */
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
  let files = 0;
  let insertions = 0;
  let deletions = 0;
  for (const line of numstat.split("\n").filter(Boolean)) {
    const [add, del] = line.split("\t");
    files += 1;
    insertions += Number(add) || 0;
    deletions += Number(del) || 0;
  }
  // Without rename detection a move lists both paths, so moving a file into (or out of) a protected path counts.
  const changedFiles = (git(cwd, ["diff", "--name-only", "--no-renames", base, "HEAD"]) ?? "").split("\n").filter(Boolean);

  const tampering: string[] = [];
  const status = git(cwd, ["diff", "--name-status", base, "HEAD"]) ?? "";
  for (const line of status.split("\n").filter(Boolean)) {
    const [kind, path, to] = line.split("\t");
    if (kind === "D" && TEST_FILE.test(path)) tampering.push(`deleted test file ${path}`);
    if (kind.startsWith("R") && to && TEST_FILE.test(path) && !TEST_FILE.test(to)) {
      tampering.push(`test file ${path} moved out of the tests to ${to}`);
    }
  }

  const patch = git(cwd, ["diff", "-U0", base, "HEAD"]) ?? "";
  let file = "";
  let oldFile = "";
  const removedThresholds = new Map<string, number>();
  const addedThresholds = new Set<string>();
  for (const line of patch.split("\n")) {
    if (line.startsWith("--- ")) {
      oldFile = line.replace(/^--- (a\/)?/, "");
      continue;
    }
    if (line.startsWith("+++ ")) {
      const newFile = line.replace(/^\+\+\+ (b\/)?/, "");
      // A deleted file has no new side: its removed lines belong to the old path.
      file = newFile === "/dev/null" ? oldFile : newFile;
      continue;
    }
    const added = line.startsWith("+");
    const removed = line.startsWith("-");
    if (!added && !removed) continue;
    const text = line.slice(1);
    if (added && TEST_FILE.test(file)) {
      const hit = SKIP_PATTERNS.find(([pattern]) => pattern.test(text));
      if (hit) tampering.push(`${hit[1]} added in ${file}: ${text.trim().slice(0, 120)}`);
    }
    if (COVERAGE_FILE.test(file)) {
      const m = text.match(THRESHOLD);
      if (!m) continue;
      const name = m[1].toLowerCase();
      const key = `${file}:${name}`;
      if (removed) removedThresholds.set(key, Number(m[2]));
      else {
        addedThresholds.add(name);
        if (removedThresholds.has(key) && Number(m[2]) < removedThresholds.get(key)!) {
          tampering.push(`coverage ${m[1]} lowered from ${removedThresholds.get(key)} to ${m[2]} in ${file}`);
        }
      }
    }
  }
  // A threshold removed with nothing added in its place (moving it to another config file is fine).
  for (const [key, value] of removedThresholds) {
    const at = key.lastIndexOf(":");
    const name = key.slice(at + 1);
    if (!addedThresholds.has(name)) tampering.push(`coverage ${name} threshold (${value}) removed from ${key.slice(0, at)}`);
  }
  return { diffStats: { files, insertions, deletions }, changedFiles, tampering, headSha };
}

/** The changed files that match the project's protected paths. */
export function protectedFiles(changedFiles: string[], profile: ProjectProfile): string[] {
  return changedFiles.filter((f) => matchesAny(f, profile.protectedPaths));
}

const PROTECTED_REASON = "Touches protected paths: ";
const SIZE_REASON = /^Diff of \d+ lines exceeds/;

/** Why a diff makes the task high risk: protected paths, or more lines than the project allows. */
export function diffRiskReasons(touchedProtected: string[], diffStats: DiffStats | null, profile: ProjectProfile): string[] {
  const reasons: string[] = [];
  if (touchedProtected.length) reasons.push(`${PROTECTED_REASON}${touchedProtected.join(", ")}`);
  const size = diffStats ? diffStats.insertions + diffStats.deletions : 0;
  if (size > profile.maxDiffLines) reasons.push(`Diff of ${size} lines exceeds the project's ${profile.maxDiffLines}`);
  return reasons;
}

/**
 * Adds diff reasons to a task's risk reasons. The diff is cumulative and is
 * read on every submission, so a newer reason of the same kind (more paths, a
 * bigger size) replaces the older one instead of piling up. `added` holds the
 * kinds the task did not have yet: the ones worth announcing.
 */
export function mergeDiffReasons(existing: string[], reasons: string[]): { riskReasons: string[]; added: string[] } {
  const kind = (r: string) => (r.startsWith(PROTECTED_REASON) ? "protected" : SIZE_REASON.test(r) ? "size" : null);
  const replaced = new Set(reasons.map(kind));
  const had = new Set(existing.map(kind));
  return {
    riskReasons: [...existing.filter((r) => kind(r) === null || !replaced.has(kind(r))), ...reasons],
    added: reasons.filter((r) => !had.has(kind(r))),
  };
}
