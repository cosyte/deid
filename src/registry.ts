/**
 * The **de-identification registry** — the corpus-level entry point that makes a **longitudinal**
 * record stay linkable after de-identification (roadmap §Phase 7). It layers cross-document
 * **consistency** on the format-agnostic core: the same patient, and the same identifier, map to the
 * **same** de-identified surrogates across every document, message, and run in a corpus, while
 * different patients and different identifiers do not collide.
 *
 * **What "consistency" means here, precisely.**
 * - **Same patient → same date-shift offset.** {@link DeidRegistry.forPatient} returns a
 *   {@link DeidContext} scoped to a patient key; the per-patient offset is *derived* deterministically
 *   from the registry's date-shift seed and the patient key (never stored, never random), so the same
 *   patient's dates shift by the same amount everywhere — intervals are preserved across the whole
 *   corpus. The context is memoized, so repeated lookups return the same handle.
 * - **Same identifier → same pseudonym.** {@link DeidRegistry.pseudonym} is a corpus-wide,
 *   patient-independent keyed-HMAC surrogate: the same MRN maps to the same token in every document.
 * - **Same UID → same remapped UID.** {@link DeidRegistry.remapUid} is the same guarantee for opaque
 *   unique identifiers (study/series/instance UIDs, GUIDs) a caller threads across files.
 *
 * **The key contract (supply, rotation, fail-closed).** The consumer supplies the HMAC key (and,
 * optionally, a distinct date-shift seed). It is **held only in a module-private registry keyed by the
 * instance** — the registry handle carries no enumerable secret field and redacts itself through every
 * stringify channel, exactly like {@link DeidContext}. There is **no default/weak key**: an absent or
 * empty key is a fatal `DEID_NO_KEY`, never a silent fallback. **Rotation is intentional linkage
 * breakage** — a new key deterministically produces *different* offsets and *different* pseudonyms, so
 * a rotated key un-links a corpus from records de-identified under the old key. That is the point:
 * rotate to sever linkage, keep the key to preserve it. The library holds **no persistent key store** —
 * key custody and lifetime are the consumer's, by design.
 *
 * @packageDocumentation
 */

import { DeidError, FATAL_CODES } from "./codes.js";
import { createDeidContext, type DeidContext, keyedDigest } from "./context.js";
import { pseudonymize } from "./transforms/pseudonymize.js";

/** The fixed marker every stringify channel of a {@link DeidRegistry} returns. Never a secret. */
const REDACTED = "[DeidRegistry:redacted]";

/** Domain separator so a remapped UID never collides with a pseudonym of the same input. */
const UID_DOMAIN = "uid-remap";

/** Module-private registry state — the base (patient-less) context + the per-patient context memo. */
interface RegistryState {
  readonly base: DeidContext;
  readonly memo: Map<string, DeidContext>;
}

/** Instance → state. A `WeakMap` so the key material is unreachable from the handle itself. */
const STATE = new WeakMap<DeidRegistry, RegistryState>();

/**
 * Specification for {@link createDeidRegistry}. Mirrors {@link DeidContextSpec} minus the per-patient
 * scope — the registry mints patient scopes itself via {@link DeidRegistry.forPatient}.
 *
 * @example
 * ```ts
 * import { createDeidRegistry } from "@cosyte/deid";
 *
 * const registry = createDeidRegistry({ key: process.env.DEID_KEY! });
 * ```
 */
export interface DeidRegistrySpec {
  /** The HMAC key for keyed transforms. Consumer-held; never emitted. Must be non-empty. */
  readonly key: string | Uint8Array;
  /**
   * A separate seed for deriving per-patient date-shift offsets. Defaults to the `key` when omitted;
   * supply a distinct seed to decouple pseudonymization from date-shifting.
   */
  readonly dateShiftSeed?: string | Uint8Array;
  /** Absolute bound (days) on each derived per-patient date-shift offset. Defaults to 365. */
  readonly maxShiftDays?: number;
}

/**
 * The corpus-level consistency handle. Construct it with {@link createDeidRegistry}. It holds the
 * consumer's key in a module-private registry — the handle exposes **no** secret field and redacts
 * itself through every stringify channel.
 *
 * @example
 * ```ts
 * import { createDeidRegistry } from "@cosyte/deid";
 *
 * const registry = createDeidRegistry({ key: "secret" });
 * // Same patient across documents shifts by the same offset:
 * const a = registry.forPatient("patient-1");
 * const b = registry.forPatient("patient-1");
 * a === b; // => true (memoized — same handle, same offset)
 * ```
 */
export class DeidRegistry {
  /** @internal Use {@link createDeidRegistry}. */
  public constructor() {
    // Intentionally empty: all key material lives in the module-private STATE, never on `this`.
  }

  /** Redacts through `JSON.stringify`. */
  public toJSON(): string {
    return REDACTED;
  }

  /** Redacts through `String(...)` and template interpolation. */
  public toString(): string {
    return REDACTED;
  }

  /** Redacts through `util.inspect` / `console.log`. */
  public [Symbol.for("nodejs.util.inspect.custom")](): string {
    return REDACTED;
  }

  /**
   * Return the {@link DeidContext} scoped to `patientKey`, minting and memoizing it on first use. The
   * same key always yields the same context — hence the same deterministic date-shift offset — so a
   * patient's dates shift consistently across every document in the corpus. Pass this context as
   * `DeidOptions.context` to {@link deidentify} (or a per-format adapter) for that patient's documents.
   *
   * @param patientKey - A stable per-patient key (an MRN, an enterprise patient id — the consumer's
   *   choice, provided it is the same across that patient's documents).
   * @returns The patient-scoped, self-redacting context.
   * @example
   * ```ts
   * import { createDeidRegistry } from "@cosyte/deid";
   *
   * const registry = createDeidRegistry({ key: "secret" });
   * const ctx = registry.forPatient("patient-1");
   * ```
   */
  public forPatient(patientKey: string): DeidContext {
    const state = stateOf(this);
    const existing = state.memo.get(patientKey);
    if (existing !== undefined) {
      return existing;
    }
    const ctx = state.base.forPatient(patientKey);
    state.memo.set(patientKey, ctx);
    return ctx;
  }

  /**
   * Map an identifier to its corpus-wide **consistent pseudonym** — a keyed-HMAC surrogate that is the
   * same for the same input everywhere and not reversible without the key. Patient-independent: the
   * same MRN maps to the same token regardless of which patient scope processes it, so records link.
   *
   * @param id - The identifier to pseudonymize (MRN, beneficiary number, account number).
   * @returns The consistent lowercase-hex surrogate.
   * @example
   * ```ts
   * import { createDeidRegistry } from "@cosyte/deid";
   *
   * const registry = createDeidRegistry({ key: "secret" });
   * registry.pseudonym("MRN-1") === registry.pseudonym("MRN-1"); // => true (consistent)
   * ```
   */
  public pseudonym(id: string): string {
    return pseudonymize(id, stateOf(this).base);
  }

  /**
   * Map an opaque unique identifier (a DICOM study/series/instance UID, a GUID) to its corpus-wide
   * **consistent surrogate**, so cross-document UID linkage survives de-identification. Domain-separated
   * from {@link pseudonym}, so a UID and an identifier with the same text never share a surrogate. This
   * is the format-agnostic linkage primitive; a format that owns UID *validity* (DICOM UIDs must be a
   * valid `0.…` OID) handles that in its own adapter.
   *
   * @param uid - The unique identifier to remap.
   * @returns The consistent lowercase-hex surrogate.
   * @example
   * ```ts
   * import { createDeidRegistry } from "@cosyte/deid";
   *
   * const registry = createDeidRegistry({ key: "secret" });
   * registry.remapUid("1.2.840.113619.2.55") === registry.remapUid("1.2.840.113619.2.55"); // => true
   * ```
   */
  public remapUid(uid: string): string {
    return keyedDigest(stateOf(this).base, UID_DOMAIN, uid);
  }
}

/** Look up a registry's state, or fail closed if the handle is foreign. */
function stateOf(registry: DeidRegistry): RegistryState {
  const state = STATE.get(registry);
  if (state === undefined) {
    // Fail closed: a handle with no bound key material (e.g. `new DeidRegistry()`) has no key.
    throw new DeidError(
      FATAL_CODES.DEID_NO_KEY,
      "no key material bound to this de-identification registry; use createDeidRegistry",
    );
  }
  return state;
}

/**
 * Create a {@link DeidRegistry} from consumer-held key material. **Fails closed** on an absent/empty
 * key — there is no default or weak key (the underlying {@link createDeidContext} throws `DEID_NO_KEY`).
 * The key is stored only in the module-private state, never on the returned handle.
 *
 * @param spec - The key, optional date-shift seed, and optional offset bound.
 * @returns An opaque, self-redacting corpus consistency handle.
 * @throws {@link DeidError} with code `DEID_NO_KEY` if the key (or an explicit seed) is empty.
 * @example
 * ```ts
 * import { createDeidRegistry } from "@cosyte/deid";
 *
 * const registry = createDeidRegistry({ key: "consumer-secret" });
 * ```
 */
export function createDeidRegistry(spec: DeidRegistrySpec): DeidRegistry {
  // Delegate key validation to the context factory — it fails closed on an empty key/seed. Build the
  // spec without explicit `undefined` (exactOptionalPropertyTypes) so omitted options take defaults.
  const base = createDeidContext({
    key: spec.key,
    ...(spec.dateShiftSeed !== undefined ? { dateShiftSeed: spec.dateShiftSeed } : {}),
    ...(spec.maxShiftDays !== undefined ? { maxShiftDays: spec.maxShiftDays } : {}),
  });
  const registry = new DeidRegistry();
  STATE.set(registry, { base, memo: new Map() });
  return registry;
}
