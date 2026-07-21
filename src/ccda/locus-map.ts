/**
 * The **C-CDA locus map** — the cited table of *where* the 18 HIPAA Safe Harbor identifier categories
 * live in an HL7 CDA R2.1 document, expressed as the structural **element types** that carry direct
 * person PHI and the coded/administrative element types that must be **retained** (the over-scrub
 * guard). This is the consumer-tier thesis (roadmap §5) applied to C-CDA: PHI is located
 * **structurally**, at the CDA element the standard defines for it — a `<name>` inside a person role is
 * a person name because CDA says so, never because a string "looked like" a name.
 *
 * Unlike HL7 v2's flat segment/field grid, a CDA document is a tree, so the map is expressed as element
 * rules the extractor applies while walking the **header person participations** (recordTarget /
 * author / informant / authenticator / legalAuthenticator / dataEnterer / participant / custodian /
 * documentationOf / componentOf and the guardian nested under the patient — roadmap §4.6 relatives).
 * The clinical **structuredBody** is deliberately *not* swept: its `<name>` can be a drug or material
 * name, so a whole-document name sweep would destroy clinical meaning (over-scrub). Section narrative
 * `<text>` blocks **fail closed**; genuinely unrecognized elements that carry a value **fail closed**.
 *
 * Element positions are grounded in the CDA R2 / C-CDA R2.1 header model (`recordTarget/patientRole`,
 * `patient/name`, `patient/birthTime`, `addr`, `telecom`, `assignedAuthor/assignedPerson/name`, …) —
 * the same structure the sibling `@cosyte/ccda` parser reads.
 *
 * @packageDocumentation
 */

import { SAFE_HARBOR_CATEGORIES, type SafeHarborCategory } from "../categories.js";

const C = SAFE_HARBOR_CATEGORIES;

/**
 * The HL7 v3 namespace every structural C-CDA element lives in (`urn:hl7-org:v3`). An element outside
 * this namespace (a vendor extension, an `sdtc:*` element) is unrecognized structure and **fails
 * closed**. Duplicated here (rather than imported from `@cosyte/ccda`) so the map is a plain data
 * module with no value-carrying import.
 */
export const V3_NS = "urn:hl7-org:v3";

/** The SSN assigning-authority OID (`2.16.840.1.113883.4.1`) — an `id/@root` naming this is an SSN. */
const SSN_ROOT_OID = "2.16.840.1.113883.4.1";

/**
 * The **document-envelope** elements — direct children of `ClinicalDocument` that carry no direct
 * patient/relative Safe Harbor identifier and are retained untouched, exactly as HL7 v2's MSH envelope
 * is (roadmap §Phase 2). The document `effectiveTime` is handled separately (it is a service-related
 * date → generalized); everything here is passed through.
 *
 * @example
 * ```ts
 * import { CCDA_ENVELOPE_ELEMENTS } from "@cosyte/deid/ccda";
 *
 * CCDA_ENVELOPE_ELEMENTS.has("confidentialityCode"); // => true
 * ```
 */
export const CCDA_ENVELOPE_ELEMENTS: ReadonlySet<string> = new Set<string>([
  "realmCode",
  "typeId",
  "templateId",
  "id", // document instance id (envelope, like MSH-10) — not the patient's id
  "code",
  "title",
  "confidentialityCode",
  "languageCode",
  "setId",
  "versionNumber",
]);

/**
 * How the extractor turns a mapped C-CDA element into a locus and how the applier writes it back:
 *
 * - `name` — a person `<name>` (patient / guardian / author / informant / relative). Redacted: the
 *   whole element is cleared. In the header, `<name>` is always a person or organization name (never a
 *   clinical drug/material name — those live in the retained clinical body), so it is always PHI.
 * - `telecom` — a `<telecom value="tel:…|mailto:…|fax:…">`. Redacted: the `@value` is cleared.
 * - `addr` — a structured `<addr>`. Generalized: only the Safe Harbor 3-digit ZIP (`postalCode`) is
 *   kept (state / country retained as permitted); every finer geographic child is dropped.
 * - `date` — a `<birthTime>` / `<time>` / `<effectiveTime>` calendar timestamp (its `@value`, and any
 *   `low`/`high`/`center` child `@value`). Generalized to year. Dosing-period `PIVL_TS`/`EIVL_TS`
 *   intervals are **not** dates and are excluded (they live in the clinical body, never swept).
 * - `id` — an `<id root= extension=>` at a person role (MRN / SSN / member / account). Pseudonymized:
 *   only the id value component is replaced (assigning-authority root retained), with an SSN-rooted id
 *   routed to the SSN category (redacted) — the structural, parser-typed knife-edge (§4.4).
 */
export type CcdaElementMode = "name" | "telecom" | "addr" | "date" | "id";

/**
 * The C-CDA element-type map — local element name → its handling mode and the Safe Harbor category it
 * carries. Applied by the extractor only inside a **header person participation**; the clinical body is
 * retained untouched (the over-scrub guard) and narrative `<text>` fails closed.
 *
 * @example
 * ```ts
 * import { CCDA_LOCUS_MAP } from "@cosyte/deid/ccda";
 *
 * CCDA_LOCUS_MAP.name?.category;   // => "NAMES"
 * CCDA_LOCUS_MAP.birthTime?.mode;  // => "date"
 * ```
 */
export const CCDA_LOCUS_MAP: Readonly<
  Record<string, { readonly mode: CcdaElementMode; readonly category: SafeHarborCategory }>
> = Object.freeze({
  name: { mode: "name", category: C.NAMES },
  telecom: { mode: "telecom", category: C.PHONE },
  addr: { mode: "addr", category: C.GEOGRAPHIC },
  birthTime: { mode: "date", category: C.DATES },
  time: { mode: "date", category: C.DATES },
  effectiveTime: { mode: "date", category: C.DATES },
  id: { mode: "id", category: C.MRN },
});

/**
 * The **positive allow-list** of recognized coded / administrative / structural CDA element names whose
 * own value is coded structure, not free PHI — the over-scrub guard. This is an **explicit set**, never
 * a `localName.endsWith("Code")` pattern: an open-ended suffix match would silently retain an unknown
 * vendor element (e.g. `<customPatientCode>`) and leak the PHI it carries. An element on this list is
 * not itself acted on, **but the extractor still descends into it** — a `<code>` can wrap a free-text
 * `<originalText>` and a `<maritalStatusCode>` could nest a `<name>`; those children are handled by the
 * normal walk (blocked / redacted), never passed through because their parent was recognized. Anything
 * **not** on this list that carries a value fails closed (roadmap §4 — the (R) catch-all).
 */
export const CCDA_CODED_ELEMENTS: ReadonlySet<string> = new Set<string>([
  // Concept descriptors + their coded children.
  "code",
  "translation",
  "qualifier",
  // Administrative / demographic coded elements (no direct person PHI — the value is a code).
  "administrativeGenderCode",
  "raceCode",
  "ethnicGroupCode",
  "maritalStatusCode",
  "religiousAffiliationCode",
  "confidentialityCode",
  "languageCode",
  "statusCode",
  "signatureCode",
  "standardIndustryClassCode",
  "functionCode",
  "priorityCode",
  "modeCode",
  "proficiencyLevelCode",
  "interpretationCode",
  "methodCode",
  "routeCode",
  "approachSiteCode",
  "targetSiteCode",
  // Structural identity elements whose `root`/`extension` are OIDs, not PHI.
  "templateId",
  "realmCode",
  "typeId",
  // A software/device descriptor, not a person.
  "assignedAuthoringDevice",
]);

/**
 * `true` when an element is on the recognized coded/structural allow-list ({@link CCDA_CODED_ELEMENTS})
 * — its own value is retained untouched (the over-scrub guard). The extractor still descends into it, so
 * a name / address / free-text child a vendor nested inside is handled, never passed through.
 *
 * @param localName - The element's local name (namespace already confirmed HL7 v3 by the caller).
 * @returns `true` when the element is a recognized coded/structural non-identifier.
 * @example
 * ```ts
 * import { isRetainedCcdaElement } from "@cosyte/deid/ccda";
 *
 * isRetainedCcdaElement("administrativeGenderCode"); // => true
 * isRetainedCcdaElement("customPatientCode");        // => false  (unknown → fails closed)
 * isRetainedCcdaElement("streetAddressLine");        // => false
 * ```
 */
export function isRetainedCcdaElement(localName: string): boolean {
  return CCDA_CODED_ELEMENTS.has(localName);
}

/**
 * Resolve the Safe Harbor category for a person-role `<id>` from its assigning-authority `root` OID: an
 * SSN-rooted id is an **SSN** (redacted); every other person/organization id defaults to **MRN**
 * (pseudonymized to a consistent surrogate, the assigning authority retained). This is the structural,
 * parser-typed way to tell an SSN from an MRN at a CDA id locus — the C-CDA analogue of HL7's CX-5
 * identifier-type routing (§4.4 knife-edge).
 *
 * @param root - The `id/@root` OID/UUID, or `undefined`.
 * @param fallback - The category to use when the root is unrecognized/absent (defaults to MRN).
 * @returns The resolved Safe Harbor category.
 * @example
 * ```ts
 * import { categoryForIdRoot, SAFE_HARBOR_CATEGORIES } from "@cosyte/deid/ccda";
 *
 * categoryForIdRoot("2.16.840.1.113883.4.1"); // => "SSN"
 * categoryForIdRoot("2.16.840.1.113883.19.5"); // => "MRN"
 * ```
 */
export function categoryForIdRoot(
  root: string | undefined,
  fallback: SafeHarborCategory = C.MRN,
): SafeHarborCategory {
  if (root === SSN_ROOT_OID) return C.SSN;
  return fallback;
}
