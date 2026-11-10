/**
 * **X12: every element the pass hands through is decided, so the residual inventory is a measured zero.**
 * A recognized clinical / financial / control segment, the `ST` / `SE` control pair, and the interchange
 * and functional-group envelope used to be handed through with no rule looking inside them; their
 * elements were counted and located as unexamined residuals. Now each of those elements is decided by the
 * shape its position expects: kept when it has that shape, removed and recorded when it does not. The
 * inventory is still taken over every segment, and it is empty because nothing is left unexamined.
 *
 * The controls are the load-bearing half: the positions that used to be counted are still in the
 * output byte-identical when they hold what they should, they carry no manifest row, and the inventory
 * is a real measurement (`[]`), not a missing field.
 *
 * Values are synthetic sentinels from the committed fixture.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { createDeidContext } from "../../src/index.js";
import { deidentifyX12String } from "../../src/x12/index.js";

const RAW = readFileSync(join(import.meta.dirname, "..", "fixtures", "x12", "837p.edi"), "utf8");

const ctx = createDeidContext({
  key: "x12-unexamined-synthetic-hmac-key",
  patientId: "p-x12-unexamined",
});

describe("X12 unexamined residual positions", () => {
  const { x12, manifest, unexaminedResiduals } = deidentifyX12String(RAW, { context: ctx });
  const recorded = new Set(manifest.map((e) => e.locus));

  it("the positions that used to be unexamined really carry values in the fixture (non-vacuity)", () => {
    expect(RAW).toContain("BHT*0019*00*REF01*20260615*0930*CH~");
    expect(RAW).toContain("ST*837*0002~");
    expect(RAW).toContain("HL*2*1*22*0~");
    expect(RAW).toContain("PER*IC*SUBMITCONTACT*TE*5550009999~");
  });

  it("the inventory is measured and empty: every element is decided", () => {
    expect(Array.isArray(unexaminedResiduals)).toBe(true);
    expect(unexaminedResiduals).toEqual([]);
  });

  it("keeps the envelope, the control pair and the retained segments byte-identical", () => {
    expect(x12).toContain(
      "ISA*00*          *00*          *ZZ*COMMERCIAL     *ZZ*CLINICSUBMTR   *260615*0930*^*00501*000000002*0*P*:~",
    );
    expect(x12).toContain("GS*HC*COMMERCIAL*CLINICSUBMTR*20260615*0930*2*X*005010X222A2~");
    expect(x12).toContain("ST*837*0002~");
    expect(x12).toContain("BHT*0019*00*REF01*20260615*0930*CH~");
    expect(x12).toContain("HL*2*1*22*0~");
    // The fixture's unknown `ZZZ*` segment is removed whole, so SE-01 counts one segment fewer.
    expect(x12).toContain("SE*29*0002~GE*1*2~IEA*1*000000002~");
  });

  it("NEGATIVE CONTROL: a position kept because it has its shape carries no manifest row", () => {
    for (const kept of [
      "ISA[0]-6",
      "ISA[0]-9",
      "GS[0]-4",
      "837/ST[0]-1",
      "837/BHT[0]-3",
      "837/HL[0]-3",
      "837/PER[0]-1",
      "837/PER[0]-3",
      "837/SV1[0]-1",
      "IEA[0]-2",
    ]) {
      expect(recorded.has(kept)).toBe(false);
    }
  });

  it("NEGATIVE CONTROL: a blank-filled ISA element is not a value and is neither kept nor removed", () => {
    // X12 fixes the ISA at 106 bytes and space-pads every element to its declared width, so an
    // all-blank ISA-02 / ISA-04 is the standard spelling of "not used".
    expect(RAW).toContain("ISA*00*          *00*          *ZZ*");
    expect(recorded.has("ISA[0]-2")).toBe(false);
    expect(recorded.has("ISA[0]-4")).toBe(false);
  });

  it("every manifest row is value-free", () => {
    const serialized = JSON.stringify(manifest);
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
  const { x12, manifest, unexaminedResiduals } = deidentifyX12String(TWO_GROUPS_WITH_TA1, {
    context: ctx,
  });

  it("the acknowledgment and both groups reach the output document byte-identical", () => {
    expect(x12).toContain("TA1*000000008*260614*1200*A*000~");
    expect(x12).toContain("GS*HC*SENDERONE*RECEIVERONE*20260615*0930*11*X*005010X222A2~");
    expect(x12).toContain("GS*HP*SENDERONE*RECEIVERONE*20260615*0931*12*X*005010X221A1~");
    expect(x12).toContain("GE*1*11~");
    expect(x12).toContain("GE*1*12~");
  });

  it("decides every envelope element: nothing removed, nothing left unexamined", () => {
    expect(manifest).toEqual([]);
    expect(unexaminedResiduals).toEqual([]);
  });
});
