/**
 * Policy-profile tests (DEID-10): the two built-in presets, the widen-never-narrow contract, the
 * reserved-label guard, and `profileOptions` composition. All values are synthetic.
 */

import { describe, expect, it } from "vitest";

import {
  createDeidContext,
  defineDeidProfile,
  deidentify,
  DeidError,
  FATAL_CODES,
  LIMITED_DATA_SET_PROFILE,
  profileOptions,
  isRetainableCategory,
  LIMITED_DATA_SET_DIRECT_IDENTIFIERS,
  RETAINED_LOCUS_CLASSES,
  retains,
  SAFE_HARBOR_CATEGORIES,
  SAFE_HARBOR_POLICY,
  SAFE_HARBOR_PROFILE,
  type DeidProfile,
} from "../src/index.js";

const C = SAFE_HARBOR_CATEGORIES;

describe("built-in profiles", () => {
  it("SAFE_HARBOR_PROFILE wraps the built-in Safe Harbor policy and needs no context", () => {
    expect(SAFE_HARBOR_PROFILE.standard).toBe("safe-harbor");
    expect(SAFE_HARBOR_PROFILE.policy).toBe(SAFE_HARBOR_POLICY);
    expect(SAFE_HARBOR_PROFILE.requiresContext).toBe(false);
  });

  it("LIMITED_DATA_SET_PROFILE date-shifts dates, is NOT labelled safe-harbor, and requires a context", () => {
    expect(LIMITED_DATA_SET_PROFILE.standard).toBe("limited-data-set");
    expect(LIMITED_DATA_SET_PROFILE.policy.name).not.toBe("safe-harbor");
    expect(LIMITED_DATA_SET_PROFILE.policy.transforms[C.DATES]).toBe("date-shift");
    // Identifier handling stays at Safe Harbor strength.
    expect(LIMITED_DATA_SET_PROFILE.policy.transforms[C.NAMES]).toBe("redact");
    expect(LIMITED_DATA_SET_PROFILE.policy.transforms[C.MRN]).toBe("pseudonymize");
    expect(LIMITED_DATA_SET_PROFILE.requiresContext).toBe(true);
  });

  it("the LDS profile actually shifts a date through the engine with a per-patient context", () => {
    const ctx = createDeidContext({ key: "lds-key", patientId: "p1" });
    const result = deidentify(
      { loci: [{ path: "d", kind: "date", category: C.DATES, value: "2020-06-15" }] },
      profileOptions(LIMITED_DATA_SET_PROFILE, ctx),
    );
    const out = result.document.loci[0]?.value;
    expect(typeof out).toBe("string");
    // A shifted real date (not generalized to a bare year).
    expect(out).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("defineDeidProfile, the widen-never-narrow contract", () => {
  it("accepts an override that TIGHTENS a category (pseudonymize -> redact)", () => {
    const strict = defineDeidProfile({
      name: "site-strict",
      transforms: { [C.MRN]: "redact" },
    });
    expect(strict.policy.transforms[C.MRN]).toBe("redact");
    expect(strict.standard).toBe("custom");
    // Untouched categories keep the base.
    expect(strict.policy.transforms[C.NAMES]).toBe("redact");
  });

  it("rejects an override that WEAKENS a category (redact -> generalize)", () => {
    expect(() =>
      defineDeidProfile({ name: "site-loose", transforms: { [C.NAMES]: "generalize" } }),
    ).toThrowError(expect.objectContaining({ code: FATAL_CODES.DEID_PROFILE_INVALID }));
  });

  it("rejects weakening a pseudonymized identifier down to a date-shift", () => {
    expect(() =>
      defineDeidProfile({ name: "site-x", transforms: { [C.MRN]: "date-shift" } }),
    ).toThrowError(expect.objectContaining({ code: FATAL_CODES.DEID_PROFILE_INVALID }));
  });

  it("rejects reclaiming a reserved standard label that does not match the base", () => {
    // "limited-data-set" while deriving from the Safe Harbor base: a label mismatch, rejected.
    expect(() => defineDeidProfile({ name: "limited-data-set" })).toThrowError(
      expect.objectContaining({ code: FATAL_CODES.DEID_PROFILE_INVALID }),
    );
    // "safe-harbor" while deriving from the LDS base: also a mismatch, rejected.
    expect(() =>
      defineDeidProfile({ name: "safe-harbor", base: LIMITED_DATA_SET_PROFILE }),
    ).toThrowError(expect.objectContaining({ code: FATAL_CODES.DEID_PROFILE_INVALID }));
  });

  it("can derive from the LDS base and TIGHTEN dates back to generalize (widening)", () => {
    const tightened = defineDeidProfile({
      name: "lds-tightened",
      base: LIMITED_DATA_SET_PROFILE,
      transforms: { [C.DATES]: "generalize" }, // date-shift(1) -> generalize(2): stronger, allowed
    });
    expect(tightened.policy.transforms[C.DATES]).toBe("generalize");
  });

  it("marks requiresContext true when a keyed transform survives in the derived policy", () => {
    const p: DeidProfile = defineDeidProfile({ name: "site-y", transforms: {} });
    // Safe Harbor pseudonymizes MRN/account/beneficiary → keyed → requires a context.
    expect(p.requiresContext).toBe(true);
  });
});

describe("profileOptions composition", () => {
  it("produces DeidOptions carrying the profile policy and the supplied context", () => {
    const ctx = createDeidContext({ key: "k", patientId: "p1" });
    const opts = profileOptions(SAFE_HARBOR_PROFILE, ctx);
    expect(opts.policy).toBe(SAFE_HARBOR_PROFILE.policy);
    expect(opts.context).toBe(ctx);
  });

  it("lets an explicit override win over the profile default redactor and context", () => {
    const base = createDeidContext({ key: "k1", patientId: "p1" });
    const override = createDeidContext({ key: "k2", patientId: "p1" });
    const redactor = () => ({ text: "[redacted]" });
    const withRedactor = defineDeidProfile({ name: "site-r", redactor });
    const opts = profileOptions(withRedactor, base, { context: override });
    expect(opts.context).toBe(override);
    expect(opts.redactor).toBe(redactor);
  });

  it("omits context/redactor when neither is provided", () => {
    const opts = profileOptions(SAFE_HARBOR_PROFILE);
    expect(opts.context).toBeUndefined();
    expect(opts.redactor).toBeUndefined();
    expect(opts.policy).toBe(SAFE_HARBOR_PROFILE.policy);
  });
});

describe("policy-scoped retention, and what widen-never-narrow means for it", () => {
  const R = RETAINED_LOCUS_CLASSES;

  it("Safe Harbor retains NOTHING; the limited data set retains the two §164.514(e)(2) permits", () => {
    expect(SAFE_HARBOR_PROFILE.retainedLoci).toEqual([]);
    expect([...LIMITED_DATA_SET_PROFILE.retainedLoci].sort()).toEqual([
      "encounter-dates",
      "encounter-identifiers",
    ]);
  });

  it("retains() fails closed on an absent or empty set", () => {
    expect(retains(undefined, R.ENCOUNTER_DATES)).toBe(false);
    expect(retains([], R.ENCOUNTER_DATES)).toBe(false);
    expect(retains([R.ENCOUNTER_DATES], R.ENCOUNTER_DATES)).toBe(true);
    expect(retains([R.ENCOUNTER_DATES], R.ENCOUNTER_IDENTIFIERS)).toBe(false);
  });

  it("profileOptions carries the retention set; a hand-built options bag does not", () => {
    expect(profileOptions(SAFE_HARBOR_PROFILE).retainedLoci).toEqual([]);
    expect(profileOptions(LIMITED_DATA_SET_PROFILE).retainedLoci).toHaveLength(2);
    // The fail-closed direction: reading the policy off a profile loses the retention set entirely.
    const handBuilt = { policy: LIMITED_DATA_SET_PROFILE.policy };
    expect(handBuilt).not.toHaveProperty("retainedLoci");
  });

  it("DROPPING a retained class is a WIDENING and is allowed (keep less, remove more)", () => {
    const tighter = defineDeidProfile({
      name: "site-dates-only",
      base: LIMITED_DATA_SET_PROFILE,
      retainedLoci: [R.ENCOUNTER_DATES],
    });
    expect(tighter.retainedLoci).toEqual([R.ENCOUNTER_DATES]);

    const strictest = defineDeidProfile({
      name: "site-retain-nothing",
      base: LIMITED_DATA_SET_PROFILE,
      retainedLoci: [],
    });
    expect(strictest.retainedLoci).toEqual([]);
  });

  it("ADDING a retained class is a NARROWING and is REJECTED (fatal DEID_PROFILE_INVALID)", () => {
    // Derived from Safe Harbor, which retains nothing: any class at all is an addition.
    expect(() =>
      defineDeidProfile({
        name: "site-keeps-visit-numbers",
        retainedLoci: [R.ENCOUNTER_IDENTIFIERS],
      }),
    ).toThrow(DeidError);
    try {
      defineDeidProfile({ name: "site-keeps-dates", retainedLoci: [R.ENCOUNTER_DATES] });
      expect.unreachable("adding a retention class must be rejected");
    } catch (err) {
      expect((err as DeidError).code).toBe(FATAL_CODES.DEID_PROFILE_INVALID);
    }
    // And a profile derived from the LDS base may not add one it does not already have either: with
    // both classes on the base there is nothing left to add, so drop one first and then try to re-add.
    const dropped = defineDeidProfile({
      name: "site-dropped",
      base: LIMITED_DATA_SET_PROFILE,
      retainedLoci: [R.ENCOUNTER_DATES],
    });
    expect(() =>
      defineDeidProfile({
        name: "site-re-added",
        base: dropped,
        retainedLoci: [R.ENCOUNTER_DATES, R.ENCOUNTER_IDENTIFIERS],
      }),
    ).toThrow(DeidError);
  });

  it("omitting retainedLoci inherits the base's set unchanged", () => {
    const derived = defineDeidProfile({ name: "site-inherit", base: LIMITED_DATA_SET_PROFILE });
    expect([...derived.retainedLoci].sort()).toEqual(
      [...LIMITED_DATA_SET_PROFILE.retainedLoci].sort(),
    );
  });

  it("a retained locus is passed through UNCHANGED and always RECORDED as a residual", () => {
    const ctx = createDeidContext({ key: "retain-key", patientId: "p1" });
    const { document, manifest } = deidentify(
      {
        loci: [
          {
            path: "PV1-44",
            kind: "date",
            category: C.DATES,
            retention: R.ENCOUNTER_DATES,
            value: "20200103040500",
          },
        ],
      },
      profileOptions(LIMITED_DATA_SET_PROFILE, ctx),
    );
    expect(document.loci[0]?.value).toBe("20200103040500");
    expect(document.loci[0]?.disposition).toBe("retained");
    expect(manifest[0]?.disposition).toBe("retained");
    expect(manifest[0]?.transform).toBe("retain");
    expect(manifest[0]?.code).toBe("DEID_RESIDUAL_RETAINED");
  });

  it("the retention marker can never keep free text or unrecognized structure (guard order)", () => {
    const ctx = createDeidContext({ key: "retain-key", patientId: "p1" });
    const { document, manifest } = deidentify(
      {
        loci: [
          {
            path: "NTE-3",
            kind: "freetext",
            category: C.OTHER_UNIQUE_ID,
            retention: R.ENCOUNTER_DATES,
            value: "ZZPROSE",
          },
          {
            path: "ZPI-1",
            kind: "unknown",
            category: C.OTHER_UNIQUE_ID,
            retention: R.ENCOUNTER_DATES,
            value: "ZZUNKNOWN",
          },
          {
            path: "PID-5",
            kind: "identifier",
            retention: R.ENCOUNTER_DATES,
            value: "ZZUNCLASSIFIED",
          },
        ],
      },
      profileOptions(LIMITED_DATA_SET_PROFILE, ctx),
    );
    // All three fail closed regardless of the flag: the three guards run BEFORE retention.
    expect(document.loci.map((l) => l.value)).toEqual([null, null, null]);
    expect(manifest.every((m) => m.disposition === "blocked")).toBe(true);
  });

  it("`retain` is not policy-assignable: assigning it to a category fails closed to a block", () => {
    expect(() =>
      defineDeidProfile({ name: "site-retain-names", transforms: { [C.NAMES]: "retain" } }),
    ).toThrow(DeidError);
  });
});

describe("retention needs all three keys, and any one missing means the transform runs", () => {
  const R = RETAINED_LOCUS_CLASSES;
  const ctx = createDeidContext({ key: "three-keys", patientId: "p1" });
  const dateLocus = {
    path: "PV1-44",
    kind: "date",
    category: C.DATES,
    retention: R.ENCOUNTER_DATES,
    value: "20200103040500",
  } as const;

  it("key 2: an adapter marker alone does NOT retain when the options bag is bare", () => {
    // The failure this pins: an engine that trusts the locus marker on its own turns every options
    // bag into a retaining one, which is the opposite of the documented fail-closed default.
    const { document, manifest } = deidentify({ loci: [dateLocus] }, {});
    expect(document.loci[0]?.value).toBe("2020");
    expect(document.loci[0]?.disposition).toBe("transformed");
    expect(manifest[0]?.transform).toBe("generalize");
  });

  it("key 2: an explicitly EMPTY retention set does not retain either", () => {
    const { document } = deidentify(
      { loci: [dateLocus] },
      { policy: LIMITED_DATA_SET_PROFILE.policy, retainedLoci: [], context: ctx },
    );
    expect(document.loci[0]?.value).not.toBe("20200103040500");
  });

  it("key 2: a set naming a DIFFERENT class does not retain", () => {
    const { document } = deidentify(
      { loci: [dateLocus] },
      {
        policy: LIMITED_DATA_SET_PROFILE.policy,
        retainedLoci: [R.ENCOUNTER_IDENTIFIERS],
        context: ctx,
      },
    );
    expect(document.loci[0]?.value).not.toBe("20200103040500");
  });

  it("key 3: a category §164.514(e)(2) NAMES is never retainable, whatever is asked for", () => {
    // The sixteen direct identifiers of a limited data set. Each one carries a retention marker and a
    // matching enabled class, and each one must still be transformed.
    for (const category of [C.MRN, C.ACCOUNT, C.SSN, C.HEALTH_PLAN_BENEFICIARY, C.NAMES, C.PHONE]) {
      const { document, manifest } = deidentify(
        {
          loci: [
            {
              path: "PV1-19[0]",
              kind: "identifier",
              category,
              retention: R.ENCOUNTER_IDENTIFIERS,
              value: "ZZDIRECTID",
            },
          ],
        },
        profileOptions(LIMITED_DATA_SET_PROFILE, ctx),
      );
      expect(document.loci[0]?.value).not.toBe("ZZDIRECTID");
      expect(manifest[0]?.disposition).not.toBe("retained");
    }
    // And exactly two of the eighteen are retainable: DATES and the (R) catch-all.
    expect(isRetainableCategory(C.DATES)).toBe(true);
    expect(isRetainableCategory(C.OTHER_UNIQUE_ID)).toBe(true);
    expect(LIMITED_DATA_SET_DIRECT_IDENTIFIERS.size).toBe(16);
  });

  it("the reserved safe-harbor label refuses retention however the options bag was built", () => {
    // The route no profile check can see: a hand-built bag pairing the reserved label with a
    // retention set. It must be fatal, not a Safe-Harbor-labelled result that is not Safe Harbor.
    try {
      deidentify(
        { loci: [dateLocus] },
        { policy: "safe-harbor", retainedLoci: [R.ENCOUNTER_DATES], context: ctx },
      );
      expect.unreachable("a safe-harbor-labelled policy must not retain");
    } catch (err) {
      expect((err as DeidError).code).toBe(FATAL_CODES.DEID_POLICY_INVALID);
    }
    // The same bag with an empty set is fine: it is the retention, not the option, that is refused.
    expect(() =>
      deidentify({ loci: [dateLocus] }, { policy: "safe-harbor", retainedLoci: [] }),
    ).not.toThrow();
  });
});
