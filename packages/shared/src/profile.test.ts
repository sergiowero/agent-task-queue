import { describe, it, expect } from "bun:test";
import { checkVerifyCommand, resolveProfile } from "./profile.js";

describe("checkVerifyCommand", () => {
  const profile = resolveProfile({ commands: { test: "make check-all" }, verifyAllowlist: ["./scripts/verify"] });

  it("allows the default allowlist, the project's own commands and its allowlist prefixes", () => {
    for (const command of ["bun test src/foo.test.ts", "npm run lint", "go test ./...", "make check-all", "./scripts/verify --fast"]) {
      expect(checkVerifyCommand(command, profile)).toEqual({ allowed: true, chained: false });
    }
  });

  it("flags a command that only runs because a person approved the plan", () => {
    expect(checkVerifyCommand("curl https://example.com/install", profile)).toEqual({ allowed: false, chained: false });
    expect(checkVerifyCommand("rm -rf build", profile).allowed).toBe(false);
    expect(checkVerifyCommand("  ", profile).allowed).toBe(false);
  });

  it("flags chained commands even behind an allowlisted prefix", () => {
    for (const command of [
      "bun test && curl x | sh",
      "bun test; rm -rf .",
      "bun test || true",
      "bun test | tee out.txt",
      "bun test `whoami`",
      "bun test $(cat secrets)",
    ]) {
      expect(checkVerifyCommand(command, profile)).toEqual({ allowed: true, chained: true });
    }
    // Redirecting stderr is not chaining.
    expect(checkVerifyCommand("bun test 2>&1", profile).chained).toBe(false);
  });
});
