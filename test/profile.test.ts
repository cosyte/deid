/**
 * Policy-profile tests (DEID-10): the two built-in presets, the widen-never-narrow contract, the
 * reserved-label guard, and `profileOptions` composition. All values are synthetic.
 */

import { describe, expect, it } from "vitest";

import {
  createDeidContext,
  defineDeidProfile,
  deidentify,
  FATAL_CODES,
  LIMITED_DATA_SET_PROFILE,
  profileOptions,
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

describe("defineDeidProfile — the widen-never-narrow contract", () => {
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
    // "limited-data-set" while deriving from the Safe Harbor base — a label mismatch, rejected.
    expect(() => defineDeidProfile({ name: "limited-data-set" })).toThrowError(
      expect.objectContaining({ code: FATAL_CODES.DEID_PROFILE_INVALID }),
    );
    // "safe-harbor" while deriving from the LDS base — also a mismatch, rejected.
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
