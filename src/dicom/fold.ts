/**
 * Fold a `@cosyte/dicom` **PS3.15 Annex E** de-identification report into the unified value-free manifest
 * (roadmap §Phase 6, §4.7). The DICOM layer is authoritative for *what was done* to each attribute — this
 * module only re-expresses its report in the shared {@link DeidManifestEntry} shape so a DICOM manifest
 * reads like every other format's.
 *
 * **Value-free, always.** An entry carries the Safe Harbor category, the transform, the **locus** (the DICOM
 * tag + keyword + any sequence context path) and a count — **never** a decoded value. The source→replacement
 * UID map is deliberately *not* folded in: a source UID is a removed value and re-linking vector, so it never
 * appears in the manifest (a caller who needs cross-file consistency owns the shared `uidMap`).
 *
 * **The category is a coarse audit label, not a claim of precision.** Each acted-on attribute is classified
 * to its obvious Safe Harbor category where the keyword makes it plain (a person-name element → Names, a
 * birth/study date → Dates, an institution/address → Geographic, a UID → the catch-all), and **everything
 * else falls closed to category (R) — "any other unique identifying number, characteristic, or code"**
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
  // `X` — the attribute was deleted outright.
  removed: {
    transform: "redact",
    disposition: "removed",
    code: DEID_DISPOSITION_CODES.DEID_CATEGORY_REMOVED,
  },
  // `Z` — replaced with a zero-length value; the value is gone.
  emptied: {
    transform: "redact",
    disposition: "removed",
    code: DEID_DISPOSITION_CODES.DEID_CATEGORY_REMOVED,
  },
  // `D` — replaced with a non-identifying dummy; the PHI value is gone, a placeholder remains.
  dummied: {
    transform: "redact",
    disposition: "transformed",
    code: DEID_DISPOSITION_CODES.DEID_CATEGORY_REMOVED,
  },
  // `U` — replaced with an internally-consistent surrogate UID (a keyed-style consistent surrogate).
  "uid-remapped": {
    transform: "pseudonymize",
    disposition: "transformed",
    code: DEID_DISPOSITION_CODES.DEID_CATEGORY_PSEUDONYMIZED,
  },
  // `C` — conservatively blanked because a safe similar-meaning value cannot be synthesised: fail-closed.
  cleaned: {
    transform: "block",
    disposition: "blocked",
    code: DEID_DISPOSITION_CODES.DEID_LOCUS_BLOCKED,
  },
};

/** Person-name keyword qualifiers — an element is a *person* name only alongside one of these. */
const PERSON_NAME_QUALIFIER =
  /patient|physician|operator|person|author|performer|referring|requesting|responsible|guardian|mother|reviewer|reading|verifying|scheduled|admitting|consulting/;
/** Equipment/organization "…Name" elements that are NOT a person's name. */
const NON_PERSON_NAME = /institution|station|model|manufacturer|application|scheme|codemeaning/;

/**
 * Classify an acted-on DICOM attribute into its Safe Harbor category — precise where the keyword makes the
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

/** Build the value-free locus string for an attribute: `[ctx/…]/(gggg,eeee) Keyword`. */
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
