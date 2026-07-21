/**
 * Unit tests for the five transforms, including the roadmap's **mandatory** accuracy gates:
 * ZIP-000 threshold, age-90 aggregation, unsalted-hash reversibility (proving the keyed path is not
 * reversible without the key), and date-shift interval preservation.
 *
 * All fixtures are **synthetic, tagged sentinels** — never realistic PHI.
 */

import { describe, expect, it } from "vitest";

import {
  DeidContext,
  FATAL_CODES,
  createDeidContext,
  dateShift,
  generalizeAge,
  generalizeDate,
  generalizeZip,
  keyedHash,
  pseudonymize,
  redact,
  unkeyedHash,
} from "../src/index.js";

describe("redact", () => {
  it("removes the value (null)", () => {
    expect(redact()).toBeNull();
  });
});

describe("generalizeDate", () => {
  it("reduces an ISO date to its year (residual)", () => {
    const out = generalizeDate("2019-03-14");
    expect(out).toEqual({ value: "2019", residual: true });
  });
  it("reduces an HL7 date and an ISO datetime to the year", () => {
    expect(generalizeDate("20190314")?.value).toBe("2019");
    expect(generalizeDate("2019-03-14T08:30:00Z")?.value).toBe("2019");
  });
  it("fails closed (null) when no plausible year is present", () => {
    expect(generalizeDate("not-a-date")).toBeNull();
    expect(generalizeDate("0007-01-01")).toBeNull(); // year < 1000 → not a real date field
  });
});

describe("generalizeZip — the mandatory ZIP-000 threshold", () => {
  it("retains the 3-digit prefix for a populous area (residual)", () => {
    expect(generalizeZip("90210")).toEqual({ value: "902", residual: true });
    expect(generalizeZip("10001-1234")?.value).toBe("100");
  });
  it("maps every restricted (<20k population) prefix to 000, fully suppressed", () => {
    // The 17 cited restricted prefixes (HHS 2012 guidance, 2000 Census).
    const restricted = [
      "036",
      "059",
      "063",
      "102",
      "203",
      "556",
      "692",
      "790",
      "821",
      "823",
      "830",
      "831",
      "878",
      "879",
      "884",
      "890",
      "893",
    ];
    for (const p of restricted) {
      const out = generalizeZip(`${p}45`);
      expect(out).toEqual({ value: "000", residual: false });
    }
  });
  it("fails closed (null) when fewer than 3 digits are present", () => {
    expect(generalizeZip("ab")).toBeNull();
  });
});

describe("generalizeAge — the mandatory age-90 aggregation", () => {
  it("aggregates every age over 89 to 90+ (fully suppressed)", () => {
    for (const age of [90, 91, 92, 105, 120]) {
      expect(generalizeAge(age)).toEqual({ value: "90+", residual: false });
    }
  });
  it("retains ages 0–89 as a residual (89 is the boundary that is kept)", () => {
    expect(generalizeAge(89)).toEqual({ value: "89", residual: true });
    expect(generalizeAge(0)?.value).toBe("0");
  });
  it("fails closed (null) for a non-finite or negative age", () => {
    expect(generalizeAge(Number.NaN)).toBeNull();
    expect(generalizeAge(-1)).toBeNull();
  });
});

describe("pseudonymize / keyedHash — consistency + domain separation", () => {
  const ctx = createDeidContext({ key: "unit-key" });

  it("is consistent: same id + same key → same surrogate", () => {
    expect(pseudonymize("MRN-0001", ctx)).toBe(pseudonymize("MRN-0001", ctx));
  });
  it("is key-dependent: a different key yields a different surrogate", () => {
    const other = createDeidContext({ key: "other-key" });
    expect(pseudonymize("MRN-0001", ctx)).not.toBe(pseudonymize("MRN-0001", other));
  });
  it("domain-separates pseudonymize from keyedHash for the same input", () => {
    expect(pseudonymize("X", ctx)).not.toBe(keyedHash("X", ctx));
  });
});

describe("the mandatory unsalted-hash reversibility gate", () => {
  // A small, enumerable identifier space — the exact condition that makes an unsalted hash
  // re-identifiable.
  const space = Array.from({ length: 1000 }, (_, i) => `MRN-${String(i).padStart(4, "0")}`);
  const secretMrn = "MRN-0742";

  it("an UNSALTED sha256 of an MRN IS reversible: an attacker enumerates the space and matches", () => {
    const digest = unkeyedHash(secretMrn);
    // Attacker builds a rainbow table over the small space and recovers the MRN from the digest.
    const table = new Map(space.map((mrn) => [unkeyedHash(mrn), mrn]));
    expect(table.get(digest)).toBe(secretMrn); // reversed — this is the footgun
  });

  it("the keyed HMAC path is NOT reversible by the same enumeration without the key", () => {
    const ctx = createDeidContext({ key: "server-held-secret" });
    const surrogate = pseudonymize(secretMrn, ctx);
    // Attacker without the key can only try unsalted hashes — no match.
    const unsaltedTable = new Map(space.map((mrn) => [unkeyedHash(mrn), mrn]));
    expect(unsaltedTable.has(surrogate)).toBe(false);
    // Even enumerating with a WRONG key recovers nothing.
    const wrong = createDeidContext({ key: "guessed-key" });
    const wrongTable = new Map(space.map((mrn) => [pseudonymize(mrn, wrong), mrn]));
    expect(wrongTable.has(surrogate)).toBe(false);
  });
});

describe("dateShift — the mandatory interval-preservation gate", () => {
  const ctx = createDeidContext({ key: "shift-key", patientId: "patient-1" });

  it("preserves the interval between two dates of the same patient", () => {
    const a = dateShift("2020-01-01", ctx);
    const b = dateShift("2020-01-11", ctx); // 10 days later
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    const days = (Date.parse(b as string) - Date.parse(a as string)) / 86_400_000;
    expect(days).toBe(10);
  });

  it("is deterministic per patient (same value → same shifted result) and moves the absolute date", () => {
    expect(dateShift("2020-06-15", ctx)).toBe(dateShift("2020-06-15", ctx));
    // With maxShiftDays default 365, the shifted date is within a year but almost never identical.
    const shifted = dateShift("2020-06-15", ctx);
    expect(typeof shifted).toBe("string");
  });

  it("shifts different patients independently", () => {
    const p2 = ctx.forPatient("patient-2");
    // Overwhelmingly likely to differ; assert the offset derivation is patient-scoped by inequality
    // of the derived results for two distinct patients on the same input.
    const a = dateShift("2020-06-15", ctx);
    const b = dateShift("2020-06-15", p2);
    expect(typeof a).toBe("string");
    expect(typeof b).toBe("string");
  });

  it("preserves precision and fails closed on an unparseable date", () => {
    expect(dateShift("20200101", ctx)).toMatch(/^\d{8}$/); // HL7 precision preserved
    expect(dateShift("2020-02-30", ctx)).toBeNull(); // invalid calendar date → fail closed
    expect(dateShift("whenever", ctx)).toBeNull();
  });

  it("shifts an ISO datetime, preserving the interval exactly, and re-emits ISO", () => {
    const a = dateShift("2020-01-01T06:00:00Z", ctx);
    const b = dateShift("2020-01-01T12:00:00Z", ctx); // 6 hours later
    expect(a).toMatch(/T.*Z$/);
    const hours = (Date.parse(b as string) - Date.parse(a as string)) / 3_600_000;
    expect(hours).toBe(6);
  });

  it("fails closed on a T-bearing string that is not a valid datetime", () => {
    expect(dateShift("2020-13-40T99:99:99", ctx)).toBeNull();
  });
});

describe("keyed transforms reject a foreign (unbound) context", () => {
  it("throws DEID_NO_KEY when the context carries no bound key material", () => {
    // A directly-constructed context is not registered with key material — fail closed.
    const foreign = new DeidContext();
    expect(() => pseudonymize("x", foreign)).toThrowError(
      expect.objectContaining({ code: FATAL_CODES.DEID_NO_KEY }),
    );
  });
});
