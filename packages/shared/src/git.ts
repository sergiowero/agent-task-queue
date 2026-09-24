import { existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";

function expandHome(p: string): string {
  if (p === "~") return homedir();
  if (p.startsWith("~/")) return join(homedir(), p.slice(2));
  return p;
}

/** Runs `git -C dir ...args`; trimmed stdout, or null when git fails or is missing. */
export function git(dir: string, args: string[]): string | null {
  const cwd = expandHome(dir);
  if (!existsSync(cwd)) return null;
  try {
    const proc = Bun.spawnSync(["git", "-C", cwd, ...args], {
      stdout: "pipe",
      stderr: "ignore",
      stdin: "ignore",
    });
    if (proc.exitCode !== 0) return null;
    return proc.stdout.toString().trim();
  } catch {
    return null;
  }
}

export function isGitRepo(dir: string): boolean {
  return git(dir, ["rev-parse", "--is-inside-work-tree"]) === "true";
}

/**
 * The branch pull requests should target: origin/HEAD when the remote is known,
 * otherwise a local `main` or `master`, otherwise "main".
 */
export function detectDefaultBranch(dir: string): string {
  const remoteHead = git(dir, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]);
  if (remoteHead) return remoteHead.replace(/^origin\//, "");
  for (const candidate of ["main", "master"]) {
    if (git(dir, ["rev-parse", "--verify", "--quiet", `refs/heads/${candidate}`]) !== null) {
      return candidate;
    }
  }
  return "main";
}
