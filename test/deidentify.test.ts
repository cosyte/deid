/**
 * Engine tests for `deidentify` — the Safe Harbor policy application, the fail-closed rule, the
 * over-scrub (clinical-retained) guard, the value-free manifest, and the mandatory
 * **offset/key-never-leak** gate.
 *
 * All values are synthetic tagged sentinels.
 */

import { describe, expect, it } from "vitest";

import {
  DEID_DISPOSITION_CODES,
  FATAL_CODES,
  SAFE_HARBOR_CATEGORIES,
  createDeidContext,
  defineDeidPolicy,
  deidentify,
  type GenericLocus,
} from "../src/index.js";

const C = SAFE_HARBOR_CATEGORIES;
const D = DEID_DISPOSITION_CODES;

function loc(partial: GenericLocus): GenericLocus {
  return partial;
}

describe("deidentify — Safe Harbor per-category defaults", () => {
  const ctx = createDeidContext({ key: "engine-key", patientId: "p1" });

  it("redacts direct identifiers (names, phone, fax, email, ssn, url, ip, device, …)", () => {
    const model = {
      loci: [
        loc({ path: "PID-5", kind: "identifier", category: C.NAMES, value: "SENTINEL_NAME" }),
        loc({ path: "PID-13", kind: "identifier", category: C.PHONE, value: "SENTINEL_PHONE" }),
        loc({ path: "PID-19", kind: "identifier", category: C.SSN, value: "SENTINEL_SSN" }),
      ],
    };
    const { document, manifest } = deidentify(model, { context: ctx });
    expect(document.loci.every((l) => l.value === null && l.disposition === "removed")).toBe(true);
    expect(manifest.every((e) => e.code === D.DEID_CATEGORY_REMOVED)).toBe(true);
  });

  it("pseudonymizes MRN / beneficiary / account with a consistent surrogate", () => {
    const model = {
      loci: [loc({ path: "PID-3", kind: "identifier", category: C.MRN, value: "SENTINEL_MRN" })],
    };
    const out = deidentify(model, { context: ctx });
    expect(out.document.loci[0]?.value).toMatch(/^[0-9a-f]{64}$/);
    expect(out.manifest[0]?.code).toBe(D.DEID_CATEGORY_PSEUDONYMIZED);
  });

  it("generalizes geography (ZIP→3-digit residual) and dates (→year residual)", () => {
    const model = {
      loci: [
        loc({ path: "PID-11/zip", kind: "zip", category: C.GEOGRAPHIC, value: "90210" }),
        loc({ path: "PID-7", kind: "date", category: C.DATES, value: "1985-07-02" }),
      ],
    };
    const out = deidentify(model, { context: ctx });
    expect(out.document.loci[0]?.value).toBe("902");
    expect(out.document.loci[1]?.value).toBe("1985");
    expect(out.manifest.every((e) => e.code === D.DEID_RESIDUAL_RETAINED)).toBe(true);
  });

  it("fully suppresses a restricted ZIP and an age>89 (GENERALIZED, no residual)", () => {
    const model = {
      loci: [
        loc({ path: "addr/zip", kind: "zip", category: C.GEOGRAPHIC, value: "03601" }),
        loc({ path: "PID-age", kind: "age", category: C.DATES, value: "94" }),
      ],
    };
    const out = deidentify(model, { context: ctx });
    expect(out.document.loci[0]?.value).toBe("000");
    expect(out.document.loci[1]?.value).toBe("90+");
    expect(out.manifest.every((e) => e.code === D.DEID_CATEGORY_GENERALIZED)).toBe(true);
  });
});

describe("deidentify — fail closed", () => {
  const ctx = createDeidContext({ key: "engine-key", patientId: "p1" });

  it("blocks an unclassified PHI-bearing locus as category (R)", () => {
    const out = deidentify(
      { loci: [loc({ path: "Z-seg", kind: "identifier", value: "SENTINEL_X" })] },
      { context: ctx },
    );
    expect(out.document.loci[0]).toMatchObject({ value: null, disposition: "blocked" });
    expect(out.manifest[0]).toMatchObject({
      category: C.OTHER_UNIQUE_ID,
      code: D.DEID_LOCUS_BLOCKED,
    });
  });

  it("blocks an unknown-kind locus even when a category is supplied", () => {
    const out = deidentify(
      { loci: [loc({ path: "?", kind: "unknown", category: C.NAMES, value: "SENTINEL_X" })] },
      { context: ctx },
    );
    expect(out.document.loci[0]?.disposition).toBe("blocked");
    expect(out.manifest[0]?.code).toBe(D.DEID_LOCUS_BLOCKED);
  });

  it("blocks free text by default (no naive scrub)", () => {
    const out = deidentify(
      {
        loci: [
          loc({
            path: "OBX-5",
            kind: "freetext",
            category: C.OTHER_UNIQUE_ID,
            value: "notes with SENTINEL_NAME",
          }),
        ],
      },
      { context: ctx },
    );
    expect(out.document.loci[0]?.value).toBeNull();
    expect(out.manifest[0]?.code).toBe(D.DEID_FREETEXT_BLOCKED);
  });

  it("blocks a category (R) value under the Safe Harbor policy", () => {
    const out = deidentify(
      {
        loci: [
          loc({
            path: "REF-x",
            kind: "identifier",
            category: C.OTHER_UNIQUE_ID,
            value: "SENTINEL_X",
          }),
        ],
      },
      { context: ctx },
    );
    expect(out.manifest[0]?.code).toBe(D.DEID_LOCUS_BLOCKED);
  });

  it("blocks a date/zip whose value cannot be generalized (fail closed, not pass-through)", () => {
    const out = deidentify(
      { loci: [loc({ path: "PID-7", kind: "date", category: C.DATES, value: "garbage" })] },
      { context: ctx },
    );
    expect(out.document.loci[0]?.value).toBeNull();
    expect(out.manifest[0]?.code).toBe(D.DEID_LOCUS_BLOCKED);
  });

  it("blocks when a policy assigns generalize to a kind/category that has no generalization", () => {
    const weird = defineDeidPolicy({ name: "weird", transforms: { [C.NAMES]: "generalize" } });
    const out = deidentify(
      { loci: [loc({ path: "PID-5", kind: "identifier", category: C.NAMES, value: "SENTINEL" })] },
      { policy: weird, context: ctx },
    );
    expect(out.document.loci[0]?.value).toBeNull();
    expect(out.manifest[0]?.code).toBe(D.DEID_LOCUS_BLOCKED);
  });

  it("blocks when date-shift cannot parse the date (fail closed)", () => {
    const shift = defineDeidPolicy({ name: "shift", transforms: { [C.DATES]: "date-shift" } });
    const out = deidentify(
      { loci: [loc({ path: "PID-7", kind: "date", category: C.DATES, value: "not-a-date" })] },
      { policy: shift, context: ctx },
    );
    expect(out.document.loci[0]?.value).toBeNull();
    expect(out.manifest[0]?.code).toBe(D.DEID_LOCUS_BLOCKED);
  });
});

describe("deidentify — the keyed-hash transform", () => {
  it("replaces a value with a consistent keyed digest under a hash policy", () => {
    const ctx = createDeidContext({ key: "k" });
    const hashPolicy = defineDeidPolicy({ name: "hashy", transforms: { [C.ACCOUNT]: "hash" } });
    const out = deidentify(
      { loci: [loc({ path: "acct", kind: "identifier", category: C.ACCOUNT, value: "ACCT-1" })] },
      { policy: hashPolicy, context: ctx },
    );
    expect(out.document.loci[0]?.value).toMatch(/^[0-9a-f]{64}$/);
    expect(out.manifest[0]?.code).toBe(D.DEID_CATEGORY_HASHED);
  });
});

describe("deidentify — over-scrub guard (clinical survives)", () => {
  it("retains a clinical value byte-identical, with no manifest action", () => {
    const clinicalValue = "5.4 mmol/L";
    const out = deidentify(
      {
        loci: [
          loc({ path: "OBX-5", kind: "clinical", value: clinicalValue }),
          loc({ path: "OBX-3", kind: "clinical", category: C.OTHER_UNIQUE_ID, value: "2951-2" }), // LOINC-like code
        ],
      },
      {},
    );
    expect(out.document.loci[0]).toMatchObject({ value: clinicalValue, disposition: "retained" });
    expect(out.document.loci[1]?.value).toBe("2951-2");
    expect(out.manifest).toHaveLength(0); // clinical values are not "acted on"
  });
});

describe("deidentify — fatal conditions", () => {
  it("throws EMPTY_INPUT for a null model or a model without loci", () => {
    expect(() => deidentify(null as never, {})).toThrowError(
      expect.objectContaining({ code: FATAL_CODES.EMPTY_INPUT }),
    );
    expect(() => deidentify({}, {})).toThrowError(
      expect.objectContaining({ code: FATAL_CODES.EMPTY_INPUT }),
    );
  });

  it("throws DEID_NO_KEY when a keyed transform is needed but no context is supplied", () => {
    expect(() =>
      deidentify(
        { loci: [loc({ path: "PID-3", kind: "identifier", category: C.MRN, value: "M" })] },
        {},
      ),
    ).toThrowError(expect.objectContaining({ code: FATAL_CODES.DEID_NO_KEY }));
  });

  it("throws DEID_NO_KEY when date-shift is requested without a per-patient scope", () => {
    const noPatient = createDeidContext({ key: "k" }); // no patientId
    const shiftPolicy = defineDeidPolicy({
      name: "shift",
      transforms: { [C.DATES]: "date-shift" },
    });
    expect(() =>
      deidentify(
        { loci: [loc({ path: "PID-7", kind: "date", category: C.DATES, value: "2020-01-01" })] },
        { policy: shiftPolicy, context: noPatient },
      ),
    ).toThrowError(expect.objectContaining({ code: FATAL_CODES.DEID_NO_KEY }));
  });
});

describe("deidentify — manifest shape + aggregation + empty model", () => {
  it("aggregates repeated identical loci into a single entry with a count", () => {
    const ctx = createDeidContext({ key: "k" });
    const out = deidentify(
      {
        loci: [
          loc({ path: "NK1-2", kind: "identifier", category: C.NAMES, value: "A" }),
          loc({ path: "NK1-2", kind: "identifier", category: C.NAMES, value: "B" }),
        ],
      },
      { context: ctx },
    );
    expect(out.manifest).toHaveLength(1);
    expect(out.manifest[0]).toMatchObject({ locus: "NK1-2", count: 2, disposition: "removed" });
  });

  it("returns an empty result for an empty (but valid) model", () => {
    const out = deidentify({ loci: [] }, {});
    expect(out.document.loci).toHaveLength(0);
    expect(out.manifest).toHaveLength(0);
  });

  it("never mutates the input model", () => {
    const input = {
      loci: [loc({ path: "PID-5", kind: "identifier", category: C.NAMES, value: "SENTINEL" })],
    };
    const before = JSON.stringify(input);
    deidentify(input, {});
    expect(JSON.stringify(input)).toBe(before);
  });
});

describe("deidentify — the mandatory offset/key-never-leak gate", () => {
  it("never emits the key, the seed, or the raw shift material in the output or manifest", () => {
    const key = "SUPERSECRET-HMAC-KEY-9f3a";
    const seed = "SUPERSECRET-SHIFT-SEED-b71c";
    const ctx = createDeidContext({ key, dateShiftSeed: seed, patientId: "patient-1" });
    const policy = defineDeidPolicy({
      name: "longitudinal",
      transforms: { [C.DATES]: "date-shift", [C.MRN]: "pseudonymize" },
    });
    const out = deidentify(
      {
        loci: [
          loc({ path: "PID-7", kind: "date", category: C.DATES, value: "2020-01-01" }),
          loc({ path: "PID-7b", kind: "date", category: C.DATES, value: "2020-01-31" }),
          loc({ path: "PID-3", kind: "identifier", category: C.MRN, value: "MRN-0001" }),
        ],
      },
      { policy, context: ctx },
    );

    const serialized = JSON.stringify(out);
    expect(serialized.includes(key)).toBe(false);
    expect(serialized.includes(seed)).toBe(false);

    // The derived offset must not be recoverable from the output: the manifest carries no numeric
    // offset field, and re-deriving the shift requires the seed. Interval is preserved though.
    const a = out.document.loci[0]?.value as string;
    const b = out.document.loci[1]?.value as string;
    expect((Date.parse(b) - Date.parse(a)) / 86_400_000).toBe(30);

    // No manifest entry exposes a value; every entry's fields are category/transform/locus/count/…
    for (const e of out.manifest) {
      expect(Object.keys(e).sort()).toEqual([
        "category",
        "code",
        "count",
        "disposition",
        "locus",
        "transform",
      ]);
    }
  });
});
