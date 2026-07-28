/**
 * Property-based conformance tests for the `@cosyte/deid` **format-agnostic core**.
 *
 * A de-identifier is not a parser, so the archetype invariants are *inverted*: instead of a
 * round-trip, the load-bearing properties are **fail-safe robustness** (arbitrary input never throws
 * outside the fatal set, and every locus resolves to a value-free manifest action or a block) and
 * **immutability** (the input model is never mutated; the output is frozen). The
 * `@cosyte/test-utils` `immutabilityProperty` runner owns the immutability invariant; this file owns
 * the de-id-specific arbitraries and the value-free/never-throw property.
 */

import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { immutabilityProperty } from "@cosyte/test-utils";

import {
  DeidError,
  DEID_DISPOSITION_CODES,
  FATAL_CODES,
  SAFE_HARBOR_CATEGORIES,
  createDeidContext,
  deidentify,
  type GenericLocus,
  type LocusKind,
  type SafeHarborCategory,
} from "../../src/index.js";

const FATAL = new Set<string>(Object.values(FATAL_CODES));
const KNOWN_CODES = new Set<string>(Object.values(DEID_DISPOSITION_CODES));
const KINDS: readonly LocusKind[] = [
  "identifier",
  "date",
  "age",
  "zip",
  "freetext",
  "clinical",
  "unknown",
];
const CATEGORIES = Object.values(SAFE_HARBOR_CATEGORIES) as readonly SafeHarborCategory[];

/** Arbitrary hostile/quirky locus: any kind, any-or-no category, arbitrary value string. */
function locusArb(): fc.Arbitrary<GenericLocus> {
  return fc
    .tuple(
      fc.string({ minLength: 1 }),
      fc.constantFrom(...KINDS),
      fc.option(fc.constantFrom(...CATEGORIES), { nil: undefined }),
      fc.string(),
    )
    .map(([path, kind, category, value]) =>
      category === undefined ? { path, kind, value } : { path, kind, category, value },
    );
}

describe("deid core conformance (fail-safe invariants)", () => {
  it("fail-safe: arbitrary loci never throw a non-fatal, and every manifest entry is value-free", () => {
    const ctx = createDeidContext({ key: "property-key", patientId: "p1" });
    fc.assert(
      fc.property(fc.array(locusArb(), { maxLength: 40 }), (loci) => {
        let result;
        try {
          result = deidentify({ loci }, { context: ctx });
        } catch (err) {
          // Only sanctioned fatal codes may escape as throws.
          if (err instanceof DeidError && FATAL.has(err.code)) return;
          throw err;
        }
        for (const entry of result.manifest) {
          // Every entry carries a registered disposition code and a locus that is a path, not a value.
          expect(KNOWN_CODES.has(entry.code)).toBe(true);
          expect(entry.count).toBeGreaterThan(0);
          // Value-free: no input value may appear anywhere in the serialized manifest entry.
          //
          // A manifest entry carries a PATH, and paths and values are both arbitrary strings here, so
          // a value can occur inside some other locus's path by coincidence. That is not a leak, and
          // treating it as one makes this property fail at random: the counterexample that first
          // exposed it was `{path: "to__ ", value: ""}` beside `{path: " ", value: "to__"}`, where
          // "to__" is a substring of the FIRST locus's path. Excluding only `entry.locus === value`
          // caught exact equality and missed that. A PHI-leak property that reds at random is worse
          // than a narrower one, because random reds are what teach a reader to ignore it.
          const serialized = JSON.stringify(entry);
          const pathHaystack = loci.map((l) => l.path).join("\u0000");
          for (const locus of loci) {
            if (locus.value.length >= 4 && !pathHaystack.includes(locus.value)) {
              expect(serialized.includes(locus.value)).toBe(false);
            }
          }
        }
      }),
    );
  });

  it("immutability: the frozen output document rejects mutation, leaving prior reads intact", () => {
    immutabilityProperty({
      arbitrary: fc.constant("ignored"),
      parse: () =>
        deidentify(
          {
            loci: [
              {
                path: "PID-19",
                kind: "identifier",
                category: SAFE_HARBOR_CATEGORIES.SSN,
                value: "SENTINEL_VALUE_01",
              },
            ],
          },
          {},
        ),
      // A frozen loci array must reject a push (throws) — a valid immutable response.
      mutate: (r) => (r.document.loci as unknown[]).push({ path: "x" }),
      getSnapshot: (r) =>
        r.document.loci.map((l) => `${l.path}:${String(l.value)}:${l.disposition}`),
    });
  });

  it("fail-safe: a keyed policy with no context is a DEID_NO_KEY fatal, never an unkeyed fallback", () => {
    expect(() =>
      deidentify(
        {
          loci: [
            {
              path: "PID-3",
              kind: "identifier",
              category: SAFE_HARBOR_CATEGORIES.MRN,
              value: "MRN1",
            },
          ],
        },
        {},
      ),
    ).toThrowError(expect.objectContaining({ code: FATAL_CODES.DEID_NO_KEY }));
  });
});
