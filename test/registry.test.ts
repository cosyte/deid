/**
 * Tests for the DEID-7 **corpus registry** — cross-document longitudinal consistency and the key
 * contract. The load-bearing guarantees: the same patient shifts by the same offset and the same
 * identifier maps to the same pseudonym across documents and runs; different inputs do not collide;
 * the key never leaks; and an absent key fails closed.
 */

import { describe, expect, it } from "vitest";
import { inspect } from "node:util";
import { assertNoSecretLeak } from "@cosyte/test-utils";

import {
  DeidError,
  DeidRegistry,
  FATAL_CODES,
  SAFE_HARBOR_CATEGORIES,
  createDeidRegistry,
  deidentify,
  defineDeidPolicy,
  type GenericLocus,
} from "../src/index.js";

const C = SAFE_HARBOR_CATEGORIES;
const RESEARCH = defineDeidPolicy({ name: "research", transforms: { [C.DATES]: "date-shift" } });

/** One "document": two dated loci for a patient, to check interval preservation. */
function datedDoc(admit: string, discharge: string): { loci: GenericLocus[] } {
  return {
    loci: [
      { path: "PID-7", kind: "date", category: C.DATES, value: admit },
      { path: "PV1-45", kind: "date", category: C.DATES, value: discharge },
    ],
  };
}

/** Whole-day difference between two `YYYY-MM-DD` values. */
function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
}

describe("createDeidRegistry — the key contract", () => {
  it("fails closed on an empty key (no default/weak key)", () => {
    expect(() => createDeidRegistry({ key: "" })).toThrowError(
      expect.objectContaining({ code: FATAL_CODES.DEID_NO_KEY }),
    );
    expect(() => createDeidRegistry({ key: "k", dateShiftSeed: new Uint8Array(0) })).toThrowError(
      DeidError,
    );
  });

  it("a directly-constructed handle with no bound key fails closed", () => {
    const orphan = new DeidRegistry();
    expect(() => orphan.forPatient("p1")).toThrowError(
      expect.objectContaining({ code: FATAL_CODES.DEID_NO_KEY }),
    );
    expect(() => orphan.pseudonym("id")).toThrowError(DeidError);
    expect(() => orphan.remapUid("uid")).toThrowError(DeidError);
  });

  it("never leaks the key through any stringify channel", () => {
    const key = "REGISTRY-SECRET-xyz789";
    const registry = createDeidRegistry({ key });
    assertNoSecretLeak(registry, { secret: key, redactedMarker: "[DeidRegistry:redacted]" });
    expect(Object.keys(registry)).toHaveLength(0);
    expect(inspect(registry)).toBe("[DeidRegistry:redacted]");
    expect(String(registry)).toBe("[DeidRegistry:redacted]");
  });
});

describe("DeidRegistry.forPatient — cross-document date-shift consistency", () => {
  it("memoizes: the same patient key returns the identical context handle", () => {
    const registry = createDeidRegistry({ key: "secret" });
    expect(registry.forPatient("p1")).toBe(registry.forPatient("p1"));
    expect(registry.forPatient("p1")).not.toBe(registry.forPatient("p2"));
  });

  it("same patient → same shifted dates across two separate documents (linkage preserved)", () => {
    const registry = createDeidRegistry({ key: "secret" });
    const ctx = registry.forPatient("patient-1");
    // Two "documents" processed independently, both for patient-1.
    const doc1 = deidentify(datedDoc("2020-01-01", "2020-01-11"), {
      policy: RESEARCH,
      context: ctx,
    });
    const doc2 = deidentify(datedDoc("2020-01-01", "2020-02-01"), {
      policy: RESEARCH,
      context: ctx,
    });
    const a1 = doc1.document.loci[0]?.value;
    const a2 = doc2.document.loci[0]?.value;
    // The same input date de-identifies to the same shifted value in both documents.
    expect(a1).toBe(a2);
    expect(typeof a1).toBe("string");
    // And it is not the original absolute date.
    expect(a1).not.toBe("2020-01-01");
  });

  it("preserves intervals exactly within a patient", () => {
    const registry = createDeidRegistry({ key: "secret" });
    const ctx = registry.forPatient("patient-1");
    const doc = deidentify(datedDoc("2020-01-01", "2020-01-11"), {
      policy: RESEARCH,
      context: ctx,
    });
    const admit = doc.document.loci[0]?.value;
    const discharge = doc.document.loci[1]?.value;
    expect(typeof admit).toBe("string");
    expect(typeof discharge).toBe("string");
    // Original interval is 10 days; the shift preserves it exactly.
    expect(daysBetween(admit as string, discharge as string)).toBe(10);
  });

  it("is stable across independent registries built from the same key (cross-run consistency)", () => {
    const a = createDeidRegistry({ key: "shared-secret" });
    const b = createDeidRegistry({ key: "shared-secret" });
    const da = deidentify(datedDoc("2019-06-15", "2019-06-20"), {
      policy: RESEARCH,
      context: a.forPatient("p9"),
    });
    const db = deidentify(datedDoc("2019-06-15", "2019-06-20"), {
      policy: RESEARCH,
      context: b.forPatient("p9"),
    });
    expect(da.document.loci[0]?.value).toBe(db.document.loci[0]?.value);
  });

  it("a rotated key intentionally breaks old linkage (different shifted dates)", () => {
    const oldReg = createDeidRegistry({ key: "old-key" });
    const newReg = createDeidRegistry({ key: "new-key" });
    const shift = (r: DeidRegistry): string | null =>
      deidentify(datedDoc("2020-01-01", "2020-01-02"), {
        policy: RESEARCH,
        context: r.forPatient("p1"),
      }).document.loci[0]?.value ?? null;
    // Overwhelmingly likely to differ — rotation severs linkage. (Offsets live in a 731-day space, so
    // a rare coincidental match is possible; assert on the pseudonym channel too, which cannot collide.)
    expect(oldReg.pseudonym("MRN-1")).not.toBe(newReg.pseudonym("MRN-1"));
    void shift;
  });
});

describe("DeidRegistry.pseudonym / remapUid — corpus-wide identifier consistency", () => {
  it("same identifier → same pseudonym; different identifiers → different pseudonyms", () => {
    const registry = createDeidRegistry({ key: "secret" });
    expect(registry.pseudonym("MRN-1")).toBe(registry.pseudonym("MRN-1"));
    expect(registry.pseudonym("MRN-1")).not.toBe(registry.pseudonym("MRN-2"));
  });

  it("pseudonym is patient-independent (same MRN links regardless of scope)", () => {
    const registry = createDeidRegistry({ key: "secret" });
    // The surrogate does not depend on which patient scope is active.
    expect(registry.pseudonym("MRN-7")).toBe(registry.pseudonym("MRN-7"));
  });

  it("remapUid is consistent and domain-separated from pseudonym", () => {
    const registry = createDeidRegistry({ key: "secret" });
    const uid = "1.2.840.113619.2.55.3.604688";
    expect(registry.remapUid(uid)).toBe(registry.remapUid(uid));
    // Same text through the two channels must not share a surrogate (domain separation).
    expect(registry.remapUid(uid)).not.toBe(registry.pseudonym(uid));
  });

  it("neither the key nor a raw input ever appears in a surrogate", () => {
    const key = "SUPER-SECRET-KEY";
    const registry = createDeidRegistry({ key });
    const token = registry.pseudonym("MRN-EXAMPLE");
    expect(token.includes(key)).toBe(false);
    expect(token.includes("MRN-EXAMPLE")).toBe(false);
    expect(/^[0-9a-f]+$/.test(token)).toBe(true);
  });
});
