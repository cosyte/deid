/**
 * Tests for the policy engine — the Safe Harbor default assignment, `defineDeidPolicy` (deviate from
 * the safe default, never forget a category), and `resolvePolicy`.
 */

import { describe, expect, it } from "vitest";

import {
  FATAL_CODES,
  SAFE_HARBOR_CATEGORIES,
  SAFE_HARBOR_POLICY,
  defineDeidPolicy,
  resolvePolicy,
  type DeidPolicy,
  type SafeHarborCategory,
} from "../src/index.js";

const C = SAFE_HARBOR_CATEGORIES;

describe("SAFE_HARBOR_POLICY", () => {
  it("assigns a transform to all 18 categories", () => {
    const categories = Object.values(C) as SafeHarborCategory[];
    expect(categories).toHaveLength(18);
    for (const cat of categories) {
      expect(SAFE_HARBOR_POLICY.transforms[cat]).toBeDefined();
    }
  });

  it("picks the regulation-grounded safe default per category", () => {
    expect(SAFE_HARBOR_POLICY.transforms[C.NAMES]).toBe("redact");
    expect(SAFE_HARBOR_POLICY.transforms[C.SSN]).toBe("redact");
    expect(SAFE_HARBOR_POLICY.transforms[C.MRN]).toBe("pseudonymize");
    expect(SAFE_HARBOR_POLICY.transforms[C.GEOGRAPHIC]).toBe("generalize");
    expect(SAFE_HARBOR_POLICY.transforms[C.DATES]).toBe("generalize");
    // The open-ended catch-all fails closed.
    expect(SAFE_HARBOR_POLICY.transforms[C.OTHER_UNIQUE_ID]).toBe("block");
  });

  it("is frozen", () => {
    expect(Object.isFrozen(SAFE_HARBOR_POLICY)).toBe(true);
    expect(Object.isFrozen(SAFE_HARBOR_POLICY.transforms)).toBe(true);
  });
});

describe("defineDeidPolicy", () => {
  it("overrides only the named categories and keeps every safe default", () => {
    const research = defineDeidPolicy({
      name: "research",
      transforms: { [C.DATES]: "date-shift" },
    });
    expect(research.name).toBe("research");
    expect(research.transforms[C.DATES]).toBe("date-shift");
    expect(research.transforms[C.NAMES]).toBe("redact"); // kept from Safe Harbor
    expect(Object.isFrozen(research.transforms)).toBe(true);
  });

  it("with no overrides is a renamed Safe Harbor", () => {
    const p = defineDeidPolicy({ name: "clone" });
    expect(p.transforms).toEqual(SAFE_HARBOR_POLICY.transforms);
  });
});

describe("resolvePolicy", () => {
  it("resolves undefined and the string to the built-in policy, and passes an object through", () => {
    expect(resolvePolicy(undefined)).toBe(SAFE_HARBOR_POLICY);
    expect(resolvePolicy("safe-harbor")).toBe(SAFE_HARBOR_POLICY);
    const custom = defineDeidPolicy({ name: "x" });
    expect(resolvePolicy(custom)).toBe(custom);
  });
});

describe("the key/label contract — date-shift is not Safe Harbor", () => {
  it("defineDeidPolicy rejects a date-shift policy that claims the safe-harbor label", () => {
    expect(() =>
      defineDeidPolicy({ name: "safe-harbor", transforms: { [C.DATES]: "date-shift" } }),
    ).toThrowError(expect.objectContaining({ code: FATAL_CODES.DEID_POLICY_INVALID }));
  });

  it("resolvePolicy fails closed on a hand-built safe-harbor-labelled date-shift object", () => {
    // A consumer can construct a DeidPolicy literal directly, bypassing defineDeidPolicy.
    const smuggled: DeidPolicy = {
      name: "safe-harbor",
      transforms: { ...SAFE_HARBOR_POLICY.transforms, [C.DATES]: "date-shift" },
    };
    expect(() => resolvePolicy(smuggled)).toThrowError(
      expect.objectContaining({ code: FATAL_CODES.DEID_POLICY_INVALID }),
    );
  });

  it("allows date-shift under a distinct label, and the built-in Safe Harbor is unaffected", () => {
    const research = defineDeidPolicy({
      name: "research",
      transforms: { [C.DATES]: "date-shift" },
    });
    expect(research.transforms[C.DATES]).toBe("date-shift");
    expect(() => resolvePolicy(research)).not.toThrow();
    // The built-in generalizes dates, so it satisfies the contract.
    expect(() => resolvePolicy("safe-harbor")).not.toThrow();
    expect(SAFE_HARBOR_POLICY.transforms[C.DATES]).toBe("generalize");
  });
});
