/**
 * Tests for the policy engine: the Safe Harbor default assignment, `defineDeidPolicy` (deviate from
 * the safe default, never forget a category), `resolvePolicy`, and the **label contract**: which
 * (category, transform) pairs a `safe-harbor`-labelled policy may carry, and the typed fatal when it
 * carries one it may not.
 */

import { describe, expect, it } from "vitest";

import {
  DeidError,
  FATAL_CODES,
  SAFE_HARBOR_CATEGORIES,
  SAFE_HARBOR_POLICY,
  defineDeidPolicy,
  deidentify,
  resolvePolicy,
  type DeidPolicy,
  type SafeHarborCategory,
  type TransformName,
} from "../src/index.js";

const C = SAFE_HARBOR_CATEGORIES;
const CATEGORIES = Object.values(C) as readonly SafeHarborCategory[];

/** The eight published transform names. */
const TRANSFORMS: readonly TransformName[] = [
  "redact",
  "generalize",
  "date-shift",
  "pseudonymize",
  "hash",
  "block",
  "byo-redact",
  "retain",
];

/**
 * The classification the label contract grades against, restated here INDEPENDENTLY of the
 * implementation so the grid is a real oracle and not a tautology: a pair is derived-output when the
 * result for that category is computed from the category's own value, rather than withheld or
 * coarsened where §164.514(b)(2)(i) expressly permits a coarsening for THAT category.
 */
function isDerivedOutput(category: SafeHarborCategory, transform: TransformName): boolean {
  if (transform === "redact" || transform === "block") return false; // withholds the value
  if (transform === "byo-redact" || transform === "retain") return false; // falls closed to a block
  if (transform === "generalize") return category !== C.GEOGRAPHIC && category !== C.DATES;
  return true; // pseudonymize / hash / date-shift, on all 18
}

/** Mint a `safe-harbor`-labelled policy that assigns exactly one category one transform. */
function labelled(category: SafeHarborCategory, transform: TransformName): DeidPolicy {
  return {
    name: "safe-harbor",
    transforms: { ...SAFE_HARBOR_POLICY.transforms, [category]: transform },
  };
}

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
    // A keyed surrogate of one of these is DERIVED from the individual's own value, so it is not a
    // §164.514(c)(1) code and the (R) exception does not reach it: Safe Harbor removes instead.
    expect(SAFE_HARBOR_POLICY.transforms[C.MRN]).toBe("redact");
    expect(SAFE_HARBOR_POLICY.transforms[C.HEALTH_PLAN_BENEFICIARY]).toBe("redact");
    expect(SAFE_HARBOR_POLICY.transforms[C.ACCOUNT]).toBe("redact");
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

describe("the key/label contract, date-shift is not Safe Harbor", () => {
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

describe("the label contract over the whole (category, transform) grid", () => {
  it("refuses EXACTLY the derived-output pairs, over all 18 categories × 8 transforms", () => {
    // 144 pairs, each constructed rather than assumed unreachable, and each graded against the
    // independent classification above at BOTH enforcement points.
    let refused = 0;
    let accepted = 0;
    for (const category of CATEGORIES) {
      for (const transform of TRANSFORMS) {
        const policy = labelled(category, transform);
        const derived = isDerivedOutput(category, transform);
        if (derived) {
          refused += 1;
          expect(() => resolvePolicy(policy)).toThrowError(
            expect.objectContaining({ code: FATAL_CODES.DEID_POLICY_INVALID }),
          );
          expect(() =>
            defineDeidPolicy({ name: "safe-harbor", transforms: { [category]: transform } }),
          ).toThrowError(expect.objectContaining({ code: FATAL_CODES.DEID_POLICY_INVALID }));
        } else {
          accepted += 1;
          expect(() => resolvePolicy(policy)).not.toThrow();
          expect(() =>
            defineDeidPolicy({ name: "safe-harbor", transforms: { [category]: transform } }),
          ).not.toThrow();
        }
      }
    }
    // pseudonymize/hash/date-shift on 18 each (54) + generalize on the 16 outside (B) and (C).
    expect(refused).toBe(70);
    expect(accepted).toBe(74);
    expect(refused + accepted).toBe(18 * 8);
  });

  it("names the three keyed transforms on a representative category each", () => {
    for (const [category, transform] of [
      [C.MRN, "pseudonymize"],
      [C.URL, "hash"],
      [C.DATES, "date-shift"],
    ] as const) {
      expect(() => resolvePolicy(labelled(category, transform))).toThrowError(
        expect.objectContaining({ code: FATAL_CODES.DEID_POLICY_INVALID }),
      );
    }
  });

  it("refuses generalize on (J) account and on another of the sixteen, and ACCEPTS it on (B) and (C)", () => {
    expect(() => resolvePolicy(labelled(C.ACCOUNT, "generalize"))).toThrow(DeidError);
    expect(() => resolvePolicy(labelled(C.SSN, "generalize"))).toThrow(DeidError);
    expect(() => resolvePolicy(labelled(C.GEOGRAPHIC, "generalize"))).not.toThrow();
    expect(() => resolvePolicy(labelled(C.DATES, "generalize"))).not.toThrow();
  });

  it("the fatal names the offending category AND transform, and carries no value / key / offset", () => {
    try {
      resolvePolicy(labelled(C.HEALTH_PLAN_BENEFICIARY, "hash"));
      expect.unreachable("a hashed beneficiary number must not wear the safe-harbor label");
    } catch (err) {
      const e = err as DeidError;
      expect(e.code).toBe(FATAL_CODES.DEID_POLICY_INVALID);
      expect(e.message).toContain("HEALTH_PLAN_BENEFICIARY");
      expect(e.message).toContain("hash");
      expect(e.message).not.toContain("SENTINEL");
    }
  });

  it("with MORE THAN ONE offending pair, names at least one and still refuses", () => {
    const many: DeidPolicy = {
      name: "safe-harbor",
      transforms: {
        ...SAFE_HARBOR_POLICY.transforms,
        [C.MRN]: "pseudonymize",
        [C.ACCOUNT]: "hash",
        [C.NAMES]: "generalize",
      },
    };
    try {
      resolvePolicy(many);
      expect.unreachable("a policy with three offending pairs must be refused");
    } catch (err) {
      const e = err as DeidError;
      expect(e.code).toBe(FATAL_CODES.DEID_POLICY_INVALID);
      // Regulatory order: (A) NAMES offends first, so it is the pair named.
      expect(e.message).toContain("NAMES");
      expect(e.message).toContain("generalize");
    }
  });

  it("refuses an assignment that is not a published transform name, and one that is missing", () => {
    const unpublished = {
      name: "safe-harbor",
      transforms: { ...SAFE_HARBOR_POLICY.transforms, [C.MRN]: "tokenise" },
    } as unknown as DeidPolicy;
    expect(() => resolvePolicy(unpublished)).toThrowError(
      expect.objectContaining({ code: FATAL_CODES.DEID_POLICY_INVALID }),
    );
    // A policy whose map covers only one category: the other seventeen read as unassigned, which is
    // not a published transform name either, so the same refusal applies.
    const missing = {
      name: "safe-harbor",
      transforms: { [C.NAMES]: "redact" },
    } as unknown as DeidPolicy;
    expect(() => resolvePolicy(missing)).toThrowError(
      expect.objectContaining({ code: FATAL_CODES.DEID_POLICY_INVALID }),
    );
  });
});

describe("the label contract at the POINT OF USE, on a caller-constructed policy", () => {
  it("refuses before any locus is transformed, returning no document and no manifest", () => {
    // Never minted by the library: a consumer can write this object literal directly.
    const smuggled: DeidPolicy = {
      name: "safe-harbor",
      transforms: { ...SAFE_HARBOR_POLICY.transforms, [C.MRN]: "pseudonymize" },
    };
    let result: unknown = "not-assigned";
    try {
      result = deidentify(
        {
          loci: [
            { path: "PID-5", kind: "identifier", category: C.NAMES, value: "SENTINEL_NAME" },
            { path: "PID-3", kind: "identifier", category: C.MRN, value: "SENTINEL_MRN" },
          ],
        },
        { policy: smuggled },
      );
      expect.unreachable("the engine must refuse a labelled policy carrying a derived-output pair");
    } catch (err) {
      expect((err as DeidError).code).toBe(FATAL_CODES.DEID_POLICY_INVALID);
      expect((err as DeidError).message).not.toContain("SENTINEL");
    }
    expect(result).toBe("not-assigned"); // no document and no manifest came back
  });
});

describe("the label contract's negative controls: what must still pass", () => {
  it("accepts redact / block on any category and generalize on (B) and (C), applying them unchanged", () => {
    for (const category of CATEGORIES) {
      expect(() => resolvePolicy(labelled(category, "redact"))).not.toThrow();
      expect(() => resolvePolicy(labelled(category, "block"))).not.toThrow();
    }
    const zip = deidentify(
      { loci: [{ path: "PID-11", kind: "zip", category: C.GEOGRAPHIC, value: "90210" }] },
      { policy: labelled(C.GEOGRAPHIC, "generalize") },
    );
    expect(zip.document.loci[0]?.value).toBe("902");
    const dob = deidentify(
      { loci: [{ path: "PID-7", kind: "date", category: C.DATES, value: "1985-07-02" }] },
      { policy: labelled(C.DATES, "generalize") },
    );
    expect(dob.document.loci[0]?.value).toBe("1985");
    const age = deidentify(
      { loci: [{ path: "PID-age", kind: "age", category: C.DATES, value: "94" }] },
      { policy: labelled(C.DATES, "generalize") },
    );
    expect(age.document.loci[0]?.value).toBe("90+");
  });

  it("accepts `retain` and `byo-redact` under the label, and the engine WITHHOLDS at that locus", () => {
    // Acceptance alone is not the assertion: the block is the whole reason the pair is let through.
    for (const transform of ["retain", "byo-redact"] as const) {
      const policy = labelled(C.MRN, transform);
      expect(() => resolvePolicy(policy)).not.toThrow();
      const { document, manifest } = deidentify(
        { loci: [{ path: "PID-3", kind: "identifier", category: C.MRN, value: "SENTINEL_MRN" }] },
        { policy },
      );
      expect(document.loci[0]?.value).toBeNull();
      expect(document.loci[0]?.disposition).toBe("blocked");
      expect(manifest[0]?.disposition).toBe("blocked");
      expect(manifest[0]?.transform).toBe("block");
      expect(manifest[0]?.reidentificationCode).toBe(false);
      expect(JSON.stringify({ document, manifest })).not.toContain("SENTINEL_MRN");
    }
  });

  it("resolving and applying the library's OWN default policy never throws", () => {
    expect(() => resolvePolicy(undefined)).not.toThrow();
    expect(() => resolvePolicy("safe-harbor")).not.toThrow();
    expect(() => resolvePolicy(SAFE_HARBOR_POLICY)).not.toThrow();
    expect(() =>
      deidentify(
        { loci: [{ path: "PID-3", kind: "identifier", category: C.MRN, value: "SENTINEL_MRN" }] },
        {},
      ),
    ).not.toThrow();
  });
});

describe("a policy that does NOT claim the label keeps its keyed surrogate (no silent repair)", () => {
  it("applies the derived-output transform unchanged and never rewrites the policy name", () => {
    const research = defineDeidPolicy({
      name: "research",
      transforms: { [C.MRN]: "pseudonymize" },
    });
    expect(research.name).toBe("research");
    expect(research.transforms[C.MRN]).toBe("pseudonymize");
    const resolved = resolvePolicy(research);
    expect(resolved).toBe(research);
    expect(resolved.name).toBe("research");
    expect(resolved.transforms[C.MRN]).toBe("pseudonymize");
  });

  it("a name that merely RESEMBLES the label is a different policy the guard does not reach", () => {
    // Exact equality, deliberately: the library mints no lookalike, so nothing library-produced is
    // left unguarded, and a caller-named policy outside this contract is not newly refused.
    for (const name of [
      "Safe-Harbor",
      "SAFE-HARBOR",
      "safe harbor",
      " safe-harbor",
      "safeharbor",
    ]) {
      const lookalike: DeidPolicy = {
        name,
        transforms: { ...SAFE_HARBOR_POLICY.transforms, [C.MRN]: "pseudonymize" },
      };
      expect(() => resolvePolicy(lookalike)).not.toThrow();
      expect(resolvePolicy(lookalike).name).toBe(name);
    }
  });
});
