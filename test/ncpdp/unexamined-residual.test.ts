/**
 * **NCPDP Telecom: the fields of a retained segment, and the header positions no rule reaches.** A
 * recognized clinical / financial segment is retained as a *structure*, which names no field inside it,
 * and the transmission header has exactly one position a rule reaches, a request's Date of Service.
 * Every other field of both used to leave unrecorded; they are counted and located now.
 *
 * The negative control is the load-bearing half: no field the pass acted on, blocked, or explicitly
 * decided to keep may appear here, and that includes a field on a PHI segment's non-identifier retain
 * list, which is a rule reaching a position and keeping it.
 *
 * A **response** transmission is enumerated from its own Response Transaction Header, because that is
 * the header its bytes are emitted from. `tx.header` is only a derived view of it: five of its six
 * fields are lifted across and the Header Response Status (501-F1) is not, so enumerating the view
 * would hand that position through unmeasured.
 *
 * Values are synthetic sentinels from the committed fixtures.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { parseTelecom, type TelecomTransaction } from "@cosyte/ncpdp/telecom";
import { describe, expect, it } from "vitest";

import { createDeidContext, DEID_DISPOSITION_CODES } from "../../src/index.js";
import { deidentifyTelecom, deidentifyTelecomString } from "../../src/ncpdp/index.js";

const RAW = readFileSync(
  join(import.meta.dirname, "..", "fixtures", "ncpdp", "telecom-b1.ncpdp"),
  "utf8",
);

/** The adjudication **response** to the request above: a different header, and response segments. */
const RAW_RESPONSE = readFileSync(
  join(import.meta.dirname, "..", "fixtures", "ncpdp", "telecom-b1-response.ncpdp"),
  "utf8",
);

/** The fixed-width response header region: the bytes before the first framing control character. */
const RESPONSE_HEADER_REGION = "D0B11A01PHARM123       ";

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

describe("NCPDP Telecom RESPONSE: the header the pass actually emits is the one enumerated", () => {
  const { telecom, manifest, unexaminedResiduals } = deidentifyTelecomString(RAW_RESPONSE, {
    context: ctx,
  });
  const loci = new Set(unexaminedResiduals.map((r) => r.locus));

  it("the fixture really is a response carrying a header status (non-vacuity)", () => {
    const tx = parseTelecom(RAW_RESPONSE);
    expect(tx.kind).toBe("response");
    expect(tx.responseHeader?.headerResponseStatus).toBe("A");
    // The derived view really does DROP it: this is the gap, stated as a fact about the parsed model.
    expect(Object.keys(tx.header)).not.toContain("headerResponseStatus");
  });

  it("the response header is handed through verbatim, status position included", () => {
    expect(telecom.slice(0, RESPONSE_HEADER_REGION.length)).toBe(RESPONSE_HEADER_REGION);
    expect(telecom.charAt(5)).toBe("A");
  });

  it("so the Header Response Status is measured, and no locus rule names it", () => {
    expect(loci.has("header/headerResponseStatus")).toBe(true);
    expect(manifest.some((e) => e.locus.includes("headerResponseStatus"))).toBe(false);
  });

  it("and the five positions the derived view DOES lift are counted exactly once each", () => {
    // Enumerating both headers would count one wire position twice, which would make this format's
    // number a different unit from every other format's.
    for (const name of [
      "versionRelease",
      "transactionCode",
      "transactionCount",
      "serviceProviderIdQualifier",
      "serviceProviderId",
    ]) {
      const record = unexaminedResiduals.find((r) => r.locus === `header/${name}`);
      expect(record?.count).toBe(1);
    }
  });

  it("NEGATIVE CONTROL: never a request-only header position a response does not carry", () => {
    for (const name of [
      "binNumber",
      "processorControlNumber",
      "softwareCertificationId",
      "dateOfService",
    ]) {
      expect(loci.has(`header/${name}`)).toBe(false);
    }
  });

  it("lists the fields of the retained response segments", () => {
    expect(loci.has("21/AN")).toBe(true); // Transaction Response Status
    expect(loci.has("23/F5")).toBe(true); // Patient Pay Amount
  });

  it("NEGATIVE CONTROL: never a response field the pass blocked", () => {
    // The two free-text fields fail closed inside an otherwise-retained response segment: a rule
    // reached them, so they are examined and may not appear in the measurement.
    expect(manifest.map((e) => e.locus)).toEqual(["20/F4", "24/FQ"]);
    for (const entry of manifest) expect(loci.has(entry.locus)).toBe(false);
  });

  it("every record is value-free and carries the unexamined code", () => {
    expect(unexaminedResiduals.length).toBeGreaterThan(0);
    for (const residual of unexaminedResiduals) {
      expect(residual.code).toBe(DEID_DISPOSITION_CODES.DEID_POSITION_UNEXAMINED);
      expect(residual.examined).toBe(false);
    }
    const serialized = JSON.stringify(unexaminedResiduals);
    for (const value of ["AUTH0000001", "RX0000001", "ZZRESPMSG", "ZZRESPFQ"]) {
      expect(serialized).not.toContain(value);
    }
  });

  it("a response with no response header is emitted from the request header, so THAT is enumerated", () => {
    // `serializeTelecom` falls back to the request header when a response carries none, so the
    // fallback's positions are the ones handed through - the Date of Service among them, because the
    // rule that names it reaches a REQUEST only.
    const real = parseTelecom(RAW_RESPONSE);
    const headerOnly: TelecomTransaction = {
      kind: "response",
      header: { ...real.header, binNumber: "999999", dateOfService: "20260115" },
      segments: real.segments,
      transactionCount: real.transactionCount,
      warnings: real.warnings,
    };
    const fallback = deidentifyTelecom(headerOnly, { context: ctx });
    const fallbackLoci = new Set(fallback.unexaminedResiduals.map((r) => r.locus));
    expect(fallbackLoci.has("header/dateOfService")).toBe(true);
    expect(fallbackLoci.has("header/binNumber")).toBe(true);
    // It is not the response header's set: the status position is not there to hand through.
    expect(fallbackLoci.has("header/headerResponseStatus")).toBe(false);
    // And the date really is handed through rather than acted on: no rule reaches a response's.
    expect(fallback.manifest.some((e) => e.locus === "header/dateOfService")).toBe(false);
    expect(fallback.telecom).toContain("20260115");
  });
});
