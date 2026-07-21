/**
 * The **BYO (bring-your-own) free-text redaction interface** — the plug-in point a consumer uses to
 * hand the engine a free-text de-identifier (a regex/pattern engine, a clinical-NER model, an
 * i2b2-grade de-id pipeline). It mirrors the parsers' BYO posture (the `TerminologyAdapter` and the
 * profile system): **the library ships the interface and the orchestration, never the detector.**
 *
 * **Why BYO, and why the library bundles nothing.** Free-text / narrative loci (C-CDA narrative
 * `<text>`, HL7 `OBX-5` / `NTE`, FHIR `note` / `div`, X12 `MSG` / `NTE`, NCPDP free text) can carry
 * any of the 18 Safe Harbor categories in prose. A naive built-in regex pass is a **false-safety
 * hazard** — it misses PHI it does not recognize while creating the *impression* of safety (roadmap
 * §4.5) — so the library refuses to ship one. Honest clinical-NER de-id is heavy, model-dependent, and
 * the consumer's choice; the library provides only the orchestration around it.
 *
 * **The fail-closed contract (the safety guarantee the library keeps).**
 * - **No redactor supplied → block.** The default stays the safe baseline: a free-text locus is
 *   removed/blocked, never emitted un-redacted.
 * - **Redactor throws → block.** A redactor failure never leaks the free text through.
 * - **Redactor returns nothing** (`null` / `undefined` / a result without a string `text`) **→ block.**
 * - **Redactor returns `{ text }` → the engine writes that prose back in place** and records
 *   {@link DEID_DISPOSITION_CODES.DEID_FREETEXT_CONSUMER_REDACTED} in the value-free manifest.
 *
 * **The honesty boundary (the guarantee the library does NOT make).** A redactor that returns `{ text }`
 * is **trusted as consumer-asserted** — the engine does **not** independently verify that the returned
 * prose is PHI-free, and it does not treat a redactor's "no findings" (returning the text unchanged) as
 * an attestation. **A BYO redactor's completeness is the consumer's responsibility** — this is
 * Expert-Determination territory (§2.2). The engine's guarantee is narrow and exact: it fails **closed**
 * whenever a redactor is absent, errors, or returns nothing, and it **never** touches the structural
 * PHI removal the format adapters already perform — the redactor handles the free *prose* only.
 *
 * @packageDocumentation
 */

import type { SafeHarborCategory } from "./categories.js";

/**
 * The value-bearing request the engine hands a {@link FreeTextRedactor} at each free-text locus. This
 * is the **one** place a value crosses into consumer code by design — it never reaches the manifest.
 *
 * @example
 * ```ts
 * import { type FreeTextRedactionRequest } from "@cosyte/deid";
 *
 * const request: FreeTextRedactionRequest = { text: "patient prose…", locus: "OBX-5" };
 * ```
 */
export interface FreeTextRedactionRequest {
  /** The free-text prose at the locus, for the consumer's redactor to de-identify. */
  readonly text: string;
  /** The format-neutral locus path (e.g. `"OBX-5"`, `"section/text"`) — value-free, for routing/logging. */
  readonly locus: string;
  /** The Safe Harbor category associated with the locus, when the adapter could classify it. */
  readonly category?: SafeHarborCategory;
}

/**
 * The successful result of a {@link FreeTextRedactor}: the redacted prose to write back in place. To
 * **decline** a locus (so the engine fails closed and blocks it), a redactor returns `null` /
 * `undefined` or throws — it never returns un-redacted text expecting the engine to catch a miss.
 *
 * @example
 * ```ts
 * import { type FreeTextRedactionResult } from "@cosyte/deid";
 *
 * const result: FreeTextRedactionResult = { text: "patient [REDACTED]…" };
 * ```
 */
export interface FreeTextRedactionResult {
  /** The redacted prose. May be an empty string (all prose removed); that is a valid redaction. */
  readonly text: string;
}

/**
 * A consumer-supplied free-text redactor. The engine invokes it at each free-text locus and treats a
 * returned {@link FreeTextRedactionResult} as **consumer-asserted** (recorded as
 * `DEID_FREETEXT_CONSUMER_REDACTED`). Returning `null` / `undefined` — or throwing — makes the engine
 * **fail closed** and block the locus. The library never inspects the returned text for residual PHI;
 * completeness is the consumer's responsibility.
 *
 * @param request - The free-text value, its value-free locus path, and its category when known.
 * @returns The redacted prose as `{ text }`, or `null` / `undefined` to decline (engine blocks).
 * @example
 * ```ts
 * import { deidentify, type FreeTextRedactor } from "@cosyte/deid";
 *
 * // A consumer plugs in their own detector; the library bundles none.
 * const redactor: FreeTextRedactor = ({ text }) => ({ text: myNerModel.scrub(text) });
 * const result = deidentify(model, { redactor });
 * ```
 */
export type FreeTextRedactor = (
  request: FreeTextRedactionRequest,
) => FreeTextRedactionResult | null | undefined;
