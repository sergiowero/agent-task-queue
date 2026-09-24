import { existsSync, readFileSync } from "fs";
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

/**
 * Best-effort commands for a checkout: package.json scripts with the package
 * manager its lockfile implies, else Makefile targets, Cargo, Go or pytest.
 */
export function detectProjectCommands(dir: string): {
  install?: string;
  build?: string;
  test?: string;
  lint?: string;
  typecheck?: string;
} {
  const root = expandHome(dir);
  const has = (file: string) => existsSync(join(root, file));
  const pkgFile = join(root, "package.json");
  if (existsSync(pkgFile)) {
    let scripts: Record<string, string> = {};
    try {
      scripts = JSON.parse(readFileSync(pkgFile, "utf8")).scripts ?? {};
    } catch {}
    const pm = has("bun.lock") || has("bun.lockb") ? "bun" : has("pnpm-lock.yaml") ? "pnpm" : has("yarn.lock") ? "yarn" : "npm";
    const run = (script: string) => (scripts[script] ? `${pm} run ${script}` : undefined);
    return {
      install: `${pm} install`,
      build: run("build"),
      test: scripts.test ? `${pm} ${pm === "npm" ? "test" : "run test"}` : pm === "bun" ? "bun test" : undefined,
      lint: run("lint"),
      typecheck: run("typecheck") ?? run("type-check") ?? run("tsc"),
    };
  }
  if (has("Cargo.toml")) return { build: "cargo build", test: "cargo test", lint: "cargo clippy" };
  if (has("go.mod")) return { build: "go build ./...", test: "go test ./...", lint: "go vet ./..." };
  if (has("pyproject.toml") || has("setup.py") || has("pytest.ini")) return { test: "pytest" };
  if (has("Makefile")) {
    const targets = readFileSync(join(root, "Makefile"), "utf8");
    const target = (name: string) => (new RegExp(`^${name}:`, "m").test(targets) ? `make ${name}` : undefined);
    return { build: target("build"), test: target("test"), lint: target("lint") };
  }
  return {};
}
