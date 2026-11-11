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
 * **The individual's employer is a Safe Harbor subject**, because §164.514(b)(2)(i) removes the
 * identifiers of the individual "or of relatives, **employers**, or household members" of the
 * individual. So the employer positions the financial segments type are acted on and recorded like any
 * other mapped locus: the guarantor's employer name (GT1-16), address (GT1-17) and phone (GT1-18), the
 * guarantor employee and employer ids (GT1-19, GT1-29), the insured's group employer id and name
 * (IN1-10, IN1-11), the insured's employer name (IN2-3), the employer contact person's name and phone
 * (IN2-49, IN2-50) and the insured's employer phone (IN2-64). **IN2-70** types an *organisation* rather
 * than a value, so it goes through the shared party-role test ({@link HL7_ORGANISATION_PARTY_RULES},
 * {@link HL7_PARTY_ROLE_TABLE}) that the X12 adapter applies to an `NM1` / `N1` party, and fails closed:
 * the role there is the insured's employer, which the clause names, so name and identifier both go. The
 * *insurer's* own company name, address and phone (IN1-3/4/5/7) and the coded employment status
 * (GT1-20) are untouched: neither is the individual's, a relative's or an employer's identity.
 *
 * **PV1-19 is a CX list routed by its CX-5 identifier-type code**, exactly like PID-3: a `VN`-typed or
 * untyped value is the encounter identifier (removed as the (R) catch-all, retainable), while an
 * `MR`/`AN`/`SS`-typed one is handled as the identifier it really is and is **transformed under both
 * profiles, never retained** -- §164.514(e)(2) names all three, so keeping one would republish in the
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
 * **Every position the pass hands through is enumerated.** A value-bearing position inside a segment
 * this adapter hands through that no locus rule names is **counted and located** as an unexamined
 * residual on {@link Hl7DeidResult.unexaminedResiduals}: the provider names in PV1-7/8 and OBR-16, the
 * date components carried inside a person-name or address composite, and the coded positions of every
 * retained segment. Nothing is transformed on account of it: the measurement exists so an empty residual
 * inventory can be told apart from an unmeasured one.
 *
 * **Known limitations.** Free text is block-only (no scrub); every **non-date** field of a retained
 * segment that the maps do not name is still passed through untouched, which includes the provider names
 * in PV1-7/8 and OBR-16 and the date components carried inside a person-name or address composite. The
 * date classification is fixed at v2.5.1, so a position only another version types as a date is a stated
 * residual, as are the file and batch envelope headers. The address generalization keeps only the Safe
 * Harbor 3-digit ZIP and conservatively drops the (permitted) state as well.
 *
 * **The postal-address allowance of §164.514(e)(2)(ii)** is the one place a profile can ask this pass to
 * keep MORE geography than that. A profile naming the `limited-data-set-geography` retention class keeps
 * the town or city (XAD.3), the State (XAD.4) and the **whole** zip code (XAD.5) of every mapped address
 * (PID-11, NK1-4, NK1-32, GT1-5, GT1-17, IN1-19), each recorded as a `DEID_RESIDUAL_RETAINED` residual
 * at its own component, and drops the street and every other component. The three-digit / `000` rule is
 * Safe Harbor's, so a restricted-prefix ZIP is kept in full under this class. **Nothing widens by
 * omission**: without the class an address is reduced exactly as it always was. An address whose ZIP is
 * not a whole zip code **fails closed** to that same generalization, which drops the whole repetition.
 * The county code (PID-12) and the birth place (PID-23) are blocked under every profile: (e)(2)(ii)
 * names neither. This adapter is the ONLY one that reads retention classes; the other five stay at Safe
 * Harbor geography.
 *
 * @packageDocumentation
 * @module @cosyte/deid/hl7
 */

import { parseHL7, type Hl7Message } from "@cosyte/hl7";

import { DeidError, FATAL_CODES } from "../codes.js";
import { deidentify, type DeidOptions } from "../deidentify.js";
import { type DeidManifestEntry } from "../manifest.js";
import { type UnexaminedResidual } from "../residual.js";
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
 * result.hl7; // de-identified HL7 wire, the same text as result.document.toString()
 * ```
 */
export interface Hl7DeidResult {
  /** The de-identified message: a fresh, independent {@link Hl7Message}; the input is never mutated. */
  readonly document: Hl7Message;
  /**
   * The de-identified message as HL7 v2 text: exactly `document.toString()`, the wire the round-trip
   * check read back. Use it rather than writing `document` again.
   */
  readonly hl7: string;
  /** The value-free audit of every action, in locus order (never a value, never a key). */
  readonly manifest: readonly DeidManifestEntry[];
  /**
   * The manifest's **second list**: every value-bearing position inside a segment this pass handed
   * through that **no locus rule named**, counted and located. Nothing here was transformed, blocked or
   * kept by a decision, because nothing reached it; an empty list is therefore a **measured zero**, not
   * a silence. Hand it to `buildExpertDeterminationSupportReport` alongside the manifest so the support
   * report can say which of the two it is.
   */
  readonly unexaminedResiduals: readonly UnexaminedResidual[];
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
 *   the message but no key context was supplied; `DEID_FORMAT_UNSUPPORTED` when the message carries
 *   more than one `MSH` segment (several messages read as one), refused before anything is extracted.
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
  // Refuse before anything is extracted, so a refused shape can never leave a partial artifact.
  assertOneMessage(msg);
  const { loci, coords, unexaminedResiduals } = extractHl7Loci(
    msg,
    options.retainedLoci !== undefined ? { retainedLoci: options.retainedLoci } : {},
  );
  const { document, manifest } = deidentify({ loci }, options);
  const deidentified = applyHl7(msg, document.loci, coords);
  const hl7 = writeRoundTripped(deidentified);
  return { document: deidentified, hl7, manifest, unexaminedResiduals };
}

/**
 * Convenience: parse raw HL7 v2 text, de-identify it, and return the de-identified wire, the
 * transformed message and the value-free manifest in one call. Parse warnings are not part of the
 * de-identification contract and are discarded here; call `parseHL7` directly if you need them.
 *
 * @param raw - One HL7 v2 message as text.
 * @param options - The policy, retention classes and key context (see {@link deidentifyHl7}).
 * @returns The de-identified wire on `hl7`, the transformed message and the value-free manifest.
 * @throws {@link DeidError} `DEID_OUTPUT_INVALID` when the transformed message does not round-trip
 *   through its parser; `DEID_NO_KEY` when a keyed transform is required but no key context was
 *   supplied; `DEID_FORMAT_UNSUPPORTED` when the text holds more than one `MSH` segment. Whatever `parseHL7` throws for text it cannot read is thrown as it is.
 * @example
 * ```ts
 * import { deidentifyHl7String } from "@cosyte/deid/hl7";
 * import { createDeidContext } from "@cosyte/deid";
 *
 * const { hl7, manifest } = deidentifyHl7String(raw, {
 *   context: createDeidContext({ key: process.env.DEID_KEY! }),
 * });
 * ```
 */
export function deidentifyHl7String(raw: string, options: DeidOptions = {}): Hl7DeidResult {
  return deidentifyHl7(parseHL7(raw), options);
}

/**
 * The diagnostic for a parsed message that carries more than one `MSH` segment. Fixed text this
 * library owns: it carries no value read from the message. Not exported: callers branch on the
 * `DEID_FORMAT_UNSUPPORTED` code.
 */
const HL7_REPEATED_MSH_REFUSAL_MESSAGE: string =
  "An HL7 v2 message carrying more than one MSH segment is refused, not handled: it is several " +
  "messages read as one, which may be several patients', and de-identifying them under one patient " +
  "context would give them one date-shift offset. De-identify each message on its own, each with " +
  "its own context.";

/**
 * Refuse a parsed message that carries a second `MSH` segment. A message has one header; the parser
 * reads messages written one after another, with no batch envelope, as one message whose later
 * headers are ordinary segments, so this is the only place the shape can be told apart.
 */
function assertOneMessage(msg: Hl7Message): void {
  let headers = 0;
  for (const seg of msg.allSegments()) {
    if (seg.type === "MSH") headers += 1;
    if (headers > 1) {
      throw new DeidError(FATAL_CODES.DEID_FORMAT_UNSUPPORTED, HL7_REPEATED_MSH_REFUSAL_MESSAGE);
    }
  }
}

/**
 * Write the transformed message once and fail closed on the **shape** of what was written: its own
 * parser must be able to read it, and reading it must be **stable**, so what a downstream reader sees
 * is what this pass emitted. A pass that emptied a locus and left a message its own reader reads
 * differently cannot say what a downstream reader will make of the values still in it, so it throws
 * rather than return a partially transformed document. The wire it wrote is returned, so a caller
 * that wants the text never writes the message a second time.
 *
 * Stability, not byte-equality, is the test, and the difference is deliberate: the serializer strips
 * an insignificant trailing empty field, so a wire this adapter emits can be one canonicalization step
 * away from the parser's own form without a single value or position having moved. The **fixed point**
 * is the honest invariant: read the emitted wire, write it back, and reading that again must produce
 * the same bytes. A structure that re-reads differently never reaches one.
 *
 * The check reads the wire once and writes it back once. When that write reproduces the wire, the
 * wire is already the fixed point (reading it again would read the same text), so nothing more is
 * done; only a wire one canonicalization step away is read and written a second time to find out
 * whether the canonical form is stable.
 *
 * The diagnostic is value-free, like every other one on this path: it names the failure, never the
 * message.
 */
function writeRoundTripped(document: Hl7Message): string {
  const wire = document.toString();
  let stable: boolean;
  try {
    const canonical = parseHL7(wire).toString();
    stable = canonical === wire || parseHL7(canonical).toString() === canonical;
  } catch {
    stable = false;
  }
  if (!stable) {
    throw new DeidError(
      FATAL_CODES.DEID_OUTPUT_INVALID,
      "the de-identified HL7 v2 message did not round-trip through its parser; no document is returned",
    );
  }
  return wire;
}

export {
  HL7_LOCUS_MAP,
  HL7_ORGANISATION_PARTY_RULES,
  HL7_PARTY_ROLES,
  HL7_PARTY_ROLE_TABLE,
  categoryForIdentifierType,
  type Hl7FieldRule,
  type Hl7FieldMode,
  type Hl7OrgPartyRule,
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
export {
  LIMITED_DATA_SET_ADDRESS_PARTS,
  RETAINED_LOCUS_CLASSES,
  isRetainableZipCode,
  retains,
  type RetainedLocusClass,
  type RetainedLocusPart,
} from "../retention.js";
export { type UnexaminedResidual } from "../residual.js";
export { SAFE_HARBOR_CATEGORIES, type SafeHarborCategory } from "../categories.js";
