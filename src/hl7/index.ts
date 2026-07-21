/**
 * `@cosyte/deid/hl7` — the **HL7 v2 de-identification adapter**. The first end-to-end format binding of
 * the format-agnostic core (roadmap §Phase 2): it locates PHI **structurally** in the parsed
 * `@cosyte/hl7` model, applies the configured de-identification policy, and returns a transformed
 * `Hl7Message` plus the core's value-free manifest.
 *
 * **`@cosyte/hl7` is an optional peer dependency**, consumed only from this subpath — a consumer who
 * only de-identifies HL7 v2 installs it alongside `@cosyte/deid`; the core stays dependency-free. Import
 * this module as `@cosyte/deid/hl7`.
 *
 * **What it covers.** The structured PHI loci of **PID** (patient), **NK1** / **GT1** / **IN1** / **IN2**
 * (relatives / guarantor / insured — §4.6) via the cited {@link HL7_LOCUS_MAP}. **Fail closed**
 * everywhere else: a recognized segment is retained only if it is on the explicit {@link RETAIN_SEGMENTS}
 * clinical/administrative list — so a *known* patient-identity segment absent from the map (**MRG** prior
 * name + MRN on a merge, **FAM**, **ACC**, **PEO**, **PDA**) is blocked, not passed through — and
 * Z-segments / structure unknown to the parser are blocked. **OBX-5** is retained only when OBX-2
 * positively types it as a structured clinical value (numeric / coded / date); narrative (`TX`/`FT`),
 * ambiguous String (`ST`), and any empty/unknown OBX-2 fail closed, as do **NTE-3** comments. Structured
 * clinical values / units / codes / status are **retained untouched** (the over-scrub guard). The honesty
 * line is unchanged: the output is **"Safe-Harbor-transformed per the configured policy"**, never
 * "de-identified".
 *
 * **Known limitations (this phase).** Free text is block-only (no scrub); within **retained** clinical /
 * visit segments, patient-related dates (OBR/DG1/PV1 timestamps), visit identifiers (PV1-19), and
 * provider names (PV1-7/8, OBR-16) are a deferred later phase; the address generalization keeps only the
 * Safe Harbor 3-digit ZIP and conservatively drops the (permitted) state as well.
 *
 * @packageDocumentation
 */

import { type Hl7Message } from "@cosyte/hl7";

import { deidentify, type DeidOptions } from "../deidentify.js";
import { type DeidManifestEntry } from "../manifest.js";
import { applyHl7 } from "./apply.js";
import { extractHl7Loci } from "./extract.js";

/**
 * The result of de-identifying an HL7 v2 message: the transformed message plus the core's value-free
 * manifest of every category acted on and every locus blocked.
 *
 * @example
 * ```ts
 * import { parseHL7 } from "@cosyte/hl7";
 * import { deidentifyHl7 } from "@cosyte/deid/hl7";
 *
 * const result: Hl7DeidResult = deidentifyHl7(parseHL7(raw), {});
 * result.document.toString(); // de-identified HL7 wire
 * ```
 */
export interface Hl7DeidResult {
  /** The de-identified message — a fresh, independent {@link Hl7Message}; the input is never mutated. */
  readonly document: Hl7Message;
  /** The value-free audit of every action, in locus order (never a value, never a key). */
  readonly manifest: readonly DeidManifestEntry[];
}

/**
 * De-identify a parsed HL7 v2 message under a policy (Safe Harbor by default). PHI is located
 * structurally from the `@cosyte/hl7` model; the input message is never mutated.
 *
 * The output is **"Safe-Harbor-transformed per the configured policy"** — it is not certified
 * de-identified, and Expert Determination is not rendered.
 *
 * @param msg - The parsed HL7 v2 message to de-identify.
 * @param options - The policy and (for keyed transforms — MRN / account / beneficiary pseudonymization)
 *   the key context. A keyed transform with no context is a fatal `DEID_NO_KEY`, never an unkeyed
 *   fallback.
 * @returns The de-identified message and the value-free manifest.
 * @throws {@link DeidError} `DEID_NO_KEY` when a keyed transform is required for a category present in
 *   the message but no key context was supplied.
 * @example
 * ```ts
 * import { parseHL7 } from "@cosyte/hl7";
 * import { deidentifyHl7 } from "@cosyte/deid/hl7";
 * import { createDeidContext } from "@cosyte/deid";
 *
 * const context = createDeidContext({ key: process.env.DEID_KEY! });
 * const { document, manifest } = deidentifyHl7(parseHL7(raw), { context });
 * // document.get("PID.5.1") === undefined  (name removed)
 * // manifest records each category + locus, never a value.
 * ```
 */
export function deidentifyHl7(msg: Hl7Message, options: DeidOptions = {}): Hl7DeidResult {
  const { loci, coords } = extractHl7Loci(msg);
  const { document, manifest } = deidentify({ loci }, options);
  const deidentified = applyHl7(msg, document.loci, coords);
  return { document: deidentified, manifest };
}

export {
  HL7_LOCUS_MAP,
  categoryForIdentifierType,
  type Hl7FieldRule,
  type Hl7FieldMode,
} from "./locus-map.js";
export { extractHl7Loci, type Hl7Coord, type Hl7Extraction, type Hl7EditKind } from "./extract.js";
export { applyHl7 } from "./apply.js";
export { RETAIN_SEGMENTS } from "./retain.js";
export { SAFE_HARBOR_CATEGORIES, type SafeHarborCategory } from "../categories.js";
