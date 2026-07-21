/**
 * `@cosyte/deid/ncpdp` — the **NCPDP de-identification adapter**. The NCPDP binding of the
 * format-agnostic core (roadmap §Phase 5): it locates PHI **structurally** in a parsed `@cosyte/ncpdp`
 * **Telecommunication (vD.0)** transaction, applies the configured de-identification policy, and returns
 * the de-identified Telecom byte stream plus the core's value-free manifest.
 *
 * **`@cosyte/ncpdp` is an optional peer dependency**, consumed only from this subpath — a consumer who
 * only de-identifies NCPDP installs it alongside `@cosyte/deid`; the core stays third-party-dep-free. The
 * adapter reaches NCPDP data **only** through `@cosyte/ncpdp`'s own exported Telecom model
 * (`TelecomTransaction` / `TelecomSegment` / `TelecomField`) and its `parseTelecom` / `serializeTelecom`
 * codec — it never touches a third-party substrate.
 *
 * **What it covers (Telecom vD.0).** The Patient (`01`), Prescriber (`03`), Insurance (`04`), and
 * Coordination-of-Benefits (`05`) segments, plus the header's Date of Service:
 * - **Patient (`01`)** — name (`CA`/`CB`) and phone (`CQ`) removed; street (`CM`) and city (`CN`)
 *   removed; ZIP (`CP`) generalized to its safe 3-digit form; date of birth (`C4`) generalized to year;
 *   patient id (`CY`) pseudonymized. Gender and state retained.
 * - **Insurance (`04`)** — cardholder id (`C2`) and group id (`C1`) pseudonymized; cardholder name
 *   (`CC`/`CD`) removed. Person code retained.
 * - **Prescriber (`03`)** — the prescriber id (`DB`) removed (the roadmap scopes prescriber identifiers
 *   for NCPDP — the deliberate asymmetry with the X12 adapter, which retains provider identity).
 * - **Coordination of Benefits (`05`)** — the other-payer cardholder id (`NU`) and group id (`MJ`)
 *   pseudonymized; the other-payer date (`E8`) generalized to year.
 * - **Header** — Date of Service generalized to year.
 *
 * **Fail closed.** A free-text field (`544-FY` DUR free text, `504-F4` response message) is blocked
 * wherever it appears; a segment that is neither mapped nor on the recognized clinical / financial retain
 * list (including a response Patient / Insurance segment) is blocked field-by-field. Clinical and
 * financial values — NDC drug codes, quantities, days supply, pricing amounts, DUR reason codes — are
 * **retained untouched** (the over-scrub guard). The output is **"Safe-Harbor-transformed per the
 * configured policy"**, never "de-identified".
 *
 * **NCPDP SCRIPT is deferred (a documented non-goal of this phase).** `@cosyte/ncpdp`'s SCRIPT
 * (ePrescribing XML) surface cannot be structurally de-identified faithfully through its public API:
 * `serializeScript` emits **only the modeled fields** (a parse → serialize round-trip drops every
 * unmodeled XML element), and the SCRIPT `Patient` model carries **no address, phone, or patient-id**
 * field. Performing a partial de-id through that surface would silently drop unmodeled content and leave
 * unmodeled patient identifiers unhandled — a false-safety hazard, which the fail-closed posture
 * forbids. SCRIPT de-identification therefore waits for a parser surface that preserves the full document
 * (tracked as a follow-up), rather than shipping an unfaithful pass here.
 *
 * @packageDocumentation
 */

import { parseTelecom, type TelecomTransaction } from "@cosyte/ncpdp/telecom";

import { deidentify, type DeidOptions } from "../deidentify.js";
import { type DeidManifestEntry } from "../manifest.js";
import { applyTelecom } from "./apply.js";
import { extractTelecomLoci } from "./extract.js";

/**
 * The result of de-identifying an NCPDP Telecom transaction: the de-identified Telecom byte stream plus
 * the core's value-free manifest of every category acted on and every locus blocked.
 *
 * @example
 * ```ts
 * import { parseTelecom } from "@cosyte/ncpdp/telecom";
 * import { deidentifyTelecom } from "@cosyte/deid/ncpdp";
 * import { createDeidContext } from "@cosyte/deid";
 *
 * const tx = parseTelecom(raw);
 * const result: TelecomDeidResult = deidentifyTelecom(tx, {
 *   context: createDeidContext({ key: "secret" }),
 * });
 * result.telecom;  // de-identified NCPDP Telecom text
 * result.manifest; // value-free audit — category + locus, never a value
 * ```
 */
export interface TelecomDeidResult {
  /** The de-identified NCPDP Telecom byte stream. */
  readonly telecom: string;
  /** The value-free audit of every action, in locus order (never a value, never a key). */
  readonly manifest: readonly DeidManifestEntry[];
}

/**
 * De-identify a parsed NCPDP Telecom transaction under a policy (Safe Harbor by default). PHI is located
 * structurally from the `@cosyte/ncpdp` Telecom model — the Patient / Prescriber / Insurance / COB
 * segment fields and the header Date of Service; the input transaction is never mutated (the
 * de-identified stream is re-serialized from a reconstruction).
 *
 * The output is **"Safe-Harbor-transformed per the configured policy"** — it is not certified
 * de-identified, and Expert Determination is not rendered.
 *
 * @param tx - The parsed Telecom transaction (`parseTelecom(raw)`).
 * @param options - The policy and (for keyed transforms — identifier pseudonymization) the key context.
 *   A keyed transform with no context is a fatal `DEID_NO_KEY`, never an unkeyed fallback.
 * @returns The de-identified Telecom stream and the value-free manifest.
 * @throws {@link "@cosyte/deid".DeidError} `DEID_NO_KEY` when a keyed transform is required for a
 *   category present in the transaction but no key context was supplied.
 * @example
 * ```ts
 * import { parseTelecom } from "@cosyte/ncpdp/telecom";
 * import { deidentifyTelecom } from "@cosyte/deid/ncpdp";
 * import { createDeidContext } from "@cosyte/deid";
 *
 * const context = createDeidContext({ key: process.env.DEID_KEY! });
 * const { telecom, manifest } = deidentifyTelecom(parseTelecom(raw), { context });
 * ```
 */
export function deidentifyTelecom(
  tx: TelecomTransaction,
  options: DeidOptions = {},
): TelecomDeidResult {
  const { loci, coords } = extractTelecomLoci(tx);
  const { document, manifest } = deidentify({ loci }, options);
  const telecom = applyTelecom(tx, document.loci, coords);
  return { telecom, manifest };
}

/**
 * Convenience: parse raw NCPDP Telecom text, de-identify it, and return the de-identified Telecom string
 * and the value-free manifest in one call. Parse warnings are not part of the de-id contract and are
 * discarded here; call `parseTelecom` directly if you need them.
 *
 * @param raw - Raw NCPDP Telecom transaction text.
 * @param options - The policy and key context (see {@link deidentifyTelecom}).
 * @returns The de-identified Telecom string and the value-free manifest.
 * @example
 * ```ts
 * import { deidentifyTelecomString } from "@cosyte/deid/ncpdp";
 * import { createDeidContext } from "@cosyte/deid";
 *
 * const { telecom, manifest } = deidentifyTelecomString(input, {
 *   context: createDeidContext({ key: "secret" }),
 * });
 * ```
 */
export function deidentifyTelecomString(raw: string, options: DeidOptions = {}): TelecomDeidResult {
  return deidentifyTelecom(parseTelecom(raw), options);
}

export {
  TELECOM_LOCUS_MAP,
  TELECOM_FREE_TEXT_FIELDS,
  TELECOM_RETAIN_SEGMENTS,
  type TelecomFieldMode,
  type TelecomFieldRule,
} from "./locus-map.js";
export { extractTelecomLoci, type TelecomCoord, type TelecomExtraction } from "./extract.js";
export { applyTelecom } from "./apply.js";
export { SAFE_HARBOR_CATEGORIES, type SafeHarborCategory } from "../categories.js";
