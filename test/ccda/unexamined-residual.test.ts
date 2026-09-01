/**
 * **C-CDA: the positions inside the retained clinical body and the document envelope that no locus rule
 * names.** The header participations are swept; the `structuredBody` entries are retained untouched by the
 * over-scrub guard and the envelope is retained like HL7's `MSH`, and *retaining a structure names nothing
 * inside it*. So the entry service dates, the entry ids and the coded positions of every retained element
 * used to leave unrecorded. They are counted and located now.
 *
 * The negative control is the load-bearing half: a suite proving an unmapped position is listed would pass
 * equally if the adapter listed everything, so no header locus the pass acted on may appear here.
 *
 * Values are synthetic sentinels from the committed fixture.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import { parseCcda } from "@cosyte/ccda";

import { createDeidContext, DEID_DISPOSITION_CODES } from "../../src/index.js";
import { deidentifyCcda } from "../../src/ccda/index.js";

/**
 * An unrecognized element carrying four attributes. The fail-closed rule's subject is its direct text
 * plus `@value` / `@extension` / `@root`; its `@displayName` and `@other` are neither blocked nor
 * decided, so both ride into the output and both must be measured.
 */
const VENDOR_ELEMENT_XML = `<?xml version="1.0" encoding="UTF-8"?>
<ClinicalDocument xmlns="urn:hl7-org:v3">
  <id root="2.16.840.1.113883.19.5" extension="ZZDOCID"/>
  <title>ZZTITLE</title>
  <effectiveTime value="20200102"/>
  <zzVendorThing displayName="ZZVENDORLEAK" value="ZZVALUE" other="ZZOTHERLEAK"/>
</ClinicalDocument>`;

const RAW = readFileSync(join(import.meta.dirname, "..", "fixtures", "ccda", "ccd.xml"), "utf8");

const ctx = createDeidContext({ key: "ccda-unexamined", patientId: "p-ccda-unexamined" });

const ENTRY = "component/structuredBody/component[0]/section/entry/organizer/component/observation";

describe("C-CDA unexamined residual positions", () => {
  const { manifest, unexaminedResiduals } = deidentifyCcda(parseCcda(RAW), { context: ctx });
  const loci = new Set(unexaminedResiduals.map((r) => r.locus));

  it("the unmapped positions really carry values in the fixture (non-vacuity)", () => {
    // The entry-level service date and the entry's coded identity are in the source, verbatim.
    expect(RAW).toContain("<effectiveTime value=");
    expect(RAW).toContain("codeSystem=");
    expect(RAW).toContain("<title>");
  });

  it("lists an entry-level service date inside the RETAINED clinical body", () => {
    expect(loci.has(`${ENTRY}/effectiveTime@value`)).toBe(true);
  });

  it("lists the coded positions of a retained entry, and the document envelope's own values", () => {
    expect(loci.has(`${ENTRY}/code@code`)).toBe(true);
    expect(loci.has(`${ENTRY}/statusCode@code`)).toBe(true);
    // The envelope (id / code / title / setId), retained like HL7's MSH.
    expect(loci.has("id@extension")).toBe(true);
    expect(loci.has("title")).toBe(true);
    expect(loci.has("code@codeSystem")).toBe(true);
  });

  it("NEGATIVE CONTROL: never a header locus the pass acted on or blocked", () => {
    for (const acted of [
      "recordTarget/patientRole/id[0]",
      "recordTarget/patientRole/addr",
      "recordTarget/patientRole/telecom",
      "recordTarget/patientRole/patient/name",
      "recordTarget/patientRole/patient/birthTime",
      "effectiveTime",
      "component/structuredBody/component[0]/section/text",
    ]) {
      expect(loci.has(acted)).toBe(false);
    }
    for (const entry of manifest) expect(loci.has(entry.locus)).toBe(false);
  });

  it("NEGATIVE CONTROL: never a position INSIDE a mapped element, nor the position the rule took", () => {
    // A mapped element is handled as a unit and does not descend, so nothing under it is unexamined,
    // and neither is the position the rule itself reached.
    for (const locus of loci) {
      expect(locus.startsWith("recordTarget/patientRole/patient/name/")).toBe(false);
      expect(locus.startsWith("recordTarget/patientRole/addr/")).toBe(false);
    }
    for (const taken of [
      "recordTarget/patientRole/patient/name",
      "recordTarget/patientRole/addr",
      "recordTarget/patientRole/telecom@value",
      "recordTarget/patientRole/patient/birthTime@value",
      "recordTarget/patientRole/id[0]@root",
      "recordTarget/patientRole/id[0]@extension",
      "effectiveTime@value",
    ]) {
      expect(loci.has(taken)).toBe(false);
    }
  });

  it("counts per ATTRIBUTE, so an attribute the rule never reached is not covered by one that it did", () => {
    // `actTelecom` clears `@value`; `@use` rides through untouched beside it. Same shape on the two
    // other mapped elements whose applier keeps every attribute it does not rewrite.
    const wire = deidentifyCcda(parseCcda(RAW), { context: ctx }).document.toString();
    // Non-vacuity: all three attributes really do survive the pass in the emitted document.
    expect(/<telecom[^>]*use="HP"/.test(wire)).toBe(true);
    expect(/<addr[^>]*use="HP"/.test(wire)).toBe(true);
    expect(/<name[^>]*use="L"/.test(wire)).toBe(true);
    for (const survivor of [
      "recordTarget/patientRole/telecom@use",
      "recordTarget/patientRole/addr@use",
      "recordTarget/patientRole/patient/name@use",
    ]) {
      expect(loci.has(survivor)).toBe(true);
    }
  });

  it("and the fail-closed rule's PARTIAL reach is measured, not treated as whole-element coverage", () => {
    const vendor = deidentifyCcda(parseCcda(VENDOR_ELEMENT_XML), { context: ctx });
    const vendorLoci = vendor.unexaminedResiduals.map((r) => r.locus);
    const vendorWire = vendor.document.toString();
    // Non-vacuity, both ways: the two unreached attributes really survive, and the one the rule DOES
    // reach really is blocked, so the fail-closed path works and only the measurement was short.
    expect(vendorWire).toContain("ZZVENDORLEAK");
    expect(vendorWire).toContain("ZZOTHERLEAK");
    expect(vendorWire).not.toContain("ZZVALUE");
    expect(vendorLoci).toContain("zzVendorThing@displayName");
    expect(vendorLoci).toContain("zzVendorThing@other");
    // NEGATIVE CONTROL: the attribute the rule blocked is not listed as one nothing examined.
    expect(vendorLoci).not.toContain("zzVendorThing@value");
    // Value-free, like every other record: the surviving values never reach the measurement.
    const serialized = JSON.stringify(vendor.unexaminedResiduals);
    for (const value of ["ZZVENDORLEAK", "ZZOTHERLEAK", "ZZVALUE", "ZZDOCID", "ZZTITLE"]) {
      expect(serialized).not.toContain(value);
    }
  });

  it("every record is value-free and carries the unexamined code", () => {
    expect(unexaminedResiduals.length).toBeGreaterThan(0);
    for (const residual of unexaminedResiduals) {
      expect(residual.code).toBe(DEID_DISPOSITION_CODES.DEID_POSITION_UNEXAMINED);
      expect(residual.examined).toBe(false);
    }
    const serialized = JSON.stringify(unexaminedResiduals);
    for (const value of [
      "ZZMRNCCDA1",
      "ZZPATGIVEN",
      "ZZCCDASTREET",
      "ZZNARRATIVEPHI",
      "19900215",
    ]) {
      expect(serialized).not.toContain(value);
    }
  });
});
