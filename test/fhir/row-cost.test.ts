/**
 * What the rows for a dropped `_`-sibling extension cost on ordinary documents: how many manifest
 * rows each document gets, and how many of them name an extension the output does not carry. The
 * counts are pinned, so a change in either shows up here.
 *
 * The documents are the committed FHIR fixtures, the benchmark shapes, and a Patient written the way
 * a profiled document often is, with a birth time on `_birthDate` and qualifiers on `_given` (both
 * R4 core extensions). Every value is synthetic (`ZZ` tokens, example.org urls).
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { createDeidContext, profileOptions, SAFE_HARBOR_PROFILE } from "../../src/index.js";
import { deidentifyFhirJson } from "../../src/fhir/index.js";
import { fhirBundle, fhirPatient } from "../../bench/shapes.mjs";

const ctx = createDeidContext({ key: "row-cost-synthetic-hmac", patientId: "p" });

const FIX = (file: string): string =>
  readFileSync(join(import.meta.dirname, "..", "fixtures", "fhir", file), "utf8");

/** A Patient with the primitive extensions a profiled document often carries. */
const PROFILED_PATIENT = JSON.stringify({
  resourceType: "Patient",
  id: "zz1",
  name: [
    {
      family: "ZZFAMILY",
      given: ["ZZGIVEN", "ZZMIDDLE"],
      _given: [
        null,
        {
          extension: [
            {
              url: "http://hl7.org/fhir/StructureDefinition/iso21090-EN-qualifier",
              valueCode: "MID",
            },
          ],
        },
      ],
    },
  ],
  gender: "female",
  birthDate: "1980-04-02",
  _birthDate: {
    extension: [
      {
        url: "http://hl7.org/fhir/StructureDefinition/patient-birthTime",
        valueDateTime: "1980-04-02T10:15:00Z",
      },
    ],
  },
  maritalStatus: {
    coding: [
      {
        system: "http://terminology.hl7.org/CodeSystem/v3-MaritalStatus",
        code: "M",
        _code: {
          extension: [
            {
              url: "http://hl7.org/fhir/StructureDefinition/data-absent-reason",
              valueCode: "unknown",
            },
          ],
        },
      },
    ],
  },
});

/** The rows that name an extension on a primitive's `_`-sibling (`Patient._birthDate.extension[0]`). */
const SIBLING_EXTENSION_ROW = /(?:^|\.)_[^.]+\.extension\[\d+\]$/;

/** Each document: its name, its text, its manifest rows, and how many name a dropped extension. */
const DOCUMENTS: readonly {
  readonly name: string;
  readonly json: string;
  readonly rows: number;
  readonly extensionRows: number;
}[] = [
  { name: "fixture bundle.json", json: FIX("bundle.json"), rows: 51, extensionRows: 0 },
  {
    name: "fixture non-person-loci.json",
    json: FIX("non-person-loci.json"),
    rows: 28,
    extensionRows: 0,
  },
  { name: "benchmark Patient", json: fhirPatient(3), rows: 9, extensionRows: 0 },
  { name: "benchmark Bundle of 12 entries", json: fhirBundle(2, 12), rows: 95, extensionRows: 0 },
  { name: "profiled Patient", json: PROFILED_PATIENT, rows: 5, extensionRows: 2 },
];

describe("rows for a dropped `_`-sibling extension, on ordinary documents", () => {
  it.each(DOCUMENTS)(
    "$name: $rows rows, $extensionRows of them for a dropped extension",
    ({ json, rows, extensionRows }) => {
      const { manifest } = deidentifyFhirJson(json, profileOptions(SAFE_HARBOR_PROFILE, ctx));
      const named = manifest.filter((m) => SIBLING_EXTENSION_ROW.test(m.locus));
      expect({ rows: manifest.length, extensionRows: named.length }).toEqual({
        rows,
        extensionRows,
      });
      for (const row of named) expect(row.disposition).toBe("blocked");
    },
  );
});
