/**
 * Release-hardening tests for the two date-shift nits fixed in DEID-10:
 *
 * 1. **ISO-datetime timezone dependence.** The shift must be a pure calendar-date operation — the
 *    time-of-day and zone travel through verbatim — so the same input yields the same output on every
 *    host regardless of the machine `TZ`. (The old path parsed a zoneless datetime as *local* time and
 *    re-emitted UTC via `toISOString()`, so the result — and sometimes the day — moved with `TZ`.)
 * 2. **The `maxShiftDays: 0` degenerate offset.** A bound flooring to 0 pinned every offset to 0, so a
 *    date-shift policy silently emitted the original real dates. It now fails closed at construction.
 *
 * All values are synthetic.
 */

import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { createDeidContext, dateShift, DeidError, FATAL_CODES } from "../src/index.js";

const ctx = createDeidContext({ key: "shift-key", patientId: "patient-1" });

describe("date-shift is timezone-independent (nit #1)", () => {
  it("shifts the calendar date only and preserves the time-of-day + zone suffix verbatim", () => {
    // The datetime's date part must move by the SAME whole-day offset as the bare date, proving the
    // datetime path uses pure calendar math (not a TZ-sensitive Date.parse / toISOString round-trip).
    const bareShift = dateShift("2020-06-15", ctx);
    const dtZoneless = dateShift("2020-06-15T12:30:45", ctx);
    const dtOffset = dateShift("2020-06-15T12:30:45.500+05:00", ctx);
    const dtZulu = dateShift("2020-06-15T23:59:59Z", ctx);

    expect(bareShift).not.toBeNull();
    // Date part matches the bare-date shift; suffix is preserved byte-for-byte.
    expect(dtZoneless).toBe(`${bareShift as string}T12:30:45`);
    expect(dtOffset).toBe(`${bareShift as string}T12:30:45.500+05:00`);
    expect(dtZulu).toBe(`${bareShift as string}T23:59:59Z`);
  });

  it("preserves sub-second precision and an explicit offset without reinterpreting them", () => {
    const out = dateShift("2019-03-14T09:15:00.123-08:00", ctx);
    expect(out).toMatch(/^\d{4}-\d{2}-\d{2}T09:15:00\.123-08:00$/);
  });

  it("produces byte-identical output under two different host timezones", () => {
    // The strongest proof: run the shift in a child process (via tsx, against source) under two very
    // different zones and require an identical result. Would have differed under the old local parse.
    const runner = fileURLToPath(new URL("./helpers/run-date-shift.ts", import.meta.url));
    const tsxBin = fileURLToPath(new URL("../node_modules/.bin/tsx", import.meta.url));
    const run = (tz: string): string =>
      execFileSync(tsxBin, [runner], {
        env: { ...process.env, TZ: tz },
        encoding: "utf8",
      }).trim();
    const kolkata = run("Asia/Kolkata"); // UTC+05:30
    const honolulu = run("Pacific/Honolulu"); // UTC-10:00
    expect(kolkata).toBe(honolulu);
    expect(kolkata).toMatch(/^\d{4}-\d{2}-\d{2}T00:30:00$/); // guard against a vacuous empty pass
  });
});

describe("date-shift maxShiftDays:0 fails closed (nit #2)", () => {
  it("rejects a maxShiftDays that floors to 0 (a guaranteed no-op shift is a leak)", () => {
    for (const bad of [0, 0.4, -0.9]) {
      expect(() =>
        createDeidContext({ key: "k", patientId: "p1", maxShiftDays: bad }),
      ).toThrowError(expect.objectContaining({ code: FATAL_CODES.DEID_CONTEXT_INVALID }));
    }
  });

  it("accepts maxShiftDays >= 1 and still shifts", () => {
    const tight = createDeidContext({ key: "k", patientId: "p1", maxShiftDays: 1 });
    const out = dateShift("2020-06-15", tight);
    // Within [-1, +1] days of the original — but a valid, defined value, not a rejected context.
    expect(out).toMatch(/^2020-06-1[456]$/);
  });

  it("the rejection is a DeidError carrying the stable fatal code", () => {
    try {
      createDeidContext({ key: "k", patientId: "p1", maxShiftDays: 0 });
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(DeidError);
      expect((err as DeidError).code).toBe(FATAL_CODES.DEID_CONTEXT_INVALID);
    }
  });
});
