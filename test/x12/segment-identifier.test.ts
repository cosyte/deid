/**
 * **X12: a segment identifier is decided too.** `@cosyte/x12` reads a segment's identifier as the text
 * before its first element separator. An extra segment terminator, or a missing element separator after
 * the identifier, puts a value there instead: a member id, a date of birth, a telephone number, a first
 * name, or a whole segment run together. The parser keeps that text in element 0 (and names the segment
 * `(non-spec)` when it is no identifier shape at all), so a pass that starts at element 1 would re-emit
 * it with no row.
 *
 * A segment whose identifier the pass does not recognize is removed whole, identifier included, and each
 * value it carried is recorded at its own position under a withheld segment id. The `SE-01` count of the
 * transaction set it sat in is reduced to match. A segment outside every transaction set is removed the
 * same way and recorded under `orphan`.
 *
 * Every value is a synthetic, ZZ-tagged sentinel, a reserved 555 telephone number, or a synthetic date.
 */

import { describe, expect, it } from "vitest";
import { parseX12 } from "@cosyte/x12";

import { createDeidContext, type DeidManifestEntry } from "../../src/index.js";
import { deidentifyX12String } from "../../src/x12/index.js";

const ctx = createDeidContext({
  key: "x12-segment-identifier-synthetic-hmac-key",
  patientId: "p-x12-segment-identifier",
});

const ISA =
  "ISA*00*          *00*          *ZZ*A              *ZZ*B              *260615*0930*^*00501*000000006*0*P*:~";
const GS = "GS*HC*A*B*20260615*0930*6*X*005010X222A2~";
const W = "<withheld>";

/** Wrap one transaction body in an 837 interchange; SE-01 counts the body as the parser splits it. */
function wrap(body: string): string {
  const segments = body.split("~").filter((s) => s.length > 0).length + 2;
  return `${ISA}${GS}ST*837*0006~${body}SE*${String(segments)}*0006~GE*1*6~IEA*1*000000006~`;
}

/** The body segments of the first transaction set, and its SE, without the envelope. */
function body(x12: string): { segments: string[]; se: string } {
  const all = x12.split("~");
  const st = all.findIndex((s) => s.startsWith("ST*"));
  const se = all.findIndex((s) => s.startsWith("SE*"));
  return { segments: all.slice(st + 1, se), se: all[se] ?? "" };
}

function run(raw: string): {
  x12: string;
  manifest: readonly DeidManifestEntry[];
  residuals: readonly string[];
} {
  const { x12, manifest, unexaminedResiduals } = deidentifyX12String(raw, { context: ctx });
  return { x12, manifest, residuals: unexaminedResiduals.map((r) => r.locus) };
}

/** `true` when the manifest records a fail-closed block at exactly this position. */
function blockedAt(manifest: readonly DeidManifestEntry[], locus: string): boolean {
  return manifest.some((e) => e.locus === locus && e.disposition === "blocked");
}

describe("a segment whose identifier the pass does not recognize is removed whole", () => {
  it("an identifier after an extra terminator at the end of an NM1", () => {
    const raw = wrap("NM1*IL*1*ZZPATLAST*ZZPATFIRST~ZZPATMEMBER~");
    expect(parseX12(raw).groups[0]?.transactions[0]?.segments[2]?.id).toBe("(non-spec)");
    const { x12, manifest, residuals } = run(raw);
    expect(x12).not.toContain("ZZPATMEMBER");
    expect(body(x12)).toEqual({ segments: ["NM1*IL*1**"], se: "SE*3*0006" });
    expect(blockedAt(manifest, `837/${W}[0]-0`)).toBe(true);
    expect(residuals).toEqual([]);
  });

  it("a date of birth after an extra terminator inside a DMG", () => {
    const { x12, manifest, residuals } = run(wrap("DMG*D8~19800101*F~"));
    expect(x12).not.toContain("19800101");
    expect(body(x12)).toEqual({ segments: ["DMG*D8"], se: "SE*3*0006" });
    expect(blockedAt(manifest, `837/${W}[0]-0`)).toBe(true);
    expect(blockedAt(manifest, `837/${W}[0]-1`)).toBe(true);
    expect(residuals).toEqual([]);
  });

  it("a telephone number after an extra terminator inside a PER", () => {
    const { x12, manifest } = run(wrap("PER*IC*ZZCONTACT*TE~5559876543~"));
    expect(x12).not.toContain("5559876543");
    expect(x12).not.toContain("ZZCONTACT");
    expect(body(x12)).toEqual({ segments: ["PER*IC**TE"], se: "SE*3*0006" });
    expect(blockedAt(manifest, `837/${W}[0]-0`)).toBe(true);
  });

  it("a first name after an extra terminator, with the member id behind it", () => {
    const { x12, manifest } = run(wrap("NM1*IL*1*ZZPATLAST~ZZPATFIRST****MI*ZZPATMEMBER~"));
    for (const sentinel of ["ZZPATLAST", "ZZPATFIRST", "ZZPATMEMBER"]) {
      expect(x12).not.toContain(sentinel);
    }
    expect(body(x12)).toEqual({ segments: ["NM1*IL*1*"], se: "SE*3*0006" });
    for (const element of [0, 4, 5]) {
      expect(blockedAt(manifest, `837/${W}[0]-${String(element)}`)).toBe(true);
    }
  });

  it("a member id inside a diagnosis composite after an extra terminator", () => {
    const { x12, manifest } = run(wrap("HI*ABK:J449~ZZPATMEMBER:X~"));
    expect(x12).not.toContain("ZZPATMEMBER");
    expect(body(x12)).toEqual({ segments: ["HI*ABK:J449"], se: "SE*3*0006" });
    expect(blockedAt(manifest, `837/${W}[0]-0`)).toBe(true);
  });

  it("a member id run into the identifier by a missing element separator", () => {
    const { x12, manifest } = run(wrap("NM1ZZPATMEMBER*X~"));
    expect(x12).not.toContain("ZZPATMEMBER");
    expect(body(x12)).toEqual({ segments: [], se: "SE*2*0006" });
    expect(blockedAt(manifest, `837/${W}[0]-0`)).toBe(true);
    expect(blockedAt(manifest, `837/${W}[0]-1`)).toBe(true);
  });

  it("a short value that has the shape of an identifier, but is not one the pass knows", () => {
    // `ZZP` passes the bare identifier grammar, so the parser keeps it as the id; a two-letter last name
    // or a name suffix would too. It is neither re-emitted nor printed in the manifest path.
    const raw = wrap("NM1*IL*1~ZZP*ZZPATFIRST~");
    expect(parseX12(raw).groups[0]?.transactions[0]?.segments[2]?.id).toBe("ZZP");
    const { x12, manifest } = run(raw);
    expect(x12).not.toContain("ZZP*");
    expect(x12).not.toContain("ZZPATFIRST");
    expect(body(x12)).toEqual({ segments: ["NM1*IL*1"], se: "SE*3*0006" });
    expect(manifest.some((e) => e.locus.includes("ZZP"))).toBe(false);
    expect(blockedAt(manifest, `837/${W}[0]-0`)).toBe(true);
    expect(blockedAt(manifest, `837/${W}[0]-1`)).toBe(true);
  });

  it("a segment with no identifier at all", () => {
    const { x12, manifest } = run(wrap("NM1*IL*1~*ZZPATMEMBER~"));
    expect(x12).not.toContain("ZZPATMEMBER");
    expect(body(x12)).toEqual({ segments: ["NM1*IL*1"], se: "SE*3*0006" });
    // An empty identifier carries no value, so only the member id has a row.
    expect(blockedAt(manifest, `837/${W}[0]-0`)).toBe(false);
    expect(blockedAt(manifest, `837/${W}[0]-1`)).toBe(true);
  });

  it("two such segments in one transaction set keep distinct rows, and SE-01 counts both out", () => {
    const { x12, manifest } = run(wrap("ZZPATMEMBER~HI*ABK:J449~ZZPATMEMBER2~"));
    expect(x12).not.toContain("ZZPATMEMBER");
    expect(body(x12)).toEqual({ segments: ["HI*ABK:J449"], se: "SE*3*0006" });
    expect(blockedAt(manifest, `837/${W}[0]-0`)).toBe(true);
    expect(blockedAt(manifest, `837/${W}[1]-0`)).toBe(true);
  });

  it("an SE-01 that is no count is removed by its own shape, not reduced", () => {
    const raw = wrap("ZZPATMEMBER~").replace(/SE\*3\*0006/, "SE*ZZ*0006");
    const { x12, manifest } = run(raw);
    expect(x12).not.toContain("ZZPATMEMBER");
    expect(body(x12)).toEqual({ segments: [], se: "SE**0006" });
    expect(blockedAt(manifest, "837/SE[0]-1")).toBe(true);
  });

  it("the output parses again, and its SE-01 matches the segments it carries", () => {
    const { x12 } = run(wrap("NM1*IL*1*ZZPATLAST*ZZPATFIRST~ZZPATMEMBER~DMG*D8~19800101*F~"));
    const tx = parseX12(x12).groups[0]?.transactions[0];
    expect(tx?.segments.map((s) => s.id)).toEqual(["ST", "NM1", "DMG", "SE"]);
    expect(tx?.se?.elements[1]).toBe("4");
  });
});

describe("a segment outside every transaction set is removed whole, identifier included", () => {
  it("an identifier between GE and the next GS", () => {
    const raw =
      `${ISA}${GS}ST*837*0006~HI*ABK:E1165~SE*3*0006~GE*1*6~ZZPATMEMBER2~` +
      `GS*HC*A*B*20260615*0930*7*X*005010X222A2~ST*837*0007~HI*ABK:E1165~SE*3*0007~GE*1*7~` +
      "IEA*2*000000006~";
    expect(parseX12(raw).orphanSegments).toHaveLength(1);
    const { x12, manifest, residuals } = run(raw);
    expect(x12).not.toContain("ZZPATMEMBER2");
    expect(x12).toContain("GE*1*6~GS*HC*A*B*20260615*0930*7*");
    expect(blockedAt(manifest, `orphan/${W}[0]-0`)).toBe(true);
    expect(residuals).toEqual([]);
  });

  it("an identifier between the ISA and the first GS", () => {
    const raw = `${ISA}ZZPATMEMBER3~${GS}ST*837*0006~HI*ABK:E1165~SE*3*0006~GE*1*6~IEA*1*000000006~`;
    expect(parseX12(raw).orphanSegments).toHaveLength(1);
    const { x12, manifest } = run(raw);
    expect(x12).not.toContain("ZZPATMEMBER3");
    expect(x12.startsWith(`${ISA}${GS}`)).toBe(true);
    expect(blockedAt(manifest, `orphan/${W}[0]-0`)).toBe(true);
  });

  it("a TA1 the parser lifted out from between an ST and its SE counts out of that SE-01", () => {
    const raw = wrap("HI*ABK:E1165~TA1*000000008*260615*1200*A*000~");
    const parsed = parseX12(raw);
    expect(parsed.orphanSegments[0]?.anchor.kind).toBe("transaction");
    expect(parsed.groups[0]?.transactions[0]?.se?.elements[1]).toBe("4");
    const { x12, manifest } = run(raw);
    expect(x12).not.toContain("TA1");
    expect(body(x12)).toEqual({ segments: ["HI*ABK:E1165"], se: "SE*3*0006" });
    for (const element of [0, 1, 2, 3, 4, 5]) {
      expect(blockedAt(manifest, `orphan/TA1[0]-${String(element)}`)).toBe(true);
    }
  });
});
