/**
 * Fold a `@cosyte/dicom` **PS3.15 Annex E** de-identification report into the unified value-free manifest.
 * The DICOM layer is authoritative for *what was done* to each attribute: this module only re-expresses
 * its report in the shared {@link DeidManifestEntry} shape so a DICOM manifest reads like every other
 * format's.
 *
 * **Value-free, always.** An entry carries the Safe Harbor category, the transform, the **locus** (the DICOM
 * tag + keyword + any sequence context path) and a count, **never** a decoded value. The source→replacement
 * UID map is deliberately *not* folded in: a source UID is a removed value and re-linking vector, so it never
 * appears in the manifest (a caller who needs cross-file consistency owns the shared `uidMap`).
 *
 * **The category is a coarse audit label, not a claim of precision.** Each acted-on attribute is classified
 * to its obvious Safe Harbor category where the keyword makes it plain (a person-name element → Names, a
 * birth/study date → Dates, an institution/address → Geographic, a UID → the catch-all), and **everything
 * else falls closed to category (R): "any other unique identifying number, characteristic, or code"**
 * (§164.514(b)(2)(i)(R)). Defaulting the unclassified to (R) mirrors the core's documented posture and never
 * *under*-labels PHI. The authoritative de-id action is the delegated Annex E action, preserved in the
 * entry's transform/disposition.
 *
 * @packageDocumentation
 */

import { SAFE_HARBOR_CATEGORIES, type SafeHarborCategory } from "../categories.js";
import { DEID_DISPOSITION_CODES, type DeidDispositionCode } from "../codes.js";
import { ManifestBuilder, type DeidManifestEntry } from "../manifest.js";
import type { TransformName } from "../policy.js";
import {
  enumerateOrFail,
  UnexaminedResidualBuilder,
  type UnexaminedResidual,
} from "../residual.js";

import type { DicomDeidWarning } from "./types.js";

/** The `applied` outcomes `@cosyte/dicom` reports for one attribute. */
type AppliedAction = "removed" | "emptied" | "dummied" | "uid-remapped" | "cleaned" | "kept";

/** One audited attribute from a `@cosyte/dicom` `DeidentifyReport` (structural facts only). */
interface ReportAttribute {
  readonly tag: string;
  readonly keyword: string;
  readonly applied: AppliedAction;
  readonly contextPath?: readonly string[];
}

/** The value-free shape of a `@cosyte/dicom` `DeidentifyReport` this module consumes. */
export interface FoldableReport {
  readonly attributes: readonly ReportAttribute[];
  readonly removedPrivateTags: readonly string[];
  readonly warnings: readonly { readonly code: string; readonly message: string }[];
  readonly retained: readonly string[];
}

/** How each Annex E outcome maps into the unified transform / disposition / disposition-code triple. */
interface Mapped {
  readonly transform: TransformName;
  readonly disposition: DeidManifestEntry["disposition"];
  readonly code: DeidDispositionCode;
}

const APPLIED_MAP: Readonly<Record<Exclude<AppliedAction, "kept">, Mapped>> = {
  // `X`: the attribute was deleted outright.
  removed: {
    transform: "redact",
    disposition: "removed",
    code: DEID_DISPOSITION_CODES.DEID_CATEGORY_REMOVED,
  },
  // `Z`: replaced with a zero-length value; the value is gone.
  emptied: {
    transform: "redact",
    disposition: "removed",
    code: DEID_DISPOSITION_CODES.DEID_CATEGORY_REMOVED,
  },
  // `D`: replaced with a non-identifying dummy; the PHI value is gone, a placeholder remains.
  dummied: {
    transform: "redact",
    disposition: "transformed",
    code: DEID_DISPOSITION_CODES.DEID_CATEGORY_REMOVED,
  },
  // `U`: replaced with an internally-consistent surrogate UID (a keyed-style consistent surrogate).
  "uid-remapped": {
    transform: "pseudonymize",
    disposition: "transformed",
    code: DEID_DISPOSITION_CODES.DEID_CATEGORY_PSEUDONYMIZED,
  },
  // `C`, conservatively blanked because a safe similar-meaning value cannot be synthesised: fail-closed.
  cleaned: {
    transform: "block",
    disposition: "blocked",
    code: DEID_DISPOSITION_CODES.DEID_LOCUS_BLOCKED,
  },
};

/** Person-name keyword qualifiers: an element is a *person* name only alongside one of these. */
const PERSON_NAME_QUALIFIER =
  /patient|physician|operator|person|author|performer|referring|requesting|responsible|guardian|mother|reviewer|reading|verifying|scheduled|admitting|consulting/;
/** Equipment/organization "…Name" elements that are NOT a person's name. */
const NON_PERSON_NAME = /institution|station|model|manufacturer|application|scheme|codemeaning/;

/**
 * Classify an acted-on DICOM attribute into its Safe Harbor category: precise where the keyword makes the
 * category plain, and **falling closed to (R)** (`OTHER_UNIQUE_ID`) for everything else. A coarse audit
 * label: it never under-labels PHI, and the authoritative action is the delegated Annex E action.
 *
 * @param keyword - The attribute's Part 6 keyword (e.g. `PatientName`).
 * @param applied - The Annex E outcome (`uid-remapped` forces the catch-all).
 * @returns The Safe Harbor category for the manifest entry.
 * @internal
 */
export function classifyDicomCategory(keyword: string, applied: AppliedAction): SafeHarborCategory {
  // Normalize: `@cosyte/dicom` reports the spaced attribute name ("Patient ID", "Referring Physician's
  // Name"), so strip spaces/punctuation before substring matching.
  const k = keyword.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (applied === "uid-remapped" || k.endsWith("uid"))
    return SAFE_HARBOR_CATEGORIES.OTHER_UNIQUE_ID;
  if (k.includes("telephone") || k.includes("phone")) return SAFE_HARBOR_CATEGORIES.PHONE;
  if (k.includes("email")) return SAFE_HARBOR_CATEGORIES.EMAIL;
  if (k.includes("url")) return SAFE_HARBOR_CATEGORIES.URL;
  if (k.includes("name") && PERSON_NAME_QUALIFIER.test(k) && !NON_PERSON_NAME.test(k)) {
    return SAFE_HARBOR_CATEGORIES.NAMES;
  }
  if (
    k.includes("institution") ||
    k.includes("address") ||
    k.includes("postal") ||
    k.includes("zip") ||
    k.includes("region") ||
    k.includes("country") ||
    k.includes("county") ||
    k.includes("city")
  ) {
    return SAFE_HARBOR_CATEGORIES.GEOGRAPHIC;
  }
  if (k.includes("date") || k.includes("time") || k.includes("birth")) {
    return SAFE_HARBOR_CATEGORIES.DATES;
  }
  if (k.includes("patientid") || k.includes("medicalrecord") || k.includes("issuerofpatient")) {
    return SAFE_HARBOR_CATEGORIES.MRN;
  }
  if (
    k.includes("serialnumber") ||
    k.includes("deviceserial") ||
    k.includes("gantryid") ||
    k.includes("detectorid")
  ) {
    return SAFE_HARBOR_CATEGORIES.DEVICE;
  }
  return SAFE_HARBOR_CATEGORIES.OTHER_UNIQUE_ID;
}

/** Format a tag `"00100010"` as `"(0010,0010)"`. A malformed tag is passed through unchanged. */
function formatTag(tag: string): string {
  return /^[0-9A-Fa-f]{8}$/.test(tag)
    ? `(${tag.slice(0, 4).toLowerCase()},${tag.slice(4, 8).toLowerCase()})`
    : tag;
}

/**
 * Build the value-free locus string for an attribute: `[ctx/…]/(gggg,eeee) Keyword`.
 *
 * **None of these three is document-derived, which is why no shape bound is applied here** (the sibling
 * adapters all bound theirs, see `../derived-token.ts`). `@cosyte/dicom` composes the report this reads:
 * the tag is normalised to eight uppercase hex digits by the parser, the keyword is a string from a
 * static table, and a sequence-context entry is a structurally-composed `TAG[index]`. A shape test here
 * cannot reach any input byte, and a first attempt at one refused every sequence-context entry (they
 * carry brackets) and two genuine Part 6 attribute names longer than 64 characters, on spec-clean files.
 * If a bound is ever wanted here, calibrate it against that real contract rather than against the shape
 * a keyword "ought" to have.
 */
function formatLocus(tag: string, keyword: string, contextPath?: readonly string[]): string {
  const prefix = contextPath && contextPath.length > 0 ? `${contextPath.join("/")}/` : "";
  const kw = keyword.length > 0 ? ` ${keyword}` : "";
  return `${prefix}${formatTag(tag)}${kw}`;
}

/**
 * Fold a `@cosyte/dicom` de-identification report into the unified value-free manifest. Attributes the
 * Annex E pass **kept** are omitted (nothing was acted on); removed private tags are recorded as redactions
 * under the catch-all category (they are removed unless a known-safe retain list keeps them).
 *
 * @param report - The value-free report returned by `@cosyte/dicom`'s `deidentify`.
 * @returns The manifest entries in locus order, counts aggregated.
 * @internal
 */
export function foldReport(report: FoldableReport): readonly DeidManifestEntry[] {
  const builder = new ManifestBuilder();

  for (const attr of report.attributes) {
    if (attr.applied === "kept") continue;
    const mapped = APPLIED_MAP[attr.applied];
    builder.add({
      category: classifyDicomCategory(attr.keyword, attr.applied),
      transform: mapped.transform,
      locus: formatLocus(attr.tag, attr.keyword, attr.contextPath),
      disposition: mapped.disposition,
      code: mapped.code,
    });
  }

  for (const tag of report.removedPrivateTags) {
    builder.add({
      category: SAFE_HARBOR_CATEGORIES.OTHER_UNIQUE_ID,
      transform: "redact",
      locus: `${formatTag(tag)} PrivateTag`,
      disposition: "removed",
      code: DEID_DISPOSITION_CODES.DEID_CATEGORY_REMOVED,
    });
  }

  return builder.build();
}

/**
 * One attribute of the de-identified dataset as this module needs to see it. **Structural facts only:
 * the decoded value is never read**, and the two length facts below are read as numbers, never as
 * content, exactly as a locus carries a coordinate and never a byte.
 */
export interface EnumerableElement {
  readonly tag: string;
  /** The Value Representation. `"SQ"` marks a sequence **container**, which carries no value of its own. */
  readonly vr: string;
  /** The declared value length. Zero means the attribute was sent empty. */
  readonly length: number;
  /** The on-wire value bytes; only their **count** is read, never a byte of their content. */
  readonly rawBytes: { readonly length: number };
  readonly items?: readonly EnumerableDataset[] | undefined;
}

/** A dataset (or a sequence item) whose elements can be enumerated in parse order. */
export interface EnumerableDataset {
  elements(): readonly EnumerableElement[];
}

/**
 * Derive the **unexamined residual positions** of a DICOM pass from the dataset the delegated PS3.15
 * Annex E pass returned.
 *
 * This adapter holds **no position map of its own**: the Annex E pass owns what was done to each
 * attribute, so the measurement is a derivation rather than an enumeration of a table. An attribute
 * present in the returned dataset that the folded report does not account for is one **no rule reached**,
 * and it is counted and located here. The report accounts for an attribute in three ways, and all three
 * are decisions: it acted on it, it **kept** it (`applied: "kept"` is the profile's `K`, a decision, not
 * a silence), or it removed it as a private tag.
 *
 * **Nested items are enumerated too**, because a sequence is exactly where an unaccounted attribute
 * hides: the walk descends through `Element.items`, which the peer exposes, and matches a nested
 * attribute against the report's own sequence-context entries by tag. The match is by **tag**, so an
 * attribute the report names anywhere is treated as reached everywhere it occurs: the conservative
 * direction, which under-counts rather than reporting a position the pass did decide about.
 *
 * **Only value-bearing positions are counted** (see {@link isValueBearing}): an attribute sent empty
 * carries no value, and a sequence container is a structure rather than a position. Both are read off
 * the peer's own structural surface as numbers and a VR, never by decoding a value.
 *
 * **The derivation is deliberately literal, and one consequence is worth stating rather than quietly
 * filtering.** The Annex E pass writes its own Patient Identity Removed and De-identification Method
 * attributes into the result, and the report does not account for those either, so they appear in the
 * measurement like any other unaccounted attribute. Forgiving them would mean this adapter keeping a
 * hand-written list of tags to exclude, which is the position map it deliberately does not hold: the
 * moment such a list exists it is one more thing to keep in step with the peer's profile, and a stale
 * entry there would hide a real attribute rather than a self-signature.
 *
 * @param dataset - The dataset the Annex E pass returned.
 * @param report - The value-free report it returned alongside.
 * @returns The unexamined residual positions, aggregated by locus, in dataset order.
 * @throws {@link DeidError} `DEID_POSITIONS_UNENUMERABLE` when a dataset or a sequence item will not
 *   yield its elements: the pass fails rather than emit a zero or a partial count, exactly as it does
 *   for a segment that will not yield its fields.
 * @internal
 */
export function deriveUnexaminedResiduals(
  dataset: EnumerableDataset,
  report: FoldableReport,
): readonly UnexaminedResidual[] {
  const accounted = new Set<string>();
  for (const attribute of report.attributes) accounted.add(normalizeTag(attribute.tag));
  for (const tag of report.removedPrivateTags) accounted.add(normalizeTag(tag));

  const residuals = new UnexaminedResidualBuilder();
  walkDataset(dataset, [], accounted, residuals);
  return residuals.build();
}

/** Case-fold a tag so a report entry and a dataset element agree on identity. */
function normalizeTag(tag: string): string {
  return tag.toUpperCase();
}

/**
 * Whether an attribute is a **value-bearing position**: one that carries a non-empty value in the
 * document being processed. An absent or empty position is not a residual and is not counted, which is
 * the same test the five structural adapters apply to a field, an element and an attribute.
 *
 * Two things are not value-bearing positions, for different reasons:
 *
 * - **A sequence is a structure, not a position.** An `SQ` element holds items, and the positions it
 *   holds are the attributes inside those items, which the walk reaches on their own and counts there.
 *   Counting the container as well would count one structure as if it were a value. The test is the VR
 *   rather than the presence of items, because encapsulated Pixel Data also carries items and *is* a
 *   value-bearing position.
 * - **A zero-length attribute carries no value.** A Type 2 attribute sent empty is routine in DICOM and
 *   is exactly the "absent or empty position" the definition excludes.
 *
 * Both length facts are read, and either one being non-zero counts the position: a declared length the
 * bytes do not back is a malformed element, and over-reporting one is the safe direction.
 */
function isValueBearing(element: EnumerableElement): boolean {
  if (element.vr === "SQ") return false;
  return element.length > 0 || element.rawBytes.length > 0;
}

/** The bounded structural token naming the root dataset in an enumeration failure. */
const ROOT_DATASET_STRUCTURE = "dataset";

/**
 * Walk a dataset and its sequence items, recording every attribute the report does not account for.
 *
 * The walk of each structure runs under the second fail-safe, so a dataset or a sequence item that will
 * not yield its elements fails the pass with the typed `DEID_POSITIONS_UNENUMERABLE` rather than
 * escaping as the peer's own error or leaving a partial count behind. The structure named is the
 * innermost one that refused: the nested call raises first, and `enumerateOrFail` passes an existing
 * `DeidError` outward unchanged. The token is the same structurally-composed context path a locus
 * carries, so nothing document-derived reaches the message.
 */
function walkDataset(
  dataset: EnumerableDataset,
  context: readonly string[],
  accounted: ReadonlySet<string>,
  residuals: UnexaminedResidualBuilder,
): void {
  const structure = context.length > 0 ? context.join("/") : ROOT_DATASET_STRUCTURE;
  enumerateOrFail(structure, () => {
    dataset.elements().forEach((element) => {
      const items = element.items;
      if (isValueBearing(element) && !accounted.has(normalizeTag(element.tag))) {
        residuals.record(formatLocus(element.tag, "", context));
      }
      if (items === undefined) return;
      items.forEach((item, index) => {
        walkDataset(
          item,
          [...context, `${formatTag(element.tag)}[${String(index)}]`],
          accounted,
          residuals,
        );
      });
    });
  });
}

/**
 * Re-express the report's warnings as value-free adapter warnings.
 *
 * @internal
 */
export function foldWarnings(
  warnings: readonly { readonly code: string; readonly message: string }[],
): readonly DicomDeidWarning[] {
  return Object.freeze(warnings.map((w) => Object.freeze({ code: w.code, message: w.message })));
}

/**
 * The `@cosyte/dicom` warning code that flags un-removable burned-in pixel annotation. Re-exported from
 * `@cosyte/deid/dicom` so consumers can branch on the burned-in hazard by its stable code.
 *
 * @example
 * ```ts
 * import { deidentifyDicom, BURNED_IN_ANNOTATION_CODE } from "@cosyte/deid/dicom";
 *
 * const { warnings } = deidentifyDicom(dataset);
 * const burnedIn = warnings.some((w) => w.code === BURNED_IN_ANNOTATION_CODE);
 * ```
 */
export const BURNED_IN_ANNOTATION_CODE = "DICOM_BURNED_IN_ANNOTATION_NOT_REMOVED";
