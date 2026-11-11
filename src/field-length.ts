/**
 * **Field lengths**: how a value the engine writes is fitted to a position that bounds its length
 * ({@link GenericLocus.maxLength}).
 *
 * A keyed surrogate is a lowercase-hex HMAC-SHA-256 digest, 64 characters. Some positions hold fewer
 * (an X12 `REF-02` holds 50 in 005010, a `CLM-01` 38), so the digest is cut to the position's
 * length. Each hex character carries 4 bits, so a surrogate cut to `L` characters keeps `4L` bits of
 * the digest. Cutting keeps both properties a keyed surrogate has:
 *
 * - **Linking inside one key.** The same value under the same key gives the same digest, so the same
 *   leading characters: two positions of the same length always carry the same surrogate, and a
 *   position of another length carries a prefix of it, or extends it. Two different values can share
 *   a cut surrogate only by collision: for `n` distinct values the chance that any two do is at most
 *   `n(n-1) / 2^(4L+1)` (the birthday bound for a pseudorandom function), which for a billion
 *   distinct values is below one in two million at the 80-bit floor and far smaller above it.
 * - **No inversion.** The digest is keyed. Without the key a holder of the output cannot compute the
 *   surrogate of any candidate value, so cannot test a guess against it; cutting removes bits and adds
 *   no information about the value.
 *
 * The floor is {@link KEYED_SURROGATE_MIN_LENGTH} characters, 80 bits, the lower bound RFC 2104
 * (section 5) sets for a truncated HMAC. A position shorter than that cannot carry a surrogate that
 * links safely, so the value there is blocked instead of written short.
 *
 * @packageDocumentation
 * @internal
 */

import type { GenericLocus } from "./locus.js";

/**
 * The fewest characters of keyed surrogate the engine writes: 20 hex characters, 80 bits. A position
 * that holds fewer gets no surrogate at all; the value is blocked.
 *
 * @internal
 */
export const KEYED_SURROGATE_MIN_LENGTH = 20;

/**
 * The bound a locus declares, read fail-closed: `undefined` when it declares none, and `0` when what
 * it declares is not a whole number of zero or more, so every value written there is refused.
 *
 * @internal
 */
export function declaredMaxLength(locus: GenericLocus): number | undefined {
  const max = locus.maxLength;
  if (max === undefined) return undefined;
  return Number.isSafeInteger(max) && max >= 0 ? max : 0;
}

/**
 * Fit a keyed surrogate to a position. `shaped` is the surrogate as it would be written with no bound
 * (the digest itself, or the digest laid out in a referenced identifier's shape); `digest` is the
 * 64-character hex digest it came from.
 *
 * @returns `shaped` when it fits; the digest cut to the bound when the bound keeps at least
 *   {@link KEYED_SURROGATE_MIN_LENGTH} characters; `null` (block the value) otherwise.
 * @internal
 */
export function fitKeyedSurrogate(
  shaped: string,
  digest: string,
  max: number | undefined,
): string | null {
  if (max === undefined || shaped.length <= max) return shaped;
  if (max < KEYED_SURROGATE_MIN_LENGTH) return null;
  return digest.slice(0, max);
}
