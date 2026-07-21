/**
 * Property-based fail-safe tests for the HL7 v2 adapter. The load-bearing invariant is the inverse of a
 * parser's: for arbitrary/quirky parsed messages the de-id pass **never throws outside the fatal set**,
 * **never leaks a seeded sentinel**, produces only value-free manifest entries, and never mutates the
 * input.
 */

import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { parseHL7 } from "@cosyte/hl7";

import {
  DeidError,
  DEID_DISPOSITION_CODES,
  FATAL_CODES,
  createDeidContext,
} from "../../src/index.js";
import { deidentifyHl7 } from "../../src/hl7/index.js";

const FATAL = new Set<string>(Object.values(FATAL_CODES));
const KNOWN = new Set<string>(Object.values(DEID_DISPOSITION_CODES));
const ctx = createDeidContext({ key: "prop-key", patientId: "p1" });

/** A sentinel token the property seeds into PHI-bearing loci; it must never survive a de-id pass. */
const SENTINEL = "ZZPROPLEAK";

/** Build a syntactically-valid HL7 message seeding the sentinel into assorted PHI loci. */
function messageArb(): fc.Arbitrary<string> {
  return fc
    .record({
      mrn: fc.constantFrom(`${SENTINEL}^^^H^MR`, `${SENTINEL}^^^H^SS`, `${SENTINEL}^^^H^AN`, ""),
      name: fc.constantFrom(`${SENTINEL}^${SENTINEL}`, "", `A^${SENTINEL}`),
      dob: fc.constantFrom("19850302", SENTINEL, ""),
      addr: fc.constantFrom(`${SENTINEL}^^${SENTINEL}^MA^90210`, `${SENTINEL}^^X^MA^03601`, ""),
      phone: fc.constantFrom(SENTINEL, ""),
      obxType: fc.constantFrom("NM", "TX", "FT", "ST"),
      obxVal: fc.constantFrom("140", `narrative ${SENTINEL}`),
      nte: fc.constantFrom(`note ${SENTINEL}`, ""),
      zseg: fc.constantFrom(`ZPI|${SENTINEL}|${SENTINEL}`, ""),
    })
    .map((r) => {
      const lines = [
        "MSH|^~\\&|A|B|C|D|20200101||ADT^A01|M1|P|2.5",
        `PID|1||${r.mrn}||${r.name}||${r.dob}|M|||${r.addr}||${r.phone}`,
        `OBX|1|${r.obxType}|1^x^L||${r.obxVal}||||F`,
      ];
      if (r.nte.length > 0) lines.push(`NTE|1||${r.nte}`);
      if (r.zseg.length > 0) lines.push(r.zseg);
      return lines.join("\r");
    });
}

describe("deidentifyHl7 — fail-safe invariants", () => {
  it("never throws a non-fatal, never leaks the sentinel except in a retained clinical value, manifest is value-free", () => {
    fc.assert(
      fc.property(messageArb(), (raw) => {
        let result;
        try {
          result = deidentifyHl7(parseHL7(raw), { context: ctx });
        } catch (err) {
          if (err instanceof DeidError && FATAL.has(err.code)) return;
          throw err;
        }
        const wire = result.document.toString();
        // The ONLY place the sentinel may survive is a clinical OBX-5 whose OBX-2 typed it non-narrative
        // (NM/ST) — a retained clinical value, never a name/id/date/address/free-text locus.
        if (wire.includes(SENTINEL)) {
          const obx5 = result.document.get("OBX[0].5") ?? "";
          expect(obx5.includes(SENTINEL)).toBe(true);
          // and it appears nowhere else
          expect(wire.split(SENTINEL).length - 1).toBe(obx5.split(SENTINEL).length - 1);
        }
        for (const entry of result.manifest) {
          expect(KNOWN.has(entry.code)).toBe(true);
          expect(entry.count).toBeGreaterThan(0);
          // Value-free: the manifest locus is a path, never the sentinel value.
          expect(entry.locus.includes(SENTINEL)).toBe(false);
        }
      }),
      { numRuns: 300 },
    );
  });

  it("never mutates the input message", () => {
    fc.assert(
      fc.property(messageArb(), (raw) => {
        const msg = parseHL7(raw);
        const before = msg.toString();
        try {
          deidentifyHl7(msg, { context: ctx });
        } catch (err) {
          if (!(err instanceof DeidError && FATAL.has(err.code))) throw err;
        }
        expect(msg.toString()).toBe(before);
      }),
    );
  });
});
