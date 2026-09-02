/**
 * **FHIR: the positions the walk descends past without deciding anything.** This adapter has no `clinical`
 * locus kind at all: it applies the person rules and the universal identifier / date / narrative /
 * extension / reference rules, and everything else it simply walks past. Those positions, a coded system,
 * a code, a status, a `fullUrl`, used to be invisible. They are counted and located now.
 *
 * The negative control is the load-bearing half: a suite proving an unreached primitive is listed would
 * pass equally if the adapter listed everything, so nothing the pass acted on or blocked may appear here,
 * and neither may a leaf under a subtree a rule consumed as a unit.
 *
 * Values are synthetic sentinels from the committed fixture.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import { parseResource } from "@cosyte/fhir";

import { createDeidContext, DEID_DISPOSITION_CODES } from "../../src/index.js";
import { deidentifyFhir } from "../../src/fhir/index.js";

const RAW = readFileSync(
  join(import.meta.dirname, "..", "fixtures", "fhir", "bundle.json"),
  "utf8",
);

const ctx = createDeidContext({ key: "fhir-unexamined", patientId: "p-fhir-unexamined" });

describe("FHIR unexamined residual positions", () => {
  const { resource } = parseResource(RAW);
  const { manifest, unexaminedResiduals } = deidentifyFhir(resource, { context: ctx });
  const loci = new Set(unexaminedResiduals.map((r) => r.locus));

  it("the unreached positions really carry values in the fixture (non-vacuity)", () => {
    const json: unknown = JSON.parse(RAW);
    expect(json).toHaveProperty("type");
    expect(RAW).toContain('"maritalStatus"');
    expect(RAW).toContain('"fullUrl"');
  });

  it("lists the coded positions of a clinical resource, which no rule here reaches", () => {
    expect(loci.has("Bundle.entry[0].resource.maritalStatus.coding[0].code")).toBe(true);
    expect(loci.has("Bundle.entry[0].resource.maritalStatus.coding[0].system")).toBe(true);
  });

  it("lists the Bundle's own structural values and an identifier's system", () => {
    expect(loci.has("Bundle.type")).toBe(true);
    expect(loci.has("Bundle.entry[0].fullUrl")).toBe(true);
    expect(loci.has("Bundle.entry[0].resource.identifier[0].system")).toBe(true);
  });

  it("NEGATIVE CONTROL: never a position the pass acted on or blocked", () => {
    for (const acted of [
      "Bundle.entry[0].resource.name",
      "Bundle.entry[0].resource.telecom",
      "Bundle.entry[0].resource.birthDate",
      "Bundle.entry[0].resource.identifier[0].value",
      "Bundle.entry[0].resource.address",
      "Bundle.entry[0].resource.text.div",
      "Bundle.entry[3].resource.note",
    ]) {
      expect(loci.has(acted)).toBe(false);
    }
    for (const entry of manifest) expect(loci.has(entry.locus)).toBe(false);
  });

  it("NEGATIVE CONTROL: never a leaf UNDER a subtree a rule consumed as a unit", () => {
    // `name`, `telecom`, `address`, `photo` and `note` are dropped or rebuilt whole, so nothing beneath
    // them was passed through: a leaf listed there would be a position the pass did act on.
    for (const locus of loci) {
      expect(locus.startsWith("Bundle.entry[0].resource.name.")).toBe(false);
      expect(locus.startsWith("Bundle.entry[0].resource.telecom.")).toBe(false);
      expect(locus.startsWith("Bundle.entry[0].resource.address.")).toBe(false);
      expect(locus.startsWith("Bundle.entry[3].resource.note.")).toBe(false);
    }
  });

  it("NEGATIVE CONTROL: never a Coding's display, which the pass positively typed as a coded term", () => {
    for (const locus of loci) expect(locus.endsWith("coding[0].display")).toBe(false);
  });

  it("every record is value-free and carries the unexamined code", () => {
    expect(unexaminedResiduals.length).toBeGreaterThan(0);
    for (const residual of unexaminedResiduals) {
      expect(residual.code).toBe(DEID_DISPOSITION_CODES.DEID_POSITION_UNEXAMINED);
      expect(residual.examined).toBe(false);
    }
    const serialized = JSON.stringify(unexaminedResiduals);
    for (const value of [
      "ZZMRNFHIR1",
      "ZZPATFAMILY",
      "ZZPATSTREET",
      "ZZOBSNOTEPHI",
      "1990-02-15",
    ]) {
      expect(serialized).not.toContain(value);
    }
  });
});
