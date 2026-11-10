/**
 * X12 adapter on shapes the headline fixture never sends: a functional group whose first transaction
 * has nothing to act on, a transaction set header with no `ST-01`, and write-back coordinates a
 * JavaScript caller hands the public `applyX12` with holes in them. Each one rewrites exactly the
 * segments it acted on and leaves every other byte as it arrived.
 *
 * All values are synthetic `ZZ` sentinels.
 */

import { parseX12 } from "@cosyte/x12";
import { describe, expect, it } from "vitest";

import { createDeidContext, type TransformedLocus } from "../../src/index.js";
import { applyX12, deidentifyX12String, type X12Coord } from "../../src/x12/index.js";

const ctx = createDeidContext({ key: "odd-shape-key-synthetic-hmac", patientId: "p" });

const ISA =
  "ISA*00*          *00*          *ZZ*COMMERCIAL     *ZZ*CLINICSUBMTR   *260615*0930*^*00501*000000002*0*P*:~";

/** One interchange, one functional group, around the given transaction sets. */
function interchange(transactions: string[]): string {
  return [
    ISA,
    "GS*HC*COMMERCIAL*CLINICSUBMTR*20260615*0930*2*X*005010X222A2~",
    ...transactions,
    `GE*${String(transactions.length)}*2~`,
    "IEA*1*000000002~",
  ].join("");
}

const CLINICAL_ONLY = "ST*837*0001~HI*ABK:E1165~SE*3*0001~";
const SUBSCRIBER = "ST*837*0002~NM1*IL*1*ZZSUBLAST*ZZSUBFIRST****MI*ZZMEMBERX12~SE*3*0002~";

describe("deidentifyX12String, transaction shapes", () => {
  it("leaves a transaction with nothing to act on byte-identical beside one it rewrites", () => {
    const { x12, manifest } = deidentifyX12String(interchange([CLINICAL_ONLY, SUBSCRIBER]), {
      context: ctx,
    });
    expect(x12).toContain(CLINICAL_ONLY);
    expect(x12).not.toContain("ZZSUB");
    expect(x12).not.toContain("ZZMEMBERX12");
    expect(manifest.map((m) => m.locus)).toEqual(["837/NM1[0]-3", "837/NM1[0]-9"]);
  });

  it("roots its paths at the withheld token when the transaction set header has no ST-01", () => {
    const { x12, manifest } = deidentifyX12String(
      interchange(["ST~NM1*IL*1*ZZPATLAST~SE*3*0002~"]),
      { context: ctx },
    );
    expect(x12).not.toContain("ZZPATLAST");
    expect(manifest.map((m) => m.locus)).toEqual(["<withheld>/NM1[0]-3"]);
  });
});

describe("deidentifyX12String, an N1 party missing its name or its identifier", () => {
  it("acts on whichever of the two a subject party carries, and on nothing it does not", () => {
    const { x12, manifest } = deidentifyX12String(
      interchange(["ST*837*0003~N1*IL**MI*ZZPATMEMBER~N1*IL*ZZPATFIRST~SE*4*0003~"]),
      { context: ctx },
    );
    expect(x12).not.toContain("ZZPATMEMBER");
    expect(x12).not.toContain("ZZPATFIRST");
    expect(manifest.map((m) => m.locus)).toEqual(["837/N1[0]-4", "837/N1[1]-2"]);
  });
});

describe("deidentifyX12String, an NM1 subject with no name", () => {
  it("acts on its identifier alone", () => {
    const { x12, manifest } = deidentifyX12String(
      interchange(["ST*837*0004~NM1*QC*1******MI*ZZPATMEMBER~SE*3*0004~"]),
      { context: ctx },
    );
    expect(x12).not.toContain("ZZPATMEMBER");
    expect(manifest.map((m) => m.locus)).toEqual(["837/NM1[0]-9"]);
  });
});

describe("deidentifyX12String, an N4 with an empty element between two it acts on", () => {
  it("acts on the city and the ZIP and leaves the empty state element where it was", () => {
    const { x12, manifest, unexaminedResiduals } = deidentifyX12String(
      interchange(["ST*837*0005~N4*ZZCITY**44101~SE*3*0005~"]),
      { context: ctx },
    );
    expect(x12).not.toContain("ZZCITY");
    expect(x12).toContain("~N4***441~");
    expect(manifest.map((m) => `${m.locus} ${m.disposition}`)).toEqual([
      "837/N4[0]-1 blocked",
      "837/N4[0]-3 transformed",
    ]);
    expect(unexaminedResiduals.map((r) => r.locus)).not.toContain("837/N4[0]-2");
  });
});

describe("deidentifyX12String, segments missing the element a rule acts on", () => {
  /** The segments between ST and SE, as the output carries them. */
  function body(x12: string): string[] {
    return x12.split("~").filter((s) => !/^(ISA|GS|ST|SE|GE|IEA)\*/.test(s) && s !== "");
  }

  it("removes an unknown segment whole and records each populated element, not an empty one", () => {
    const { x12, manifest } = deidentifyX12String(
      interchange(["ST*837*0006~ZZZ*ZZPATFIRST**ZZPATMEMBER~SE*3*0006~"]),
      { context: ctx },
    );
    expect(body(x12)).toEqual([]);
    expect(x12).toContain("~ST*837*0006~SE*2*0006~");
    expect(manifest.map((m) => `${m.locus} ${m.disposition}`)).toEqual([
      "837/<withheld>[0]-0 blocked",
      "837/<withheld>[0]-1 blocked",
      "837/<withheld>[0]-3 blocked",
    ]);
  });

  it("keeps a REF with a qualifier and no value, and records nothing for it", () => {
    const { x12, manifest, unexaminedResiduals } = deidentifyX12String(
      interchange(["ST*837*0007~REF*SY~SE*3*0007~"]),
      { context: ctx },
    );
    expect(body(x12)).toEqual(["REF*SY"]);
    expect(manifest).toEqual([]);
    // The qualifier is a position the REF rule read, so it is not an unexamined residual.
    expect(unexaminedResiduals.map((r) => r.locus)).not.toContain("837/REF[0]-1");
  });

  it("keeps a note segment whose free-text element is absent, and blocks nothing", () => {
    const { x12, manifest, unexaminedResiduals } = deidentifyX12String(
      interchange(["ST*837*0008~NTE*ADD~SE*3*0008~"]),
      { context: ctx },
    );
    expect(body(x12)).toEqual(["NTE*ADD"]);
    expect(manifest).toEqual([]);
    // The note code is decided by its shape, so nothing is left unexamined.
    expect(unexaminedResiduals).toEqual([]);
  });
});

describe("deidentifyX12String, an interchange with no group or interchange trailer", () => {
  it("acts on the transaction and counts only the envelope segments it was given", () => {
    const raw = [
      ISA,
      "GS*HC*COMMERCIAL*CLINICSUBMTR*20260615*0930*2*X*005010X222A2~",
      "ST*837*0009~NM1*IL*1*ZZPATLAST~SE*3*0009~",
    ].join("");
    const { x12, manifest, unexaminedResiduals } = deidentifyX12String(raw, { context: ctx });
    expect(x12).not.toContain("ZZPATLAST");
    expect(x12.endsWith("~ST*837*0009~NM1*IL*1*~SE*3*0009~")).toBe(true);
    expect(manifest.map((m) => m.locus)).toEqual(["837/NM1[0]-3"]);
    // The envelope segments it was given are decided by their shape; the missing ones are not invented.
    expect(x12).toContain("~GS*HC*COMMERCIAL*CLINICSUBMTR*20260615*0930*2*X*005010X222A2~");
    expect(unexaminedResiduals).toEqual([]);
  });
});

describe("applyX12, hand-built coordinates", () => {
  it("skips a coordinate with no transformed locus beside it, and a hole in the coordinate list", () => {
    const raw = interchange([SUBSCRIBER]);
    const removed: TransformedLocus = {
      path: "x",
      kind: "identifier",
      value: null,
      disposition: "removed",
    };
    const coords: X12Coord[] = [];
    coords[1] = { groupIndex: 0, txIndex: 0, segIndex: 1, elements: [3] }; // index 0 is a hole
    coords[2] = { groupIndex: 0, txIndex: 0, segIndex: 1, elements: [9] }; // no transformed[2]
    const out = applyX12(parseX12(raw), [removed, removed], coords);
    expect(out).not.toContain("ZZSUBLAST");
    expect(out).toContain("ZZSUBFIRST");
    expect(out).toContain("ZZMEMBERX12");
  });
});
