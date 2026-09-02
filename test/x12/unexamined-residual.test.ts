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

  it("lists the INTERCHANGE and GROUP envelope, which sits outside every transaction set", () => {
    const { x12 } = deidentifyX12String(RAW, { context: ctx });
    // Non-vacuity: the envelope really is emitted into the output document, values and all.
    expect(x12).toContain("ISA*00*");
    expect(x12).toContain("GS*HC*COMMERCIAL*CLINICSUBMTR*");
    expect(x12).toContain("GE*1*2~");
    expect(x12).toContain("IEA*1*000000002~");
    // The sender and receiver ids, the interchange and group dates and times, the control numbers.
    for (const position of [
      "ISA[0]-6",
      "ISA[0]-8",
      "ISA[0]-9",
      "ISA[0]-10",
      "ISA[0]-13",
      "GS[0]-2",
      "GS[0]-3",
      "GS[0]-4",
      "GS[0]-5",
      "GS[0]-6",
      "GE[0]-1",
      "GE[0]-2",
      "IEA[0]-1",
      "IEA[0]-2",
    ]) {
      expect(loci.has(position)).toBe(true);
    }
    // An envelope position carries no transaction-set root, because it sits inside no transaction set.
    expect(loci.has("837/ISA[0]-6")).toBe(false);
  });

  it("NEGATIVE CONTROL: a blank-filled ISA element is not a value-bearing position", () => {
    // X12 fixes the ISA at 106 bytes and space-pads every element to its declared width, so an
    // all-blank ISA-02 / ISA-04 is the standard spelling of "not used", not a value handed through.
    expect(RAW).toContain("ISA*00*          *00*          *ZZ*");
    expect(loci.has("ISA[0]-2")).toBe(false);
    expect(loci.has("ISA[0]-4")).toBe(false);
    // Not vacuous: a populated fixed-width element on the same segment IS counted, padding and all.
    expect(loci.has("ISA[0]-6")).toBe(true);
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

/**
 * The two envelope shapes the committed fixture does not carry: an envelope-level `TA1` acknowledgment,
 * and a second functional group. Both ride into the output from their verbatim raw text, so both are
 * enumerated, and the group index has to keep the two groups' headers and trailers apart.
 */
const TWO_GROUPS_WITH_TA1 = [
  "ISA*00*          *00*          *ZZ*SENDERONE      *ZZ*RECEIVERONE    *260615*0930*^*00501*000000009*0*P*:",
  "TA1*000000008*260614*1200*A*000",
  "GS*HC*SENDERONE*RECEIVERONE*20260615*0930*11*X*005010X222A2",
  "ST*837*0001",
  "BHT*0019*00*REF01*20260615*0930*CH",
  "SE*3*0001",
  "GE*1*11",
  "GS*HP*SENDERONE*RECEIVERONE*20260615*0931*12*X*005010X221A1",
  "ST*835*0002",
  "BHT*0019*00*REF02*20260615*0931*CH",
  "SE*3*0002",
  "GE*1*12",
  "IEA*1*000000009",
  "",
].join("~");

describe("X12 envelope shapes the committed fixture does not carry", () => {
  const { x12, unexaminedResiduals } = deidentifyX12String(TWO_GROUPS_WITH_TA1, { context: ctx });
  const loci = new Set(unexaminedResiduals.map((r) => r.locus));

  it("the acknowledgment and both groups really reach the output document (non-vacuity)", () => {
    expect(x12).toContain("TA1*000000008*260614*1200*A*000~");
    expect(x12).toContain("GS*HC*");
    expect(x12).toContain("GS*HP*");
    expect(x12).toContain("GE*1*11~");
    expect(x12).toContain("GE*1*12~");
  });

  it("counts a TA1, which is an envelope segment and not a transaction set", () => {
    for (const position of ["TA1[0]-1", "TA1[0]-2", "TA1[0]-3", "TA1[0]-4", "TA1[0]-5"]) {
      expect(loci.has(position)).toBe(true);
    }
  });

  it("indexes a group's header and trailer by the group, so two groups stay distinguishable", () => {
    for (const position of ["GS[0]-1", "GS[1]-1", "GE[0]-2", "GE[1]-2"]) {
      expect(loci.has(position)).toBe(true);
    }
    // GS-01 is `HC` in the first group and `HP` in the second: two positions, not one row of count 2.
    const gs01 = unexaminedResiduals.filter((r) => /^GS\[\d\]-1$/.test(r.locus));
    expect(gs01.map((r) => r.count)).toEqual([1, 1]);
  });

  it("reads in document order: the header before the transactions, the trailer after them", () => {
    const order = unexaminedResiduals.map((r) => r.locus);
    expect(order.indexOf("ISA[0]-6")).toBeLessThan(order.indexOf("TA1[0]-1"));
    expect(order.indexOf("TA1[0]-1")).toBeLessThan(order.indexOf("GS[0]-1"));
    expect(order.indexOf("GS[0]-1")).toBeLessThan(order.indexOf("837/ST[0]-1"));
    expect(order.indexOf("837/ST[0]-1")).toBeLessThan(order.indexOf("GE[0]-1"));
    expect(order.indexOf("GE[0]-1")).toBeLessThan(order.indexOf("GS[1]-1"));
    expect(order.indexOf("GS[1]-1")).toBeLessThan(order.indexOf("IEA[0]-1"));
  });

  it("every envelope record is value-free: a locus, a count and the fact", () => {
    const serialized = JSON.stringify(unexaminedResiduals);
    for (const value of ["SENDERONE", "RECEIVERONE", "000000009", "20260615", "005010X222A2"]) {
      expect(serialized).not.toContain(value);
    }
  });
});
