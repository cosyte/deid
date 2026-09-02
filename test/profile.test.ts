/**
 * Policy-profile tests (DEID-10): the two built-in presets, the widen-never-narrow contract, the
 * reserved-label guard, and `profileOptions` composition. All values are synthetic.
 */

import { describe, expect, it } from "vitest";

import {
  assertLimitedDataSetRetention,
  buildExpertDeterminationSupportReport,
  createDeidContext,
  defineDeidProfile,
  deidentify,
  DeidError,
  FATAL_CODES,
  LIMITED_DATA_SET_PROFILE,
  profileOptions,
  isRetainableCategory,
  isRetainablePart,
  isRetainableZipCode,
  LIMITED_DATA_SET_ADDRESS_PARTS,
  LIMITED_DATA_SET_DIRECT_IDENTIFIERS,
  LIMITED_DATA_SET_RETENTION_CLASSES,
  RETAINED_LOCUS_CLASSES,
  retains,
  SAFE_HARBOR_CATEGORIES,
  SAFE_HARBOR_POLICY,
  SAFE_HARBOR_PROFILE,
  type DeidProfile,
  type LocusModel,
  type RetainedLocusClass,
  type RetainedLocusPart,
  type TransformName,
} from "../src/index.js";

const C = SAFE_HARBOR_CATEGORIES;

/** The three categories this contract moves to `redact` in the Safe Harbor base: (H), (I), (J). */
const KEYED_TRIPLE = [C.MRN, C.HEALTH_PLAN_BENEFICIARY, C.ACCOUNT] as const;

describe("built-in profiles", () => {
  it("SAFE_HARBOR_PROFILE wraps the built-in Safe Harbor policy and needs no context", () => {
    expect(SAFE_HARBOR_PROFILE.standard).toBe("safe-harbor");
    expect(SAFE_HARBOR_PROFILE.policy).toBe(SAFE_HARBOR_POLICY);
    expect(SAFE_HARBOR_PROFILE.requiresContext).toBe(false);
  });

  it("SAFE_HARBOR_PROFILE removes (H), (I) and (J) and says so in its own description", () => {
    for (const category of KEYED_TRIPLE) {
      expect(SAFE_HARBOR_PROFILE.policy.transforms[category]).toBe("redact");
    }
    // A preset that misdescribes its own transform set is the same defect as a mislabelled one.
    expect(SAFE_HARBOR_PROFILE.description).not.toContain("pseudonymized");
    expect(SAFE_HARBOR_PROFILE.description).toContain("REMOVED");
  });

  it("LIMITED_DATA_SET_PROFILE date-shifts dates, is NOT labelled safe-harbor, and requires a context", () => {
    expect(LIMITED_DATA_SET_PROFILE.standard).toBe("limited-data-set");
    expect(LIMITED_DATA_SET_PROFILE.policy.name).not.toBe("safe-harbor");
    expect(LIMITED_DATA_SET_PROFILE.policy.transforms[C.DATES]).toBe("date-shift");
    // Identifier handling stays at Safe Harbor strength.
    expect(LIMITED_DATA_SET_PROFILE.policy.transforms[C.NAMES]).toBe("redact");
    // ...except that the three keyed identifiers stay keyed HERE, so linkage survives under a preset
    // that does not, and may not, claim Safe Harbor.
    for (const category of KEYED_TRIPLE) {
      expect(LIMITED_DATA_SET_PROFILE.policy.transforms[category]).toBe("pseudonymize");
    }
    expect(LIMITED_DATA_SET_PROFILE.requiresContext).toBe(true);
    expect(LIMITED_DATA_SET_PROFILE.description).toContain("KEYED SURROGATES");
    expect(LIMITED_DATA_SET_PROFILE.description).toContain("NOT Safe Harbor");
  });

  it("the LDS preset's other fourteen categories are exactly the Safe Harbor base's", () => {
    // The eighteen less the three above and the dates it already overrides.
    const overridden = new Set<string>([...KEYED_TRIPLE, C.DATES]);
    const others = (Object.values(C) as string[]).filter((c) => !overridden.has(c));
    expect(others).toHaveLength(14);
    for (const category of others as (keyof typeof SAFE_HARBOR_POLICY.transforms)[]) {
      expect(LIMITED_DATA_SET_PROFILE.policy.transforms[category]).toBe(
        SAFE_HARBOR_POLICY.transforms[category],
      );
    }
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
  it("accepts an override that TIGHTENS a category (generalize -> redact)", () => {
    const strict = defineDeidProfile({
      name: "site-strict",
      transforms: { [C.GEOGRAPHIC]: "redact" },
    });
    expect(strict.policy.transforms[C.GEOGRAPHIC]).toBe("redact");
    expect(strict.standard).toBe("custom");
    // Untouched categories keep the base.
    expect(strict.policy.transforms[C.NAMES]).toBe("redact");
  });

  it("rejects an override that WEAKENS a category (redact -> generalize)", () => {
    expect(() =>
      defineDeidProfile({ name: "site-loose", transforms: { [C.NAMES]: "generalize" } }),
    ).toThrowError(expect.objectContaining({ code: FATAL_CODES.DEID_PROFILE_INVALID }));
  });

  it("rejects weakening a removed identifier down to a date-shift", () => {
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

  it("marks requiresContext by whether a keyed transform survives in the derived policy", () => {
    // The Safe Harbor base now REMOVES MRN / beneficiary / account, so nothing in it is keyed and a
    // profile derived from it needs no context at all.
    const fromSafeHarbor: DeidProfile = defineDeidProfile({ name: "site-y", transforms: {} });
    expect(fromSafeHarbor.requiresContext).toBe(false);
    // Derived from the limited-data-set base, whose date-shift and identifier surrogates ARE keyed.
    const fromLds: DeidProfile = defineDeidProfile({
      name: "site-y-lds",
      base: LIMITED_DATA_SET_PROFILE,
    });
    expect(fromLds.requiresContext).toBe(true);
  });
});

describe("widen-never-narrow over (H), (I) and (J), now that the base REDACTS them", () => {
  /** The two sets are exhaustive over the published transform set, graded against the pinned rank. */
  const REFUSED: readonly TransformName[] = [
    "pseudonymize",
    "hash",
    "date-shift",
    "generalize",
    "retain",
  ];
  const ACCEPTED: readonly TransformName[] = ["redact", "block", "byo-redact"];

  it("the two sets partition the published transform set, with nothing left over", () => {
    // The pinned protection ranking is NOT re-derived here: this asserts the sets it must yield.
    const all = [...REFUSED, ...ACCEPTED].sort();
    expect(all).toEqual(
      [
        "block",
        "byo-redact",
        "date-shift",
        "generalize",
        "hash",
        "pseudonymize",
        "redact",
        "retain",
      ].sort(),
    );
    expect(new Set(all).size).toBe(8);
  });

  it("REFUSES every weakening override, on each of the three, each one constructed", () => {
    for (const category of KEYED_TRIPLE) {
      for (const transform of REFUSED) {
        expect(() =>
          defineDeidProfile({
            name: `site-${category}-${transform}`,
            transforms: { [category]: transform },
          }),
        ).toThrowError(expect.objectContaining({ code: FATAL_CODES.DEID_PROFILE_INVALID }));
      }
    }
  });

  it("ACCEPTS every equal-or-stronger override, on each of the three, each one constructed", () => {
    for (const category of KEYED_TRIPLE) {
      for (const transform of ACCEPTED) {
        const derived = defineDeidProfile({
          name: `ok-${category}-${transform}`,
          transforms: { [category]: transform },
        });
        expect(derived.policy.transforms[category]).toBe(transform);
      }
    }
  });

  it("the shipped code path is what refuses: no bypass, exemption flag or trusted-caller route", () => {
    // The library's own limited-data-set preset does NOT go through this check (it is built from the
    // policy layer, not derived from the Safe Harbor PROFILE), so nothing had to be exempted to make
    // it resolve. Deriving it the other way round is still refused, which is the point.
    expect(() =>
      defineDeidProfile({ name: "would-be-lds", transforms: { [C.MRN]: "pseudonymize" } }),
    ).toThrowError(expect.objectContaining({ code: FATAL_CODES.DEID_PROFILE_INVALID }));
  });
});

describe("the label contract on a PROFILE that declares the safe-harbor standard", () => {
  /** A hand-built profile: it DECLARES the standard while its policy is named something else. */
  function declaringProfile(transform: TransformName): DeidProfile {
    return {
      name: "site-p",
      standard: "safe-harbor",
      policy: {
        name: "site-p-policy",
        transforms: { ...SAFE_HARBOR_POLICY.transforms, [C.MRN]: transform },
      },
      description: "hand-built",
      requiresContext: false,
      retainedLoci: [],
    };
  }

  it("refuses it with DEID_POLICY_INVALID at the point it becomes engine options", () => {
    try {
      profileOptions(declaringProfile("pseudonymize"));
      expect.unreachable(
        "a profile declaring the safe-harbor standard may not pseudonymize an MRN",
      );
    } catch (err) {
      const e = err as DeidError;
      expect(e.code).toBe(FATAL_CODES.DEID_POLICY_INVALID);
      expect(e.message).toContain("MRN");
      expect(e.message).toContain("pseudonymize");
    }
  });

  it("refuses it with DEID_POLICY_INVALID when it is used as a derivation base", () => {
    expect(() =>
      defineDeidProfile({ name: "site-derived", base: declaringProfile("pseudonymize") }),
    ).toThrowError(expect.objectContaining({ code: FATAL_CODES.DEID_POLICY_INVALID }));
  });

  it("where BOTH refusals fall due at derive time, the derive-time one wins (DEID_PROFILE_INVALID)", () => {
    // The reserved-name refusal and the base's label refusal both apply to this one call. A profile
    // that is refused never mints a policy to label, so the profile code is the one a caller sees.
    try {
      defineDeidProfile({ name: "safe-harbor", base: declaringProfile("pseudonymize") });
      expect.unreachable("a derived profile may not reclaim a reserved standard label");
    } catch (err) {
      expect((err as DeidError).code).toBe(FATAL_CODES.DEID_PROFILE_INVALID);
    }
  });

  it("leaves a profile that declares a DIFFERENT standard entirely alone", () => {
    const custom: DeidProfile = {
      ...declaringProfile("pseudonymize"),
      standard: "custom",
    };
    expect(() => profileOptions(custom)).not.toThrow();
    expect(profileOptions(custom).policy).toBe(custom.policy);
    expect(custom.policy.transforms[C.MRN]).toBe("pseudonymize");
  });

  it("the library's OWN Safe Harbor profile passes both surfaces", () => {
    expect(() => profileOptions(SAFE_HARBOR_PROFILE)).not.toThrow();
    expect(() => defineDeidProfile({ name: "site-from-sh" })).not.toThrow();
  });
});

describe("the limited-data-set preset keeps consistent keyed surrogates available", () => {
  const ctx = createDeidContext({ key: "lds-linkage-key", patientId: "p1" });
  const model = {
    loci: [
      { path: "PID-3", kind: "identifier" as const, category: C.MRN, value: "ZZMRN-1" },
      {
        path: "IN1-49",
        kind: "identifier" as const,
        category: C.HEALTH_PLAN_BENEFICIARY,
        value: "ZZBEN-1",
      },
      { path: "PID-18", kind: "identifier" as const, category: C.ACCOUNT, value: "ZZACCT-1" },
      { path: "PID-7", kind: "date" as const, category: C.DATES, value: "2020-06-15" },
    ],
  };

  it("resolves AND applies without throwing, and neither claims nor is labelled safe-harbor", () => {
    expect(LIMITED_DATA_SET_PROFILE.standard).not.toBe("safe-harbor");
    expect(LIMITED_DATA_SET_PROFILE.policy.name).not.toBe("safe-harbor");
    expect(LIMITED_DATA_SET_PROFILE.description).toContain("NOT a certified de-identification");
    expect(() => profileOptions(LIMITED_DATA_SET_PROFILE, ctx)).not.toThrow();
    expect(() => deidentify(model, profileOptions(LIMITED_DATA_SET_PROFILE, ctx))).not.toThrow();
  });

  it("emits a CONSISTENT keyed surrogate for each of the three, flagged as a re-identification code", () => {
    const first = deidentify(model, profileOptions(LIMITED_DATA_SET_PROFILE, ctx));
    const second = deidentify(model, profileOptions(LIMITED_DATA_SET_PROFILE, ctx));
    for (const index of [0, 1, 2]) {
      const value = first.document.loci[index]?.value;
      expect(value).toMatch(/^[0-9a-f]{64}$/);
      expect(second.document.loci[index]?.value).toBe(value); // cross-document linkage survives
    }
    const byLocus = new Map(first.manifest.map((e) => [e.locus, e]));
    for (const locus of ["PID-3", "IN1-49", "PID-18"]) {
      expect(byLocus.get(locus)?.transform).toBe("pseudonymize");
      expect(byLocus.get(locus)?.reidentificationCode).toBe(true);
    }
    // The date-shifted locus is a keyed surrogate by the same definition.
    expect(byLocus.get("PID-7")?.transform).toBe("date-shift");
    expect(byLocus.get("PID-7")?.reidentificationCode).toBe(true);
    // And every one reaches the support report's keyed-surrogate inventory.
    const report = buildExpertDeterminationSupportReport(first.manifest, {
      policy: LIMITED_DATA_SET_PROFILE.policy,
    });
    expect(report.keyedSurrogateResiduals.map((r) => r.locus).sort()).toEqual([
      "IN1-49",
      "PID-18",
      "PID-3",
      "PID-7",
    ]);
  });

  it("fails with DEID_NO_KEY, never an unkeyed fallback, when a keyed category is present and no key is", () => {
    expect(() => deidentify(model, profileOptions(LIMITED_DATA_SET_PROFILE))).toThrowError(
      expect.objectContaining({ code: FATAL_CODES.DEID_NO_KEY }),
    );
  });

  it("on a document with NO such category the pass completes and throws nothing about a key", () => {
    const out = deidentify({ loci: [] }, profileOptions(LIMITED_DATA_SET_PROFILE));
    expect(out.manifest).toHaveLength(0);
    const report = buildExpertDeterminationSupportReport(out.manifest);
    expect(report.keyedSurrogateResiduals).toEqual([]);
    expect(report.retainedQuasiIdentifiers).toEqual([]);
    expect(report.dispositionSummary.residualRetained).toBe(0);
    expect(report.dispositionSummary.retained).toBe(0);
  });

  it("the built-in Safe Harbor profile over the SAME document needs no key and removes all three", () => {
    const out = deidentify(model, profileOptions(SAFE_HARBOR_PROFILE));
    expect(out.document.loci.slice(0, 3).map((l) => l.value)).toEqual([null, null, null]);
    for (const e of out.manifest.filter((m) => m.locus !== "PID-7")) {
      expect(e.transform).toBe("redact");
      expect(e.disposition).toBe("removed");
      expect(e.code).toBe("DEID_CATEGORY_REMOVED");
      expect(e.reidentificationCode).toBe(false);
    }
    expect(JSON.stringify(out)).not.toContain("ZZMRN-1");
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

  it("Safe Harbor retains NOTHING; the limited data set retains the three §164.514(e)(2) permits", () => {
    expect(SAFE_HARBOR_PROFILE.retainedLoci).toEqual([]);
    expect([...LIMITED_DATA_SET_PROFILE.retainedLoci].sort()).toEqual([
      "encounter-dates",
      "encounter-identifiers",
      "limited-data-set-geography",
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
    expect(profileOptions(LIMITED_DATA_SET_PROFILE).retainedLoci).toHaveLength(3);
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

describe("§164.514(e)(2)(ii): the list's only PARTIAL exclusion, and what the engine does with it", () => {
  const R = RETAINED_LOCUS_CLASSES;
  const P = LIMITED_DATA_SET_ADDRESS_PARTS;
  const ctx = createDeidContext({ key: "geo-part-key", patientId: "p1" });

  /** One address-part locus: the unit an adapter emits under the geographic class. */
  const partLoci = (name: RetainedLocusPart, value: string): LocusModel => ({
    loci: [
      {
        path: "PID-11[0].3",
        kind: "identifier",
        category: C.GEOGRAPHIC,
        retention: R.LIMITED_DATA_SET_GEOGRAPHY,
        retainedPart: name,
        value,
      },
    ],
  });

  it("GEOGRAPHIC stays on the sixteen-identifier list and stays UNretainable as a category", () => {
    // The class permits named PARTS; it does not make the category retainable, and the guard that
    // says so is the reason a county code and a birth place cannot ride in on it.
    expect(LIMITED_DATA_SET_DIRECT_IDENTIFIERS.has(C.GEOGRAPHIC)).toBe(true);
    expect(isRetainableCategory(C.GEOGRAPHIC)).toBe(false);
    expect(LIMITED_DATA_SET_DIRECT_IDENTIFIERS.size).toBe(16);
  });

  it("a marked NAMED PART is kept and recorded; the SAME locus unmarked is generalized", () => {
    const kept = deidentify(
      partLoci(P.TOWN_OR_CITY, "ZZTOWN"),
      profileOptions(LIMITED_DATA_SET_PROFILE, ctx),
    );
    expect(kept.document.loci[0]?.value).toBe("ZZTOWN");
    expect(kept.document.loci[0]?.disposition).toBe("retained");
    expect(kept.manifest[0]?.code).toBe("DEID_RESIDUAL_RETAINED");

    // The negative control: strip the part marker and the very same locus takes its policy transform.
    // A town has no readable ZIP prefix, so the geographic generalization fails closed and blocks it.
    const unmarked = deidentify(
      {
        loci: [
          {
            path: "PID-11[0].3",
            kind: "identifier",
            category: C.GEOGRAPHIC,
            retention: R.LIMITED_DATA_SET_GEOGRAPHY,
            value: "ZZTOWN",
          },
        ],
      },
      profileOptions(LIMITED_DATA_SET_PROFILE, ctx),
    );
    expect(unmarked.document.loci[0]?.value).toBeNull();
    expect(unmarked.manifest[0]?.disposition).toBe("blocked");
  });

  it("the part route needs the SAME three keys, and any one missing means the transform runs", () => {
    // Key 2: the options bag never mentions the class.
    const bare = deidentify(partLoci(P.STATE, "IL"), { context: ctx });
    expect(bare.document.loci[0]?.disposition).not.toBe("retained");
    // Key 2 again: a set naming only the other two classes.
    const others = deidentify(partLoci(P.STATE, "IL"), {
      policy: LIMITED_DATA_SET_PROFILE.policy,
      retainedLoci: [R.ENCOUNTER_DATES, R.ENCOUNTER_IDENTIFIERS],
      context: ctx,
    });
    expect(others.document.loci[0]?.disposition).not.toBe("retained");
  });

  it("isRetainablePart is an ALLOW-LIST on all three of class, category and part name", () => {
    const geo = R.LIMITED_DATA_SET_GEOGRAPHY;
    for (const name of [P.TOWN_OR_CITY, P.STATE, P.ZIP_CODE]) {
      expect(isRetainablePart(geo, C.GEOGRAPHIC, name)).toBe(true);
    }
    // Wrong class, wrong category, and an unknown part name: each on its own is a refusal.
    expect(isRetainablePart(R.ENCOUNTER_DATES, C.GEOGRAPHIC, P.STATE)).toBe(false);
    for (const category of [C.NAMES, C.MRN, C.SSN, C.DATES, C.OTHER_UNIQUE_ID]) {
      expect(isRetainablePart(geo, category, P.STATE)).toBe(false);
    }
    expect(isRetainablePart(geo, C.GEOGRAPHIC, "county" as RetainedLocusPart)).toBe(false);
  });

  it("a part name the allow-list does not carry is TRANSFORMED, never kept", () => {
    // The fail-closed direction for a marker an adapter invented: a county is not one of the three
    // names, so the engine refuses it exactly as if the marker were absent.
    const { document, manifest } = deidentify(
      partLoci("county" as RetainedLocusPart, "ZZCOUNTY"),
      profileOptions(LIMITED_DATA_SET_PROFILE, ctx),
    );
    expect(document.loci[0]?.value).not.toBe("ZZCOUNTY");
    expect(manifest[0]?.disposition).not.toBe("retained");
  });

  it("a marked part whose CATEGORY is one of the sixteen is refused: the class is not a bypass", () => {
    for (const category of [C.NAMES, C.MRN, C.SSN, C.ACCOUNT, C.HEALTH_PLAN_BENEFICIARY]) {
      const { document, manifest } = deidentify(
        {
          loci: [
            {
              path: "PID-5",
              kind: "identifier",
              category,
              retention: R.LIMITED_DATA_SET_GEOGRAPHY,
              retainedPart: P.TOWN_OR_CITY,
              value: "ZZDIRECTID",
            },
          ],
        },
        profileOptions(LIMITED_DATA_SET_PROFILE, ctx),
      );
      expect(document.loci[0]?.value, category).not.toBe("ZZDIRECTID");
      expect(manifest[0]?.disposition, category).not.toBe("retained");
    }
  });

  it("the WHOLE zip code is what may be kept, and a partial one is not a zip code", () => {
    for (const whole of ["62704", "62704-1234", "627041234"]) {
      expect(isRetainableZipCode(whole), whole).toBe(true);
    }
    for (const partial of ["627", "6270", "0062704", "62704 ", " 62704", "62704-12", "ZZZIP", ""]) {
      expect(isRetainableZipCode(partial), partial).toBe(false);
    }
  });
});

describe("a profile DECLARING the limited-data-set standard is checked against §164.514(e)(2)", () => {
  const R = RETAINED_LOCUS_CLASSES;
  const ctx = createDeidContext({ key: "e2-guard-key", patientId: "p1" });

  /** A class the registry does not carry: the only shape a class "beyond the permitted set" has. */
  const BEYOND = "vehicle-identifiers" as RetainedLocusClass;

  /** A hand-built profile declaring the standard: the interface is public, so this is reachable. */
  const declaring = (retainedLoci: readonly RetainedLocusClass[]): DeidProfile => ({
    name: "site-claims-lds",
    standard: "limited-data-set",
    policy: LIMITED_DATA_SET_PROFILE.policy,
    description: "a profile claiming the limited-data-set standard",
    requiresContext: true,
    retainedLoci,
  });

  it("the permitted set is exactly the three classes the regulation leaves out or names", () => {
    expect([...LIMITED_DATA_SET_RETENTION_CLASSES].sort()).toEqual([
      "encounter-dates",
      "encounter-identifiers",
      "limited-data-set-geography",
    ]);
    // And the shipped preset carries only classes from it, so the preset satisfies its own guard.
    for (const cls of LIMITED_DATA_SET_PROFILE.retainedLoci) {
      expect(LIMITED_DATA_SET_RETENTION_CLASSES.has(cls)).toBe(true);
    }
  });

  it("a class BEYOND the permitted set is refused where the profile becomes engine options", () => {
    try {
      profileOptions(declaring([R.ENCOUNTER_DATES, BEYOND]), ctx);
      expect.unreachable("a profile claiming the standard must not retain an excluded class");
    } catch (err) {
      expect((err as DeidError).code).toBe(FATAL_CODES.DEID_PROFILE_INVALID);
      // The diagnostic NAMES the offending class, so a consumer can act on it without guessing.
      expect((err as DeidError).message).toContain("vehicle-identifiers");
    }
  });

  it("and again where it is used as a DERIVATION BASE, before any locus is transformed", () => {
    try {
      defineDeidProfile({ name: "site-derived", base: declaring([BEYOND]) });
      expect.unreachable("a base claiming the standard must not retain an excluded class");
    } catch (err) {
      expect((err as DeidError).code).toBe(FATAL_CODES.DEID_PROFILE_INVALID);
      expect((err as DeidError).message).toContain("vehicle-identifiers");
    }
  });

  it("the same profile with only permitted classes is accepted at both points", () => {
    const ok = declaring([R.ENCOUNTER_DATES, R.LIMITED_DATA_SET_GEOGRAPHY]);
    expect(profileOptions(ok, ctx).retainedLoci).toHaveLength(2);
    expect(defineDeidProfile({ name: "site-derived-ok", base: ok }).retainedLoci).toHaveLength(2);
  });

  it("an absent or empty retention set is nothing to check, and is not an error", () => {
    expect(() => assertLimitedDataSetRetention("a profile", undefined)).not.toThrow();
    expect(() => assertLimitedDataSetRetention("a profile", [])).not.toThrow();
    expect(() => assertLimitedDataSetRetention("a profile", [BEYOND])).toThrow(DeidError);
  });

  it("a CUSTOM profile is not policed by (e)(2): the guard binds the claim, not the library", () => {
    // The contract is honesty about the standard a profile DECLARES. A profile that claims nothing is
    // out of the clause's reach, and refusing it would be the library inventing a rule.
    const custom: DeidProfile = { ...declaring([BEYOND]), standard: "custom" };
    expect(() => profileOptions(custom, ctx)).not.toThrow();
  });
});

describe("widen-never-narrow, and the reserved label, both hold for the geographic class", () => {
  const R = RETAINED_LOCUS_CLASSES;
  const ctx = createDeidContext({ key: "geo-contract-key", patientId: "p1" });

  it("a profile derived from the SAFE HARBOR base may not ADD the geographic class", () => {
    try {
      defineDeidProfile({
        name: "site-keeps-geography",
        retainedLoci: [R.LIMITED_DATA_SET_GEOGRAPHY],
      });
      expect.unreachable("adding a retention class to the Safe Harbor base must be rejected");
    } catch (err) {
      expect((err as DeidError).code).toBe(FATAL_CODES.DEID_PROFILE_INVALID);
      expect((err as DeidError).message).toContain("limited-data-set-geography");
    }
  });

  it("a profile derived from the LDS preset that DROPS the class is accepted", () => {
    const dropped = defineDeidProfile({
      name: "site-drops-geography",
      base: LIMITED_DATA_SET_PROFILE,
      retainedLoci: [R.ENCOUNTER_DATES, R.ENCOUNTER_IDENTIFIERS],
    });
    expect([...dropped.retainedLoci].sort()).toEqual(["encounter-dates", "encounter-identifiers"]);
    expect(retains(dropped.retainedLoci, R.LIMITED_DATA_SET_GEOGRAPHY)).toBe(false);
    // And re-adding it to THAT base is refused, so a drop cannot be walked back in one more step.
    expect(() =>
      defineDeidProfile({
        name: "site-re-adds-geography",
        base: dropped,
        retainedLoci: [...dropped.retainedLoci, R.LIMITED_DATA_SET_GEOGRAPHY],
      }),
    ).toThrow(DeidError);
  });

  it("the reserved safe-harbor label refuses the geographic class on BOTH its surfaces", () => {
    // Surface 1: a policy NAMED safe-harbor, whatever built the options bag.
    try {
      deidentify(
        {
          loci: [
            {
              path: "PID-11[0].3",
              kind: "identifier",
              category: C.GEOGRAPHIC,
              retention: R.LIMITED_DATA_SET_GEOGRAPHY,
              retainedPart: LIMITED_DATA_SET_ADDRESS_PARTS.TOWN_OR_CITY,
              value: "ZZTOWN",
            },
          ],
        },
        { policy: "safe-harbor", retainedLoci: [R.LIMITED_DATA_SET_GEOGRAPHY], context: ctx },
      );
      expect.unreachable("a safe-harbor-labelled policy must not retain geography");
    } catch (err) {
      expect((err as DeidError).code).toBe(FATAL_CODES.DEID_POLICY_INVALID);
    }

    // Surface 2: a profile DECLARING the standard while naming its policy something else. Nothing at
    // the engine can see this one, because the engine is handed the policy and never the claim.
    const claiming: DeidProfile = {
      name: "site-claims-safe-harbor",
      standard: "safe-harbor",
      policy: SAFE_HARBOR_POLICY,
      description: "a profile declaring the reserved standard",
      requiresContext: false,
      retainedLoci: [R.LIMITED_DATA_SET_GEOGRAPHY],
    };
    try {
      profileOptions(claiming, ctx);
      expect.unreachable("a profile declaring safe-harbor must not retain geography");
    } catch (err) {
      expect((err as DeidError).code).toBe(FATAL_CODES.DEID_POLICY_INVALID);
    }
    expect(() => defineDeidProfile({ name: "site-from-claiming", base: claiming })).toThrow(
      DeidError,
    );
    // The shipped Safe Harbor profile retains nothing, so the guard never fires on it.
    expect(() => profileOptions(SAFE_HARBOR_PROFILE, ctx)).not.toThrow();
  });
});

describe("the limited-data-set preset EXCLUDES all sixteen, and says whose the data use agreement is", () => {
  const R = RETAINED_LOCUS_CLASSES;
  const ctx = createDeidContext({ key: "sixteen-key", patientId: "p1" });

  it("every one of the sixteen is refused retention, even carrying an enabled class marker", () => {
    // §164.514(e)(2) (i) to (xvi), mapped onto this library's category model. Each locus asks to be
    // retained under an enabled class and each must still be acted on. (ii) is the partial one and is
    // asserted separately below, at the two halves the clause actually draws.
    for (const category of [...LIMITED_DATA_SET_DIRECT_IDENTIFIERS]) {
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
      expect(document.loci[0]?.value, category).not.toBe("ZZDIRECTID");
      expect(manifest[0]?.disposition, category).not.toBe("retained");
    }
    expect(LIMITED_DATA_SET_DIRECT_IDENTIFIERS.size).toBe(16);
  });

  it("(ii) is excluded EXACTLY to the extent the regulation states: the two halves, both ways", () => {
    // The kept half: each named part, marked, is retained. The excluded half: the same category
    // without a named part (a street, a county code, a whole address) is not.
    for (const name of [
      LIMITED_DATA_SET_ADDRESS_PARTS.TOWN_OR_CITY,
      LIMITED_DATA_SET_ADDRESS_PARTS.STATE,
      LIMITED_DATA_SET_ADDRESS_PARTS.ZIP_CODE,
    ]) {
      const { document } = deidentify(
        {
          loci: [
            {
              path: "PID-11[0].5",
              kind: "identifier",
              category: C.GEOGRAPHIC,
              retention: R.LIMITED_DATA_SET_GEOGRAPHY,
              retainedPart: name,
              value: "62704",
            },
          ],
        },
        profileOptions(LIMITED_DATA_SET_PROFILE, ctx),
      );
      expect(document.loci[0]?.disposition, name).toBe("retained");
    }
    const street = deidentify(
      {
        loci: [
          {
            path: "PID-11[0].1",
            kind: "identifier",
            category: C.GEOGRAPHIC,
            retention: R.LIMITED_DATA_SET_GEOGRAPHY,
            value: "742 Evergreen Ter",
          },
        ],
      },
      profileOptions(LIMITED_DATA_SET_PROFILE, ctx),
    );
    // Not passed through unchanged, and not retained: the class did not reach it. What it becomes is
    // the geographic generalization's business (it reads what leading digits it can find), and the
    // HL7 pass never hands it a street at all, which `test/hl7/retained-geography.test.ts` asserts on
    // the wire. Here the claim is only that the excluded half of (ii) stays excluded.
    expect(street.document.loci[0]?.value).not.toBe("742 Evergreen Ter");
    expect(street.document.loci[0]?.disposition).not.toBe("retained");
    expect(street.manifest[0]?.disposition).not.toBe("retained");
  });

  it("the preset's own machine-readable description states the data use agreement obligation", () => {
    // §164.514(e)(1) permits a limited data set only under a data use agreement. The library holds
    // none and checks none, and a preset carrying the regulation's name has to say so.
    const d = LIMITED_DATA_SET_PROFILE.description;
    expect(d).toContain("DATA USE AGREEMENT");
    expect(d).toContain("164.514(e)(1)");
    expect(d).toContain("CONSUMER'S responsibility");
    expect(d).toContain("neither holds nor checks one");
  });

  it("and it states what it keeps of an address, and that the ZIP is kept WHOLE", () => {
    const d = LIMITED_DATA_SET_PROFILE.description;
    expect(d).toContain("164.514(e)(2)(ii)");
    expect(d).toContain("WHOLE zip code");
    expect(d).toContain("street address");
    // The adapter limitation, stated where the preset itself is read (D2).
    expect(d).toContain("HL7 v2 pass ALONE");
  });
});
