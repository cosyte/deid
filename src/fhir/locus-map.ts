/**
 * The **FHIR locus map** — the cited table of *where* the 18 HIPAA Safe Harbor identifier categories
 * live in a FHIR R4 resource, expressed against the **generic element tree** the sibling `@cosyte/fhir`
 * parser produces (`FhirComplex` / `FhirList` / `FhirPrimitive` — there are no typed per-resource
 * models; every resource, datatype, and extension is the same node shape, reached by property name).
 * This is the consumer-tier thesis (roadmap §5) applied to FHIR: PHI is located **structurally**, at
 * the FHIR element the standard defines for it — a `name` under a `Patient` is the patient's name
 * because FHIR says so, never because a string "looked like" a name.
 *
 * FHIR is a **graph of typed resources**, so — unlike the flat HL7 grid or the single-patient CDA tree —
 * the map is split by **resource role**:
 *
 * - **Identifying (person) resources** — `Patient` / `RelatedPerson` / `Practitioner` / `Person`
 *   (roadmap §Phase 4, the demographics carriers, plus the nested `Patient.contact` relative — §4.6).
 *   Their demographic elements (`name` / `telecom` / `address` / `photo` / `birthDate`) are direct PHI.
 * - **Every resource** — the **universal** PHI vectors that leak regardless of resource type:
 *   `identifier` (MRN pseudonymized by system, SSN removed), PHI-bearing **dates**, the narrative
 *   `text.div`, **extensions** (the fail-closed frontier — an unknown extension can carry any PHI), and
 *   a `Reference.display` (a human label that is usually a person's name).
 * - **Clinical resources** — `Observation` / `Condition` / … — are otherwise **retained untouched** (the
 *   over-scrub guard): their codes, values, units, and statuses are not identifiers and must survive.
 *
 * Element positions are grounded in the FHIR R4 datatype model (`HumanName`, `ContactPoint`, `Address`,
 * `Identifier`, `Reference`, `Narrative`) — the same structures the sibling `@cosyte/fhir` reader parses.
 *
 * @packageDocumentation
 */

import { SAFE_HARBOR_CATEGORIES, type SafeHarborCategory } from "../categories.js";

const C = SAFE_HARBOR_CATEGORIES;

/**
 * The **identifying (person) resource types** whose demographic elements carry direct Safe Harbor PHI.
 * Scoped to the four the roadmap names (§Phase 4); a demographic `name` / `address` in any other
 * resource (`Location.address`, `Organization.name`) is facility/administrative data, not the
 * individual's PHI, and is left to the clinical-retain path — the FHIR analogue of C-CDA sweeping only
 * the header participations, never the clinical body.
 *
 * @example
 * ```ts
 * import { PERSON_RESOURCE_TYPES } from "@cosyte/deid/fhir";
 *
 * PERSON_RESOURCE_TYPES.has("Patient");     // => true
 * PERSON_RESOURCE_TYPES.has("Observation"); // => false
 * ```
 */
export const PERSON_RESOURCE_TYPES: ReadonlySet<string> = new Set<string>([
  "Patient",
  "RelatedPerson",
  "Practitioner",
  "Person",
]);

/**
 * The **demographic element** names that carry direct PHI **inside a person resource** (and its nested
 * `contact` relative — §4.6): `name` (HumanName), `telecom` (ContactPoint), and `photo` (Attachment)
 * are redacted whole; `address` (Address) is generalized to the safe 3-digit ZIP. `birthDate` and every
 * other date is handled generically by {@link isFhirDateValue} (date → year), so it is deliberately not
 * listed here.
 */
export type FhirDemographicMode = "redact" | "address";

/**
 * The person-resource demographic element map — element name → how the applier handles it. Applied only
 * within a {@link PERSON_RESOURCE_TYPES} resource subtree (so a body `Coding.display` or a
 * `Location.address` is never swept). A mapped element is handled as a **unit** — the extractor does not
 * descend into it, so a redacted `name` never has an inner primitive ride through.
 *
 * @example
 * ```ts
 * import { FHIR_DEMOGRAPHIC_ELEMENTS } from "@cosyte/deid/fhir";
 *
 * FHIR_DEMOGRAPHIC_ELEMENTS.name;    // => "redact"
 * FHIR_DEMOGRAPHIC_ELEMENTS.address; // => "address"
 * ```
 */
export const FHIR_DEMOGRAPHIC_ELEMENTS: Readonly<Record<string, FhirDemographicMode>> =
  Object.freeze({
    name: "redact",
    telecom: "redact",
    photo: "redact",
    address: "address",
  });

/**
 * The **positive allow-list** of person-resource top-level element names whose own primitive value is
 * recognized structural / coded / administrative data (not free PHI) — the over-scrub guard for the
 * fail-closed person sweep. A **bare-string** top-level property of a person resource that is neither a
 * mapped demographic, an `identifier`/`text`/`extension`/`contained`, nor on this list is **blocked**
 * (roadmap §4 — the (R) catch-all): a vendor `<Patient>`-level string field (`ssn`, `motherMaidenName`)
 * cannot ride through in the clear. This is an **explicit set**, never a suffix/shape heuristic, for the
 * exact reason the C-CDA map is: an open-ended match would silently retain an unknown field and leak it.
 * The list covers the R4 person-resource scalar/coded elements; complex children are descended into
 * regardless (their PHI is caught by the datatype rules), so this gate only governs direct scalars.
 */
export const RECOGNIZED_PERSON_ELEMENTS: ReadonlySet<string> = new Set<string>([
  // Base resource structure.
  "resourceType",
  "id",
  "meta",
  "implicitRules",
  "language",
  // Coded / administrative demographics whose value is a code or a boolean, never free PHI.
  "active",
  "gender",
  "maritalStatus",
  "multipleBirthBoolean",
  "multipleBirthInteger",
  "deceasedBoolean",
  "communication",
  "birthOrder",
  "birthDate", // a date — generalized generically; recognized here so it is not blocked as unknown
  "deceasedDateTime", // a date — generalized generically
  // Structural links (references — walked; a Reference.display is blocked by the universal rule).
  "generalPractitioner",
  "managingOrganization",
  "organization",
  "link",
  "relationship",
  "patient",
  "contact", // BackboneElement — descended (its name/telecom/address are person PHI, §4.6)
  "qualification", // Practitioner
]);

/**
 * FHIR identifier `system` URIs that denote a **Social Security number** — an id under one of these is
 * an SSN (redacted), not an MRN (pseudonymized). The US SSN system is published as both the canonical
 * HL7 URL and its OID form; both are recognized. Every other person/organization identifier system
 * defaults to MRN (a consistent keyed surrogate, the `system` retained) — the FHIR analogue of the CDA
 * `id/@root` and HL7 CX-5 identifier-type routing (§4.4 knife-edge).
 */
const SSN_SYSTEMS: ReadonlySet<string> = new Set<string>([
  "http://hl7.org/fhir/sid/us-ssn",
  "urn:oid:2.16.840.1.113883.4.1",
]);

/**
 * Resolve the Safe Harbor category for a FHIR `Identifier` from its `system` URI: a US-SSN system is an
 * **SSN** (redacted); every other identifier defaults to **MRN** (pseudonymized to a consistent
 * surrogate, the `system` retained). Structural, parser-typed routing — never a guess from the value's
 * shape.
 *
 * @param system - The `Identifier.system` URI, or `undefined`.
 * @param fallback - The category for a non-SSN / absent system (defaults to MRN).
 * @returns The resolved Safe Harbor category.
 * @example
 * ```ts
 * import { categoryForIdentifierSystem, SAFE_HARBOR_CATEGORIES } from "@cosyte/deid/fhir";
 *
 * categoryForIdentifierSystem("http://hl7.org/fhir/sid/us-ssn");   // => "SSN"
 * categoryForIdentifierSystem("http://hospital.example/mrn");      // => "MRN"
 * ```
 */
export function categoryForIdentifierSystem(
  system: string | undefined,
  fallback: SafeHarborCategory = C.MRN,
): SafeHarborCategory {
  if (system !== undefined && SSN_SYSTEMS.has(system)) return C.SSN;
  return fallback;
}

/**
 * `true` when a primitive string value is a **FHIR date / dateTime / instant** carrying month precision
 * or finer — i.e. a PHI element of a date under Safe Harbor §164.514(b)(2)(i)(C). A bare four-digit year
 * (`"1985"`) is already Safe-Harbor-safe and returns `false` (it is retained, not re-generalized).
 *
 * Detection is **value-shaped and validated**, not element-name-based: any primitive whose whole value
 * is a real calendar date (`YYYY-MM`, `YYYY-MM-DD`, or a full `YYYY-MM-DDThh:mm:ss…` instant, with a
 * plausible year, month `01–12`, and day `01–31`) is a date wherever it sits — so a date in an
 * unexpected or vendor element is generalized too (fail closed on dates). The strict full-match with
 * month/day validation is what keeps a clinical code (`"2951-2"`, `"1234-56"`) from being mistaken for a
 * date and over-scrubbed: `2951-2` has a one-digit tail, `1234-56` has an impossible month.
 *
 * @param value - The primitive's string value.
 * @returns `true` when the value is a real date/dateTime with month-or-finer precision.
 * @example
 * ```ts
 * import { isFhirDateValue } from "@cosyte/deid/fhir";
 *
 * isFhirDateValue("2019-03-14");          // => true
 * isFhirDateValue("2019-03-14T09:00:00Z");// => true
 * isFhirDateValue("1985");                // => false  (year only — already safe)
 * isFhirDateValue("2951-2");              // => false  (a LOINC code, not a date)
 * isFhirDateValue("1234-56");             // => false  (impossible month 56)
 * ```
 */
export function isFhirDateValue(value: string): boolean {
  const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?(?:T[\d:.]+(?:Z|[+-]\d{2}:\d{2})?)?$/.exec(value);
  if (m === null) return false;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (year < 1000 || month < 1 || month > 12) return false;
  if (m[3] !== undefined) {
    const day = Number(m[3]);
    if (day < 1 || day > 31) return false;
  }
  return true;
}

/** The Safe Harbor category carried by a PHI-bearing FHIR date locus. @internal */
export const FHIR_DATE_CATEGORY: SafeHarborCategory = C.DATES;
