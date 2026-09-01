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

  it("NEGATIVE CONTROL: never a mapped element's own attribute positions either", () => {
    // A mapped element is handled as a unit and does not descend, so nothing under it is unexamined.
    for (const locus of loci) {
      expect(locus.startsWith("recordTarget/patientRole/patient/name")).toBe(false);
      expect(locus.startsWith("recordTarget/patientRole/addr")).toBe(false);
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
