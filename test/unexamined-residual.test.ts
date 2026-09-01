/**
 * **Unexamined residual positions**: the measurement that tells an *empty* residual inventory apart from
 * an *unmeasured* one.
 *
 * The library fails closed on structures and not on the positions inside a structure it hands through, so
 * a value-bearing position no locus rule reaches used to leave untouched **and recorded nowhere**. The
 * pass-through is a stated limitation a consumer can filter for; the silence is not, because an empty
 * residual inventory reads the same whether the pass found nothing or measured nothing, and a determiner
 * acts on that emptiness.
 *
 * This suite pins the core of the measurement: that a handed-through position is recorded with its
 * structural locus, that the count travels with the pass, and the two fail-safes, an inexpressible locus
 * is still counted and an unenumerable structure fails the pass rather than contributing a zero.
 *
 * Every suite here is written to be **non-vacuous**: each asserted position is first shown to carry a
 * value in the input, so an assertion cannot pass because the position was never there. Every value is a
 * synthetic sentinel or a synthetic timestamp; the fixture literals are declared in
 * `scripts/phi-allow-list.txt`.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import { parseCcda } from "@cosyte/ccda";
import { parseHL7 } from "@cosyte/hl7";
import { parseTelecom, type TelecomTransaction } from "@cosyte/ncpdp/telecom";

import {
  buildExpertDeterminationSupportReport,
  createDeidContext,
  DeidError,
  DEID_DISPOSITION_CODES,
  FATAL_CODES,
  WITHHELD_LOCUS_TOKEN,
} from "../src/index.js";
import {
  enumerateOrFail,
  failUnenumerableStructure,
  UnexaminedResidualBuilder,
} from "../src/residual.js";
import { deidentifyCcda } from "../src/ccda/index.js";
import { deidentifyHl7 } from "../src/hl7/index.js";
import { extractTelecomLoci } from "../src/ncpdp/index.js";

const D = DEID_DISPOSITION_CODES;

const FIX = (fmt: string, file: string): string =>
  readFileSync(join(import.meta.dirname, "fixtures", fmt, file), "utf8");

const FIXTURE_CCDA = FIX("ccda", "ccd.xml");
const FIXTURE_TELECOM = FIX("ncpdp", "telecom-b1.ncpdp");

/** Build an HL7 v2 segment from `{ field number -> value }`, so no assertion rests on counting pipes. */
function segment(id: string, fields: Readonly<Record<number, string>>): string {
  const highest = Math.max(...Object.keys(fields).map(Number));
  const parts = [id];
  for (let n = 1; n <= highest; n += 1) parts.push(fields[n] ?? "");
  return parts.join("|");
}

/**
 * An ADT with a referring doctor in `PV1-8` and a patient location in `PV1-3`: value-bearing positions
 * inside a segment the retain-list hands through that no locus rule names. `PV1-44` / `PV1-45` are the
 * control in the other direction, the admit and discharge dates the carve-out table DOES name.
 */
const ADT = [
  "MSH|^~\\&|APP|FAC|RCV|RFAC|20240315103000||ADT^A01|ZZMSG900|P|2.5.1",
  "PID|1||ZZMRN900^^^HOSP^MR||ZZFAMILY^ZZGIVEN||19850302|F",
  segment("PV1", {
    1: "1",
    2: "I",
    3: "ZZWARD^ZZROOM^ZZBED",
    7: "ZZATTID^ZZATTFAM^ZZATTGIV",
    8: "ZZREFID^ZZREFFAM^ZZREFGIV",
    44: "20200103040500",
    45: "20200109060700",
  }),
].join("\r");

const locusOf = (residuals: readonly { readonly locus: string }[]): string[] =>
  residuals.map((r) => r.locus);

describe("a handed-through position no locus rule names is recorded with its structural locus", () => {
  const { manifest, unexaminedResiduals } = deidentifyHl7(parseHL7(ADT), {});

  it("the positions are really there to begin with (non-vacuity)", () => {
    const original = parseHL7(ADT);
    expect(original.get("PV1.8.2")).toBe("ZZREFFAM");
    expect(original.get("PV1.3.1")).toBe("ZZWARD");
    expect(original.get("PV1.44")).toBe("20200103040500");
  });

  it("records the referring provider's name components, at their own positions", () => {
    const loci = locusOf(unexaminedResiduals);
    expect(loci).toContain("PV1-8.1");
    expect(loci).toContain("PV1-8.2");
    expect(loci).toContain("PV1-8.3");
    expect(loci).toContain("PV1-3.1");
  });

  it("each record carries the fact of being unexamined, its code and a count, and no value", () => {
    const referring = unexaminedResiduals.find((r) => r.locus === "PV1-8.2");
    expect(referring).toEqual({
      locus: "PV1-8.2",
      count: 1,
      examined: false,
      locusWithheld: false,
      code: D.DEID_POSITION_UNEXAMINED,
    });
    // The whole list, serialized, carries not one value from the document it measured.
    const serialized = JSON.stringify(unexaminedResiduals);
    for (const value of ["ZZREFFAM", "ZZREFGIV", "ZZWARD", "ZZMRN900", "19850302"]) {
      expect(serialized).not.toContain(value);
    }
  });

  it("and never lists a position the same pass acted on, blocked or named a rule for", () => {
    const loci = new Set(locusOf(unexaminedResiduals));
    // Acted on: the admit and discharge dates the carve-out table names, and the mapped PID loci.
    for (const named of ["PV1-44", "PV1-45", "PID-3", "PID-3[0]", "PID-5", "PID-7"]) {
      expect(loci.has(named)).toBe(false);
    }
    // Not one manifest locus is in the unexamined list: the two lists are disjoint by construction.
    for (const entry of manifest) expect(loci.has(entry.locus)).toBe(false);
  });
});

describe("the count travels with the pass and reaches the report beside the categories acted on", () => {
  const ctx = createDeidContext({ key: "unexamined-count", patientId: "p-count" });
  const { manifest, unexaminedResiduals } = deidentifyHl7(parseHL7(ADT), { context: ctx });

  it("the pass returns a count of the positions it handed through unexamined", () => {
    const total = unexaminedResiduals.reduce((sum, r) => sum + r.count, 0);
    expect(total).toBeGreaterThan(0);
    expect(unexaminedResiduals.every((r) => r.count >= 1)).toBe(true);
  });

  it("and the report carries that count in the roll-up, alongside the categories acted on", () => {
    const report = buildExpertDeterminationSupportReport(manifest, { unexaminedResiduals });
    const total = unexaminedResiduals.reduce((sum, r) => sum + r.count, 0);
    expect(report.dispositionSummary.unexaminedResidualPositions).toBe(total);
    expect(report.totals.categoriesActedOn).toBeGreaterThan(0);
    expect(report.unexaminedResidualsMeasured).toBe(true);
  });

  it("the count is NOT folded into any of the four dispositions", () => {
    const report = buildExpertDeterminationSupportReport(manifest, { unexaminedResiduals });
    const d = report.dispositionSummary;
    const acted = manifest.reduce((sum, e) => sum + e.count, 0);
    expect(d.transformed + d.removed + d.blocked + d.retained).toBe(acted);
  });
});

describe("fail-safe one: a locus that cannot be expressed is counted, never dropped", () => {
  it("an inexpressible locus is recorded under the withheld token and flagged", () => {
    const builder = new UnexaminedResidualBuilder();
    builder.record(undefined);
    builder.record("");
    expect(builder.total).toBe(2);
    expect(builder.build()).toEqual([
      {
        locus: WITHHELD_LOCUS_TOKEN,
        count: 2,
        examined: false,
        locusWithheld: true,
        code: D.DEID_POSITION_UNEXAMINED,
      },
    ]);
  });

  it("a locus composed AROUND a refused identifier keeps its coordinates and is still flagged", () => {
    const builder = new UnexaminedResidualBuilder();
    builder.record(`${WITHHELD_LOCUS_TOKEN}-7`);
    const [entry] = builder.build();
    expect(entry?.locus).toBe(`${WITHHELD_LOCUS_TOKEN}-7`);
    expect(entry?.locusWithheld).toBe(true);
    expect(entry?.count).toBe(1);
  });

  it("end to end: a position whose identifier the adapter may not echo is counted, locus withheld", () => {
    // A namespaced XML attribute name is not an `xmlName`, so the bound refuses it and the composed
    // locus can only say WHERE inside the element, not which attribute. The position is counted anyway.
    const { unexaminedResiduals } = deidentifyCcda(parseCcda(FIXTURE_CCDA), {});
    const withheld = unexaminedResiduals.filter((r) => r.locusWithheld);
    expect(withheld.length).toBeGreaterThan(0);
    expect(withheld.every((r) => r.locus.includes(WITHHELD_LOCUS_TOKEN))).toBe(true);
    expect(withheld.every((r) => r.count >= 1)).toBe(true);
    expect(withheld.every((r) => r.code === D.DEID_POSITION_UNEXAMINED)).toBe(true);
  });

  it("a measured zero is a list, not an absence", () => {
    const builder = new UnexaminedResidualBuilder();
    expect(builder.total).toBe(0);
    expect(builder.build()).toEqual([]);
  });
});

describe("fail-safe two: an unenumerable structure fails the pass, never a zero or a partial count", () => {
  it("raises a typed fatal that names the structure and carries no value", () => {
    expect(() => {
      failUnenumerableStructure("PV1[2]");
    }).toThrow(DeidError);
    try {
      failUnenumerableStructure("PV1[2]");
    } catch (err) {
      expect(err).toBeInstanceOf(DeidError);
      const fatal = err as DeidError;
      expect(fatal.code).toBe(FATAL_CODES.DEID_POSITIONS_UNENUMERABLE);
      expect(fatal.message).toContain("PV1[2]");
      expect(fatal.message).toContain("could not be enumerated");
    }
  });

  it("an enumeration that throws becomes that fatal, naming the structure it was walking", () => {
    try {
      enumerateOrFail("837/CLM[0]", () => {
        throw new TypeError("the model would not yield its elements");
      });
      expect.unreachable("the enumeration failure must not be swallowed");
    } catch (err) {
      expect(err).toBeInstanceOf(DeidError);
      expect((err as DeidError).code).toBe(FATAL_CODES.DEID_POSITIONS_UNENUMERABLE);
      expect((err as DeidError).message).toContain("837/CLM[0]");
    }
  });

  it("a structure with no name of its own still fails under the withheld token, never silently", () => {
    try {
      enumerateOrFail("", () => {
        throw new Error("unreadable");
      });
      expect.unreachable("the enumeration failure must not be swallowed");
    } catch (err) {
      expect((err as DeidError).message).toContain(WITHHELD_LOCUS_TOKEN);
    }
  });

  it("a fatal the engine itself decided on passes through unchanged, never relabelled", () => {
    // Re-labelling a DEID_NO_KEY as an enumeration failure would lose the reason the pass really failed.
    try {
      enumerateOrFail("PID", () => {
        throw new DeidError(FATAL_CODES.DEID_NO_KEY, "no key context was supplied");
      });
      expect.unreachable("the fatal must propagate");
    } catch (err) {
      expect((err as DeidError).code).toBe(FATAL_CODES.DEID_NO_KEY);
    }
  });

  it("end to end: an adapter whose structure will not enumerate returns nothing at all", () => {
    const real = parseTelecom(FIXTURE_TELECOM);
    // Everything about this transaction is the real one except that ONE segment refuses to yield its
    // fields, which is the condition the fail-safe exists for.
    const hostile: TelecomTransaction = {
      ...real,
      segments: [
        {
          segmentId: "07",
          byteOffset: 0,
          get fields(): never {
            throw new TypeError("the segment would not yield its fields");
          },
        },
      ],
    };
    let thrown: unknown;
    try {
      extractTelecomLoci(hostile);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(DeidError);
    expect((thrown as DeidError).code).toBe(FATAL_CODES.DEID_POSITIONS_UNENUMERABLE);
    // No result at all: not a zero, not a partial count. There is nothing to read a number off.
    expect((thrown as DeidError).message).toContain("07");
  });

  it("the same transaction enumerates cleanly when its segments do yield: the fatal is not vacuous", () => {
    const { unexaminedResiduals } = extractTelecomLoci(parseTelecom(FIXTURE_TELECOM));
    expect(unexaminedResiduals.length).toBeGreaterThan(0);
  });
});

describe("the two lists never merge: an unexamined position is not a residual of an examined value", () => {
  it("no unexamined record ever carries the examined-residual code", () => {
    const { unexaminedResiduals } = deidentifyHl7(parseHL7(ADT), {});
    expect(unexaminedResiduals.length).toBeGreaterThan(0);
    for (const residual of unexaminedResiduals) {
      expect(residual.code).toBe(D.DEID_POSITION_UNEXAMINED);
      expect(residual.examined).toBe(false);
    }
  });

  it("and no manifest entry ever carries the unexamined code", () => {
    const { manifest } = deidentifyHl7(parseHL7(ADT), {});
    expect(manifest.length).toBeGreaterThan(0);
    for (const entry of manifest) {
      expect(entry.code).not.toBe(D.DEID_POSITION_UNEXAMINED);
    }
  });
});
