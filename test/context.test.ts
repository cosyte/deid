/**
 * Tests for the de-identification context — the secret-material holder. The headline gate: the key
 * never leaks through any stringify channel (via `@cosyte/test-utils`' `assertNoSecretLeak`).
 */

import { describe, expect, it } from "vitest";
import { inspect } from "node:util";
import { assertNoSecretLeak } from "@cosyte/test-utils";

import { createDeidContext, DeidError, FATAL_CODES } from "../src/index.js";

describe("DeidContext secret handling", () => {
  it("never leaks the key through JSON.stringify / String / template / util.inspect", () => {
    const key = "TOP-SECRET-KEY-abc123";
    const ctx = createDeidContext({ key });
    // The raw key must never surface; every channel shows the redaction marker.
    assertNoSecretLeak(ctx, { secret: key, redactedMarker: "[DeidContext:redacted]" });
    // Belt-and-braces: the instance carries no enumerable secret field at all.
    expect(Object.keys(ctx)).toHaveLength(0);
    expect(inspect(ctx)).toBe("[DeidContext:redacted]");
    // Template interpolation is covered by assertNoSecretLeak above; assert String() coercion here.
    expect(String(ctx)).toBe("[DeidContext:redacted]");
  });

  it("rejects an empty key or empty explicit seed as DEID_NO_KEY", () => {
    expect(() => createDeidContext({ key: "" })).toThrowError(
      expect.objectContaining({ code: FATAL_CODES.DEID_NO_KEY }),
    );
    expect(() => createDeidContext({ key: "k", dateShiftSeed: new Uint8Array(0) })).toThrowError(
      DeidError,
    );
  });

  it("accepts a Uint8Array key and derives patient-scoped siblings", () => {
    const ctx = createDeidContext({ key: new Uint8Array([1, 2, 3, 4]), patientId: "p1" });
    const p2 = ctx.forPatient("p2");
    expect(p2).not.toBe(ctx);
    // Both redact identically.
    expect(String(p2)).toBe("[DeidContext:redacted]");
  });
});
