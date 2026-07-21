/**
 * Property-based conformance tests for the DEID-7 **longitudinal** layer — the corpus registry.
 *
 * The load-bearing longitudinal invariants, asserted over arbitrary corpora:
 * - **Cross-document consistency:** the same patient shifts by the same offset (same input date → same
 *   output) and the same identifier maps to the same pseudonym, across independent de-id passes and
 *   across independent registries built from the same key.
 * - **Interval preservation:** the number of days between two of a patient's dates is unchanged.
 * - **Collision-resistance:** distinct identifiers never share a pseudonym.
 * - **Secret absence:** the key never appears in the output, and the value-free manifest never carries
 *   the original absolute date. (The per-patient offset is a return-only integer — never stored on the
 *   context, never exported, never written to a manifest — so there is no channel through which to
 *   assert it "absent"; its non-emission is a structural property of the context module, covered there.)
 */

import { describe, expect, it } from "vitest";
import fc from "fast-check";

import {
  SAFE_HARBOR_CATEGORIES,
  createDeidRegistry,
  deidentify,
  defineDeidPolicy,
  type GenericLocus,
} from "../../src/index.js";

const C = SAFE_HARBOR_CATEGORIES;
const RESEARCH = defineDeidPolicy({ name: "research", transforms: { [C.DATES]: "date-shift" } });

/** Arbitrary valid `YYYY-MM-DD` in a wide but bounded range. */
function isoDateArb(): fc.Arbitrary<string> {
  return fc
    .date({ min: new Date("1970-01-01T00:00:00Z"), max: new Date("2035-12-31T00:00:00Z") })
    .map((d) => d.toISOString().slice(0, 10));
}

/** Shift a single date for a patient key under an independent registry built from `key`. */
function shiftOne(key: string, patient: string, date: string): string | null | undefined {
  const registry = createDeidRegistry({ key });
  const loci: GenericLocus[] = [{ path: "D", kind: "date", category: C.DATES, value: date }];
  return deidentify({ loci }, { policy: RESEARCH, context: registry.forPatient(patient) }).document
    .loci[0]?.value;
}

/** Whole-day difference between two `YYYY-MM-DD` values. */
function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
}

describe("longitudinal consistency (property)", () => {
  it("same (key, patient, date) → same shifted output across independent passes", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }),
        fc.string({ minLength: 1 }),
        isoDateArb(),
        (key, patient, date) => {
          const a = shiftOne(key, patient, date);
          const b = shiftOne(key, patient, date);
          expect(a).toBe(b);
          expect(typeof a).toBe("string");
        },
      ),
    );
  });

  it("preserves the interval between two dates of the same patient exactly", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }),
        fc.string({ minLength: 1 }),
        isoDateArb(),
        isoDateArb(),
        (key, patient, d1, d2) => {
          const registry = createDeidRegistry({ key });
          const ctx = registry.forPatient(patient);
          const loci: GenericLocus[] = [
            { path: "A", kind: "date", category: C.DATES, value: d1 },
            { path: "B", kind: "date", category: C.DATES, value: d2 },
          ];
          const out = deidentify({ loci }, { policy: RESEARCH, context: ctx }).document.loci;
          const s1 = out[0]?.value;
          const s2 = out[1]?.value;
          expect(typeof s1).toBe("string");
          expect(typeof s2).toBe("string");
          expect(daysBetween(s1 as string, s2 as string)).toBe(daysBetween(d1, d2));
        },
      ),
    );
  });

  it("distinct identifiers never share a pseudonym; the same identifier always does", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }),
        fc.string({ minLength: 1 }),
        fc.string({ minLength: 1 }),
        (key, id1, id2) => {
          const registry = createDeidRegistry({ key });
          expect(registry.pseudonym(id1)).toBe(registry.pseudonym(id1));
          if (id1 !== id2) {
            expect(registry.pseudonym(id1)).not.toBe(registry.pseudonym(id2));
          }
        },
      ),
    );
  });

  it("secret absence: the key never appears in the output or the value-free manifest", () => {
    fc.assert(
      fc.property(
        // A key with enough length that an accidental substring match would be meaningful.
        fc.string({ minLength: 8 }),
        fc.string({ minLength: 1 }),
        isoDateArb(),
        (key, patient, date) => {
          const registry = createDeidRegistry({ key });
          const loci: GenericLocus[] = [
            { path: "D", kind: "date", category: C.DATES, value: date },
          ];
          const result = deidentify(
            { loci },
            { policy: RESEARCH, context: registry.forPatient(patient) },
          );
          const serialized = JSON.stringify(result);
          expect(serialized.includes(key)).toBe(false);
          // The manifest is value-free: the original absolute date must not appear in it.
          expect(JSON.stringify(result.manifest).includes(date)).toBe(false);
        },
      ),
    );
  });
});
