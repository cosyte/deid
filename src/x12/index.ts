/**
 * `@cosyte/deid/x12` — the **X12 EDI de-identification adapter**. The X12 binding of the
 * format-agnostic core (roadmap §Phase 5): it locates PHI **structurally** in a parsed `@cosyte/x12`
 * interchange, applies the configured de-identification policy, and returns the de-identified X12 byte
 * stream plus the core's value-free manifest.
 *
 * **`@cosyte/x12` is an optional peer dependency**, consumed only from this subpath — a consumer who
 * only de-identifies X12 installs it alongside `@cosyte/deid`; the core stays third-party-dep-free. The
 * adapter reaches X12 data **only** through `@cosyte/x12`'s own exported model (`X12Interchange` /
 * `X12Segment`, the 1-indexed `elements`, `delimiters`) and its `parseX12` / `serializeX12` codec — it
 * never touches a third-party substrate, so `@cosyte/deid` declares no third-party runtime dependency.
 *
 * **What it covers (HIPAA 005010).** Across the subscriber (2000B/2010BA) and patient (2000C/2010CA)
 * loops of 837 / 835 / 270-271 and the other v1 transactions:
 * - **`NM1`** — entity-classified: a subscriber / patient / dependent name (`NM1-03..07`) is removed and
 *   its identifier (`NM1-09`) is routed by the `NM1-08` qualifier (SSN removed, member id
 *   pseudonymized); a recognized provider / organization `NM1` is **retained** (non-patient identity,
 *   mirroring the HL7 adapter's provider retention); an **unknown** entity code **fails closed**.
 * - **`N3` / `N4`** — street + city removed, ZIP generalized to its safe 3-digit form, state retained.
 * - **`DMG-02`** — date of birth generalized to year.
 * - **`REF`** — qualifier-classified: a patient / member / subscriber / group / medical-record
 *   identifier is removed (SSN) or pseudonymized; a recognized administrative / provider reference is
 *   retained; an **unknown REF qualifier** **fails closed** (Safe Harbor category (R)).
 * - **`PER`** — contact name and communication numbers removed.
 * - **`DTP-03` / `DTM-02`** — dates generalized to year.
 * - **`CLM-01` / `CLP-01`** — the patient account number pseudonymized to a consistent surrogate.
 *
 * **Fail closed.** A segment that is neither mapped nor on the recognized clinical / financial retain
 * list is blocked element-by-element; an unknown `NM1` entity or `REF` qualifier is blocked. Clinical
 * and financial values — diagnosis / procedure / revenue codes, monetary amounts, quantities, NDCs —
 * are **retained untouched** (the over-scrub guard). The honesty line is unchanged: the output is
 * **"Safe-Harbor-transformed per the configured policy"**, never "de-identified".
 *
 * **Known limitations (this phase).** Provider / organization identity is **retained** as non-patient
 * PHI (per §5); a deployment that must also suppress provider identity supplies a widening profile
 * (Phase 10). Retained clinical segments may carry residual patient-related dates the map does not
 * surface as `DTP` / `DTM` (a documented Phase-5 limitation, mirroring the HL7 adapter) — forgetting one
 * fails **safe** (retained, not leaked, but conversely a residual date is not generalized). NCPDP SCRIPT
 * de-identification is deferred; NCPDP Telecom ships alongside this adapter at `@cosyte/deid/ncpdp`.
 *
 * @packageDocumentation
 */

import { parseX12, type X12Interchange } from "@cosyte/x12";

import { deidentify, type DeidOptions } from "../deidentify.js";
import { type DeidManifestEntry } from "../manifest.js";
import { applyX12 } from "./apply.js";
import { extractX12Loci } from "./extract.js";

/**
 * The result of de-identifying an X12 interchange: the de-identified X12 byte stream plus the core's
 * value-free manifest of every category acted on and every locus blocked.
 *
 * @example
 * ```ts
 * import { parseX12 } from "@cosyte/x12";
 * import { deidentifyX12 } from "@cosyte/deid/x12";
 * import { createDeidContext } from "@cosyte/deid";
 *
 * const ix = parseX12(raw);
 * const result: X12DeidResult = deidentifyX12(ix, { context: createDeidContext({ key: "secret" }) });
 * result.x12;      // de-identified X12 text
 * result.manifest; // value-free audit — category + locus, never a value
 * ```
 */
export interface X12DeidResult {
  /** The de-identified X12 byte stream (byte-faithful for every untouched segment). */
  readonly x12: string;
  /** The value-free audit of every action, in locus order (never a value, never a key). */
  readonly manifest: readonly DeidManifestEntry[];
}

/**
 * De-identify a parsed X12 interchange under a policy (Safe Harbor by default). PHI is located
 * structurally from the `@cosyte/x12` model — the subscriber / patient / dependent `NM1` / `N3` / `N4` /
 * `DMG` / `REF` / `PER` / `DTP` loci and the `CLM` / `CLP` account number; the input interchange is
 * never mutated (the de-identified stream is re-serialized from a reconstruction).
 *
 * The output is **"Safe-Harbor-transformed per the configured policy"** — it is not certified
 * de-identified, and Expert Determination is not rendered.
 *
 * @param interchange - The parsed X12 interchange (`parseX12(raw)`).
 * @param options - The policy and (for keyed transforms — identifier pseudonymization) the key context.
 *   A keyed transform with no context is a fatal `DEID_NO_KEY`, never an unkeyed fallback.
 * @returns The de-identified X12 stream and the value-free manifest.
 * @throws {@link "@cosyte/deid".DeidError} `DEID_NO_KEY` when a keyed transform is required for a
 *   category present in the interchange but no key context was supplied.
 * @example
 * ```ts
 * import { parseX12 } from "@cosyte/x12";
 * import { deidentifyX12 } from "@cosyte/deid/x12";
 * import { createDeidContext } from "@cosyte/deid";
 *
 * const context = createDeidContext({ key: process.env.DEID_KEY! });
 * const { x12, manifest } = deidentifyX12(parseX12(raw), { context });
 * ```
 */
export function deidentifyX12(
  interchange: X12Interchange,
  options: DeidOptions = {},
): X12DeidResult {
  const { loci, coords } = extractX12Loci(interchange);
  const { document, manifest } = deidentify({ loci }, options);
  const x12 = applyX12(interchange, document.loci, coords);
  return { x12, manifest };
}

/**
 * Convenience: parse raw X12 text, de-identify it, and return the de-identified X12 string and the
 * value-free manifest in one call. Parse warnings are not part of the de-id contract and are discarded
 * here; call `parseX12` directly if you need them.
 *
 * @param raw - Raw X12 interchange text.
 * @param options - The policy and key context (see {@link deidentifyX12}).
 * @returns The de-identified X12 string and the value-free manifest.
 * @example
 * ```ts
 * import { deidentifyX12String } from "@cosyte/deid/x12";
 * import { createDeidContext } from "@cosyte/deid";
 *
 * const { x12, manifest } = deidentifyX12String(input, {
 *   context: createDeidContext({ key: "secret" }),
 * });
 * ```
 */
export function deidentifyX12String(raw: string, options: DeidOptions = {}): X12DeidResult {
  return deidentifyX12(parseX12(raw), options);
}

export {
  PROVIDER_ENTITY_CODES,
  PATIENT_ENTITY_CODES,
  X12_UNIVERSAL_SEGMENT_RULES,
  X12_FREE_TEXT_ELEMENTS,
  X12_GEO_SEGMENTS,
  X12_GEO_RETAIN_ELEMENTS,
  X12_ACCOUNT_SEGMENTS,
  X12_RETAIN_SEGMENTS,
  classifyNm1Entity,
  categoryForNm1IdQualifier,
  classifyRefQualifier,
  type X12ElementMode,
  type X12ElementRule,
  type Nm1Disposition,
  type RefDisposition,
} from "./locus-map.js";
export { extractX12Loci, type X12Coord, type X12Extraction } from "./extract.js";
export { applyX12 } from "./apply.js";
export { SAFE_HARBOR_CATEGORIES, type SafeHarborCategory } from "../categories.js";
