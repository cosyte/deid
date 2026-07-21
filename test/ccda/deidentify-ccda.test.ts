/**
 * C-CDA adapter tests — the two headline gates (the **leak test** and the **over-scrub test**), the
 * per-category structured behavior across the header participations, the narrative / unknown-structure
 * fail-closed defaults, the keyed-context fatal, and immutability.
 *
 * Every value is a synthetic, tagged sentinel (`ZZ…`, `555-000-…` phones) or a synthetic clinical
 * value. The fixture is declared synthetic in `scripts/phi-allow-list.txt`.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import { parseCcda } from "@cosyte/ccda";

import {
  DEID_DISPOSITION_CODES,
  FATAL_CODES,
  SAFE_HARBOR_CATEGORIES,
  createDeidContext,
  defineDeidPolicy,
} from "../../src/index.js";
import { deidentifyCcda } from "../../src/ccda/index.js";

const C = SAFE_HARBOR_CATEGORIES;
const D = DEID_DISPOSITION_CODES;
const FIXTURES = join(import.meta.dirname, "..", "fixtures", "ccda");

function loadFixture(name: string): string {
  return readFileSync(join(FIXTURES, `${name}.xml`), "utf8");
}

const ctx = createDeidContext({ key: "ccda-test-key", patientId: "patient-ccda-1" });

/** Parse + de-identify a fixture, returning the serialized wire and the manifest. */
function deid(name: string, options = { context: ctx }) {
  const { document, manifest } = deidentifyCcda(parseCcda(loadFixture(name)), options);
  return { document, manifest, wire: document.toString() };
}

/**
 * The patient / guardian / author / informant / custodian / encounter PHI sentinels seeded across the
 * header + narrative of `ccd.xml`. Every one must be GONE after a de-id pass. Retained-by-design values
 * — the clinical body's coded values, the body service date `20190505`, the drug name `ZZDRUGNAME`, the
 * dosing period — are deliberately not in this list (the clinical body is the over-scrub guard and the
 * documented Phase-3 boundary).
 */
const CCD_SENTINELS: readonly string[] = [
  "ZZMRNCCDA1",
  "ZZSSNCCDA1",
  "ZZPATGIVEN",
  "ZZPATFAMILY",
  "ZZCCDASTREET",
  "ZZCCDACITY",
  "ZZCOUNTY",
  "19900215",
  "555-000-1111",
  "ZZGUARDGIVEN",
  "ZZGUARDFAMILY",
  "ZZGUARDSTREET",
  "ZZGUARDCITY",
  "555-000-2222",
  "ZZAUTHORNPI",
  "ZZAUTHGIVEN",
  "ZZAUTHFAMILY",
  "ZZAUTHSTREET",
  "ZZAUTHCITY",
  "ZZAUTHORG",
  "555-000-3333",
  "555-000-4444",
  "20200102",
  "ZZINFGIVEN",
  "ZZINFFAMILY",
  "ZZCUSTODIANORG",
  "ZZCUSTODIANSTREET",
  "ZZCUSTODIANCITY",
  "555-000-5555",
  "ZZENCOUNTERID",
  "ZZNARRATIVEPHI",
  "ZZSDTCLEAK",
  "ZZVENDORLEAK",
];

/** Clinical values that must SURVIVE byte-identical (the over-scrub guard). */
const CCD_CLINICAL: readonly string[] = [
  "2951-2", // LOINC sodium observation code
  "140", // sodium value
  "mmol/L", // unit
  "completed", // result status
  "314076", // RxNorm medication code
  "ZZDRUGNAME", // drug material name — a body <name>, never a person: must survive the header sweep
  "PIVL_TS", // dosing-period datatype
  "20190505", // in-entry service date — retained-by-design (Phase-3 clinical-body boundary)
];

describe("deidentifyCcda — the leak test (zero surviving header/narrative sentinels)", () => {
  it("removes every seeded PHI sentinel across recordTarget/guardian/author/informant/custodian/encounter + narrative", () => {
    const { wire } = deid("ccd");
    expect(CCD_SENTINELS.filter((s) => wire.includes(s))).toEqual([]);
  });
});

describe("deidentifyCcda — the over-scrub test (clinical values survive byte-identical)", () => {
  it("retains coded observation/medication values, units, status, drug name, and dosing period", () => {
    const { wire, manifest } = deid("ccd");
    expect(CCD_CLINICAL.filter((s) => !wire.includes(s))).toEqual([]);
    // No manifest entry ever touches a clinical-body locus — only its narrative <text> is blocked.
    const bodyActs = manifest.filter(
      (m) => m.locus.includes("observation") || m.locus.includes("manufactured"),
    );
    expect(bodyActs).toEqual([]);
  });
});

describe("deidentifyCcda — structured per-category behavior", () => {
  it("pseudonymizes the patient MRN (keeping the assigning root) and redacts an SSN-rooted id", () => {
    const { document, manifest } = deid("ccd");
    const ids = document.getPatient()?.identifiers ?? [];
    // MRN → 64-hex HMAC surrogate; assigning authority root retained.
    expect(ids[0]?.extension).toMatch(/^[0-9a-f]{64}$/);
    expect(ids[0]?.root).toBe("2.16.840.1.113883.19.5");
    // SSN-rooted id → redacted (value dropped), root retained.
    expect(ids[1]?.extension).toBeUndefined();
    expect(ids[1]?.root).toBe("2.16.840.1.113883.4.1");
    expect(manifest.find((m) => m.locus === "recordTarget/patientRole/id[0]")?.category).toBe(
      C.MRN,
    );
    expect(manifest.find((m) => m.locus === "recordTarget/patientRole/id[1]")?.category).toBe(
      C.SSN,
    );
  });

  it("removes the patient name and generalizes the birthTime to its year (residual retained)", () => {
    const { document, manifest } = deid("ccd");
    const patient = document.getPatient();
    expect(patient?.name?.family).toBeUndefined();
    expect(patient?.name?.given).toBeUndefined();
    expect(patient?.birthTime?.raw).toBe("1990");
    expect(
      manifest.find((m) => m.locus === "recordTarget/patientRole/patient/birthTime")?.code,
    ).toBe(D.DEID_RESIDUAL_RETAINED);
  });

  it("generalizes the patient address to the safe 3-digit ZIP and drops street/city/county (state kept)", () => {
    const { wire } = deid("ccd");
    expect(wire).toContain("<postalCode>902</postalCode>");
    expect(wire).toContain("<state>MA</state>"); // state is permitted, retained
    expect(wire).not.toContain("<streetAddressLine>");
    expect(wire).not.toContain("<city>");
    expect(wire).not.toContain("<county>");
  });

  it("fully suppresses a restricted-prefix ZIP (guardian 03601) to 000", () => {
    const { wire, manifest } = deid("ccd");
    expect(wire).toContain("<postalCode>000</postalCode>");
    expect(manifest.find((m) => m.locus.includes("guardian/addr"))?.code).toBe(
      D.DEID_CATEGORY_GENERALIZED,
    );
  });

  it("generalizes header participation + encounter dates to their year", () => {
    const { manifest } = deid("ccd");
    const dateLoci = manifest.filter((m) => m.category === C.DATES);
    // document effectiveTime, author time, encounter low/high, patient birthTime — all generalized.
    expect(dateLoci.length).toBeGreaterThanOrEqual(4);
    expect(dateLoci.every((m) => m.transform === "generalize")).toBe(true);
  });
});

describe("deidentifyCcda — fail closed on narrative and unknown structure", () => {
  it("blocks section narrative <text> by default (no naive scrub)", () => {
    const { manifest } = deid("ccd");
    const narrative = manifest.filter((m) => m.code === D.DEID_FREETEXT_BLOCKED);
    expect(narrative.length).toBeGreaterThan(0);
    expect(narrative.every((m) => m.locus.endsWith("text"))).toBe(true);
  });

  it("fails closed on an unknown vendor element whose name ends in 'Code' (positive allow-list)", () => {
    // A blocklist (`endsWith('Code')`) would silently retain this; the allow-list blocks it.
    const xml = `<?xml version="1.0"?><ClinicalDocument xmlns="urn:hl7-org:v3">
      <recordTarget><patientRole><patient>
        <customPatientCode>ZZUNKNOWNCODEPHI</customPatientCode>
      </patient></patientRole></recordTarget></ClinicalDocument>`;
    const { document, manifest } = deidentifyCcda(parseCcda(xml), { context: ctx });
    expect(document.toString()).not.toContain("ZZUNKNOWNCODEPHI");
    expect(manifest.some((m) => m.code === D.DEID_LOCUS_BLOCKED)).toBe(true);
  });

  it("blocks free text nested inside a recognized code element (<originalText>) and a name under a *Code", () => {
    const xml = `<?xml version="1.0"?><ClinicalDocument xmlns="urn:hl7-org:v3">
      <author><assignedAuthor>
        <code code="207Q00000X"><originalText>Dr ZZORIGTEXTPHI, 123 Sentinel St</originalText></code>
        <assignedPerson><name><family>ZZAUTHORFAM</family></name></assignedPerson>
      </assignedAuthor></author>
      <recordTarget><patientRole><patient>
        <maritalStatusCode code="M"><name><family>ZZNAMEUNDERCODE</family></name></maritalStatusCode>
      </patient></patientRole></recordTarget></ClinicalDocument>`;
    const { document } = deidentifyCcda(parseCcda(xml), { context: ctx });
    const wire = document.toString();
    expect(wire).not.toContain("ZZORIGTEXTPHI"); // free text inside a retained <code> blocked
    expect(wire).not.toContain("ZZAUTHORFAM"); // author name redacted
    expect(wire).not.toContain("ZZNAMEUNDERCODE"); // name nested under a retained *Code redacted
    expect(wire).toContain('code="207Q00000X"'); // the code value itself is retained
  });

  it("blocks stray direct text on a recognized coded element while retaining its code attribute", () => {
    // Schema-invalid (a CD/CE carries no direct text), but the fail-closed guarantee must be uniform.
    const xml = `<?xml version="1.0"?><ClinicalDocument xmlns="urn:hl7-org:v3">
      <recordTarget><patientRole><patient>
        <administrativeGenderCode code="F">ZZGENDERTEXT John Smith</administrativeGenderCode>
      </patient></patientRole></recordTarget></ClinicalDocument>`;
    const { document, manifest } = deidentifyCcda(parseCcda(xml), { context: ctx });
    const wire = document.toString();
    expect(wire).not.toContain("ZZGENDERTEXT"); // stray direct text blocked
    expect(wire).toContain('code="F"'); // the coded attribute retained
    expect(manifest.some((m) => m.code === D.DEID_LOCUS_BLOCKED)).toBe(true);
  });

  it("blocks entry-level narrative <text> too (inline PHI in an entry never rides through)", () => {
    const xml = `<?xml version="1.0"?><ClinicalDocument xmlns="urn:hl7-org:v3">
      <component><structuredBody><component><section>
        <code code="30954-2"/><title>Results</title>
        <entry><observation>
          <code code="2951-2"/><statusCode code="completed"/>
          <text>Inline note naming ZZENTRYPHI for the patient</text>
          <value value="140" unit="mmol/L"/>
        </observation></entry>
      </section></component></structuredBody></component></ClinicalDocument>`;
    const { document, manifest } = deidentifyCcda(parseCcda(xml), { context: ctx });
    const wire = document.toString();
    expect(wire).not.toContain("ZZENTRYPHI"); // entry-level narrative blocked
    expect(wire).toContain('value="140"'); // coded clinical value survives
    expect(wire).toContain("2951-2"); // code survives
    expect(manifest.some((m) => m.code === D.DEID_FREETEXT_BLOCKED)).toBe(true);
  });

  it("blocks a known-but-unmapped element and a foreign/sdtc element carrying a value", () => {
    const { wire, manifest } = deid("ccd");
    // The vendor `<vendorNote>` (v3, unmapped) and `<sdtc:patientID>` (foreign namespace) both fail closed.
    expect(wire).not.toContain("ZZVENDORLEAK");
    expect(wire).not.toContain("ZZSDTCLEAK");
    expect(manifest.filter((m) => m.code === D.DEID_LOCUS_BLOCKED).length).toBeGreaterThan(0);
  });

  it("fails closed on an address with no generalizable ZIP (whole address dropped)", () => {
    const xml = `<?xml version="1.0"?><ClinicalDocument xmlns="urn:hl7-org:v3">
      <recordTarget><patientRole>
        <addr><streetAddressLine>ZZNOZIP</streetAddressLine><city>ZZNOZIPCITY</city></addr>
      </patientRole></recordTarget></ClinicalDocument>`;
    const { document, manifest } = deidentifyCcda(parseCcda(xml), { context: ctx });
    const wire = document.toString();
    expect(wire).not.toContain("ZZNOZIP");
    expect(manifest.find((m) => m.locus.includes("addr"))?.disposition).toBe("blocked");
  });

  it("pseudonymizes a root-only person-role id (no extension)", () => {
    const xml = `<?xml version="1.0"?><ClinicalDocument xmlns="urn:hl7-org:v3">
      <recordTarget><patientRole>
        <id root="ZZROOTONLYID"/>
      </patientRole></recordTarget></ClinicalDocument>`;
    const { document } = deidentifyCcda(parseCcda(xml), { context: ctx });
    const id = document.getPatient()?.identifiers[0];
    expect(id?.root).toMatch(/^[0-9a-f]{64}$/); // the root itself was the value → pseudonymized
    expect(document.toString()).not.toContain("ZZROOTONLYID");
  });

  it("does not generalize a dosing-period (PIVL_TS) effectiveTime that sits at a header participation", () => {
    // Defensive: a PIVL period is a duration, not a calendar date — it must never be treated as a date.
    const xml = `<?xml version="1.0"?><ClinicalDocument xmlns="urn:hl7-org:v3" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
      <documentationOf><serviceEvent>
        <effectiveTime xsi:type="PIVL_TS"><period value="8" unit="h"/></effectiveTime>
      </serviceEvent></documentationOf>
      <componentOf><encompassingEncounter>
        <effectiveTime xsi:type="IVL_TS" value="20210708"/>
      </encompassingEncounter></componentOf></ClinicalDocument>`;
    const { document, manifest } = deidentifyCcda(parseCcda(xml), { context: ctx });
    const wire = document.toString();
    expect(wire).toContain('value="8"'); // PIVL dosing period untouched
    expect(wire).not.toContain("20210708"); // explicit IVL_TS calendar date generalized
    expect(wire).toContain('value="2021"');
    // exactly one DATES action: the IVL_TS date, never the PIVL period.
    expect(manifest.filter((m) => m.category === C.DATES).length).toBe(1);
  });

  it("fails closed on a top-level foreign-namespace element carrying a value", () => {
    const xml = `<?xml version="1.0"?><ClinicalDocument xmlns="urn:hl7-org:v3" xmlns:vnd="urn:vendor:x">
      <vnd:extra>ZZTOPLEVELVENDOR</vnd:extra>
      <recordTarget><patientRole><patient><name><family>ZZFAM</family></name></patient></patientRole></recordTarget>
    </ClinicalDocument>`;
    const { document, manifest } = deidentifyCcda(parseCcda(xml), { context: ctx });
    expect(document.toString()).not.toContain("ZZTOPLEVELVENDOR");
    expect(manifest.some((m) => m.code === D.DEID_LOCUS_BLOCKED)).toBe(true);
  });

  it("blocks narrative in a nested subsection, and generalizes a date center value", () => {
    const xml = `<?xml version="1.0"?><ClinicalDocument xmlns="urn:hl7-org:v3">
      <documentationOf><serviceEvent><effectiveTime><center value="20200606"/></effectiveTime></serviceEvent></documentationOf>
      <component><structuredBody><component><section>
        <text>ZZOUTERNARR</text>
        <component><section><text>ZZSUBNARR</text></section></component>
      </section></component></structuredBody></component>
    </ClinicalDocument>`;
    const { document } = deidentifyCcda(parseCcda(xml), { context: ctx });
    const wire = document.toString();
    expect(wire).not.toContain("ZZOUTERNARR");
    expect(wire).not.toContain("ZZSUBNARR");
    expect(wire).toContain('value="2020"'); // center date generalized to year
  });

  it("redacts a root-only SSN-rooted id (no extension) by dropping the root value", () => {
    const xml = `<?xml version="1.0"?><ClinicalDocument xmlns="urn:hl7-org:v3">
      <recordTarget><patientRole><id root="2.16.840.1.113883.4.1"/></patientRole></recordTarget>
    </ClinicalDocument>`;
    const { document, manifest } = deidentifyCcda(parseCcda(xml), { context: ctx });
    expect(document.getPatient()?.identifiers[0]?.root).toBeUndefined(); // SSN root value dropped
    expect(manifest.find((m) => m.locus.includes("id"))?.category).toBe(C.SSN);
  });

  it("fails closed on an address whose ZIP has no readable prefix (whole postalCode dropped)", () => {
    const xml = `<?xml version="1.0"?><ClinicalDocument xmlns="urn:hl7-org:v3">
      <recordTarget><patientRole><addr><postalCode>AB</postalCode><city>ZZBADZIPCITY</city></addr></patientRole></recordTarget>
    </ClinicalDocument>`;
    const { document, manifest } = deidentifyCcda(parseCcda(xml), { context: ctx });
    const wire = document.toString();
    expect(wire).not.toContain("ZZBADZIPCITY");
    expect(wire).not.toContain("<postalCode>");
    expect(manifest.find((m) => m.locus.includes("addr"))?.disposition).toBe("blocked");
  });

  it("blocks the unstructured nonXMLBody text (fail closed on opaque content)", () => {
    const xml = `<?xml version="1.0"?><ClinicalDocument xmlns="urn:hl7-org:v3">
      <component><nonXMLBody><text mediaType="text/plain">ZZOPAQUEPHI base64-ish blob</text></nonXMLBody></component>
    </ClinicalDocument>`;
    const { document, manifest } = deidentifyCcda(parseCcda(xml), { context: ctx });
    expect(document.toString()).not.toContain("ZZOPAQUEPHI");
    expect(manifest.some((m) => m.code === D.DEID_FREETEXT_BLOCKED)).toBe(true);
  });
});

describe("deidentifyCcda — fatal + policy + immutability", () => {
  it("throws DEID_NO_KEY when a keyed transform is needed but no context is supplied", () => {
    expect(() => deidentifyCcda(parseCcda(loadFixture("ccd")), {})).toThrowError(
      expect.objectContaining({ code: FATAL_CODES.DEID_NO_KEY }),
    );
  });

  it("date-shifts under an Expert-Determination policy instead of generalizing", () => {
    const shift = defineDeidPolicy({ name: "research", transforms: { [C.DATES]: "date-shift" } });
    const { document, manifest } = deidentifyCcda(parseCcda(loadFixture("ccd")), {
      policy: shift,
      context: ctx,
    });
    const birth = document.getPatient()?.birthTime?.raw ?? "";
    expect(birth).not.toBe("19900215"); // actually shifted
    expect(birth).not.toBe("1990"); // not generalized — a full shifted date
    expect(birth).toMatch(/^\d{8}/);
    expect(manifest.find((m) => m.locus.endsWith("birthTime"))?.code).toBe(
      D.DEID_CATEGORY_DATE_SHIFTED,
    );
  });

  it("never mutates the input document", () => {
    const doc = parseCcda(loadFixture("ccd"));
    const before = doc.toString();
    deidentifyCcda(doc, { context: ctx });
    expect(doc.toString()).toBe(before);
    expect(doc.getPatient()?.name?.family).toBe("ZZPATFAMILY"); // original still intact
  });

  it("returns an empty manifest for a document with no PHI loci", () => {
    const xml = `<?xml version="1.0"?><ClinicalDocument xmlns="urn:hl7-org:v3">
      <templateId root="2.16.840.1.113883.10.20.22.1.1"/>
      <code code="34133-9" codeSystem="2.16.840.1.113883.6.1"/>
      <title>Empty</title>
    </ClinicalDocument>`;
    const { manifest } = deidentifyCcda(parseCcda(xml), { context: ctx });
    expect(manifest).toEqual([]);
  });

  it("emits only value-free manifest entries (never a value, key, or offset)", () => {
    const { manifest } = deid("ccd");
    for (const entry of manifest) {
      const blob = JSON.stringify(entry);
      for (const sentinel of CCD_SENTINELS) expect(blob).not.toContain(sentinel);
      expect(entry.locus).not.toMatch(/[0-9a-f]{64}/); // no surrogate/key hex leaks into the locus
    }
  });
});
