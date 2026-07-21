/**
 * Property-based fail-safe tests for the NCPDP Telecom adapter. For arbitrary transactions the de-id
 * pass **never throws outside the fatal set**, **never leaks a seeded sentinel from a scrub locus**,
 * produces only value-free manifest entries, and never mutates the input.
 */

import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  buildTelecomRequest,
  serializeTelecom,
  type TelecomSegmentInput,
} from "@cosyte/ncpdp/telecom";

import {
  DeidError,
  DEID_DISPOSITION_CODES,
  FATAL_CODES,
  createDeidContext,
} from "../../src/index.js";
import { deidentifyTelecom } from "../../src/ncpdp/index.js";

const FATAL = new Set<string>(Object.values(FATAL_CODES));
const KNOWN = new Set<string>(Object.values(DEID_DISPOSITION_CODES));
const ctx = createDeidContext({ key: "prop-ncpdp", patientId: "p1" });

/** A sentinel seeded only into scrub loci; it must never survive a de-id pass. */
const SENTINEL = "ZZPROPLEAK";

/** Build a Telecom transaction seeding the sentinel across scrub-only PHI fields + an unknown segment. */
function transactionArb(): fc.Arbitrary<ReturnType<typeof buildTelecomRequest>> {
  return fc
    .record({
      patient: fc.constantFrom(
        [
          { id: "CA", value: SENTINEL },
          { id: "CB", value: SENTINEL },
          { id: "C4", value: "19850302" },
          { id: "CM", value: `${SENTINEL} STREET` },
          { id: "CN", value: SENTINEL },
          { id: "CP", value: "90210" },
          { id: "CQ", value: SENTINEL },
          { id: "CY", value: SENTINEL },
        ],
        [{ id: "CB", value: SENTINEL }],
        [] as { id: string; value: string }[],
      ),
      insurance: fc.constantFrom(
        [
          { id: "C2", value: SENTINEL },
          { id: "C1", value: SENTINEL },
          { id: "CD", value: SENTINEL },
        ],
        [] as { id: string; value: string }[],
      ),
      prescriber: fc.constantFrom(
        [{ id: "DB", value: SENTINEL }],
        [] as { id: string; value: string }[],
      ),
      unknown: fc.constantFrom(
        [{ id: "ZZ", value: SENTINEL }],
        [] as { id: string; value: string }[],
      ),
      dur: fc.constantFrom(
        [{ id: "FY", value: `SEEN ${SENTINEL}` }],
        [] as { id: string; value: string }[],
      ),
    })
    .map((r) => {
      const segments: TelecomSegmentInput[] = [];
      if (r.patient.length > 0) segments.push({ segmentId: "01", fields: r.patient });
      if (r.prescriber.length > 0) segments.push({ segmentId: "03", fields: r.prescriber });
      if (r.insurance.length > 0) segments.push({ segmentId: "04", fields: r.insurance });
      // Always include a retained clinical segment so the transaction is non-trivial.
      segments.push({ segmentId: "07", fields: [{ id: "D7", value: "00071015527" }, ...r.dur] });
      if (r.unknown.length > 0) segments.push({ segmentId: "99", fields: r.unknown });
      return buildTelecomRequest({
        header: { transactionCode: "B1", binNumber: "999999", dateOfService: "20260115" },
        segments,
      });
    });
}

describe("deidentifyTelecom — fail-safe invariants", () => {
  it("never throws a non-fatal, never leaks a scrub-locus sentinel, manifest is value-free", () => {
    fc.assert(
      fc.property(transactionArb(), (tx) => {
        let result;
        try {
          result = deidentifyTelecom(tx, { context: ctx });
        } catch (err) {
          if (err instanceof DeidError && FATAL.has(err.code)) return;
          throw err;
        }
        expect(result.telecom.includes(SENTINEL)).toBe(false);
        for (const entry of result.manifest) {
          expect(KNOWN.has(entry.code)).toBe(true);
          expect(entry.count).toBeGreaterThan(0);
          expect(entry.locus.includes(SENTINEL)).toBe(false);
        }
        // The retained clinical NDC always survives (the over-scrub guard).
        expect(result.telecom.includes("00071015527")).toBe(true);
      }),
      { numRuns: 300 },
    );
  });

  it("never mutates the input transaction", () => {
    fc.assert(
      fc.property(transactionArb(), (tx) => {
        const before = serializeTelecom(tx);
        try {
          deidentifyTelecom(tx, { context: ctx });
        } catch (err) {
          if (!(err instanceof DeidError && FATAL.has(err.code))) throw err;
        }
        expect(serializeTelecom(tx)).toBe(before);
      }),
    );
  });
});
