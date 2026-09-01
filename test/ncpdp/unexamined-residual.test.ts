/**
 * **NCPDP Telecom: the fields of a retained segment, and the header positions no rule reaches.** A
 * recognized clinical / financial segment is retained as a *structure*, which names no field inside it,
 * and the fixed Transaction Header has exactly one position a rule reaches, its Date of Service. Every
 * other field of both used to leave unrecorded; they are counted and located now.
 *
 * The negative control is the load-bearing half: no field the pass acted on, blocked, or explicitly
 * decided to keep may appear here, and that includes a field on a PHI segment's non-identifier retain
 * list, which is a rule reaching a position and keeping it.
 *
 * Values are synthetic sentinels from the committed fixture.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { createDeidContext, DEID_DISPOSITION_CODES } from "../../src/index.js";
import { deidentifyTelecomString } from "../../src/ncpdp/index.js";

const RAW = readFileSync(
  join(import.meta.dirname, "..", "fixtures", "ncpdp", "telecom-b1.ncpdp"),
  "utf8",
);

const ctx = createDeidContext({ key: "ncpdp-unexamined", patientId: "p-ncpdp-unexamined" });

describe("NCPDP Telecom unexamined residual positions", () => {
  const { manifest, unexaminedResiduals } = deidentifyTelecomString(RAW, { context: ctx });
  const loci = new Set(unexaminedResiduals.map((r) => r.locus));

  it("the unmapped fields really carry values in the fixture (non-vacuity)", () => {
    expect(RAW).toContain("00071015527"); // the NDC in the retained claim segment
    expect(RAW).toContain("PHARM123"); // the service provider id in the fixed header
  });

  it("lists the fields of a RETAINED clinical / financial segment", () => {
    expect(loci.has("07/D2")).toBe(true);
    expect(loci.has("07/E1")).toBe(true);
  });

  it("lists the fixed header's own positions, all but the one a rule reaches", () => {
    expect(loci.has("header/binNumber")).toBe(true);
    expect(loci.has("header/serviceProviderId")).toBe(true);
    expect(loci.has("header/transactionCode")).toBe(true);
  });

  it("NEGATIVE CONTROL: never a field the pass acted on or blocked", () => {
    for (const acted of ["01/CA", "01/CB", "01/C4", "01/CP", "03/DB", "04/C2", "99/ZZ"]) {
      expect(loci.has(acted)).toBe(false);
    }
    for (const entry of manifest) expect(loci.has(entry.locus)).toBe(false);
  });

  it("NEGATIVE CONTROL: never the header Date of Service, which a rule DOES reach", () => {
    expect(manifest.some((e) => e.locus === "header/dateOfService")).toBe(true);
    expect(loci.has("header/dateOfService")).toBe(false);
  });

  it("NEGATIVE CONTROL: never a field a PHI segment's non-identifier retain list keeps", () => {
    // A retain-listed field inside a mapped segment is a rule reaching a position and keeping it, which
    // is a decision. Only fields NO rule names are residuals.
    for (const locus of loci) expect(locus.startsWith("01/")).toBe(false);
  });

  it("every record is value-free and carries the unexamined code", () => {
    expect(unexaminedResiduals.length).toBeGreaterThan(0);
    for (const residual of unexaminedResiduals) {
      expect(residual.code).toBe(DEID_DISPOSITION_CODES.DEID_POSITION_UNEXAMINED);
      expect(residual.examined).toBe(false);
    }
    const serialized = JSON.stringify(unexaminedResiduals);
    for (const value of ["ZZPATFIRST", "ZZPATIENTID", "ZZPRESCRIBERID", "ZZDURPHI", "19850302"]) {
      expect(serialized).not.toContain(value);
    }
  });
});
