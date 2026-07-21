/**
 * Property-based invariants for the FHIR adapter (the fail-safe reflex):
 *
 * - **Leak invariant:** for arbitrary synthetic tokens injected at the FHIR PHI loci (names,
 *   identifiers, telecom, a local extension, a nested Bundle/contact relative, a narrative div), no
 *   token survives the serialized output — an un-handleable locus fails closed, never passes through.
 * - **Value-free invariant:** no injected token, and no keyed surrogate/key, ever appears in the
 *   manifest — the audit trail records loci, never values or secrets.
 */

import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { parseResource, serializeResource } from "@cosyte/fhir";

import { createDeidContext } from "../../src/index.js";
import { deidentifyFhir } from "../../src/fhir/index.js";

/** A recognizable synthetic token: `ZZ` + upper-alnum, distinct from any structural URI/code. */
const token = fc.stringMatching(/^[A-Z0-9]{4,10}$/).map((s) => `ZZ${s}`);

/** Build a synthetic Bundle carrying the given tokens at real FHIR PHI loci. */
function buildBundle(t: {
  family: string;
  given: string;
  mrn: string;
  phone: string;
  ext: string;
  relative: string;
  narrative: string;
}): string {
  return JSON.stringify({
    resourceType: "Bundle",
    type: "collection",
    entry: [
      {
        resource: {
          resourceType: "Patient",
          text: {
            status: "generated",
            div: `<div xmlns="http://www.w3.org/1999/xhtml">${t.narrative}</div>`,
          },
          identifier: [{ system: "http://h/mrn", value: t.mrn }],
          name: [{ family: t.family, given: [t.given] }],
          telecom: [{ system: "phone", value: t.phone }],
          address: [{ line: [`${t.family} St`], postalCode: "12345" }],
          contact: [{ name: { family: t.relative } }],
          extension: [{ url: "http://h/x", valueString: t.ext }],
        },
      },
    ],
  });
}

describe("deidentifyFhir — property: fail-safe leak + value-free invariants", () => {
  it("never leaves an injected token in the output or the manifest, for arbitrary inputs", () => {
    fc.assert(
      fc.property(
        fc.record({
          family: token,
          given: token,
          mrn: token,
          phone: token,
          ext: token,
          relative: token,
          narrative: token,
          key: fc.stringMatching(/^[a-z0-9]{8,16}$/),
        }),
        (r) => {
          const ctx = createDeidContext({ key: r.key, patientId: "p" });
          const { resource } = parseResource(buildBundle(r));
          const { document, manifest } = deidentifyFhir(resource, { context: ctx });
          const wire = serializeResource(document);
          const tokens = [r.family, r.given, r.mrn, r.phone, r.ext, r.relative, r.narrative];
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
