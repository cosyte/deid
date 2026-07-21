/**
 * Property-based invariants for the C-CDA adapter (the fail-safe reflex):
 *
 * - **Leak invariant:** for arbitrary synthetic person tokens injected at the header PHI loci, no token
 *   survives the serialized output — an un-handleable locus fails closed, never passes through.
 * - **Value-free invariant:** no injected token, and no keyed surrogate/offset, ever appears in the
 *   manifest — the audit trail records loci, never values or secrets.
 */

import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { parseCcda } from "@cosyte/ccda";

import { createDeidContext } from "../../src/index.js";
import { deidentifyCcda } from "../../src/ccda/index.js";

/** A recognizable synthetic token: `ZZ` + upper-alnum, distinct from any structural OID/keyword. */
const token = fc.stringMatching(/^[A-Z0-9]{4,10}$/).map((s) => `ZZ${s}`);

/** Build a synthetic C-CDA header carrying the given tokens at real PHI loci. */
function buildDoc(t: {
  given: string;
  family: string;
  mrn: string;
  street: string;
  guardian: string;
  authorName: string;
}): string {
  return `<?xml version="1.0"?>
<ClinicalDocument xmlns="urn:hl7-org:v3" xmlns:sdtc="urn:hl7-org:sdtc">
  <recordTarget><patientRole>
    <id root="2.16.840.1.113883.19.5" extension="${t.mrn}"/>
    <addr><streetAddressLine>${t.street}</streetAddressLine><postalCode>12345</postalCode></addr>
    <patient>
      <name><given>${t.given}</given><family>${t.family}</family></name>
      <birthTime value="19811203"/>
      <guardian><guardianPerson><name><family>${t.guardian}</family></name></guardianPerson></guardian>
      <sdtc:patientID>${t.family}SDTC</sdtc:patientID>
    </patient>
  </patientRole></recordTarget>
  <author><assignedAuthor><assignedPerson><name><family>${t.authorName}</family></name></assignedPerson></assignedAuthor></author>
</ClinicalDocument>`;
}

describe("deidentifyCcda — property: fail-safe leak + value-free invariants", () => {
  it("never leaves an injected token in the output or the manifest, for arbitrary inputs", () => {
    fc.assert(
      fc.property(
        fc.record({
          given: token,
          family: token,
          mrn: token,
          street: token,
          guardian: token,
          authorName: token,
          key: fc.stringMatching(/^[a-z0-9]{8,16}$/),
        }),
        (r) => {
          const ctx = createDeidContext({ key: r.key, patientId: "p" });
          const { document, manifest } = deidentifyCcda(parseCcda(buildDoc(r)), { context: ctx });
          const wire = document.toString();
          const tokens = [r.given, r.family, r.mrn, r.street, r.guardian, r.authorName];
          for (const tk of tokens) {
            expect(wire.includes(tk)).toBe(false); // leak invariant
          }
          const manifestBlob = JSON.stringify(manifest);
          for (const tk of tokens) {
            expect(manifestBlob.includes(tk)).toBe(false); // value-free invariant
          }
          expect(manifestBlob.includes(r.key)).toBe(false); // the key never leaks
        },
      ),
      { numRuns: 60 },
    );
  });
});
