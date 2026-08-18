/**
 * `@cosyte/deid/hl7`: the **HL7 v2 de-identification adapter**. The first end-to-end format binding of
 * the format-agnostic core: it locates PHI **structurally** in the parsed
 * `@cosyte/hl7` model, applies the configured de-identification policy, and returns a transformed
 * `Hl7Message` plus the core's value-free manifest.
 *
 * **`@cosyte/hl7` is an optional peer dependency**, consumed only from this subpath: a consumer who
 * only de-identifies HL7 v2 installs it alongside `@cosyte/deid`; the core stays dependency-free. Import
 * this module as `@cosyte/deid/hl7`.
 *
 * **What it covers.** The structured PHI loci of **PID** (patient), **NK1** / **GT1** / **IN1** / **IN2**
 * (relatives / guarantor / insured) via the cited {@link HL7_LOCUS_MAP}. **Fail closed**
 * everywhere else: a recognized segment is retained only if it is on the explicit {@link RETAIN_SEGMENTS}
 * clinical/administrative list, so a *known* patient-identity segment absent from the map (**MRG** prior
 * name + MRN on a merge, **FAM**, **ACC**, **PEO**, **PDA**) is blocked, not passed through, and
 * Z-segments / structure unknown to the parser are blocked. **OBX-5** is retained only when OBX-2
 * positively types it as a structured clinical value (numeric / coded / a time of day); narrative
 * (`TX`/`FT`), ambiguous String (`ST`), and any empty/unknown OBX-2 fail closed, as do **NTE-3**
 * comments, and a **date/time** value type makes OBX-5 a date this pass acts on. The OBX segment's own
 * date/time fields are acted on too (below). Structured clinical values / units / codes / status are
 * **retained untouched** (the over-scrub guard). The honesty line is unchanged: the output is
 * **"Safe-Harbor-transformed per the configured policy"**, never "de-identified".
 *
 * **Inside a retained segment**, the identifying dates and the encounter / order numbers are carved
 * back out ({@link RETAINED_LOCUS_RULES}): under a Safe-Harbor-labelled policy the admit (PV1-44),
 * discharge (PV1-45), observation (OBR-7) and diagnosis (DG1-5) dates generalize to their **year**, and
 * the visit number (PV1-19) and the placer / filler order numbers (OBR-2/3, ORC-2/3) are **removed**. A
 * profile that names their retention class keeps them **unchanged and recorded**.
 *
 * **PV1-19 is a CX list routed by its CX-5 identifier-type code**, exactly like PID-3: a `VN`-typed or
 * untyped value is the encounter identifier (removed as the (R) catch-all, retainable), while an
 * `MR`/`AN`/`SS`-typed one is handled as the identifier it really is and is **transformed under both
 * profiles, never retained** — §164.514(e)(2) names all three, so keeping one would republish in the
 * clear the identifier the pass pseudonymized at PID-3 in the same message.
 *
 * **Every other date inside a segment the pass hands through** is located from {@link HL7_DATE_LOCI},
 * the committed HL7 v2.5.1 enumeration, and acted on under the configured policy at the unit the
 * standard gives it: a `DT`/`TS` field, a single date component of a composite, one repetition at a
 * time. Its domain is {@link HL7_PASSED_THROUGH_SEGMENTS}: the retain-list **plus OBX**, whose own
 * observation (OBX-14), analysis (OBX-19) and reference-range (OBX-12) timestamps are swept like any
 * other even though the retain-list does not name the segment. Each outcome is recorded, so a consumer
 * reads the manifest and knows which dates the output still carries.
 *
 * **Known limitations.** Free text is block-only (no scrub); every **non-date** field of a retained
 * segment that the maps do not name is still passed through untouched and unrecorded, which includes
 * the provider names in PV1-7/8 and OBR-16 and the date components carried inside a person-name or
 * address composite. The date classification is fixed at v2.5.1, so a position only another version
 * types as a date is a stated residual, as are the file and batch envelope headers. The address
 * generalization keeps only the Safe Harbor 3-digit ZIP and conservatively drops the (permitted) state
 * as well.
 *
 * @packageDocumentation
 */

import { parseHL7, type Hl7Message } from "@cosyte/hl7";

import { DeidError, FATAL_CODES } from "../codes.js";
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
  /** The de-identified message: a fresh, independent {@link Hl7Message}; the input is never mutated. */
  readonly document: Hl7Message;
  /** The value-free audit of every action, in locus order (never a value, never a key). */
  readonly manifest: readonly DeidManifestEntry[];
}

/**
 * De-identify a parsed HL7 v2 message under a policy (Safe Harbor by default). PHI is located
 * structurally from the `@cosyte/hl7` model; the input message is never mutated.
 *
 * The output is **"Safe-Harbor-transformed per the configured policy"**: it is not certified
 * de-identified, and Expert Determination is not rendered.
 *
 * @param msg - The parsed HL7 v2 message to de-identify.
 * @param options - The policy, the profile's retention classes, and (for keyed transforms, MRN /
 *   account / beneficiary pseudonymization) the key context. A keyed transform with no context is a
 *   fatal `DEID_NO_KEY`, never an unkeyed fallback. **Retention defaults to nothing**, so a bare
 *   options bag removes the encounter dates and identifiers rather than keeping them.
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
  const { loci, coords } = extractHl7Loci(
    msg,
    options.retainedLoci !== undefined ? { retainedLoci: options.retainedLoci } : {},
  );
  const { document, manifest } = deidentify({ loci }, options);
  const deidentified = applyHl7(msg, document.loci, coords);
  assertRoundTrips(deidentified);
  return { document: deidentified, manifest };
}

/**
 * Fail closed on the **shape** of the output: the transformed message must serialize, its own parser
 * must be able to read what was written, and reading it must be **stable**, so what a downstream
 * reader sees is what this pass emitted. A pass that emptied a locus and left a message its own reader
 * reads differently cannot say what a downstream reader will make of the values still in it, so it
 * throws rather than return a partially transformed document.
 *
 * Stability, not byte-equality, is the test, and the difference is deliberate: the serializer strips
 * an insignificant trailing empty field, so a wire this adapter emits can be one canonicalization step
 * away from the parser's own form without a single value or position having moved. The **fixed point**
 * is the honest invariant: read the emitted wire, write it back, and reading that again must produce
 * the same bytes. A structure that re-reads differently never reaches one.
 *
 * The diagnostic is value-free, like every other one on this path: it names the failure, never the
 * message.
 */
function assertRoundTrips(document: Hl7Message): void {
  let stable: boolean;
  try {
    const canonical = parseHL7(document.toString()).toString();
    stable = parseHL7(canonical).toString() === canonical;
  } catch {
    stable = false;
  }
  if (!stable) {
    throw new DeidError(
      FATAL_CODES.DEID_OUTPUT_INVALID,
      "the de-identified HL7 v2 message did not round-trip through its parser; no document is returned",
    );
  }
}

export {
  HL7_LOCUS_MAP,
  categoryForIdentifierType,
  type Hl7FieldRule,
  type Hl7FieldMode,
} from "./locus-map.js";
export {
  extractHl7Loci,
  type Hl7Coord,
  type Hl7Extraction,
  type Hl7EditKind,
  type Hl7ExtractOptions,
} from "./extract.js";
export { applyHl7 } from "./apply.js";
export { RETAIN_SEGMENTS, RETAINED_LOCUS_RULES, type Hl7RetainedFieldRule } from "./retain.js";
export {
  HL7_DATE_LOCI,
  HL7_DATE_LOCUS_VERSION,
  HL7_PASSED_THROUGH_SEGMENTS,
  OBX_DATE_VALUE_TYPES,
  type Hl7DateDatatype,
  type Hl7DateLocusRule,
  type Hl7SegmentDateLoci,
} from "./date-loci.js";
export { RETAINED_LOCUS_CLASSES, retains, type RetainedLocusClass } from "../retention.js";
export { SAFE_HARBOR_CATEGORIES, type SafeHarborCategory } from "../categories.js";
