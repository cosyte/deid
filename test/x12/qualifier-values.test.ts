/**
 * **X12: a value in a qualifier or code position is kept only when it is a code the position knows.**
 * The rules read a code at `NM1-01` / `N1-01` (entity identifier), `NM1-08` / `N1-03` (identification
 * code qualifier), `REF-01` (reference identification qualifier), and `N4-02` / `N4-04` (state and
 * country), and they keep that code as it is. A sender who drops one element separator shifts the
 * next value left by one position, so an identifier can land where a code belongs. Kept verbatim, it
 * would leave with no manifest row and no unexamined residual, because the position counts as
 * examined. So a value the position's code list does not hold is removed and recorded at its own
 * position, exactly as an unrecognized structure is, and a recognized code is kept as before.
 *
 * Every value is a synthetic, ZZ-tagged sentinel.
 */

import { describe, expect, it } from "vitest";

import { createDeidContext, type DeidManifestEntry } from "../../src/index.js";
import { deidentifyX12String } from "../../src/x12/index.js";

const ctx = createDeidContext({
  key: "x12-qualifier-synthetic-hmac-key",
  patientId: "p-x12-qualifier",
});

const ISA =
  "ISA*00*          *00*          *ZZ*A              *ZZ*B              *260615*0930*^*00501*000000004*0*P*:~";

/** Wrap one transaction body in an 837 interchange with transaction set control number `0004`. */
function wrap(body: string, segments: number): string {
  return `${ISA}GS*HC*A*B*20260615*0930*4*X*005010X222A2~ST*837*0004~${body}SE*${String(segments)}*0004~GE*1*4~IEA*1*000000004~`;
}

/**
 * The body segments of the one transaction set, without the envelope, each with its terminator: an
 * expected segment written with its `~` reads as one segment to the PHI scanner, not glued to the next.
 */
function body(x12: string): string[] {
  const all = x12.split("~");
  const st = all.findIndex((s) => s.startsWith("ST*"));
  const se = all.findIndex((s) => s.startsWith("SE*"));
  return all.slice(st + 1, se).map((segment) => `${segment}~`);
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

describe("an identifier shifted into a qualifier position is removed and recorded", () => {
  it("NM1-08: the exact one-separator-short patient segment", () => {
    // Five separators between `1` and `MI` instead of six: `MI` lands in NM1-07 (a name component)
    // and the member id lands in NM1-08, the qualifier position.
    const raw = wrap("NM1*QC*1*****MI*ZZPATMEMBER~", 3);
    expect(raw).toContain("ZZPATMEMBER");
    const { x12, manifest, residuals } = run(raw);
    expect(x12).not.toContain("ZZPATMEMBER");
    expect(blockedAt(manifest, "837/NM1[0]-8")).toBe(true);
    // The name component it displaced is still removed under its own row.
    expect(manifest.some((e) => e.locus === "837/NM1[0]-3")).toBe(true);
    // Recorded once, as a block: never also counted as unexamined.
    expect(residuals).not.toContain("837/NM1[0]-8");
    expect(body(x12)).toEqual(["NM1*QC*1******~"]);
  });

  it("NM1-08 on a retained provider party: the shifted value goes, the provider name stays", () => {
    const raw = wrap("NM1*85*2*ZZBILLINGORG****XX*ZZPATMEMBER~", 3);
    const { x12, manifest } = run(raw);
    expect(x12).not.toContain("ZZPATMEMBER");
    expect(x12).toContain("ZZBILLINGORG");
    expect(blockedAt(manifest, "837/NM1[0]-8")).toBe(true);
    // The party-role row still sits at NM1-01; the two positions do not share a row.
    expect(manifest.filter((e) => e.locus === "837/NM1[0]-1")).toHaveLength(1);
  });

  it("NM1-01: a value that is no entity code is removed, and the party still fails closed", () => {
    const raw = wrap("NM1*ZZPATMEMBER*1*ZZPATLAST*ZZPATFIRST~", 3);
    const { x12, manifest, residuals } = run(raw);
    expect(x12).not.toContain("ZZPATMEMBER");
    expect(x12).not.toContain("ZZPATLAST");
    expect(blockedAt(manifest, "837/NM1[0]-1")).toBe(true);
    expect(residuals).not.toContain("837/NM1[0]-1");
  });

  it("N1-03: the one-separator-short party segment, for a subject party and a retained one", () => {
    // N1-03 is the qualifier; with it missing, the identifier lands there and N1-04 is empty.
    const subject = run(wrap("N1*IL*ZZSUBNAME*ZZPATMEMBER~", 3));
    expect(subject.x12).not.toContain("ZZPATMEMBER");
    expect(subject.x12).not.toContain("ZZSUBNAME");
    expect(blockedAt(subject.manifest, "837/N1[0]-3")).toBe(true);
    expect(subject.residuals).not.toContain("837/N1[0]-3");

    // The same shift on a party that carries no name at all.
    const nameless = run(wrap("N1*IL**ZZPATMEMBER~", 3));
    expect(nameless.x12).not.toContain("ZZPATMEMBER");
    expect(blockedAt(nameless.manifest, "837/N1[0]-3")).toBe(true);

    const payer = run(wrap("N1*PR*ZZPAYERORG*ZZPATMEMBER~", 3));
    expect(payer.x12).not.toContain("ZZPATMEMBER");
    expect(payer.x12).toContain("ZZPAYERORG");
    expect(blockedAt(payer.manifest, "837/N1[0]-3")).toBe(true);
  });

  it("N1-01: a value that is no entity code is removed", () => {
    const { x12, manifest } = run(wrap("N1*ZZPATMEMBER*ZZPATNAME~", 3));
    expect(x12).not.toContain("ZZPATMEMBER");
    expect(x12).not.toContain("ZZPATNAME");
    expect(blockedAt(manifest, "837/N1[0]-1")).toBe(true);
  });

  it("REF-01: the one-separator-short reference, with and without a value after it", () => {
    // With the qualifier missing, the identifier is REF-01 and REF-02 is empty.
    const alone = run(wrap("REF*ZZPATMEMBER~", 3));
    expect(alone.x12).not.toContain("ZZPATMEMBER");
    expect(blockedAt(alone.manifest, "837/REF[0]-1")).toBe(true);
    expect(alone.residuals).not.toContain("837/REF[0]-1");
    expect(body(alone.x12)).toEqual(["REF*~"]);

    // Qualifier and value run together: REF-01 is not a code, and REF-02 still fails closed.
    const joined = run(wrap("REF*1WZZPATMEMBER*ZZPATCLAIM~", 3));
    expect(joined.x12).not.toContain("ZZPATMEMBER");
    expect(joined.x12).not.toContain("ZZPATCLAIM");
    expect(blockedAt(joined.manifest, "837/REF[0]-1")).toBe(true);
    expect(blockedAt(joined.manifest, "837/REF[0]-2")).toBe(true);
  });

  it("REF-01: `ZZ` is on neither REF table, so the qualifier goes with the value it routes", () => {
    // `ZZ` is not on either REF table, so the value fails closed and so does the qualifier.
    const { x12, manifest } = run(wrap("REF*ZZ*ZZUNKNOWNREF~", 3));
    expect(x12).not.toContain("ZZUNKNOWNREF");
    expect(body(x12)).toEqual(["REF**~"]);
    expect(blockedAt(manifest, "837/REF[0]-1")).toBe(true);
  });

  it("N4-02: a postal code shifted into the state position is removed, not kept whole", () => {
    // The state is missing, so the five-digit ZIP lands in N4-02 and N4-03 is empty.
    const { x12, manifest, residuals } = run(wrap("N4*ZZPATCITY*44101~", 3));
    expect(x12).not.toContain("44101");
    expect(x12).not.toContain("ZZPATCITY");
    expect(blockedAt(manifest, "837/N4[0]-2")).toBe(true);
    expect(residuals).not.toContain("837/N4[0]-2");
  });

  it("N4-04: a value that is no country code is removed", () => {
    const { x12, manifest } = run(wrap("N4*ZZPATCITY*OH*44101*ZZPATLOCID~", 3));
    expect(x12).not.toContain("ZZPATLOCID");
    expect(blockedAt(manifest, "837/N4[0]-4")).toBe(true);
    expect(body(x12)).toEqual(["N4**OH*441*~"]);
  });

  it("a qualifier must be the code itself: a lower-case or padded spelling is removed", () => {
    const lower = run(wrap("NM1*QC*1*ZZPATLAST*****mi*ZZPATMEMBER~", 3));
    expect(blockedAt(lower.manifest, "837/NM1[0]-8")).toBe(true);
    expect(lower.x12).not.toContain("ZZPATMEMBER");
    const padded = run(wrap("REF* SY*900000201~", 3));
    expect(blockedAt(padded.manifest, "837/REF[0]-1")).toBe(true);
    expect(padded.x12).not.toContain("900000201");
  });
});

describe("a recognized code in a qualifier position is kept as before", () => {
  it("keeps the entity code, the identification code qualifier, the REF qualifier, state and country", () => {
    const raw = wrap(
      [
        "NM1*QC*1*ZZPATLAST*ZZPATFIRST****MI*ZZPATMEMBER~",
        "NM1*85*2*ZZBILLINGORG*****XX*1999999999~",
        "N1*PR*ZZPAYERORG*PI*ZZPAYERID~",
        "N1*IL*ZZSUBNAME*MI*ZZSUBMEMBER~",
        "REF*F8*ZZCLAIMCTRL~",
        "REF*SY*900000201~",
        "N4*ZZPATCITY*OH*44101*US~",
      ].join(""),
      9,
    );
    const { x12, manifest } = run(raw);
    expect(body(x12)).toEqual([
      "NM1*QC*1******MI*~",
      "NM1*85*2*ZZBILLINGORG*****XX*1999999999~",
      "N1*PR*ZZPAYERORG*PI*ZZPAYERID~",
      "N1*IL**MI*~",
      "REF*F8*ZZCLAIMCTRL~",
      "REF*SY*~",
      "N4**OH*441*US~",
    ]);
    for (const position of [
      "NM1[0]-1",
      "NM1[0]-8",
      "NM1[1]-8",
      "N1[0]-3",
      "N1[1]-1",
      "N1[1]-3",
      "REF[0]-1",
      "REF[1]-1",
      "N4[0]-2",
      "N4[0]-4",
    ]) {
      expect(blockedAt(manifest, `837/${position}`)).toBe(false);
    }
  });

  it("keeps every identification code qualifier a provider, payer or submitter party carries", () => {
    for (const code of ["XX", "46", "PI", "XV", "FI", "24", "34", "SV", "NI", "PP", "AD"]) {
      const { x12, manifest } = run(wrap(`NM1*85*2*ZZBILLINGORG*****${code}*ZZPROVID~`, 3));
      expect(body(x12)).toEqual([`NM1*85*2*ZZBILLINGORG*****${code}*ZZPROVID~`]);
      expect(blockedAt(manifest, "837/NM1[0]-8")).toBe(false);
    }
  });

  it("keeps a Canadian province and a non-US country code", () => {
    const { x12 } = run(wrap("N4*ZZPATCITY*ON*K1A0B1*CA~", 3));
    expect(body(x12)[0]).toMatch(/^N4\*\*ON\*.*\*CA~$/);
  });
});
