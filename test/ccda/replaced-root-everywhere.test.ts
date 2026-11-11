/**
 * A root the header replaced, because an `<id>` there carried it with no extension, is replaced on
 * every other element that carries it: an `<id>` with an extension in the header, the document's own
 * `<id>` with an extension, and an `<id>` with an extension in the clinical body. Each takes the same
 * replacement the header wrote, recorded at its own `@root` position; the extension beside it is
 * decided as it always was.
 *
 * All values are synthetic `ZZ` sentinels.
 */

import { describe, expect, it } from "vitest";
import { parseCcda } from "@cosyte/ccda";

import {
  DEID_DISPOSITION_CODES,
  SAFE_HARBOR_CATEGORIES,
  createDeidContext,
  defineDeidPolicy,
  pseudonymize,
} from "../../src/index.js";
import { deidentifyCcda } from "../../src/ccda/index.js";

const C = SAFE_HARBOR_CATEGORIES;
const D = DEID_DISPOSITION_CODES;
const ctx = createDeidContext({ key: "ccda-root-everywhere-key-synthetic", patientId: "p-root" });

const ROOT = "ZZSHAREDROOT";

/** A document whose header names `ROOT` with no extension, and carries it with one elsewhere. */
const XML = `<?xml version="1.0"?>
<ClinicalDocument xmlns="urn:hl7-org:v3" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<id root="${ROOT}" extension="ZZDOCEXT"/>
<recordTarget><patientRole>
<id root="${ROOT}" extension="ZZHEADEREXT"/>
<id root="${ROOT}"/>
<patient><name><family>ZZFAMILY</family></name></patient>
</patientRole></recordTarget>
<component><structuredBody><component><section>
<code code="30954-2" codeSystem="2.16.840.1.113883.6.1"/>
<entry><observation classCode="OBS" moodCode="EVN">
<id root="${ROOT}" extension="ZZBODYEXT"/>
<code code="2951-2" codeSystem="2.16.840.1.113883.6.1"/>
<value xsi:type="PQ" value="140" unit="mmol/L"/>
</observation></entry>
</section></component></structuredBody></component>
</ClinicalDocument>`;

/** Every `@root` value an element named `id` carries in the serialized output, in document order. */
function idRoots(wire: string): string[] {
  return [...wire.matchAll(/<id\b[^>]*\broot="([^"]*)"/g)].map((m) => m[1] as string);
}

describe("a root the header replaced is replaced on every element that carries it", () => {
  it("under the Safe Harbor default: the same stand-in everywhere, the root gone", () => {
    const { document, manifest } = deidentifyCcda(parseCcda(XML), { context: ctx });
    const wire = document.toString();
    expect(wire).not.toContain(ROOT);
    expect(idRoots(wire)).toEqual(["1", "1", "1", "1"]);
    // The body extension is a clinical record id, kept as before; the header one is transformed.
    expect(wire).toContain('extension="ZZBODYEXT"');
    expect(wire).not.toContain("ZZHEADEREXT");
    const rootRows = manifest.filter((m) => m.locus.endsWith("@root"));
    expect(rootRows.map((m) => m.locus)).toEqual([
      "id@root",
      "recordTarget/patientRole/id[0]@root",
      "component/structuredBody/component/section/entry/observation/id@root",
    ]);
    for (const row of rootRows) {
      expect(row).toMatchObject({
        transform: "redact",
        disposition: "transformed",
        code: D.DEID_IDENTIFIER_SUBSTITUTED,
        reidentificationCode: false,
      });
    }
  });

  it("under a keyed policy: the same keyed surrogate everywhere", () => {
    const keyed = defineDeidPolicy({
      name: "keyed",
      transforms: { [C.MRN]: "pseudonymize", [C.OTHER_UNIQUE_ID]: "pseudonymize" },
    });
    const { document } = deidentifyCcda(parseCcda(XML), { context: ctx, policy: keyed });
    const wire = document.toString();
    expect(wire).not.toContain(ROOT);
    expect(idRoots(wire)).toEqual(Array(4).fill(pseudonymize(ROOT, ctx)));
  });

  it("no longer counts the replaced root as an unexamined residual; the body extension still is", () => {
    const { unexaminedResiduals } = deidentifyCcda(parseCcda(XML), { context: ctx });
    const loci = unexaminedResiduals.map((r) => r.locus);
    const body = "component/structuredBody/component/section/entry/observation/id";
    expect(loci).not.toContain(`${body}@root`);
    expect(loci).not.toContain("id@root");
    expect(loci).toContain(`${body}@extension`);
  });

  it("removes the root everywhere under a transform that cannot replace an identifier", () => {
    const odd = defineDeidPolicy({ name: "odd", transforms: { [C.MRN]: "generalize" } });
    const { document } = deidentifyCcda(parseCcda(XML), { context: ctx, policy: odd });
    const wire = document.toString();
    expect(wire).not.toContain(ROOT);
    expect(wire).toContain('<id extension="ZZBODYEXT"/>');
    expect(wire).toContain('<id extension="ZZDOCEXT"/>');
  });

  it("leaves a root the header did not replace where it was", () => {
    const xml = XML.replace(`<id root="${ROOT}"/>`, "");
    const { document } = deidentifyCcda(parseCcda(xml), { context: ctx });
    const wire = document.toString();
    expect(wire).toContain(`root="${ROOT}" extension="ZZBODYEXT"`);
    expect(wire).toContain(`root="${ROOT}" extension="ZZDOCEXT"`);
  });
});
