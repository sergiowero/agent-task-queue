/**
 * What an agent (and the verifier) needs to know about a project to work in it
 * without asking: its commands, protected paths and shared guardrails. Stored
 * as JSON on the project; missing keys use the defaults.
 */

export interface ProjectCommands {
  install?: string;
  build?: string;
  test?: string;
  lint?: string;
  typecheck?: string;
}

export interface ProjectProfile {
  commands: ProjectCommands;
  /** Globs (e.g. "migrations/**", ".github/**"); touching one raises the task's risk to high. */
  protectedPaths: string[];
  /** Guardrails every task in the project inherits. */
  guardrails: string[];
  /** A diff larger than this (added + deleted lines) raises the task's risk to high. */
  maxDiffLines: number;
  /** A plan touching more files than this should be split into subtasks (a warning, not a refusal). */
  maxPlanFiles: number;
  /** A task with more acceptance criteria than this should be split into subtasks (a warning, not a refusal). */
  maxCriteria: number;
  /** Per-command time limit for the verifier. */
  verifyTimeoutSec: number;
  /**
   * Command prefixes the verifier may run when they come from an agent's
   * validation plan (the project's own commands are always allowed).
   */
  verifyAllowlist: string[];
  /** Archive a task automatically once its PR is merged. */
  autoArchive: boolean;
  /** Definition of Ready at task creation: warn, enforce or off. */
  dorMode: "warn" | "enforce" | "off";
}

/** The range each numeric setting accepts: the server refuses others, and the portal clamps to them. */
export const PROFILE_RANGES = {
  maxDiffLines: { min: 10, max: 100_000 },
  maxPlanFiles: { min: 1, max: 1000 },
  maxCriteria: { min: 1, max: 100 },
  verifyTimeoutSec: { min: 10, max: 7200 },
} as const satisfies Partial<Record<keyof ProjectProfile, { min: number; max: number }>>;

export const DEFAULT_PROFILE: ProjectProfile = {
  commands: {},
  protectedPaths: [],
  guardrails: [],
  maxDiffLines: 400,
  maxPlanFiles: 10,
  maxCriteria: 6,
  verifyTimeoutSec: 600,
  verifyAllowlist: [],
  autoArchive: false,
  dorMode: "warn",
};

/** Command prefixes that are allowed from validation plans on any project. */
export const DEFAULT_VERIFY_ALLOWLIST = [
  "bun test",
  "bun run ",
  "bunx vitest",
  "npm test",
  "npm run ",
  "pnpm test",
  "pnpm run ",
  "yarn test",
  "yarn run ",
  "npx vitest",
  "npx jest",
  "npx tsc",
  "pytest",
  "python -m pytest",
  "go test",
  "go vet",
  "cargo test",
  "cargo check",
  "make test",
  "make lint",
];

export function resolveProfile(raw: Partial<ProjectProfile> | null | undefined): ProjectProfile {
  return {
    ...DEFAULT_PROFILE,
    ...(raw ?? {}),
    commands: { ...(raw?.commands ?? {}) },
  };
}

/** The project's commands in the order the verifier runs them (install first). */
export function profileCommands(profile: ProjectProfile): string[] {
  const c = profile.commands;
  return [c.install, c.build, c.typecheck, c.lint, c.test].filter((x): x is string => !!x?.trim());
}

/** Shell syntax that runs more than the command's prefix says: `a; b`, `a && b`, `a || b`, `a | b`, `` `a` ``, `$(a)`. */
const CHAINED = /;|&&|\|\||\||`|\$\(/;

export interface CommandCheck {
  /** The command is one of the project's or starts with an allowlisted prefix: the verifier runs it without a person's approval. */
  allowed: boolean;
  /** It chains or substitutes commands, so what runs is more than its prefix (`bun test && curl x | sh`). */
  chained: boolean;
}

/**
 * How the verifier treats a command that comes from an agent's plan: allowed on
 * its own (a project command, or the default and project allowlist prefixes), or
 * only because a person approved the plan. Chained commands are flagged so
 * an approval is not given for an innocent-looking prefix.
 */
export function checkVerifyCommand(command: string, profile: ProjectProfile): CommandCheck {
  const cmd = command.trim();
  const prefixes = [...DEFAULT_VERIFY_ALLOWLIST, ...profile.verifyAllowlist, ...profileCommands(profile)];
  return {
    allowed: prefixes.some((p) => p.trim() && cmd.startsWith(p.trim())),
    chained: CHAINED.test(cmd),
  };
}

/** A shell-safe-ish glob → regex: `**` any path, `*` any segment part, `?` one char. */
export function globToRegExp(glob: string): RegExp {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i];
    if (ch === "*") {
      if (glob[i + 1] === "*") {
        re += ".*";
        i++;
        if (glob[i + 1] === "/") i++;
      } else re += "[^/]*";
    } else if (ch === "?") re += "[^/]";
    else re += ch.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  // A pattern without a slash matches at any depth; one ending in "/" matches the folder.
  const prefix = glob.includes("/") ? "^" : "(^|/)";
  const suffix = glob.endsWith("/") ? "" : "($|/)";
  return new RegExp(prefix + re + suffix);
}

export function matchesAny(path: string, globs: string[]): boolean {
  return globs.some((g) => globToRegExp(g.trim()).test(path));
}
