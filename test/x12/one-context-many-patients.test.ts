/**
 * **X12: an interchange naming more than one person is handled under the one context it is given.**
 *
 * The question asked of the NCPDP adapter (does one call put two patients under one patient
 * context?) asked of this one. An `837` names a subscriber (2000B) and a dependent patient (2000C),
 * and an interchange can carry many claims for many patients, so that shape is ordinary and is not
 * refused. What this pins is the documented consequence: under a `date-shift` policy both people's
 * dates move by the one offset the context derives, and neither name survives. The limitations page
 * says so; when this changes, that page changes with it.
 *
 * The committed fixture's values are synthetic, ZZ-tagged sentinels.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { createDeidContext, LIMITED_DATA_SET_PROFILE, profileOptions } from "../../src/index.js";
import { deidentifyX12String } from "../../src/x12/index.js";

const ctx = createDeidContext({ key: "one-context-x12-synthetic-key", patientId: "p-one" });
const options = profileOptions(LIMITED_DATA_SET_PROFILE, ctx);
const RAW = readFileSync(join(import.meta.dirname, "..", "fixtures", "x12", "837p.edi"), "utf8");

/** `DMG-02` of every `DMG` segment, in order. */
function birthDates(x12: string): string[] {
  return x12
    .split("~")
    .map((s) => s.trim())
    .filter((s) => s.startsWith("DMG*"))
    .map((s) => s.split("*")[2] ?? "");
}

/** Whole days from `from` to `to`, both `YYYYMMDD`. */
function daysBetween(from: string, to: string): number {
  const at = (d: string): number =>
    Date.UTC(Number(d.slice(0, 4)), Number(d.slice(4, 6)) - 1, Number(d.slice(6, 8)));
  return (at(to) - at(from)) / 86_400_000;
}

describe("X12: a subscriber and a dependent patient share the context's one offset", () => {
  it("the fixture names two people with two birth dates (non-vacuity)", () => {
    expect(birthDates(RAW)).toEqual(["19850302", "20211130"]);
  });

  it("is handled, and both birth dates move by one offset", () => {
    const { x12 } = deidentifyX12String(RAW, options);
    const dates = birthDates(x12);
    expect(dates).toHaveLength(2);
    const [subscriber, patient] = dates as [string, string];
    expect(subscriber).not.toBe("19850302");
    expect(daysBetween("19850302", subscriber)).toBe(daysBetween("20211130", patient));
    for (const sentinel of ["ZZSUBLAST", "ZZPATLAST"]) {
      expect(x12).not.toContain(sentinel);
    }
  });
});
