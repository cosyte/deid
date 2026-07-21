/**
 * FHIR adapter tests — the two headline gates (the **leak test** and the **over-scrub test**), the
 * per-category structured behavior across the person resources and the universal vectors, the
 * narrative / extension / unknown-structure fail-closed defaults, the keyed-context fatal, and
 * immutability.
 *
 * Every value is a synthetic, tagged sentinel (`ZZ…`, `555-000-…` phones, `example.com`) or a synthetic
 * clinical value. The fixture is declared synthetic in `scripts/phi-allow-list.txt`.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import { getProperty, isList, parseResource, resourceType, serializeResource } from "@cosyte/fhir";

import {
  DEID_DISPOSITION_CODES,
  FATAL_CODES,
  SAFE_HARBOR_CATEGORIES,
  createDeidContext,
  defineDeidPolicy,
} from "../../src/index.js";
import { deidentifyFhir, deidentifyFhirJson } from "../../src/fhir/index.js";

const C = SAFE_HARBOR_CATEGORIES;
const D = DEID_DISPOSITION_CODES;
const FIXTURES = join(import.meta.dirname, "..", "fixtures", "fhir");

function loadFixture(name: string): string {
  return readFileSync(join(FIXTURES, `${name}.json`), "utf8");
}

const ctx = createDeidContext({ key: "fhir-test-key", patientId: "patient-fhir-1" });

/** Parse + de-identify a fixture, returning the transformed model, serialized wire, and manifest. */
function deid(name: string, options = { context: ctx }) {
  const { resource } = parseResource(loadFixture(name));
  const { document, manifest } = deidentifyFhir(resource, options);
  return { document, manifest, wire: serializeResource(document) };
}

/**
 * Every PHI sentinel seeded across the Bundle's person resources, universal vectors (identifier /
 * narrative / extension / reference display), the nested `Patient.contact` relative, and a contained
 * `RelatedPerson`. Every one must be GONE after a de-id pass. Retained-by-design values — the clinical
 * `Observation`/`Encounter` codes, values, units, statuses, and reference wiring — are deliberately not
 * in this list (they are the over-scrub guard).
 */
const SENTINELS: readonly string[] = [
  "ZZPATNARRATIVE",
  "ZZMRNFHIR1",
  "ZZSSNFHIR1",
  "ZZPATFAMILY",
  "ZZPATGIVEN",
  "555-000-1111",
  "ZZPATSTREET",
  "ZZPATCITY",
  "ZZPATCOUNTY",
  "ZZPATPHOTO",
  "ZZCONTACTREL",
  "ZZCONTACTGIVEN",
  "ZZCONTACTSTREET",
  "555-000-2222",
  "ZZEXTMRN",
  "ZZNESTEDEXTPHI",
  "ZZVENDORMAIDEN",
  "ZZNPI1",
  "ZZDOCFAMILY",
  "ZZDOCGIVEN",
  "ZZDOCSTREET",
  "ZZDOCCITY",
  "555-000-3333",
  "ZZRELFAMILY",
  "ZZRELGIVEN",
  "zzrel@example.com",
  "ZZREFDISPLAYNAME",
  "ZZPERFORMERONLYDISPLAY",
  "ZZCOMMSUBJECTDISPLAY",
  "ZZOBSNOTEPHI",
  "ZZNOTEAUTHOR",
  "ZZCONTENTPHI",
  "555-000-7777",
  "ZZACCESSION1",
  "ZZCONTAINEDREL",
  "555-000-4444",
  "1990-02-15",
  "1965-11-20",
  "2021-06-30",
  "2019-03-14",
];

/** Clinical / structural values that must SURVIVE (the over-scrub guard + reference-wiring invariant). */
const CLINICAL: readonly string[] = [
  "2951-2", // LOINC sodium observation code
  "Sodium [Moles/volume] in Serum or Plasma", // code display — a coded term, not a person label
  "140", // sodium result value
  "mmol/L", // unit
  "135", // reference-range low
  "145", // reference-range high
  "final", // observation status
  "laboratory", // observation category
  "Married", // maritalStatus coding display (a Coding.display, never a Reference.display)
  "English", // communication language display
  "Doctor of Medicine", // qualification display
  "Patient/pat1", // reference wiring preserved structurally after identifier handling
  "Practitioner/prac1", // reference wiring preserved
  "902", // Patient ZIP generalized to safe 3-digit prefix
  "MA", // state — permitted, retained
];

describe("deidentifyFhir — the leak test (zero surviving sentinels across every resource)", () => {
  it("removes every seeded PHI sentinel across person resources, universal vectors, contact + contained", () => {
    const { wire } = deid("bundle");
    expect(SENTINELS.filter((s) => wire.includes(s))).toEqual([]);
  });
});

describe("deidentifyFhir — the over-scrub test (clinical values + wiring survive)", () => {
  it("retains coded values, units, statuses, coded displays, ZIP prefix, and reference wiring", () => {
    const { wire } = deid("bundle");
    expect(CLINICAL.filter((s) => !wire.includes(s))).toEqual([]);
  });

  it("never acts on a clinical Observation code/value/unit locus", () => {
    const { manifest } = deid("bundle");
    const clinicalActs = manifest.filter(
      (m) =>
        m.locus.includes("valueQuantity") ||
        m.locus.includes("code") ||
        m.locus.includes("referenceRange"),
    );
    expect(clinicalActs).toEqual([]);
  });
});

describe("deidentifyFhir — structured per-category behavior", () => {
  it("pseudonymizes the patient MRN by system (keeping system) and removes an SSN-system identifier", () => {
    const { document, manifest } = deid("bundle");
    const patient = firstResource(document, "Patient");
    const ids = getProperty(patient, "identifier");
    const items = ids !== undefined && isList(ids) ? ids.items : [];
    // MRN → 64-hex HMAC surrogate; system retained.
    const mrn = items[0];
    expect(strValue(mrn, "value")).toMatch(/^[0-9a-f]{64}$/);
    expect(strValue(mrn, "system")).toBe("http://hospital.example/mrn");
    // SSN-system id → value removed, system retained.
    const ssn = items[1];
    expect(getProperty(asComplex(ssn), "value")).toBeUndefined();
    expect(strValue(ssn, "system")).toBe("http://hl7.org/fhir/sid/us-ssn");
    expect(manifest.find((m) => m.locus.endsWith("identifier[0].value"))?.category).toBe(C.MRN);
    expect(manifest.find((m) => m.locus.endsWith("identifier[1].value"))?.category).toBe(C.SSN);
  });

  it("generalizes birthDate and deceasedDateTime to their year (residual retained)", () => {
    const { document, manifest } = deid("bundle");
    const patient = firstResource(document, "Patient");
    expect(strValue(patient, "birthDate")).toBe("1990");
    expect(strValue(patient, "deceasedDateTime")).toBe("2021");
    expect(manifest.find((m) => m.locus.endsWith(".birthDate"))?.code).toBe(
      D.DEID_RESIDUAL_RETAINED,
    );
  });

  it("generalizes the patient address to the safe 3-digit ZIP and drops finer geography (state kept)", () => {
    const { wire } = deid("bundle");
    expect(wire).toContain('"postalCode":"902"');
    expect(wire).toContain('"state":"MA"');
    expect(wire).not.toContain('"line"');
    expect(wire).not.toContain('"city"');
    expect(wire).not.toContain('"district"');
  });

  it("fully suppresses a restricted-prefix ZIP (contact 03601) to 000", () => {
    const { wire } = deid("bundle");
    expect(wire).toContain('"postalCode":"000"');
  });

  it("generalizes clinical-resource dates (Observation.effective/issued, Encounter.period) to year", () => {
    const { manifest } = deid("bundle");
    const dateLoci = manifest.filter((m) => m.category === C.DATES);
    // birthDate, deceasedDateTime, related birthDate, effectiveDateTime, issued, period.start, period.end
    expect(dateLoci.length).toBeGreaterThanOrEqual(6);
    expect(dateLoci.every((m) => m.transform === "generalize")).toBe(true);
  });

  it("preserves reference wiring while blocking a Reference.display person label", () => {
    const { wire, manifest } = deid("bundle");
    expect(wire).toContain('"reference":"Patient/pat1"'); // wiring intact
    expect(wire).not.toContain("ZZREFDISPLAYNAME"); // the display label blocked
    expect(
      manifest.some((m) => m.locus.endsWith("subject.display") && m.disposition === "blocked"),
    ).toBe(true);
  });
});

describe("deidentifyFhir — fail closed on narrative, extensions, and unknown structure", () => {
  it("blocks the narrative text.div (rendered PHI), leaving the Narrative status", () => {
    const { document, wire, manifest } = deid("bundle");
    expect(wire).not.toContain("ZZPATNARRATIVE");
    const patient = firstResource(document, "Patient");
    const text = getProperty(patient, "text");
    expect(text !== undefined && getProperty(asComplex(text), "div")).toBeUndefined(); // div dropped
    expect(manifest.some((m) => m.locus.endsWith("text.div") && m.disposition === "blocked")).toBe(
      true,
    );
  });

  it("blocks extension values at any nesting (an MRN in a local extension, a nested extension) — url kept", () => {
    const { wire, manifest } = deid("bundle");
    expect(wire).not.toContain("ZZEXTMRN");
    expect(wire).not.toContain("ZZNESTEDEXTPHI");
    expect(wire).toContain('"url":"http://hospital.example/local-mrn"'); // structural url retained
    expect(
      manifest.filter((m) => m.locus.includes("extension") && m.disposition === "blocked").length,
    ).toBeGreaterThanOrEqual(2);
  });

  it("fails closed on an unknown bare-string property at a person resource top level", () => {
    const { wire, manifest } = deid("bundle");
    expect(wire).not.toContain("ZZVENDORMAIDEN");
    expect(
      manifest.some(
        (m) => m.locus.endsWith("vendorMotherMaidenName") && m.disposition === "blocked",
      ),
    ).toBe(true);
  });

  it("walks a contained resource and de-identifies its person PHI", () => {
    const { wire } = deid("bundle");
    expect(wire).not.toContain("ZZCONTAINEDREL");
    expect(wire).not.toContain("555-000-4444");
  });

  it("distinguishes a Coding.display (retained) from a Reference.display (blocked)", () => {
    const json = JSON.stringify({
      resourceType: "Observation",
      status: "final",
      code: { coding: [{ system: "http://loinc.org", code: "2951-2", display: "ZZKEEPCODE" }] },
      subject: { reference: "Patient/1", display: "ZZDROPREF" },
    });
    const { json: out } = deidentifyFhirJson(json, { context: ctx });
    expect(out).toContain("ZZKEEPCODE"); // Coding.display survives (over-scrub guard)
    expect(out).not.toContain("ZZDROPREF"); // Reference.display blocked
  });

  it("fails closed on a display-only / type+display Reference (a person label with no reference target)", () => {
    // The refutal class: a Reference that carries neither `reference` nor `identifier` still leaks its
    // `display` name unless the rule fails closed on any non-Coding display.
    const json = JSON.stringify({
      resourceType: "Encounter",
      status: "finished",
      subject: { display: "ZZDISPLAYONLY" }, // display-only reference
      participant: [{ individual: { type: "Practitioner", display: "ZZTYPEDISPLAY" } }], // type+display
      reasonCode: [
        {
          coding: [{ system: "http://snomed.info/sct", code: "386661006", display: "ZZKEEPFEVER" }],
        },
      ],
    });
    const { json: out } = deidentifyFhirJson(json, { context: ctx });
    expect(out).not.toContain("ZZDISPLAYONLY"); // display-only reference label blocked
    expect(out).not.toContain("ZZTYPEDISPLAY"); // type+display reference label blocked
    expect(out).toContain("ZZKEEPFEVER"); // a Coding.display (has code+system) is retained
  });

  it("blocks free-text loci: Annotation note (text + author), contentString, and an uncoded valueString", () => {
    const json = JSON.stringify({
      resourceType: "Observation",
      status: "final",
      code: { coding: [{ system: "http://loinc.org", code: "2951-2" }] },
      note: [{ text: "ZZNOTEPROSE naming Jane Doe", authorString: "ZZNOTEAUTH" }],
      valueString: "ZZVALUESTRINGPROSE",
    });
    const { json: out, manifest } = deidentifyFhirJson(json, { context: ctx });
    expect(out).not.toContain("ZZNOTEPROSE"); // Annotation.text blocked
    expect(out).not.toContain("ZZNOTEAUTH"); // Annotation.authorString blocked
    expect(out).not.toContain("ZZVALUESTRINGPROSE"); // uncoded string result blocked (HL7 ST analogue)
    expect(out).toContain("2951-2"); // the code survives (over-scrub guard)
    expect(manifest.some((m) => m.code === D.DEID_FREETEXT_BLOCKED)).toBe(true);
  });

  it("retains a structured valueQuantity result while blocking an uncoded valueString", () => {
    const structured = deidentifyFhirJson(
      JSON.stringify({
        resourceType: "Observation",
        status: "final",
        valueQuantity: { value: 140, unit: "mmol/L" },
      }),
      { context: ctx },
    );
    expect(structured.json).toContain('"value":140'); // structured value survives
    expect(structured.manifest).toEqual([]); // nothing blocked
  });

  it("blocks an unusual identifier system value by pseudonymizing (not passing through) it", () => {
    const json = JSON.stringify({
      resourceType: "Patient",
      identifier: [{ system: "urn:vendor:weird", value: "ZZWEIRDID" }],
    });
    const { json: out, manifest } = deidentifyFhirJson(json, { context: ctx });
    expect(out).not.toContain("ZZWEIRDID"); // pseudonymized, never in the clear
    expect(manifest.find((m) => m.locus.includes("identifier"))?.category).toBe(C.MRN);
  });

  it("drops a primitive-level (_-sibling) extension carrying PHI (the side-channel guard)", () => {
    // `_birthDate.extension` carries PHI in the JSON `_`-sibling. The applier strips primitive extensions.
    const json = JSON.stringify({
      resourceType: "Patient",
      birthDate: "1985-04-12",
      _birthDate: { extension: [{ url: "http://x/orig", valueString: "ZZPRIMEXT" }] },
    });
    const { json: out } = deidentifyFhirJson(json, { context: ctx });
    expect(out).not.toContain("ZZPRIMEXT");
    expect(out).toContain('"birthDate":"1985"'); // still generalized
  });
});

describe("deidentifyFhir — fatal + policy + immutability + value-free manifest", () => {
  it("throws DEID_NO_KEY when a keyed transform is needed but no context is supplied", () => {
    expect(() => deidentifyFhir(parseResource(loadFixture("bundle")).resource, {})).toThrowError(
      expect.objectContaining({ code: FATAL_CODES.DEID_NO_KEY }),
    );
  });

  it("date-shifts under an Expert-Determination policy instead of generalizing", () => {
    const shift = defineDeidPolicy({ name: "research", transforms: { [C.DATES]: "date-shift" } });
    const { document } = deidentifyFhir(parseResource(loadFixture("bundle")).resource, {
      policy: shift,
      context: ctx,
    });
    const patient = firstResource(document, "Patient");
    const birth = strValue(patient, "birthDate");
    expect(birth).not.toBe("1990-02-15"); // actually shifted
    expect(birth).not.toBe("1990"); // not generalized — a full shifted date
    expect(birth).toMatch(/^\d{4}-\d{2}-\d{2}/);
  });

  it("never mutates the input resource", () => {
    const { resource } = parseResource(loadFixture("bundle"));
    const before = serializeResource(resource);
    deidentifyFhir(resource, { context: ctx });
    expect(serializeResource(resource)).toBe(before);
  });

  it("returns an empty manifest for a resource with no PHI loci", () => {
    const json = JSON.stringify({
      resourceType: "Observation",
      status: "final",
      code: { coding: [{ system: "http://loinc.org", code: "2951-2" }] },
      valueQuantity: { value: 140, unit: "mmol/L" },
    });
    const { manifest } = deidentifyFhirJson(json, { context: ctx });
    expect(manifest).toEqual([]);
  });

  it("emits only value-free manifest entries (never a value, key, or offset)", () => {
    const { manifest } = deid("bundle");
    for (const entry of manifest) {
      const blob = JSON.stringify(entry);
      for (const sentinel of SENTINELS) expect(blob).not.toContain(sentinel);
      expect(entry.locus).not.toMatch(/[0-9a-f]{64}/); // no surrogate/key hex in the locus
    }
  });
});

// ── small typed helpers over the generic @cosyte/fhir model ──────────────────────────────────────

import { isComplex, type FhirComplex, type FhirNode } from "@cosyte/fhir";

function asComplex(node: FhirNode | undefined): FhirComplex {
  if (node === undefined || !isComplex(node)) throw new Error("expected a complex node");
  return node;
}

/** The string value of a named primitive property, or `undefined`. */
function strValue(node: FhirNode | undefined, name: string): string | undefined {
  if (node === undefined || !isComplex(node)) return undefined;
  const prop = getProperty(node, name);
  if (prop === undefined || prop.kind !== "primitive") return undefined;
  const v = prop.value;
  return typeof v === "string" ? v : undefined;
}

/** The first resource of a given type in a Bundle (or the resource itself if it matches). */
function firstResource(root: FhirComplex, type: string): FhirComplex {
  if (resourceType(root) === type) return root;
  const entry = getProperty(root, "entry");
  if (entry !== undefined && isList(entry)) {
    for (const e of entry.items) {
      if (!isComplex(e)) continue;
      const res = getProperty(e, "resource");
      if (res !== undefined && isComplex(res) && resourceType(res) === type) return res;
    }
  }
  throw new Error(`no ${type} in bundle`);
}
