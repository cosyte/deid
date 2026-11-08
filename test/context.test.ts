/**
 * Tests for the de-identification context: the secret-material holder. The headline gate: the key
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
    expect(() =>
      createDeidContext({ key: "k-synthetic-hmac-key", dateShiftSeed: new Uint8Array(0) }),
    ).toThrowError(DeidError);
  });

  it("accepts a Uint8Array key and derives patient-scoped siblings", () => {
    // A synthetic 32-byte key: the bytes 0..31, never a real secret.
    const key = Uint8Array.from({ length: 32 }, (_, i) => i);
    const ctx = createDeidContext({ key, patientId: "p1" });
    const p2 = ctx.forPatient("p2");
    expect(p2).not.toBe(ctx);
    // Both redact identically.
    expect(String(p2)).toBe("[DeidContext:redacted]");
  });
});

describe("DeidContext key length", () => {
  // Synthetic keys only. A string is counted as the UTF-8 bytes the HMAC uses.
  const KEY_15 = "synthetic-key15";
  const KEY_16 = "synthetic-key-16";
  const KEY_32 = "synthetic-hmac-key-thirty-two-by";

  /** Run `fn`, which must throw, and return the DeidError it threw. */
  function thrown(fn: () => unknown): DeidError {
    try {
      fn();
    } catch (error) {
      expect(error).toBeInstanceOf(DeidError);
      return error as DeidError;
    }
    throw new Error("expected a DeidError");
  }

  it("the synthetic keys are the lengths the tests claim", () => {
    expect(Buffer.byteLength(KEY_15, "utf8")).toBe(15);
    expect(Buffer.byteLength(KEY_16, "utf8")).toBe(16);
    expect(Buffer.byteLength(KEY_32, "utf8")).toBe(32);
  });

  it("refuses a 15-byte key as DEID_KEY_TOO_SHORT, string or bytes", () => {
    for (const key of [KEY_15, new Uint8Array(15).fill(7)]) {
      const error = thrown(() => createDeidContext({ key }));
      expect(error.code).toBe(FATAL_CODES.DEID_KEY_TOO_SHORT);
    }
  });

  it("says the minimum and how to make a key, and never echoes the key or its length", () => {
    const error = thrown(() => createDeidContext({ key: KEY_15 }));
    expect(error.message).toContain("at least 16 bytes");
    expect(error.message).toContain("randomBytes(32)");
    expect(error.message).toContain("openssl rand -hex 32");
    expect(error.message).not.toContain(KEY_15);
    expect(error.message).not.toContain("15");
    expect(JSON.stringify(error)).not.toContain(KEY_15);
    expect(inspect(error)).not.toContain(KEY_15);
  });

  it("refuses a short explicit date-shift seed the same way", () => {
    const error = thrown(() => createDeidContext({ key: KEY_32, dateShiftSeed: KEY_15 }));
    expect(error.code).toBe(FATAL_CODES.DEID_KEY_TOO_SHORT);
    expect(error.message).toMatch(/^dateShiftSeed /);
  });

  it("accepts 16 and 32 bytes, string or bytes", () => {
    for (const key of [KEY_16, KEY_32, new Uint8Array(16).fill(7), new Uint8Array(32).fill(7)]) {
      expect(() => createDeidContext({ key, dateShiftSeed: key, patientId: "p1" })).not.toThrow();
    }
  });

  it("counts UTF-8 bytes, not characters", () => {
    // Five three-byte characters: 15 bytes in 5 characters. Eight two-byte ones: 16 bytes in 8.
    expect(thrown(() => createDeidContext({ key: "\u20ac".repeat(5) })).code).toBe(
      FATAL_CODES.DEID_KEY_TOO_SHORT,
    );
    expect(() => createDeidContext({ key: "\u00e9".repeat(8) })).not.toThrow();
    // Sixteen ASCII characters of 64 bits of hex are 16 bytes to the HMAC, so the check passes them.
    expect(() => createDeidContext({ key: "0123456789abcdef" })).not.toThrow();
  });
});
