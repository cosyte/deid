/**
 * A **birth year that shows an age over 89** is aggregated, not kept. §164.514(b)(2)(i)(C) lets a
 * date keep its year, except that "all elements of dates (including year) indicative of such age"
 * over 89 are aggregated into a single category of age 90 or older. Under a policy that generalizes
 * dates, a date of birth whose year is 90 or more years before the year of the call is therefore
 * **removed**, and the manifest records that as `DEID_CATEGORY_GENERALIZED`, never as a residual.
 *
 * One case per adapter: HL7 v2 `PID-7` (and the guarantor `GT1-8` and insured `IN1-18`), C-CDA
 * `birthTime`, FHIR `birthDate`, X12 `DMG-02`, NCPDP `304-C4`, and DICOM `(0010,0030)`. Each has a
 * control born well under 90 whose year survives exactly as before.
 *
 * Every value is synthetic: `ZZ`-tagged names, a 1920 birth year for the over-89 person and a 1990
 * one for the control, inputs built in code from the shapes of the repository's synthetic fixtures.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";
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
import { deidentifyDicom } from "../src/dicom/index.js";
import { deidentifyFhirJson } from "../src/fhir/index.js";
import { deidentifyHl7 } from "../src/hl7/index.js";
import { deidentifyTelecomString } from "../src/ncpdp/index.js";
import { deidentifyX12String } from "../src/x12/index.js";
import { buildPhiDataset } from "./dicom/helpers/fixtures.js";

const C = SAFE_HARBOR_CATEGORIES;
const D = DEID_DISPOSITION_CODES;
const FIX = (fmt: string, file: string): string =>
  readFileSync(join(import.meta.dirname, "fixtures", fmt, file), "utf8");

const ctx = createDeidContext({ key: "birth-year-test-key-synthetic-key", patientId: "p-90" });

/** The manifest rows at one locus. */
function at(manifest: readonly DeidManifestEntry[], locus: string): DeidManifestEntry[] {
  return manifest.filter((m) => m.locus === locus);
}

/** Assert the one row at `locus` records an aggregated birth year, not a kept one. */
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

/** Assert the one row at `locus` records a kept year, the residual it always was. */
function expectYearKept(manifest: readonly DeidManifestEntry[], locus: string): void {
  const rows = at(manifest, locus);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    category: C.DATES,
    transform: "generalize",
    disposition: "transformed",
    code: D.DEID_RESIDUAL_RETAINED,
  });
}

describe("the core: a date of birth whose year shows an age over 89", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  const dob = (value: string): GenericLocus => ({
    path: "DOB",
    kind: "date",
    category: C.DATES,
    dateOfBirth: true,
    value,
  });

  it("removes the year 90 years before the year of the call, and keeps the one 89 years before", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const out = deidentify({ loci: [dob("19360101"), dob("1937-12-31")] }, {});
    expect(out.document.loci.map((l) => [l.value, l.disposition])).toEqual([
      [null, "removed"],
      ["1937", "transformed"],
    ]);
    expect(out.manifest.map((m) => [m.disposition, m.code])).toEqual([
      ["removed", D.DEID_CATEGORY_GENERALIZED],
      ["transformed", D.DEID_RESIDUAL_RETAINED],
    ]);
  });

  it("reads the reference year when the call runs, not when the module loaded", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2027-06-30T12:00:00Z"));
    const out = deidentify({ loci: [dob("19370615")] }, {});
    expect(out.document.loci[0]?.value).toBeNull();
  });

  it("leaves a date that is not marked as a date of birth at its year, however old", () => {
    const out = deidentify({ loci: [{ ...dob("19000101"), dateOfBirth: false }] }, {});
    expect(out.document.loci[0]?.value).toBe("1900");
    expect(out.manifest[0]?.code).toBe(D.DEID_RESIDUAL_RETAINED);
  });

  it("blocks a date of birth with no readable year, exactly as before", () => {
    const out = deidentify({ loci: [dob("not-a-date")] }, {});
    expect(out.document.loci[0]?.disposition).toBe("blocked");
    expect(out.manifest[0]?.code).toBe(D.DEID_LOCUS_BLOCKED);
  });

  it("does not apply under a policy that shifts dates: the rule is part of the year generalization", () => {
    const shift = defineDeidPolicy({ name: "research", transforms: { [C.DATES]: "date-shift" } });
    const out = deidentify({ loci: [dob("19200215")] }, { policy: shift, context: ctx });
    expect(out.document.loci[0]?.value).toMatch(/^19\d{6}$/);
    expect(out.manifest[0]?.code).toBe(D.DEID_CATEGORY_DATE_SHIFTED);
  });
});

/** Field `n` of the first segment named `name` in an HL7 v2 wire (not MSH, which is offset by one). */
function field(wire: string, name: string, n: number): string | undefined {
  return wire
    .split("\r")
    .find((line) => line.startsWith(`${name}|`))
    ?.split("|")[n];
}

describe("HL7 v2: PID-7, GT1-8 and IN1-18", () => {
  const wire = (pid7: string): string =>
    FIX("hl7", "adt-a01.hl7")
      .trim()
      .split(/\r?\n/)
      .join("\r")
      .replace("|19900215|", `|${pid7}|`)
      .replace("|19850302|", `|${pid7}|`)
      .replace("|19850303|", `|${pid7}|`);

  it("removes a birth year over 89 and records it as generalized", () => {
    const { hl7, manifest } = deidentifyHl7(parseHL7(wire("19200215")), { context: ctx });
    expect(hl7).not.toContain("1920");
    expect(field(hl7, "PID", 7)).toBe("");
    expect(field(hl7, "GT1", 8)).toBe("");
    expect(field(hl7, "IN1", 18)).toBe("");
    expectAggregated(manifest, "PID-7");
    expectAggregated(manifest, "GT1-8");
    expectAggregated(manifest, "IN1-18");
  });

  it("keeps the year of a birth date under 90", () => {
    const { hl7, manifest } = deidentifyHl7(parseHL7(wire("19900215")), { context: ctx });
    expect(field(hl7, "PID", 7)).toBe("1990");
    expectYearKept(manifest, "PID-7");
  });

  it("keeps the year of a death date, which is not a date of birth", () => {
    const raw = wire("19900215").replace("|20211130", "|19200101");
    const { hl7 } = deidentifyHl7(parseHL7(raw), { context: ctx });
    expect(field(hl7, "PID", 29)).toBe("1920");
  });
});

describe("C-CDA: the patient birthTime", () => {
  const xml = (value: string): string =>
    FIX("ccda", "ccd.xml").replace(
      '<birthTime value="19900215"/>',
      `<birthTime value="${value}"/>`,
    );

  it("removes a birth year over 89 and records it as generalized", () => {
    const { document, manifest } = deidentifyCcda(parseCcda(xml("19200215")), { context: ctx });
    const out = document.toString();
    expect(out).not.toContain("1920");
    expect(out).toContain('<birthTime nullFlavor="MSK"/>');
    const locus = manifest.find((m) => m.locus.endsWith("/patient/birthTime"))?.locus ?? "";
    expectAggregated(manifest, locus);
  });

  it("removes an over-89 bound of a birthTime given as an interval, and keeps an under-90 one", () => {
    const interval = FIX("ccda", "ccd.xml").replace(
      '<birthTime value="19900215"/>',
      '<birthTime><low value="19200101"/><high value="19900101"/></birthTime>',
    );
    const { document, manifest } = deidentifyCcda(parseCcda(interval), { context: ctx });
    const out = document.toString();
    expect(out).not.toContain("1920");
    expect(out).toContain('<high value="1990"/>');
    const low = manifest.find((m) => m.locus.endsWith("/patient/birthTime/low"))?.locus ?? "";
    const high = manifest.find((m) => m.locus.endsWith("/patient/birthTime/high"))?.locus ?? "";
    expectAggregated(manifest, low);
    expectYearKept(manifest, high);
  });

  it("keeps the year of a birth date under 90", () => {
    const { document, manifest } = deidentifyCcda(parseCcda(xml("19900215")), { context: ctx });
    expect(document.toString()).toContain('<birthTime value="1990"/>');
    const locus = manifest.find((m) => m.locus.endsWith("/patient/birthTime"))?.locus ?? "";
    expectYearKept(manifest, locus);
  });
});

describe("FHIR R4: Patient.birthDate", () => {
  const patient = (birthDate: string): string =>
    JSON.stringify({ resourceType: "Patient", gender: "female", birthDate });

  it("removes a birth year over 89 and records it as generalized", () => {
    const { json, manifest } = deidentifyFhirJson(patient("1920-02-15"), { context: ctx });
    expect(json).toBe('{"resourceType":"Patient","gender":"female"}');
    expectAggregated(manifest, "Patient.birthDate");
  });

  it("removes a year-only birth date over 89 as well, and records a year-only one under 90", () => {
    const over = deidentifyFhirJson(patient("1920"), { context: ctx });
    expect(over.json).not.toContain("1920");
    expectAggregated(over.manifest, "Patient.birthDate");
    const under = deidentifyFhirJson(patient("1990"), { context: ctx });
    expect(under.json).toContain('"birthDate":"1990"');
    expectYearKept(under.manifest, "Patient.birthDate");
  });

  it("still keeps a four-digit string at an element that is not a birth date by name", () => {
    // A code, not `language`: a person resource now keeps a top-level string only when it is a code
    // the pass can check, and `1920` is no language tag, so it is removed there for that reason.
    const { json } = deidentifyFhirJson(
      JSON.stringify({
        resourceType: "Patient",
        gender: "female",
        maritalStatus: { coding: [{ system: "http://example.org/cs", code: "1920" }] },
      }),
      { context: ctx },
    );
    expect(json).toContain('"code":"1920"');
  });

  it("keeps the year of a birth date under 90", () => {
    const { json, manifest } = deidentifyFhirJson(patient("1990-02-15"), { context: ctx });
    expect(json).toBe('{"resourceType":"Patient","gender":"female","birthDate":"1990"}');
    expectYearKept(manifest, "Patient.birthDate");
  });
});

describe("X12: DMG-02", () => {
  const edi = (dob: string): string =>
    FIX("x12", "837p.edi").replace("DMG*D8*19850302*M~", `DMG*D8*${dob}*M~`);

  it("removes a birth year over 89 and records it as generalized", () => {
    const { x12, manifest } = deidentifyX12String(edi("19200302"), { context: ctx });
    expect(x12).not.toContain("1920");
    expect(x12).toContain("DMG*D8**M~");
    expectAggregated(manifest, "837/DMG[0]-2");
    // The second member's birth date, under 90, keeps its year beside it.
    expectYearKept(manifest, "837/DMG[1]-2");
  });

  it("keeps the year of a birth date under 90", () => {
    const { x12, manifest } = deidentifyX12String(edi("19900302"), { context: ctx });
    expect(x12).toContain("DMG*D8*1990*M~");
    expectYearKept(manifest, "837/DMG[0]-2");
  });
});

describe("NCPDP Telecom: 304-C4", () => {
  const raw = (dob: string): string =>
    FIX("ncpdp", "telecom-b1.ncpdp").replace("C419850302", `C4${dob}`);

  it("removes a birth year over 89 and records it as generalized", () => {
    const { telecom, manifest } = deidentifyTelecomString(raw("19200302"), { context: ctx });
    expect(telecom).not.toContain("C41920");
    expectAggregated(manifest, "01/C4");
  });

  it("keeps the year of a birth date under 90", () => {
    const { telecom, manifest } = deidentifyTelecomString(raw("19900302"), { context: ctx });
    expect(telecom).toContain("C41990");
    expectYearKept(manifest, "01/C4");
  });
});

describe("DICOM: (0010,0030) Patient's Birth Date", () => {
  it("empties the birth date whole for everyone, so no year is ever kept to aggregate", () => {
    // The delegated PS3.15 Annex E Basic Profile replaces Patient's Birth Date with a zero-length
    // value, and the adapter applies no option that keeps it, so a birth year over 89 never survives.
    // The fixture's birth date is 1900.
    const { dataset, manifest } = deidentifyDicom(buildPhiDataset());
    expect(dataset.get("00100030")?.rawBytes.toString("latin1").trim()).toBe("");
    const rows = at(manifest, "(0010,0030) Patient's Birth Date");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ disposition: "removed", code: D.DEID_CATEGORY_REMOVED });
  });
});
