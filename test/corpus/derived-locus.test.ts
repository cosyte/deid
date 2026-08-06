/**
 * The **derived-identifier locus gate**: the manifest-side companion to `leak-corpus.test.ts`.
 *
 * The headline leak corpus sweeps the *serialized output document* and nothing else, so it is
 * structurally blind to a leak that travels on the **manifest**. This suite closes that gap for the
 * one shape that produces it: every adapter builds a manifest `locus` by interpolating an identifier
 * it read **out of the document** (an HL7 segment id, a CDA element local name, a FHIR JSON key, an
 * X12 segment / transaction-set id, an NCPDP segment code, a DICOM keyword). When the upstream parser
 * cannot recognize that identifier it hands back whatever bytes stood in its place, and on a narrative
 * line, that is clinical prose, an unbounded interpolation writes it into the value-free
 * manifest, and from there into the Expert-Determination support report.
 *
 * So each case plants one synthetic marker in **the identifier position itself**, not in a value, and
 * asserts it reaches neither the manifest, nor the structured report, nor the rendered report, nor any
 * warning. The core's own property test cannot reach this: it draws `path` and `value` as two
 * independent arbitraries, so its generator can never make the path *be* the content.
 *
 * Each case also asserts the marker is genuinely present in the input (non-vacuity), that the pass
 * produced manifest entries at all, and that the refusal is **visible**: an identifier the adapter
 * will not echo is reported as `WITHHELD_LOCUS_TOKEN`, never silently truncated or silently dropped.
 *
 * Every fixture value here is a synthetic `ZZ`-tagged token; nothing resembles real PHI.
 */

import { Buffer } from "node:buffer";

import { describe, expect, it } from "vitest";

import { parseHL7 } from "@cosyte/hl7";
import { parseCcda } from "@cosyte/ccda";
import { parseResource } from "@cosyte/fhir";
import { parseDicom } from "@cosyte/dicom";

import {
  WITHHELD_LOCUS_TOKEN,
  buildExpertDeterminationSupportReport,
  createDeidContext,
  formatExpertDeterminationSupportReport,
  type DeidManifestEntry,
} from "../../src/index.js";
import { deidentifyHl7 } from "../../src/hl7/index.js";
import { deidentifyCcda } from "../../src/ccda/index.js";
import { deidentifyFhir } from "../../src/fhir/index.js";
import { deidentifyX12String } from "../../src/x12/index.js";
import { deidentifyTelecomString } from "../../src/ncpdp/index.js";
import { deidentifyDicom } from "../../src/dicom/index.js";
import { buildDicom } from "../dicom/helpers/build-dicom.js";

/** The one synthetic marker every case plants in an identifier position. Never a real-looking value. */
const MARKER = "ZZLOCUSMARKERZZ";

/**
 * How far past every legitimate identifier the planted token runs. A real HL7 segment id is 3
 * characters, a CDA element name and a FHIR element name are bounded by their specs, an X12 segment id
 * is 2–3 and an NCPDP segment code is 2, so 4 KB is unambiguously not one of them, while staying small
 * enough that the suite runs in milliseconds.
 */
const PAD = 4096;

/** A marker padded with a character that is legal in the identifier slot of every format used here. */
const LONG_MARKER = MARKER + "a".repeat(PAD);

const ctx = (): ReturnType<typeof createDeidContext> =>
  createDeidContext({ key: "derived-locus-key", patientId: "p-derived" });

/** One adapter's contribution: the input it was given and every artifact the pass hands back. */
interface DerivedLocusCase {
  readonly name: string;
  /** The input the marker was planted in; swept to prove the marker is really there. */
  readonly input: string;
  /** The value-free manifest the pass produced. */
  readonly manifest: readonly DeidManifestEntry[];
  /** Every warning message the pass surfaces to the caller, from any surface it returns. */
  readonly warnings: readonly string[];
  /** `false` for a case that exercises an inherited diagnostic rather than a refused identifier. */
  readonly expectsWithheld: boolean;
}

// ── HL7 v2 ────────────────────────────────────────────────────────────────────────────────────────
// An unrecognized narrative continuation line: the parser reads its line prefix as the "segment name",
// and the adapter interpolates that into `TYPE-field`.
function hl7Case(): DerivedLocusCase {
  const narrative = `${LONG_MARKER}|ZZTRAILING`;
  const wire = [
    "MSH|^~\\&|ZZAPP|ZZFAC|ZZRCV|ZZRFAC|20200102103000||ADT^A01|ZZMSG0001|P|2.5",
    "OBX|1|TX|ZZOBS||ZZNARRATIVE||||||F",
    narrative,
  ].join("\r");
  const { document, manifest } = deidentifyHl7(parseHL7(wire), { context: ctx() });
  return {
    name: "hl7",
    input: wire,
    manifest,
    warnings: document.warnings.map((w) => w.message),
    expectsWithheld: true,
  };
}

// ── C-CDA ─────────────────────────────────────────────────────────────────────────────────────────
// An element the CDA locus map does not recognize: its local name becomes a path segment.
function ccdaCase(): DerivedLocusCase {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<ClinicalDocument xmlns="urn:hl7-org:v3">
  <recordTarget>
    <patientRole>
      <${LONG_MARKER}>ZZUNKNOWNVALUE</${LONG_MARKER}>
      <patient><name use="L"><given>ZZGIVEN</given><family>ZZFAMILY</family></name></patient>
    </patientRole>
  </recordTarget>
  <component><structuredBody><component><section>
    <text>ZZNARRATIVEPHI</text>
  </section></component></structuredBody></component>
</ClinicalDocument>`;
  const { manifest } = deidentifyCcda(parseCcda(xml), { context: ctx() });
  return { name: "ccda", input: xml, manifest, warnings: [], expectsWithheld: true };
}

// ── FHIR R4 ───────────────────────────────────────────────────────────────────────────────────────
// A JSON key at a person resource's top level: the key becomes a path segment verbatim.
function fhirCase(): DerivedLocusCase {
  const json = JSON.stringify({
    resourceType: "Patient",
    id: "zz-pat-1",
    [LONG_MARKER]: "ZZUNKNOWNVALUE",
  });
  const { manifest } = deidentifyFhir(parseResource(json).resource, { context: ctx() });
  return { name: "fhir", input: json, manifest, warnings: [], expectsWithheld: true };
}

// A `resourceType` the reader does not recognize becomes the ROOT of every path in the manifest.
function fhirResourceTypeCase(): DerivedLocusCase {
  const json = JSON.stringify({
    resourceType: LONG_MARKER,
    id: "zz-res-1",
    note: { text: "ZZNOTEPHI" },
  });
  const { manifest } = deidentifyFhir(parseResource(json).resource, { context: ctx() });
  return {
    name: "fhir (resourceType)",
    input: json,
    manifest,
    warnings: [],
    expectsWithheld: true,
  };
}

// ── X12 EDI ───────────────────────────────────────────────────────────────────────────────────────
// An unknown segment id AND an unrecognized ST-01 transaction-set id; both are path components.
function x12Case(): DerivedLocusCase {
  const edi = [
    "ISA*00*          *00*          *ZZ*ZZSENDER       *ZZ*ZZRECEIVER     *260615*0930*^*00501*000000002*0*P*:~",
    "GS*HC*ZZSENDER*ZZRECEIVER*20260615*0930*2*X*005010X222A2~",
    `ST*${LONG_MARKER}*0002~`,
    `${LONG_MARKER}*ZZUNKNOWNVALUE~`,
    "SE*4*0002~",
    "GE*1*2~",
    "IEA*1*000000002~",
  ].join("");
  const { manifest } = deidentifyX12String(edi, { context: ctx() });
  return { name: "x12", input: edi, manifest, warnings: [], expectsWithheld: true };
}

// ── NCPDP Telecom ─────────────────────────────────────────────────────────────────────────────────
// An unreadable Segment Identification (111-AM) code: the adapter interpolates it as `SEG/FIELD`.
function ncpdpCase(): DerivedLocusCase {
  const raw =
    "999999D0B1PCN01     101PHARM123       20260115          " + `AM${LONG_MARKER}\\CAZZPATFIRST`;
  const { manifest } = deidentifyTelecomString(raw, { context: ctx() });
  return { name: "ncpdp", input: raw, manifest, warnings: [], expectsWithheld: true };
}

// ── DICOM ─────────────────────────────────────────────────────────────────────────────────────────
// The adapter's own manifest and warnings are clean, but the de-identified `Dataset` it returns must
// not carry the ORIGINAL file's parse warnings, which are diagnostics about the input, and the input
// is the thing that holds PHI.
function dicomCase(): DerivedLocusCase {
  const pad = (s: string): Buffer => {
    const b = Buffer.from(s, "latin1");
    return b.length % 2 === 0 ? b : Buffer.concat([b, Buffer.from([0x20])]);
  };
  // An unsupported Specific Character Set term, echoed verbatim by the upstream parse warning.
  const term = MARKER + "a".repeat(PAD);
  const bytes = buildDicom({
    transferSyntax: "1.2.840.10008.1.2.1",
    elements: [
      { tag: "00080005", vr: "CS", value: pad(term) },
      { tag: "00080060", vr: "CS", value: pad("CT") },
      { tag: "00100010", vr: "PN", value: pad("ZZFAMILY^ZZGIVEN") },
    ],
  });
  const original = parseDicom(bytes);
  const { dataset, manifest, warnings } = deidentifyDicom(original);
  return {
    name: "dicom",
    input: bytes.toString("latin1"),
    manifest,
    warnings: [...warnings.map((w) => w.message), ...dataset.warnings.map((w) => w.message)],
    // The DICOM locus is built from a tag + Part 6 keyword the upstream pass supplies, not from an
    // identifier read off this document, so there is nothing here for the adapter to withhold.
    expectsWithheld: false,
  };
}

const CASES: readonly DerivedLocusCase[] = [
  hl7Case(),
  ccdaCase(),
  fhirCase(),
  fhirResourceTypeCase(),
  x12Case(),
  ncpdpCase(),
  dicomCase(),
];

describe("derived-identifier loci: document content never reaches the manifest", () => {
  for (const c of CASES) {
    it(`${c.name}: the marker is present in the INPUT (non-vacuity)`, () => {
      expect(c.input.includes(MARKER)).toBe(true);
    });

    it(`${c.name}: the pass produced manifest entries (the sweep is not empty)`, () => {
      expect(c.manifest.length).toBeGreaterThan(0);
    });

    it(`${c.name}: no manifest locus carries the marker`, () => {
      const leaking = c.manifest.filter((e) => e.locus.includes(MARKER)).map((e) => e.locus.length);
      expect(leaking).toEqual([]);
    });

    it(`${c.name}: the structured Expert-Determination report carries no marker`, () => {
      const report = buildExpertDeterminationSupportReport(c.manifest);
      expect(JSON.stringify(report).includes(MARKER)).toBe(false);
    });

    it(`${c.name}: the rendered Expert-Determination report carries no marker`, () => {
      const rendered = formatExpertDeterminationSupportReport(
        buildExpertDeterminationSupportReport(c.manifest),
      );
      expect(rendered.includes(MARKER)).toBe(false);
    });

    it(`${c.name}: no warning surfaced by the pass carries the marker`, () => {
      expect(c.warnings.filter((m) => m.includes(MARKER))).toEqual([]);
    });
  }
});

describe("derived-identifier loci: a refusal is recorded, never silent", () => {
  for (const c of CASES) {
    if (!c.expectsWithheld) continue;
    it(`${c.name}: the unrecognizable identifier is reported as withheld`, () => {
      const withheld = c.manifest.filter((e) => e.locus.includes(WITHHELD_LOCUS_TOKEN));
      expect(withheld.length).toBeGreaterThan(0);
    });
  }
});

describe("derived-identifier loci: two refused identifiers stay distinguishable", () => {
  // A bound that collapsed every refused identifier to one string would trade a leak for a different
  // failure of the same artifact: a manifest that under-reports how many distinct positions were
  // acted on. Each adapter therefore keeps a structural index alongside the withheld token.
  it("hl7: two unrecognizable segments produce two distinct loci", () => {
    const wire = [
      "MSH|^~\\&|ZZAPP|ZZFAC|ZZRCV|ZZRFAC|20200102103000||ADT^A01|ZZMSG0001|P|2.5",
      `${MARKER}one narrative|ZZONE`,
      `${MARKER}two narrative|ZZTWO`,
    ].join("\r");
    const { manifest } = deidentifyHl7(parseHL7(wire), { context: ctx() });
    const withheld = manifest.filter((e) => e.locus.includes(WITHHELD_LOCUS_TOKEN));
    expect(new Set(withheld.map((e) => e.locus)).size).toBe(2);
  });

  it("ccda: two unrecognizable siblings in the body descent produce two distinct loci", () => {
    // Both descents compose their segments the same way, and a refused name always carries its index
    // among the refused siblings: `<withheld>` names nothing, so the index is the only "where" left.
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<ClinicalDocument xmlns="urn:hl7-org:v3">
  <recordTarget><patientRole><patient><name use="L"><given>ZZGIVEN</given></name></patient></patientRole></recordTarget>
  <component><structuredBody><component><section>
    <${MARKER}one${"a".repeat(PAD)}><text>ZZNARRATIVEONE</text></${MARKER}one${"a".repeat(PAD)}>
    <${MARKER}two${"a".repeat(PAD)}><text>ZZNARRATIVETWO</text></${MARKER}two${"a".repeat(PAD)}>
  </section></component></structuredBody></component>
</ClinicalDocument>`;
    const { manifest } = deidentifyCcda(parseCcda(xml), { context: ctx() });
    const withheld = manifest.filter((e) => e.locus.includes(WITHHELD_LOCUS_TOKEN));
    expect(new Set(withheld.map((e) => e.locus)).size).toBe(2);
  });

  it("ccda: two refused siblings in DIFFERENT namespaces still produce two distinct loci", () => {
    // A path prints no namespace, so a counter keyed on `namespaceURI|name` counted a difference the
    // reader could not see: both siblings printed a bare `<withheld>` and aggregated into one row.
    // The counter keys on the printed name, so the two are separated whatever namespace they sit in.
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<ClinicalDocument xmlns="urn:hl7-org:v3" xmlns:sdtc="urn:hl7-org:sdtc">
  <recordTarget><patientRole><patient>
    <${LONG_MARKER}>ZZONE</${LONG_MARKER}>
    <sdtc:${LONG_MARKER}>ZZTWO</sdtc:${LONG_MARKER}>
  </patient></patientRole></recordTarget>
</ClinicalDocument>`;
    const { manifest } = deidentifyCcda(parseCcda(xml), { context: ctx() });
    const withheld = manifest.filter((e) => e.locus.includes(WITHHELD_LOCUS_TOKEN));
    expect(withheld.map((e) => e.locus)).toEqual([
      `recordTarget/patientRole/patient/${WITHHELD_LOCUS_TOKEN}[0]`,
      `recordTarget/patientRole/patient/${WITHHELD_LOCUS_TOKEN}[1]`,
    ]);
    for (const e of withheld) expect(e.count).toBe(1);
  });

  it("ccda: a lone refused sibling still carries its index", () => {
    // Not needed for distinctness: needed because `<withheld>` names nothing, so without the index
    // the locus says only "somewhere under this parent".
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<ClinicalDocument xmlns="urn:hl7-org:v3">
  <recordTarget><patientRole><patient>
    <${LONG_MARKER}>ZZONE</${LONG_MARKER}>
  </patient></patientRole></recordTarget>
</ClinicalDocument>`;
    const { manifest } = deidentifyCcda(parseCcda(xml), { context: ctx() });
    expect(manifest.map((e) => e.locus)).toEqual([
      `recordTarget/patientRole/patient/${WITHHELD_LOCUS_TOKEN}[0]`,
    ]);
  });

  it("fhir: two unrecognizable keys on one object produce two distinct loci", () => {
    const json = JSON.stringify({
      resourceType: "Patient",
      id: "zz-pat-2",
      [`${MARKER} one`]: "ZZONE",
      [`${MARKER} two`]: "ZZTWO",
    });
    const { manifest } = deidentifyFhir(parseResource(json).resource, { context: ctx() });
    const withheld = manifest.filter((e) => e.locus.includes(WITHHELD_LOCUS_TOKEN));
    expect(new Set(withheld.map((e) => e.locus)).size).toBe(2);
  });
});

describe("derived-identifier loci: a conforming identifier is byte-identical", () => {
  // The bound is a shape test, not a rewrite: well-formed input must see no change at all, or every
  // manifest a consumer already has stops matching the one the same document produces now.
  it("hl7: a spec-shaped Z-segment keeps its own name in the locus", () => {
    const wire = [
      "MSH|^~\\&|ZZAPP|ZZFAC|ZZRCV|ZZRFAC|20200102103000||ADT^A01|ZZMSG0001|P|2.5",
      "ZPI|ZZVENDORVALUE",
    ].join("\r");
    const { manifest } = deidentifyHl7(parseHL7(wire), { context: ctx() });
    expect(manifest.map((e) => e.locus)).toContain("ZPI-1");
  });

  it("fhir: a spec-shaped element name keeps its own spelling in the locus", () => {
    const json = JSON.stringify({
      resourceType: "Patient",
      id: "zz-pat-3",
      unrecognizedElement: "ZZVENDORVALUE",
    });
    const { manifest } = deidentifyFhir(parseResource(json).resource, { context: ctx() });
    expect(manifest.map((e) => e.locus)).toContain("Patient.unrecognizedElement");
  });
});
