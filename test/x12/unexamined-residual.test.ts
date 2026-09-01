/**
 * **X12: the elements of a retained segment, and the unmapped elements of a mapped one.** A recognized
 * clinical / financial / control segment is retained as a *structure*, which names no element inside it,
 * and the `ST` / `SE` envelope control pair is handed through with no rule looking at it at all. Those
 * elements used to leave unrecorded; they are counted and located now.
 *
 * The negative control is the load-bearing half: no element the pass acted on, blocked, or explicitly
 * decided to keep may appear here, and that includes the two kinds of deliberate keep this adapter makes,
 * a party the scope clause does not reach and a geographic element on the segment's safe list.
 *
 * Values are synthetic sentinels from the committed fixture.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { createDeidContext, DEID_DISPOSITION_CODES } from "../../src/index.js";
import { deidentifyX12String } from "../../src/x12/index.js";

const RAW = readFileSync(join(import.meta.dirname, "..", "fixtures", "x12", "837p.edi"), "utf8");

const ctx = createDeidContext({ key: "x12-unexamined", patientId: "p-x12-unexamined" });

describe("X12 unexamined residual positions", () => {
  const { manifest, unexaminedResiduals } = deidentifyX12String(RAW, { context: ctx });
  const loci = new Set(unexaminedResiduals.map((r) => r.locus));

  it("the unmapped elements really carry values in the fixture (non-vacuity)", () => {
    expect(RAW).toContain("BHT*");
    expect(RAW).toContain("ST*837*");
    expect(RAW).toContain("SV1*");
  });

  it("lists the elements of the envelope control pair, which no rule looks at", () => {
    expect(loci.has("837/ST[0]-1")).toBe(true);
    expect(loci.has("837/ST[0]-2")).toBe(true);
  });

  it("lists the elements of a retained segment and the unmapped elements of a mapped one", () => {
    expect(loci.has("837/BHT[0]-3")).toBe(true);
    expect(loci.has("837/HL[0]-3")).toBe(true);
    // `PER-01` is the contact-function code beside a telecom the pass DOES remove at `PER-02`.
    expect(loci.has("837/PER[0]-1")).toBe(true);
  });

  it("NEGATIVE CONTROL: never an element the pass acted on or blocked", () => {
    for (const acted of [
      "837/NM1[2]-3",
      "837/NM1[2]-9",
      "837/DMG[0]-2",
      "837/N3[1]-1",
      "837/N4[1]-3",
      "837/CLM[0]-1",
      "837/DTP[0]-3",
      "837/ZZZ[0]-1",
    ]) {
      expect(loci.has(acted)).toBe(false);
    }
    for (const entry of manifest) expect(loci.has(entry.locus)).toBe(false);
  });

  it("NEGATIVE CONTROL: never a party the scope clause does not reach, name or identifier", () => {
    // `NM1*PR` / `N1*PR` is a payer: the role test decided to leave its name and id in place and
    // RECORDED the role code, so those elements were retained under a rule, not passed over in silence.
    for (const retainedParty of ["837/NM1[0]-3", "837/NM1[0]-9", "837/N1[0]-2", "837/N1[0]-4"]) {
      expect(loci.has(retainedParty)).toBe(false);
    }
  });

  it("NEGATIVE CONTROL: never a geographic element the segment's safe list keeps", () => {
    // `N4-02` state and `N4-04` country are recognized non-identifiers: a rule reached them and kept them.
    for (const safe of ["837/N4[0]-2", "837/N4[1]-2", "837/N4[2]-2"]) {
      expect(loci.has(safe)).toBe(false);
    }
  });

  it("every record is value-free and carries the unexamined code", () => {
    expect(unexaminedResiduals.length).toBeGreaterThan(0);
    for (const residual of unexaminedResiduals) {
      expect(residual.code).toBe(DEID_DISPOSITION_CODES.DEID_POSITION_UNEXAMINED);
      expect(residual.examined).toBe(false);
    }
    const serialized = JSON.stringify(unexaminedResiduals);
    for (const value of ["ZZSUBLAST", "ZZMEMBERX12", "ZZACCTX12", "ZZNTEPHI", "19850302"]) {
      expect(serialized).not.toContain(value);
    }
  });
});
