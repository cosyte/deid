/**
 * The engine holds every value it writes to the length a locus declares (`GenericLocus.maxLength`):
 * a keyed surrogate is cut to the position's length when that keeps at least 80 bits (20 hex
 * characters) and blocked when it does not; a stand-in that does not fit in its shape is written as
 * its bare sequence number; any other written value that does not fit is blocked. Every value here is
 * synthetic.
 */

import { describe, expect, it } from "vitest";

import {
  DEID_DISPOSITION_CODES,
  SAFE_HARBOR_CATEGORIES,
  createDeidContext,
  defineDeidPolicy,
  deidentify,
  keyedHash,
  pseudonymize,
  type GenericLocus,
} from "../src/index.js";

const C = SAFE_HARBOR_CATEGORIES;
const D = DEID_DISPOSITION_CODES;
const context = createDeidContext({ key: "field-length-test-key-synthetic", patientId: "p-fl" });
const pseudo = defineDeidPolicy({ name: "keyed", transforms: { [C.MRN]: "pseudonymize" } });
const hashed = defineDeidPolicy({ name: "keyed-hash", transforms: { [C.MRN]: "hash" } });

/** One MRN locus with the given bound. */
function mrn(value: string, maxLength?: number, extra: Partial<GenericLocus> = {}): GenericLocus {
  return {
    path: "ZZ-1",
    kind: "identifier",
    category: C.MRN,
    value,
    ...(maxLength === undefined ? {} : { maxLength }),
    ...extra,
  };
}

/** Run one locus and return its written value and its manifest code. */
function run(
  locus: GenericLocus,
  policy = pseudo,
): { value: string | null; code: string | undefined } {
  const { document, manifest } = deidentify({ loci: [locus] }, { policy, context });
  return { value: document.loci[0]?.value ?? null, code: manifest[0]?.code };
}

describe("a keyed surrogate fits the length its position declares", () => {
  const full = pseudonymize("ZZMRNFIELD01", context);

  it("is written whole when the position holds 64 characters or more, and when none is declared", () => {
    expect(run(mrn("ZZMRNFIELD01")).value).toBe(full);
    expect(run(mrn("ZZMRNFIELD01", 64)).value).toBe(full);
    expect(run(mrn("ZZMRNFIELD01", 80)).value).toBe(full);
  });

  it.each([63, 60, 50, 38, 35, 30, 25, 20])(
    "is cut to its first %i characters, the same for the same value, a prefix of the whole",
    (max) => {
      const one = run(mrn("ZZMRNFIELD01", max));
      expect(one.value).toBe(full.slice(0, max));
      expect(one.value).toHaveLength(max);
      expect(one.code).toBe(D.DEID_CATEGORY_PSEUDONYMIZED);
      // Linking inside one key: the same value gives the same cut surrogate, another value another.
      expect(run(mrn("ZZMRNFIELD01", max)).value).toBe(one.value);
      expect(run(mrn("ZZMRNFIELD02", max)).value).not.toBe(one.value);
    },
  );

  it.each([19, 15, 10, 8, 1, 0])(
    "is blocked when the position holds %i characters, fewer than 80 bits",
    (max) => {
      const { value, code } = run(mrn("ZZMRNFIELD01", max));
      expect(value).toBeNull();
      expect(code).toBe(D.DEID_LOCUS_BLOCKED);
    },
  );

  it("cuts a keyed hash the same way", () => {
    const digest = keyedHash("ZZMRNFIELD01", context);
    expect(run(mrn("ZZMRNFIELD01", 30), hashed).value).toBe(digest.slice(0, 30));
    expect(run(mrn("ZZMRNFIELD01", 12), hashed).value).toBeNull();
  });

  it.each([Number.NaN, -1, 2.5, Number.POSITIVE_INFINITY])(
    "reads a bound of %s as 0 and blocks the value",
    (max) => {
      expect(run(mrn("ZZMRNFIELD01", max)).value).toBeNull();
    },
  );
});

describe("a referenced identifier fits the length its position declares", () => {
  const uuid = "0f0e0d0c-0b0a-4908-8706-050403020100";

  it("keeps its shape when the shaped surrogate fits, and is the cut digest when it does not", () => {
    const shaped = run(mrn(uuid, 36, { referencedId: true })).value;
    expect(shaped).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(run(mrn(uuid, 30, { referencedId: true })).value).toBe(
      pseudonymize(uuid, context).slice(0, 30),
    );
    expect(run(mrn(uuid, 19, { referencedId: true })).value).toBeNull();
  });

  it("writes a stand-in as its bare sequence number when its shape does not fit", () => {
    const loci = [
      mrn(uuid, 36, { referencedId: true }),
      mrn(uuid, 10, { referencedId: true }),
      mrn("ZZOTHER", 10, { referencedId: true }),
    ];
    const { document } = deidentify({ loci }, {});
    expect(document.loci.map((l) => l.value)).toEqual([
      "00000000-0000-4000-8000-000000000001",
      "1",
      "2",
    ]);
  });

  it("blocks a stand-in that does not fit even as a number", () => {
    const { document } = deidentify({ loci: [mrn("ZZTRACE", 0, { referencedId: true })] }, {});
    expect(document.loci[0]?.value).toBeNull();
  });
});

describe("any other written value that does not fit is blocked; a kept value is not checked", () => {
  it("blocks a generalized ZIP longer than the position", () => {
    const zip: GenericLocus = {
      path: "ZZ-2",
      kind: "zip",
      category: C.GEOGRAPHIC,
      value: "02139",
      maxLength: 2,
    };
    const { document, manifest } = deidentify({ loci: [zip] }, {});
    expect(document.loci[0]?.value).toBeNull();
    expect(manifest[0]?.code).toBe(D.DEID_LOCUS_BLOCKED);
    expect(deidentify({ loci: [{ ...zip, maxLength: 3 }] }, {}).document.loci[0]?.value).toBe(
      "021",
    );
  });

  it("blocks a redactor's prose longer than the position, under the catch-all with no category", () => {
    const prose: GenericLocus = { path: "ZZ-4", kind: "freetext", value: "ZZ NOTE", maxLength: 4 };
    const { document, manifest } = deidentify(
      { loci: [prose] },
      { redactor: () => ({ text: "[REDACTED NOTE]" }) },
    );
    expect(document.loci[0]?.value).toBeNull();
    expect(manifest[0]).toMatchObject({
      category: C.OTHER_UNIQUE_ID,
      code: D.DEID_LOCUS_BLOCKED,
    });
  });

  it("does not check a clinical value kept as it arrived", () => {
    const kept: GenericLocus = { path: "ZZ-3", kind: "clinical", value: "140", maxLength: 1 };
    expect(deidentify({ loci: [kept] }, {}).document.loci[0]?.value).toBe("140");
  });
});
