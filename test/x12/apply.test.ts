/**
 * **The X12 applier, driven directly.** The extractor never hands it some shapes the applier still has
 * to write correctly: two components of one element rewritten together, coordinates in a second
 * transaction set while the first carries none, and a blank line kept after the `IEA`.
 *
 * Every value is a synthetic code or a ZZ-tagged sentinel.
 */

import { describe, expect, it } from "vitest";
import { parseX12, serializeX12 } from "@cosyte/x12";

import { type TransformedLocus } from "../../src/index.js";
import { applyX12, type X12Coord } from "../../src/x12/index.js";

const ISA =
  "ISA*00*          *00*          *ZZ*A              *ZZ*B              *260615*0930*^*00501*000000008*0*P*:~";

const TWO_TRANSACTIONS = [
  `${ISA}GS*HC*A*B*20260615*0930*8*X*005010X222A2`,
  "ST*837*0001",
  "HI*BH:11:D8:20260103",
  "SE*3*0001",
  "ST*837*0002",
  "HI*BH:11:D8:20260104",
  "SE*3*0002",
  "GE*2*8",
  "IEA*1*000000008",
  "",
].join("~");

const removed = (path: string): TransformedLocus => ({
  path,
  kind: "identifier",
  value: null,
  disposition: "blocked",
});

describe("applyX12", () => {
  it("rewrites two components of one element together, and leaves a transaction with no edit alone", () => {
    const ix = parseX12(TWO_TRANSACTIONS);
    const at = { groupIndex: 0, txIndex: 1, segIndex: 1, elements: [1] };
    const coords: X12Coord[] = [
      { ...at, component: 2 },
      { ...at, component: 4 },
    ];
    const out = applyX12(ix, [removed("837/HI[0]-1-2"), removed("837/HI[0]-1-4")], coords);
    expect(out).toContain("~HI*BH:11:D8:20260103~");
    expect(out).toContain("~HI*BH::D8:~");
  });

  it("skips a coordinate with no transformed locus beside it", () => {
    const ix = parseX12(TWO_TRANSACTIONS);
    const coords: X12Coord[] = [{ groupIndex: 0, txIndex: 0, segIndex: 1, elements: [1] }];
    expect(applyX12(ix, [], coords)).toBe(TWO_TRANSACTIONS);
  });

  it("keeps blank bytes after the IEA, which carry no value", () => {
    const ix = parseX12(`${TWO_TRANSACTIONS}\r\n  `);
    expect(ix.trailingBytes).toBe("  ~");
    expect(applyX12(ix, [], [])).toBe(serializeX12(ix));
    expect(applyX12(ix, [], []).endsWith("IEA*1*000000008~  ~")).toBe(true);
  });
});
