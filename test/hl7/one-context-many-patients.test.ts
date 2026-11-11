/**
 * **HL7 v2: several patients under one context.**
 *
 * The question asked of the NCPDP adapter (does one call put two patients under one patient
 * context?) asked of this one, three ways:
 *
 * - Two messages written one after another, with no batch envelope, parse as one message whose
 *   second `MSH` is an ordinary segment. That is two messages, perhaps two patients', read as one,
 *   so both entry points refuse it, typed, before anything is extracted.
 * - A batch with its `FHS` / `BHS` envelope never reaches this library: `parseHL7` refuses it, and a
 *   caller splits it (`splitBatch`) and de-identifies each message on its own.
 * - An `ADT^A17` swaps two patients' PID segments inside one message. That shape is ordinary and is
 *   handled; what this pins is the documented consequence that under a `date-shift` policy both
 *   patients' dates move by the one offset the context derives. The limitations page says so; when
 *   this changes, that page changes with it.
 *
 * Every value is a synthetic, ZZ-tagged sentinel.
 */
import { describe, expect, it } from "vitest";
import { parseHL7 } from "@cosyte/hl7";

import {
  createDeidContext,
  DeidError,
  FATAL_CODES,
  LIMITED_DATA_SET_PROFILE,
  profileOptions,
} from "../../src/index.js";
import { deidentifyHl7, deidentifyHl7String } from "../../src/hl7/index.js";

const ctx = createDeidContext({ key: "one-context-hl7-synthetic-key", patientId: "p-one" });
const options = profileOptions(LIMITED_DATA_SET_PROFILE, ctx);

const MSH = (id: string, type: string): string =>
  `MSH|^~\\&|ZZAPP|ZZFAC|ZZRECV|ZZRFAC|20200101120000||${type}|${id}|P|2.5`;
const PID_ONE = "PID|1||ZZMRNONE^^^ZZH^MR||ZZONELAST^ZZONEFIRST||19900215|M";
const PID_TWO = "PID|1||ZZMRNTWO^^^ZZH^MR||ZZTWOLAST^ZZTWOFIRST||19700610|F";

/** Two messages, one patient each, written one after another with no envelope. */
const CONCATENATED = [MSH("ZZMSG1", "ADT^A08"), PID_ONE, MSH("ZZMSG2", "ADT^A08"), PID_TWO].join(
  "\r",
);

/** The same two messages inside a file and batch envelope. */
const BATCH = [
  "FHS|^~\\&|ZZAPP|ZZFAC",
  "BHS|^~\\&|ZZAPP|ZZFAC",
  CONCATENATED,
  "BTS|2",
  "FTS|1",
].join("\r");

/** One swap message carrying two patients' PID segments. */
const SWAP = [MSH("ZZMSG3", "ADT^A17"), "EVN|A17|20200101", PID_ONE, PID_TWO].join("\r");

/** Run `call` and return what it threw, or fail when it returned. */
function thrownBy(call: () => unknown): unknown {
  try {
    call();
  } catch (err) {
    return err;
  }
  throw new Error("expected a refusal, and the call returned");
}

/** PID-7 of every PID segment in an HL7 v2 string, in order. */
function birthDates(hl7: string): string[] {
  return hl7
    .split("\r")
    .filter((s) => s.startsWith("PID|"))
    .map((s) => s.split("|")[7] ?? "");
}

/** Whole days from `from` to `to`, both `YYYYMMDD`. */
function daysBetween(from: string, to: string): number {
  const at = (d: string): number =>
    Date.UTC(Number(d.slice(0, 4)), Number(d.slice(4, 6)) - 1, Number(d.slice(6, 8)));
  return (at(to) - at(from)) / 86_400_000;
}

describe("HL7 v2: two messages read as one are refused, typed", () => {
  it("the shape really parses as one message with two MSH segments (non-vacuity)", () => {
    const types = parseHL7(CONCATENATED)
      .allSegments()
      .map((s) => s.type);
    expect(types).toEqual(["MSH", "PID", "MSH", "PID"]);
  });

  it("both entry points refuse it, and the diagnostic reads nothing out of it", () => {
    for (const call of [
      () => deidentifyHl7(parseHL7(CONCATENATED), options),
      () => deidentifyHl7String(CONCATENATED, options),
    ]) {
      const err = thrownBy(call);
      expect(err).toBeInstanceOf(DeidError);
      expect((err as DeidError).code).toBe(FATAL_CODES.DEID_FORMAT_UNSUPPORTED);
      expect((err as DeidError).message).toContain("more than one MSH segment");
      const text = `${(err as Error).message} ${String((err as Error).stack)}`;
      for (const sentinel of ["ZZONELAST", "ZZTWOLAST", "ZZMRNONE", "ZZMSG2"]) {
        expect(text).not.toContain(sentinel);
      }
    }
  });

  it("a batch with its envelope is refused by the parser before it reaches this library", () => {
    expect(() => parseHL7(BATCH)).toThrow();
  });

  it("CONTROL: one message with one MSH is still de-identified", () => {
    const { hl7 } = deidentifyHl7String([MSH("ZZMSG4", "ADT^A08"), PID_ONE].join("\r"), options);
    expect(hl7).not.toContain("ZZONELAST");
  });
});

describe("HL7 v2: an ADT^A17 shares the context's one date-shift offset", () => {
  it("is handled, both birth dates moved by one offset", () => {
    const { hl7 } = deidentifyHl7(parseHL7(SWAP), options);
    const dates = birthDates(hl7);
    expect(dates).toHaveLength(2);
    const [one, two] = dates as [string, string];
    expect(one).not.toBe("19900215");
    expect(daysBetween("19900215", one)).toBe(daysBetween("19700610", two));
    for (const sentinel of ["ZZONELAST", "ZZTWOLAST", "ZZMRNONE", "ZZMRNTWO"]) {
      expect(hl7).not.toContain(sentinel);
    }
  });
});
