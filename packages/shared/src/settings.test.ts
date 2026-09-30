import { describe, it, expect } from "bun:test";
import { DEFAULT_POLICY, POLICY_RANGES, type PolicySettings } from "./policy.js";
import { DEFAULT_PROFILE, PROFILE_RANGES, type ProjectProfile } from "./profile.js";
import { policySettingsSchema, projectProfileSchema } from "./schemas.js";

// The portal clamps the numbers it sends to these ranges: they must be the ones the server accepts.
describe("the ranges of the project settings", () => {
  for (const [key, { min, max }] of Object.entries(POLICY_RANGES)) {
    it(`policy ${key}: ${min} to ${max}, and its default is inside`, () => {
      const accepts = (value: number) => policySettingsSchema.safeParse({ [key]: value }).success;
      expect([accepts(min), accepts(max)]).toEqual([true, true]);
      expect([accepts(min - 1), accepts(max + 1)]).toEqual([false, false]);
      const fallback = DEFAULT_POLICY[key as keyof PolicySettings] as number;
      expect(fallback).toBeGreaterThanOrEqual(min);
      expect(fallback).toBeLessThanOrEqual(max);
    });
  }

  for (const [key, { min, max }] of Object.entries(PROFILE_RANGES)) {
    it(`profile ${key}: ${min} to ${max}, and its default is inside`, () => {
      const accepts = (value: number) => projectProfileSchema.safeParse({ [key]: value }).success;
      expect([accepts(min), accepts(max)]).toEqual([true, true]);
      expect([accepts(min - 1), accepts(max + 1)]).toEqual([false, false]);
      const fallback = DEFAULT_PROFILE[key as keyof ProjectProfile] as number;
      expect(fallback).toBeGreaterThanOrEqual(min);
      expect(fallback).toBeLessThanOrEqual(max);
    });
  }

  it("every numeric setting has a range", () => {
    const numeric = (defaults: object) => Object.entries(defaults).filter(([, v]) => typeof v === "number").map(([k]) => k).sort();
    expect(Object.keys(POLICY_RANGES).sort()).toEqual(numeric(DEFAULT_POLICY));
    expect(Object.keys(PROFILE_RANGES).sort()).toEqual(numeric(DEFAULT_PROFILE));
  });
});
