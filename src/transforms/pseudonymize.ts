/**
 * The **pseudonymization** and **keyed-hash** transforms — replace an identifier with a **consistent**
 * surrogate so records still link, without the surrogate being reversible.
 *
 * Both are **keyed HMAC-SHA-256** (`node:crypto`). The key is the secret salt — held by the consumer,
 * per-deployment, and **never emitted**. This is the direct implementation of §164.514(c): a
 * re-identification code must be "not derived from … the individual" and "not otherwise capable of
 * being translated" — a keyed HMAC satisfies both, whereas an **unsalted hash of an MRN is
 * re-identifiable** (the identifier space is small and enumerable, so an attacker hashes every
 * candidate and matches). {@link unkeyedHash} exists **only** to demonstrate that hazard in tests; it
 * is non-conforming and never used by the engine.
 *
 * @packageDocumentation
 */

import { createHash } from "node:crypto";

import { type DeidContext, keyedDigest } from "../context.js";

/** Domain separator so a pseudonym and a keyed hash of the same input never collide. */
const PSEUDONYM_DOMAIN = "pseudonymize";
const HASH_DOMAIN = "keyed-hash";

/**
 * Replace an identifier with a **consistent keyed-HMAC surrogate**. The same input under the same key
 * always yields the same surrogate (linkage preserved); the surrogate is **not reversible without the
 * key** (collision-resistant, key-dependent). Domain-separated from {@link keyedHash}.
 *
 * @param id - The identifier to pseudonymize (MRN, beneficiary number, account number).
 * @param ctx - The de-identification context holding the consumer's key.
 * @returns A lowercase-hex surrogate, consistent per (key, id).
 * @example
 * ```ts
 * import { pseudonymize, createDeidContext } from "@cosyte/deid";
 *
 * const ctx = createDeidContext({ key: "secret" });
 * pseudonymize("MRN-123", ctx) === pseudonymize("MRN-123", ctx); // => true (consistent)
 * ```
 */
export function pseudonymize(id: string, ctx: DeidContext): string {
  return keyedDigest(ctx, PSEUDONYM_DOMAIN, id);
}

/**
 * Replace a value with a **keyed one-way digest** (HMAC-SHA-256). Like {@link pseudonymize} it is
 * consistent and non-reversible without the key, but domain-separated so it is a distinct surrogate
 * space from pseudonyms.
 *
 * @param value - The value to hash.
 * @param ctx - The de-identification context holding the consumer's key.
 * @returns A lowercase-hex keyed digest, consistent per (key, value).
 * @example
 * ```ts
 * import { keyedHash, createDeidContext } from "@cosyte/deid";
 *
 * const ctx = createDeidContext({ key: "secret" });
 * typeof keyedHash("value", ctx); // => "string"
 * ```
 */
export function keyedHash(value: string, ctx: DeidContext): string {
  return keyedDigest(ctx, HASH_DOMAIN, value);
}

/**
 * A **plain, unsalted SHA-256** digest — **NON-CONFORMING** to §164.514(c) and never used by the
 * engine. It is re-identifiable for a small, enumerable identifier space (an attacker hashes every
 * candidate and matches). Exported solely so the test suite can *prove* the reversibility hazard the
 * keyed path avoids. **Do not use this to de-identify anything.**
 *
 * @param value - The value to hash.
 * @returns The lowercase-hex SHA-256 of `value` — reversible for a small input space.
 * @example
 * ```ts
 * import { unkeyedHash } from "@cosyte/deid";
 *
 * // Deterministic and unsalted — this is the footgun, shown so tests can assert against it.
 * unkeyedHash("a") === unkeyedHash("a"); // => true
 * ```
 */
export function unkeyedHash(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
