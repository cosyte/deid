/**
 * **Ages over 89 held as a value, and birth dates and other positions the locus maps missed.**
 *
 * §164.514(b)(2)(i)(C) aggregates "all ages over 89 and all elements of dates (including year)
 * indicative of such age" into a single category of age 90 or older. A date of birth already loses
 * a year that shows such an age (`birth-year-over-89.test.ts`). This file covers the rest:
 *
 * - An **age written as a number**: an HL7 v2 OBX age, a FHIR `Age` or an age-coded
 *   `Observation.valueQuantity`, and a C-CDA age observation. Over 89 the number is removed and
 *   recorded as generalized; 89 and under it is kept exactly as written and recorded as a residual.
 * - **Birth dates no adapter marked**: HL7 v2 `NK1-16`, an OBX date result coded as a birth date, a
 *   relative's `birthTime` in a C-CDA family history, and FHIR `FamilyMemberHistory.born[x]`.
 * - **Positions the maps missed**: HL7 v2 `NK1-12`, `NK1-13`, the v2.7 telecom fields `PID-40`,
 *   `NK1-40` and `NK1-41`, and FHIR `Location.position` on a Location that may be a residence.
 *
 * Every value is synthetic: `ZZ`-tagged names and identifiers, a 1920 birth year and an age of 93
 * for the person over 89, and a 1990 birth year and an age of 45 for the control. Inputs are built
 * in code from the shapes of the repository's synthetic fixtures.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import { parseCcda } from "@cosyte/ccda";
import { parseHL7 } from "@cosyte/hl7";

import {
  DEID_DISPOSITION_CODES,
  SAFE_HARBOR_CATEGORIES,
  createDeidContext,
  defineDeidPolicy,
  deidentify,
  type DeidManifestEntry,
  type GenericLocus,
} from "../src/index.js";
import { deidentifyCcda } from "../src/ccda/index.js";
import { deidentifyFhirJson } from "../src/fhir/index.js";
import { deidentifyHl7 } from "../src/hl7/index.js";

const C = SAFE_HARBOR_CATEGORIES;
const D = DEID_DISPOSITION_CODES;
const FIX = (fmt: string, file: string): string =>
  readFileSync(join(import.meta.dirname, "fixtures", fmt, file), "utf8");

const ctx = createDeidContext({ key: "ages-over-89-test-key-synthetic", patientId: "p-93" });

/** The manifest rows at one locus. */
function at(manifest: readonly DeidManifestEntry[], locus: string): DeidManifestEntry[] {
  return manifest.filter((m) => m.locus === locus);
}

/** Assert the one row at `locus` records an aggregated age or birth year: removed, generalized. */
function expectAggregated(manifest: readonly DeidManifestEntry[], locus: string): void {
  const rows = at(manifest, locus);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    category: C.DATES,
    transform: "generalize",
    disposition: "removed",
    code: D.DEID_CATEGORY_GENERALIZED,
  });
}

/** Assert the one row at `locus` records a kept age or year: the residual it is. */
function expectKept(manifest: readonly DeidManifestEntry[], locus: string): void {
  const rows = at(manifest, locus);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    category: C.DATES,
    transform: "generalize",
    disposition: "transformed",
    code: D.DEID_RESIDUAL_RETAINED,
  });
}

describe("the core: an age held as a number", () => {
  const age = (value: string, ageUnit: string): GenericLocus => ({
    // Each age at its own path: two loci at one path share a manifest row.
    path: `AGE ${value} ${ageUnit}`,
    kind: "age",
    category: C.DATES,
    ageUnit,
    value,
  });

  it("removes an age over 89 and keeps one of 89 exactly as written", () => {
    const out = deidentify({ loci: [age("93", "a"), age("89", "a"), age("45.5", "a")] }, {});
    expect(out.document.loci.map((l) => [l.value, l.disposition])).toEqual([
      [null, "removed"],
      ["89", "transformed"],
      ["45.5", "transformed"],
    ]);
    expect(out.manifest.map((m) => [m.disposition, m.code])).toEqual([
      ["removed", D.DEID_CATEGORY_GENERALIZED],
      ["transformed", D.DEID_RESIDUAL_RETAINED],
      ["transformed", D.DEID_RESIDUAL_RETAINED],
    ]);
  });

  it("reads the age in its unit: months, weeks and days, and a spelled-out year", () => {
    const out = deidentify(
      {
        loci: [
          age("1100", "mo"),
          age("18", "mo"),
          age("6", "wk"),
          age("33000", "d"),
          age("93", "years"),
        ],
      },
      {},
    );
    expect(out.document.loci.map((l) => l.value)).toEqual([null, "18", "6", null, null]);
  });

  it("blocks an age it cannot read: an unknown unit or a value that is not a number", () => {
    const out = deidentify({ loci: [age("93", "furlongs"), age("ninety", "a")] }, {});
    expect(out.document.loci.map((l) => l.disposition)).toEqual(["blocked", "blocked"]);
    expect(out.manifest.map((m) => m.code)).toEqual([D.DEID_LOCUS_BLOCKED, D.DEID_LOCUS_BLOCKED]);
  });

  it("keeps an age under a policy that shifts dates: a shift keeps intervals, and an age is one", () => {
    const shift = defineDeidPolicy({ name: "research", transforms: { [C.DATES]: "date-shift" } });
    const out = deidentify({ loci: [age("93", "a")] }, { policy: shift, context: ctx });
    expect(out.document.loci[0]).toMatchObject({ value: "93", disposition: "retained" });
    expect(out.manifest[0]).toMatchObject({
      transform: "date-shift",
      disposition: "retained",
      code: D.DEID_RESIDUAL_RETAINED,
    });
  });

  it("leaves an age locus with no unit to the existing 90+ generalization", () => {
    const out = deidentify(
      { loci: [{ path: "AGE", kind: "age", category: C.DATES, value: "92" }] },
      {},
    );
    expect(out.document.loci[0]?.value).toBe("90+");
  });
});

/** The line of an HL7 v2 wire that starts with `prefix`, split into fields. */
function fields(wire: string, prefix: string): string[] {
  return (
    wire
      .split("\r")
      .find((l) => l.startsWith(prefix))
      ?.split("|") ?? []
  );
}

/** The synthetic ORU, with extra segments appended. */
const oru = (...lines: string[]): string =>
  [...FIX("hl7", "oru-r01.hl7").trim().split(/\r?\n/), ...lines].join("\r");

/** The synthetic ADT, its NK1 replaced by `nk1`. */
const adt = (nk1: string): string =>
  FIX("hl7", "adt-a01.hl7")
    .trim()
    .split(/\r?\n/)
    .map((l) => (l.startsWith("NK1|") ? nk1 : l))
    .join("\r");

describe("HL7 v2: an OBX age and an OBX birth date", () => {
  it("removes an NM age over 89 and records it, and keeps one under 90", () => {
    const { hl7, manifest } = deidentifyHl7(
      parseHL7(
        oru(
          "OBX|6|NM|30525-0^Age^LN|1|93|a^year^UCUM|||||F",
          "OBX|7|NM|21612-7^Age - Reported^LN|1|45|a^year^UCUM|||||F",
        ),
      ),
      { context: ctx },
    );
    expect(fields(hl7, "OBX|6|")[5]).toBe("");
    expect(fields(hl7, "OBX|6|")[6]).toBe("a^year^UCUM");
    expectAggregated(manifest, "OBX[5]-5");
    expect(fields(hl7, "OBX|7|")[5]).toBe("45");
    expectKept(manifest, "OBX[6]-5");
  });

  it("reads an age in months by its unit", () => {
    const { hl7 } = deidentifyHl7(parseHL7(oru("OBX|6|NM|30525-0^Age^LN|1|1100|mo|||||F")), {
      context: ctx,
    });
    expect(fields(hl7, "OBX|6|")[5]).toBe("");
  });

  it("leaves a numeric result that is not an age untouched, however large", () => {
    const { hl7, manifest } = deidentifyHl7(
      parseHL7(oru("OBX|6|NM|2951-2^Sodium^LN|1|140|mmol/L|||||F")),
      { context: ctx },
    );
    expect(fields(hl7, "OBX|6|")[5]).toBe("140");
    expect(at(manifest, "OBX[5]-5")).toHaveLength(0);
  });

  it("treats a date result coded as a birth date as one", () => {
    const over = deidentifyHl7(parseHL7(oru("OBX|6|DT|21112-8^Birth date^LN|1|19200301||||||F")), {
      context: ctx,
    });
    expect(over.hl7).not.toContain("1920");
    expectAggregated(over.manifest, "OBX[5]-5[0]");
    const under = deidentifyHl7(parseHL7(oru("OBX|6|DT|21112-8^Birth date^LN|1|19900301||||||F")), {
      context: ctx,
    });
    expect(fields(under.hl7, "OBX|6|")[5]).toBe("1990");
  });
});

describe("HL7 v2: NK1-16 and the NK1 and PID positions the map missed", () => {
  const nk1 = (dob: string): string => {
    const f = ["NK1", "1", "ZZNKFAMILY^ZZNKGIVEN", "SPO"];
    f[12] = "ZZNKEMPNO01^^^ZZEMPAUTH^EI";
    f[13] = "ZZNKORGNAME^^^^^^^^^ZZNKORGID";
    f[16] = dob;
    f[40] = "^PRN^PH^^1^555^0000041";
    f[41] = "^WPN^PH^^1^555^0000042";
    return Array.from(f, (v) => v ?? "").join("|");
  };

  it("removes a relative's birth year over 89 and keeps one under 90", () => {
    const over = deidentifyHl7(parseHL7(adt(nk1("19200301"))), { context: ctx });
    expect(fields(over.hl7, "NK1|")[16]).toBe("");
    expectAggregated(over.manifest, "NK1-16");
    const under = deidentifyHl7(parseHL7(adt(nk1("19900301"))), { context: ctx });
    expect(fields(under.hl7, "NK1|")[16]).toBe("1990");
    expectKept(under.manifest, "NK1-16");
  });

  it("removes and records the employee number, the organisation and the v2.7 telecoms", () => {
    const { hl7, manifest } = deidentifyHl7(parseHL7(adt(nk1("19900301"))), { context: ctx });
    for (const sentinel of ["ZZNKEMPNO01", "ZZNKORGNAME", "ZZNKORGID", "0000041", "0000042"]) {
      expect(hl7).not.toContain(sentinel);
    }
    expect(at(manifest, "NK1-12[0]")[0]).toMatchObject({ category: C.OTHER_UNIQUE_ID });
    expect(at(manifest, "NK1-13")[0]).toMatchObject({
      category: C.NAMES,
      disposition: "removed",
    });
    expect(at(manifest, "NK1-40")[0]).toMatchObject({ category: C.PHONE, disposition: "removed" });
    expect(at(manifest, "NK1-41")[0]).toMatchObject({ category: C.PHONE, disposition: "removed" });
    // The relationship code beside them is not an identifier and stays.
    expect(fields(hl7, "NK1|")[3]).toBe("SPO");
  });

  it("removes the v2.7 patient telecom, PID-40", () => {
    const raw = adt(nk1("19900301")).replace(
      /^(PID\|.*)$/m,
      (pid) => `${pid}${"|".repeat(40 - pid.split("|").length + 1)}^PRN^PH^^1^555^0000040`,
    );
    expect(fields(raw, "PID|")[40]).toBe("^PRN^PH^^1^555^0000040");
    const { hl7, manifest } = deidentifyHl7(parseHL7(raw), { context: ctx });
    expect(hl7).not.toContain("0000040");
    expect(at(manifest, "PID-40")[0]).toMatchObject({ category: C.PHONE, disposition: "removed" });
  });
});

/** Run one FHIR resource through the default pass. */
const fhir = (resource: object) => deidentifyFhirJson(JSON.stringify(resource), { context: ctx });

const LOINC = "http://loinc.org";
const UCUM = "http://unitsofmeasure.org";

describe("FHIR R4: an age held as a value", () => {
  const ageObservation = (value: number) => ({
    resourceType: "Observation",
    status: "final",
    code: { coding: [{ system: LOINC, code: "30525-0", display: "Age" }] },
    valueQuantity: { value, unit: "a", system: UCUM, code: "a" },
  });

  it("removes an age-coded valueQuantity over 89, and keeps one under 90 byte for byte", () => {
    const over = fhir(ageObservation(93));
    expect(JSON.parse(over.json)).toMatchObject({
      valueQuantity: { unit: "a", system: UCUM, code: "a" },
    });
    expect(over.json).not.toContain("93");
    expectAggregated(over.manifest, "Observation.valueQuantity.value");
    const under = fhir(ageObservation(45));
    expect(under.json).toBe(JSON.stringify(ageObservation(45)));
    expectKept(under.manifest, "Observation.valueQuantity.value");
  });

  it("reaches an age-coded component as well", () => {
    const { json, manifest } = fhir({
      resourceType: "Observation",
      status: "final",
      code: { coding: [{ system: LOINC, code: "2951-2" }] },
      component: [
        {
          code: { coding: [{ system: LOINC, code: "30525-0" }] },
          valueQuantity: { value: 93, unit: "a", system: UCUM, code: "a" },
        },
      ],
    });
    expect(json).not.toContain("93");
    expectAggregated(manifest, "Observation.component[0].valueQuantity.value");
  });

  it("reads an age code with no system, and a SNOMED CT one", () => {
    for (const coding of [
      { code: "30525-0" },
      { system: "http://snomed.info/sct", code: "397659008" },
    ]) {
      const { json } = fhir({
        resourceType: "Observation",
        status: "final",
        code: { coding: [coding] },
        valueQuantity: { value: 93, code: "a" },
      });
      expect(json).not.toContain("93");
    }
  });

  it("leaves a valueQuantity that is not coded as an age untouched", () => {
    const sodium = {
      resourceType: "Observation",
      status: "final",
      code: { coding: [{ system: LOINC, code: "2951-2" }] },
      valueQuantity: { value: 140, unit: "mmol/L", system: UCUM, code: "mmol/L" },
    };
    expect(fhir(sodium).json).toBe(JSON.stringify(sodium));
  });

  it("removes Condition.onsetAge over 89 and reads its unit", () => {
    const condition = (value: number, code: string) => ({
      resourceType: "Condition",
      onsetAge: { value, unit: code, system: UCUM, code },
    });
    const over = fhir(condition(93, "a"));
    expect(over.json).not.toContain("93");
    expectAggregated(over.manifest, "Condition.onsetAge.value");
    expect(fhir(condition(18, "mo")).json).toContain('"value":18');
  });

  it("removes FamilyMemberHistory.ageAge and deceasedAge over 89", () => {
    const { json, manifest } = fhir({
      resourceType: "FamilyMemberHistory",
      status: "completed",
      ageAge: { value: 93, unit: "a", system: UCUM, code: "a" },
      deceasedAge: { value: 97, unit: "a", system: UCUM, code: "a" },
    });
    expect(json).not.toMatch(/"value":9[37]/);
    expectAggregated(manifest, "FamilyMemberHistory.ageAge.value");
    expectAggregated(manifest, "FamilyMemberHistory.deceasedAge.value");
  });

  it("removes each bound of an age range over 89", () => {
    const { json, manifest } = fhir({
      resourceType: "FamilyMemberHistory",
      status: "completed",
      ageRange: {
        low: { value: 90, unit: "a", system: UCUM, code: "a" },
        high: { value: 95, unit: "a", system: UCUM, code: "a" },
      },
    });
    expect(json).not.toMatch(/"value":9[05]/);
    expectAggregated(manifest, "FamilyMemberHistory.ageRange.low.value");
    expectAggregated(manifest, "FamilyMemberHistory.ageRange.high.value");
  });
});

describe("FHIR R4: birth dates the pass did not mark", () => {
  it("removes FamilyMemberHistory.bornDate over 89, year-only included, and keeps one under 90", () => {
    const fmh = (bornDate: string) => ({
      resourceType: "FamilyMemberHistory",
      status: "completed",
      bornDate,
    });
    const over = fhir(fmh("1920-03-01"));
    expect(over.json).not.toContain("1920");
    expectAggregated(over.manifest, "FamilyMemberHistory.bornDate");
    expect(fhir(fmh("1920")).json).not.toContain("1920");
    expect(fhir(fmh("1990-03-01")).json).toContain('"bornDate":"1990"');
  });

  it("removes each bound of bornPeriod over 89 and reads bornString as a birth date", () => {
    const { json, manifest } = fhir({
      resourceType: "FamilyMemberHistory",
      status: "completed",
      bornPeriod: { start: "1920-01-01", end: "1990-12-31" },
    });
    expect(json).not.toContain("1920");
    expect(json).toContain('"end":"1990"');
    expectAggregated(manifest, "FamilyMemberHistory.bornPeriod.start");
    expectKept(manifest, "FamilyMemberHistory.bornPeriod.end");
    const startOnly = fhir({
      resourceType: "FamilyMemberHistory",
      status: "completed",
      bornPeriod: { start: "1920-01-01" },
    });
    expect(startOnly.json).not.toContain("1920");
    const born = fhir({
      resourceType: "FamilyMemberHistory",
      status: "completed",
      bornString: "1920",
    });
    expect(born.json).not.toContain("1920");
  });

  it("treats an Observation.valueDateTime coded as a birth date as one", () => {
    const { json, manifest } = fhir({
      resourceType: "Observation",
      status: "final",
      code: { coding: [{ system: LOINC, code: "21112-8", display: "Birth date" }] },
      valueDateTime: "1920-03-01",
    });
    expect(json).not.toContain("1920");
    expectAggregated(manifest, "Observation.valueDateTime");
  });
});

describe("FHIR R4: Location.position", () => {
  const location = (type?: string) => ({
    resourceType: "Location",
    status: "active",
    ...(type === undefined
      ? {}
      : {
          type: [
            {
              coding: [{ system: "http://terminology.hl7.org/CodeSystem/v3-RoleCode", code: type }],
            },
          ],
        }),
    position: { longitude: -71.0589, latitude: 42.3601 },
  });

  it("removes the position of a patient's residence and records it as geographic", () => {
    const { json, manifest } = fhir(location("PTRES"));
    expect(json).not.toContain("42.3601");
    expect(json).not.toContain("position");
    expect(at(manifest, "Location.position")[0]).toMatchObject({ category: C.GEOGRAPHIC });
  });

  it("removes the position of a Location with no type, which may be a residence", () => {
    expect(fhir(location()).json).not.toContain("42.3601");
  });

  it("keeps the position of a Location typed as a facility", () => {
    expect(fhir(location("HOSP")).json).toContain('"latitude":42.3601');
  });

  it("reads the physical type too: a house is removed, a building is kept", () => {
    const physical = (code: string) => ({
      resourceType: "Location",
      status: "active",
      physicalType: {
        coding: [{ system: "http://terminology.hl7.org/CodeSystem/location-physical-type", code }],
      },
      position: { longitude: -71.0589, latitude: 42.3601 },
    });
    expect(fhir(physical("ho")).json).not.toContain("42.3601");
    expect(fhir(physical("bu")).json).toContain('"latitude":42.3601');
  });

  it("removes a geolocation extension on a residence's address or on the Location itself", () => {
    const geolocation = {
      url: "http://hl7.org/fhir/StructureDefinition/geolocation",
      extension: [
        { url: "latitude", valueDecimal: 42.3601 },
        { url: "longitude", valueDecimal: -71.0589 },
      ],
    };
    const { json } = fhir({
      resourceType: "Location",
      status: "active",
      extension: [geolocation],
      address: { extension: [geolocation], state: "MA", postalCode: "02101" },
    });
    expect(json).not.toContain("42.3601");
    expect(json).not.toContain("71.0589");
  });
});

describe("C-CDA: a family history and an age observation", () => {
  const SNOMED = "2.16.840.1.113883.6.96";
  const ageObservation = (value: string): string =>
    `<entryRelationship typeCode="SUBJ" inversionInd="true"><observation classCode="OBS" moodCode="EVN">` +
    `<templateId root="2.16.840.1.113883.10.20.22.4.31"/>` +
    `<code code="445518008" codeSystem="${SNOMED}" displayName="Age At Onset"/>` +
    `<statusCode code="completed"/><value xsi:type="PQ" value="${value}" unit="a"/>` +
    `</observation></entryRelationship>`;
  const familyHistory = (birthTime: string, age: string): string =>
    `<component><section><templateId root="2.16.840.1.113883.10.20.22.2.15"/>` +
    `<code code="10157-6" codeSystem="2.16.840.1.113883.6.1" displayName="Family History"/>` +
    `<title>Family History</title><text>Family history for ZZNARRATIVEPHI.</text>` +
    `<entry><organizer classCode="CLUSTER" moodCode="EVN">` +
    `<statusCode code="completed"/>` +
    `<subject><relatedSubject classCode="PRS"><code code="FTH" codeSystem="2.16.840.1.113883.5.111"/>` +
    `<subject><administrativeGenderCode code="M" codeSystem="2.16.840.1.113883.5.1"/>` +
    `<birthTime value="${birthTime}"/></subject></relatedSubject></subject>` +
    `<component><observation classCode="OBS" moodCode="EVN">` +
    `<code code="64572001" codeSystem="${SNOMED}" displayName="Condition"/>` +
    `<statusCode code="completed"/>` +
    `<value xsi:type="CD" code="22298006" codeSystem="${SNOMED}" displayName="Myocardial infarction"/>` +
    ageObservation(age) +
    `</observation></component></organizer></entry></section></component>`;
  const xml = (birthTime: string, age: string): string =>
    FIX("ccda", "ccd.xml").replace(
      "</structuredBody>",
      `${familyHistory(birthTime, age)}</structuredBody>`,
    );

  it("removes a relative's birth year over 89 and writes a nullFlavor in its place", () => {
    const { document, manifest } = deidentifyCcda(parseCcda(xml("19200301", "45")), {
      context: ctx,
    });
    const out = document.toString();
    expect(out).not.toContain("1920");
    expect(out).toContain('<birthTime nullFlavor="MSK"/>');
    const locus = manifest.find((m) => m.locus.endsWith("relatedSubject/subject/birthTime"))?.locus;
    expectAggregated(manifest, locus ?? "");
  });

  it("keeps the year of a relative's birth date under 90", () => {
    const { document } = deidentifyCcda(parseCcda(xml("19900301", "45")), { context: ctx });
    expect(document.toString()).toContain('<birthTime value="1990"/>');
  });

  it("removes an age over 89 with a nullFlavor, and keeps one under 90", () => {
    const over = deidentifyCcda(parseCcda(xml("19900301", "93")), { context: ctx });
    const out = over.document.toString();
    expect(out).not.toContain('value="93"');
    expect(out).toContain('<value xsi:type="PQ" unit="a" nullFlavor="MSK"/>');
    const locus = over.manifest.find((m) => m.locus.endsWith("observation/value"))?.locus;
    expectAggregated(over.manifest, locus ?? "");
    const under = deidentifyCcda(parseCcda(xml("19900301", "45")), { context: ctx });
    expect(under.document.toString()).toContain('<value xsi:type="PQ" value="45" unit="a"/>');
  });

  it("writes a nullFlavor on the patient's removed birthTime too", () => {
    const raw = FIX("ccda", "ccd.xml").replace(
      '<birthTime value="19900215"/>',
      '<birthTime value="19200215"/>',
    );
    const { document } = deidentifyCcda(parseCcda(raw), { context: ctx });
    expect(document.toString()).toContain('<birthTime nullFlavor="MSK"/>');
  });

  it("leaves the clinical values of the family history untouched", () => {
    const { document } = deidentifyCcda(parseCcda(xml("19900301", "45")), { context: ctx });
    const out = document.toString();
    expect(out).toContain('code="22298006"');
    expect(out).toContain('code="FTH"');
    expect(out).toContain('<value xsi:type="PQ" value="140" unit="mmol/L"/>');
  });
});

describe("what the rules read, and the shapes they fail closed on", () => {
  it("HL7 v2: reads the alternate identifier, and leaves a local code that is not LOINC alone", () => {
    const alternate = deidentifyHl7(
      parseHL7(oru("OBX|6|NM|ZZAGE^Age^L^30525-0^Age^LN|1|93|a|||||F")),
      { context: ctx },
    );
    expect(fields(alternate.hl7, "OBX|6|")[5]).toBe("");
    const local = deidentifyHl7(parseHL7(oru("OBX|6|NM|30525-0^Age^L|1|93|a|||||F")), {
      context: ctx,
    });
    expect(fields(local.hl7, "OBX|6|")[5]).toBe("93");
    const snomed = deidentifyHl7(
      parseHL7(oru("OBX|6|NM|445518008^Age at onset^SCT|1|93|a|||||F")),
      {
        context: ctx,
      },
    );
    expect(fields(snomed.hl7, "OBX|6|")[5]).toBe("");
  });

  it("FHIR: blocks an age whose value is not a number, and keeps one written as a string", () => {
    const odd = fhir({ resourceType: "Condition", onsetAge: { value: { nested: 93 }, code: "a" } });
    expect(odd.json).not.toContain("93");
    const text = fhir({ resourceType: "Condition", onsetAge: { value: "45", unit: "years" } });
    expect(text.json).toContain('"value":"45"');
  });

  it("FHIR: drops an age a custom policy replaced with a surrogate, which a number cannot hold", () => {
    const hashed = defineDeidPolicy({ name: "ages-hashed", transforms: { [C.DATES]: "hash" } });
    const { json } = deidentifyFhirJson(
      JSON.stringify({ resourceType: "Condition", onsetAge: { value: 45, code: "a" } }),
      { policy: hashed, context: ctx },
    );
    expect(json).toBe('{"resourceType":"Condition","onsetAge":{"code":"a"}}');
  });

  it("FHIR: a range with one bound, and a quantity with no value, are read as they are", () => {
    const { json, manifest } = fhir({
      resourceType: "FamilyMemberHistory",
      status: "completed",
      ageRange: { low: { value: 91, code: "a" } },
      deceasedAge: { code: "a" },
    });
    expect(json).not.toContain("91");
    expect(json).toContain('"deceasedAge":{"code":"a"}');
    expect(at(manifest, "FamilyMemberHistory.deceasedAge.value")).toHaveLength(0);
  });

  it("FHIR: a Location type it cannot read fails closed, and a system it does not know keeps", () => {
    const position = { longitude: -71.0589, latitude: 42.3601 };
    // A type sent as a bare string, a coding sent as a bare string, and a coding with no code: none
    // of them says what the Location is, so each fails closed.
    for (const type of [
      "PTRES",
      [{ coding: "PTRES" }],
      [{ coding: [{ system: "http://x.example" }] }],
    ]) {
      expect(fhir({ resourceType: "Location", type, position }).json).not.toContain("42.3601");
    }
    const unstated = fhir({
      resourceType: "Location",
      type: [{ coding: [{ code: "PTRES" }] }],
      position,
    });
    expect(unstated.json).not.toContain("42.3601");
    const foreign = fhir({
      resourceType: "Location",
      type: [{ coding: [{ system: "http://example.org/zz-local", code: "PTRES" }] }],
      position,
    });
    expect(foreign.json).toContain('"latitude":42.3601');
    const building = fhir({
      resourceType: "Location",
      physicalType: { coding: { code: "bu" } },
      position,
    });
    expect(building.json).toContain('"latitude":42.3601');
  });

  it("C-CDA: reads each bound of an age range, and leaves a code in another system alone", () => {
    const body = (observation: string): string =>
      FIX("ccda", "ccd.xml").replace(
        "</structuredBody>",
        `<component><section><entry>${observation}</entry></section></component></structuredBody>`,
      );
    const range = deidentifyCcda(
      parseCcda(
        body(
          `<observation classCode="OBS" moodCode="EVN"><code code="30525-0" codeSystem="2.16.840.1.113883.6.1"/>` +
            `<value xsi:type="IVL_PQ"><low value="91" unit="a"/><high value="45" unit="a"/></value></observation>`,
        ),
      ),
      { context: ctx },
    );
    const out = range.document.toString();
    expect(out).toContain('<low unit="a" nullFlavor="MSK"/>');
    expect(out).toContain('<high value="45" unit="a"/>');
    const other = deidentifyCcda(
      parseCcda(
        body(
          `<observation classCode="OBS" moodCode="EVN"><code code="30525-0" codeSystem="2.16.840.1.113883.6.88"/>` +
            `<value xsi:type="PQ" value="93" unit="a"/></observation>`,
        ),
      ),
      { context: ctx },
    );
    expect(other.document.toString()).toContain('<value xsi:type="PQ" value="93" unit="a"/>');
    const unstated = deidentifyCcda(
      parseCcda(
        body(
          `<observation classCode="OBS" moodCode="EVN"><code code="445518008"/>` +
            `<value xsi:type="PQ" value="93"/></observation>`,
        ),
      ),
      { context: ctx },
    );
    expect(unstated.document.toString()).not.toContain('value="93"');
  });

  it("C-CDA: removes an age a custom policy replaced with a surrogate", () => {
    const hashed = defineDeidPolicy({ name: "ages-hashed", transforms: { [C.DATES]: "hash" } });
    const raw = FIX("ccda", "ccd.xml").replace(
      "</structuredBody>",
      `<component><section><entry><observation classCode="OBS" moodCode="EVN">` +
        `<code code="30525-0" codeSystem="2.16.840.1.113883.6.1"/>` +
        `<value xsi:type="PQ" value="45" unit="a"/></observation></entry></section></component></structuredBody>`,
    );
    const { document } = deidentifyCcda(parseCcda(raw), { policy: hashed, context: ctx });
    expect(document.toString()).toContain('<value xsi:type="PQ" unit="a" nullFlavor="MSK"/>');
  });
});
