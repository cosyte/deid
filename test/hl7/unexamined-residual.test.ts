/**
 * **HL7 v2: the positions inside a retained segment that no locus rule names.** The retain-list keeps a
 * *structure*, and keeping a structure names nothing inside it, so the provider names in `PV1-7` / `PV1-8`
 * and the coded positions of every retained segment used to leave in the clear and unrecorded. They are
 * counted and located now.
 *
 * Both directions are asserted, because only one of them is a gate. A suite that proved an unmapped
 * position is *listed* would pass just as well if the adapter listed everything, so the negative control
 * is the load-bearing half: no position the pass acted on, blocked, or named a rule for may appear here.
 *
 * Values are synthetic sentinels from the committed fixtures.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import { parseHL7 } from "@cosyte/hl7";

import { createDeidContext, DEID_DISPOSITION_CODES } from "../../src/index.js";
import { deidentifyHl7 } from "../../src/hl7/index.js";

const wire = (name: string): string =>
  readFileSync(join(import.meta.dirname, "..", "fixtures", "hl7", `${name}.hl7`), "utf8")
    .trim()
    .split(/\r?\n/)
    .join("\r");

const ctx = createDeidContext({ key: "hl7-unexamined", patientId: "p-hl7-unexamined" });

describe("HL7 v2 unexamined residual positions", () => {
  const raw = wire("adt-a03");
  const original = parseHL7(raw);
  const { manifest, unexaminedResiduals } = deidentifyHl7(parseHL7(raw), { context: ctx });
  const loci = new Set(unexaminedResiduals.map((r) => r.locus));

  it("the unmapped positions really carry values in the fixture (non-vacuity)", () => {
    expect(original.get("PV1.8.2")).toBeDefined();
    expect(original.get("PV1.3.1")).toBeDefined();
    expect(original.get("OBX.3.1")).toBeDefined();
  });

  it("lists the referring provider's name, which no locus map reaches", () => {
    expect(loci.has("PV1-8.1")).toBe(true);
    expect(loci.has("PV1-8.2")).toBe(true);
    expect(loci.has("PV1-8.3")).toBe(true);
  });

  it("lists the coded positions of a retained clinical segment", () => {
    expect(loci.has("PV1-3.1")).toBe(true);
    expect(loci.has("OBX-3.1")).toBe(true);
    expect(loci.has("DG1-3.1")).toBe(true);
  });

  it("NEGATIVE CONTROL: never a position the pass acted on or blocked", () => {
    for (const acted of ["PID-5", "PID-3[0]", "PID-13", "PV1-44", "PV1-45", "OBR-7", "DG1-5"]) {
      expect(loci.has(acted)).toBe(false);
    }
    for (const entry of manifest) expect(loci.has(entry.locus)).toBe(false);
  });

  it("NEGATIVE CONTROL: never OBX-5, which the over-scrub guard decided to keep", () => {
    // A positively-typed structured clinical value survives ON PURPOSE. That is a decision the engine
    // reached at the position, not a silence, so it is examined and must not appear here.
    expect(original.get("OBX.5")).toBeDefined();
    expect(loci.has("OBX-5")).toBe(false);
    expect(loci.has("OBX[0]-5")).toBe(false);
  });

  it("every record is value-free and carries the unexamined code", () => {
    expect(unexaminedResiduals.length).toBeGreaterThan(0);
    for (const residual of unexaminedResiduals) {
      expect(residual.code).toBe(DEID_DISPOSITION_CODES.DEID_POSITION_UNEXAMINED);
      expect(residual.examined).toBe(false);
    }
    const serialized = JSON.stringify(unexaminedResiduals);
    for (const value of ["ZZENCFAMILY", "ZZENCGIVEN", "ZZMRN003", "ZZVISIT700", "19900215"]) {
      expect(serialized).not.toContain(value);
    }
  });
});
