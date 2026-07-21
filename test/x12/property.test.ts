/**
 * Property-based fail-safe tests for the X12 adapter. The load-bearing invariant is the inverse of a
 * parser's: for arbitrary/quirky interchanges the de-id pass **never throws outside the fatal set**,
 * **never leaks a seeded sentinel from a scrub locus**, produces only value-free manifest entries, and
 * never mutates the input.
 */

import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { parseX12, serializeX12 } from "@cosyte/x12";

import {
  DeidError,
  DEID_DISPOSITION_CODES,
  FATAL_CODES,
  createDeidContext,
} from "../../src/index.js";
import { deidentifyX12 } from "../../src/x12/index.js";

const FATAL = new Set<string>(Object.values(FATAL_CODES));
const KNOWN = new Set<string>(Object.values(DEID_DISPOSITION_CODES));
const ctx = createDeidContext({ key: "prop-x12", patientId: "p1" });

/** The 106-byte fixed ISA + the GS/ST envelope shared by every generated interchange. */
const ISA =
  "ISA*00*          *00*          *ZZ*COMMERCIAL     *ZZ*CLINICSUBMTR   *260615*0930*^*00501*000000002*0*P*:~";
const HEAD = `${ISA}GS*HC*A*B*20260615*0930*2*X*005010X222A2~ST*837*0002~`;
const TAIL = "SE*9*0002~GE*1*2~IEA*1*000000002~";

/** A sentinel token seeded only into guaranteed-scrub loci; it must never survive a de-id pass. */
const SENTINEL = "ZZPROPLEAK";

/** Build a syntactically-valid 837 interchange seeding the sentinel across scrub-only PHI loci. */
function interchangeArb(): fc.Arbitrary<string> {
  return fc
    .record({
      name: fc.constantFrom(
        `NM1*IL*1*${SENTINEL}*${SENTINEL}****MI*${SENTINEL}~`,
        `NM1*QC*1*${SENTINEL}~`,
        "",
      ),
      addr: fc.constantFrom(
        `N3*${SENTINEL} STREET~N4*${SENTINEL}*OH*90210~`,
        "N4*CITY*OH*03601~",
        "",
      ),
      dmg: fc.constantFrom(`DMG*D8*19850302*M~`, ""),
      ref: fc.constantFrom(`REF*SY*${SENTINEL}~`, `REF*1W*${SENTINEL}~`, `REF*ZZ*${SENTINEL}~`, ""),
      per: fc.constantFrom(`PER*IC*${SENTINEL}*TE*${SENTINEL}~`, ""),
      clm: fc.constantFrom(`CLM*${SENTINEL}*100.00***11:B:1*Y*A*Y*Y~`, ""),
      zseg: fc.constantFrom(`ZPI*${SENTINEL}*${SENTINEL}~`, ""),
    })
    .map((r) => `${HEAD}${r.name}${r.addr}${r.dmg}${r.ref}${r.per}${r.clm}${r.zseg}${TAIL}`);
}

describe("deidentifyX12 — fail-safe invariants", () => {
  it("never throws a non-fatal, never leaks a scrub-locus sentinel, manifest is value-free", () => {
    fc.assert(
      fc.property(interchangeArb(), (raw) => {
        let result;
        try {
          result = deidentifyX12(parseX12(raw), { context: ctx });
        } catch (err) {
          if (err instanceof DeidError && FATAL.has(err.code)) return;
          throw err;
        }
        // Every seeded sentinel sat in a scrub locus (name / id / address / SSN / member / account /
        // telecom / unknown segment), so none may survive.
        expect(result.x12.includes(SENTINEL)).toBe(false);
        for (const entry of result.manifest) {
          expect(KNOWN.has(entry.code)).toBe(true);
          expect(entry.count).toBeGreaterThan(0);
          expect(entry.locus.includes(SENTINEL)).toBe(false);
        }
      }),
      { numRuns: 300 },
    );
  });

  it("never mutates the input interchange", () => {
    fc.assert(
      fc.property(interchangeArb(), (raw) => {
        const ix = parseX12(raw);
        const before = serializeX12(ix);
        try {
          deidentifyX12(ix, { context: ctx });
        } catch (err) {
          if (!(err instanceof DeidError && FATAL.has(err.code))) throw err;
        }
        expect(serializeX12(ix)).toBe(before);
      }),
    );
  });
});
