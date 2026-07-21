/**
 * Property-based invariants for the DICOM de-identification adapter (roadmap §Phase 6, §6).
 *
 * The load-bearing invariants: **the de-id pass never throws** on arbitrary/adversarial synthetic
 * datasets; **no seeded sentinel ever survives** the serialized output (fail-closed under fuzzing);
 * **the manifest is always value-free**; and **UID remapping is consistent** across arbitrary corpora.
 * Everything is synthetic and built in memory.
 *
 * @module
 */

import { Buffer } from "node:buffer";

import { parseDicom, serializeDicom } from "@cosyte/dicom";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { deidentifyDicom } from "../../src/dicom/index.js";
import { buildDicom, type BuildDicomElement } from "./helpers/build-dicom.js";
import { pad, TS_EXPLICIT_LE } from "./helpers/fixtures.js";

/** A tagged synthetic sentinel — obviously fake, never realistic. */
const sentinelText = fc
  .integer({ min: 0, max: 1_000_000 })
  .map((n) => `ZZFUZZSENTINEL${String(n).padStart(7, "0")}`);

/** An arbitrary PHI-bearing element drawn from the enumerated Annex E loci, carrying a sentinel value. */
const phiElement: fc.Arbitrary<BuildDicomElement & { readonly sentinel: string }> = fc
  .tuple(
    fc.constantFrom(
      "00100010", // Patient's Name (PN)
      "00100020", // Patient ID (LO)
      "00080090", // Referring Physician's Name (PN)
      "00080080", // Institution Name (LO)
      "00080050", // Accession Number (SH)
      "00101000", // Other Patient IDs (LO)
      "00101040", // Patient's Address (LO)
      "00100050", // hypothetical extra — modeled as LO
    ),
    sentinelText,
  )
  .map(([tag, sentinel]) => ({
    tag,
    vr: tag === "00100010" || tag === "00080090" ? "PN" : "LO",
    value: pad(sentinel),
    sentinel,
  }));

describe("fail-safe: never throws, never leaks a sentinel (fuzz)", () => {
  it("de-identifies an arbitrary PHI-laden dataset without throwing, and no sentinel survives", () => {
    fc.assert(
      fc.property(fc.array(phiElement, { minLength: 0, maxLength: 20 }), (elements) => {
        const buf = buildDicom({
          transferSyntax: TS_EXPLICIT_LE,
          mediaStorageSOPInstanceUID: "1.2.826.0.1.3680043.8.498.1",
          elements: elements.map((e) => ({ tag: e.tag, vr: e.vr, value: e.value })),
        });
        const result = deidentifyDicom(parseDicom(buf));
        const out = serializeDicom(result.dataset).toString("latin1");
        // Leak invariant: every seeded sentinel is gone.
        for (const e of elements) {
          expect(out.includes(e.sentinel), `leaked ${e.sentinel} at ${e.tag}`).toBe(false);
        }
        // Value-free invariant: the manifest never carries a seeded value.
        const flat = JSON.stringify(result.manifest);
        for (const e of elements) expect(flat.includes(e.sentinel)).toBe(false);
      }),
      { numRuns: 200 },
    );
  });

  it("tolerates arbitrary private-group elements and always strips their values", () => {
    const privateElement = fc
      .tuple(fc.integer({ min: 0x0009, max: 0x00ff }), sentinelText)
      .map(([group, sentinel]) => {
        const g = (group | 1).toString(16).padStart(4, "0"); // force odd (private) group
        return { tag: `${g}1001`, vr: "LO" as const, value: pad(sentinel), sentinel };
      });
    fc.assert(
      fc.property(fc.array(privateElement, { minLength: 1, maxLength: 8 }), (elements) => {
        const buf = buildDicom({
          transferSyntax: TS_EXPLICIT_LE,
          elements: elements.map((e) => ({ tag: e.tag, vr: e.vr, value: e.value })),
        });
        const out = serializeDicom(deidentifyDicom(parseDicom(buf)).dataset).toString("latin1");
        for (const e of elements) expect(out.includes(e.sentinel)).toBe(false);
      }),
      { numRuns: 100 },
    );
  });
});

describe("consistency: UID remapping is deterministic across arbitrary corpora", () => {
  it("maps a given source UID to the same replacement in every document (shared cache)", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 1, max: 9999 }), { minLength: 2, maxLength: 6 }),
        (suffixes) => {
          const uidMap = new Map<string, string>();
          const studyUid = "1.2.826.0.1.3680043.8.498.777";
          const replacements = new Set<string>();
          for (const s of suffixes) {
            const buf = buildDicom({
              transferSyntax: TS_EXPLICIT_LE,
              elements: [
                { tag: "0020000D", vr: "UI", value: pad(studyUid) },
                { tag: "00080018", vr: "UI", value: pad(`1.2.826.0.1.3680043.8.498.${String(s)}`) },
              ],
            });
            const { dataset } = deidentifyDicom(parseDicom(buf), { uidMap });
            const mapped = dataset.get("0020000D")?.rawBytes.toString("latin1").replace(/\0+$/, "");
            expect(mapped).toBeDefined();
            expect(mapped).not.toContain(studyUid);
            if (mapped !== undefined) replacements.add(mapped);
          }
          // The same source Study UID → exactly one replacement across the whole corpus.
          expect(replacements.size).toBe(1);
        },
      ),
      { numRuns: 50 },
    );
  });
});

describe("immutability", () => {
  it("never mutates the input dataset under arbitrary input", () => {
    fc.assert(
      fc.property(fc.array(phiElement, { minLength: 1, maxLength: 10 }), (elements) => {
        const buf = buildDicom({
          transferSyntax: TS_EXPLICIT_LE,
          elements: elements.map((e) => ({ tag: e.tag, vr: e.vr, value: e.value })),
        });
        const ds = parseDicom(buf);
        const before = serializeDicom(ds);
        deidentifyDicom(ds);
        const after = serializeDicom(ds);
        expect(Buffer.compare(before, after)).toBe(0);
      }),
      { numRuns: 100 },
    );
  });
});
