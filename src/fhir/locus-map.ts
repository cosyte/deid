/**
 * The **FHIR locus map**: the cited table of *where* the 18 HIPAA Safe Harbor identifier categories
 * live in a FHIR R4 resource, expressed against the **generic element tree** the sibling `@cosyte/fhir`
 * parser produces (`FhirComplex` / `FhirList` / `FhirPrimitive`, there are no typed per-resource
 * models; every resource, datatype, and extension is the same node shape, reached by property name).
 * This is the consumer-tier thesis applied to FHIR: PHI is located **structurally**, at
 * the FHIR element the standard defines for it: a `name` under a `Patient` is the patient's name
 * because FHIR says so, never because a string "looked like" a name.
 *
 * FHIR is a **graph of typed resources**, so, unlike the flat HL7 grid or the single-patient CDA tree,
 * the map is split by **resource role**:
 *
 * - **Identifying (person) resources**: `Patient` / `RelatedPerson` / `Practitioner` / `Person`
 *   (the demographics carriers, plus the nested `Patient.contact` relative).
 *   Their demographic elements (`name` / `telecom` / `address` / `photo` / `birthDate`) are direct PHI.
 * - **Every resource**, the **universal** PHI vectors that leak regardless of resource type:
 *   `identifier` (MRN pseudonymized by system, SSN removed), PHI-bearing **dates**, the narrative
 *   `text.div`, **extensions** (the fail-closed frontier, an unknown extension can carry any PHI), and
 *   a `Reference.display` (a human label that is usually a person's name).
 * - **Every resource, by DATATYPE**: a `HumanName` and an `Address` are acted on wherever the graph
 *   puts them, so `Organization.contact.name` and `Location.address` get the treatment
 *   `Patient.name` and `Patient.address` get. Which resource carries a person's name is a producer's
 *   shaping choice, and coverage that depends on it is coverage a consumer cannot rely on. The
 *   classification is closed and marker-bound (`./datatype.js`), which is what keeps the widened
 *   sweep off an organisation's own `name` string and off a clinical code.
 * - **Clinical resources**, `Observation` / `Condition` / …, are otherwise **retained untouched** (the
 *   over-scrub guard): their codes, values, units, and statuses are not identifiers and must survive.
 *
 * Element positions are grounded in the FHIR R4 datatype model (`HumanName`, `ContactPoint`, `Address`,
 * `Identifier`, `Reference`, `Narrative`): the same structures the sibling `@cosyte/fhir` reader parses.
 *
 * @packageDocumentation
 */

import { SAFE_HARBOR_CATEGORIES, type SafeHarborCategory } from "../categories.js";

const C = SAFE_HARBOR_CATEGORIES;

/**
 * The **identifying (person) resource types** whose demographic elements carry direct Safe Harbor PHI.
 * Scoped to those four, and that scope now governs the `telecom` / `photo` sweep and the
 * bare-unrecognized-string frontier **only**: a `HumanName` or an `Address` is acted on by its own
 * datatype wherever it sits, including on a `Location` or an `Organization` (see `./datatype.js`).
 * What stays outside every rule here is an organisation's own `name`, which is a plain string R4
 * types at no personal datatype at all.
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
 * `contact` relative): `name` (HumanName), `telecom` (ContactPoint), and `photo` (Attachment)
 * are redacted whole; `address` (Address) is generalized to the safe 3-digit ZIP. `birthDate` and every
 * other date is handled generically by {@link isFhirDateValue} (date → year), so it is deliberately not
 * listed here.
 */
export type FhirDemographicMode = "redact" | "address";

/**
 * The person-resource demographic element map: element name → how the applier handles it. Applied
 * within a {@link PERSON_RESOURCE_TYPES} resource subtree; outside one, the datatype-keyed sweep
 * reaches a `HumanName` and an `Address` on its own terms while a body `Coding.display` is still
 * never swept. A mapped element is handled as a **unit**: the extractor does not descend into it, so
 * a redacted `name` never has an inner primitive ride through.
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
 * The element names FHIR R4 **types** as a `HumanName` or an `Address`, as an **explicit enumeration**
 * and never a suffix or shape heuristic:
 *
 * - `name` - `Organization.contact.name`, `InsurancePlan.contact.name`.
 * - `address` - `Location.address`, `Organization.address`, `Organization.contact.address`,
 *   `InsurancePlan.contact.address`.
 * - `locationAddress` - the `Address` arm of `Claim.accident.location[x]` and
 *   `ExplanationOfBenefit.accident.location[x]`.
 * - `valueAddress` / `valueHumanName` - the two arms of an open `value[x]` (`Task.input.value[x]`,
 *   `Parameters.parameter.value[x]`). An `Extension.value[x]` never reaches here: every extension value
 *   is already blocked earlier, at the frontier rule.
 *
 * This is **not** how the sweep FINDS a name or an address, which is the point of keying on the
 * datatype: a conformant `Address` under any element name at all is classified and reduced without
 * consulting this set. The set does one narrower, fail-closed job. At one of these positions the
 * standard has already said what is supposed to be there, so a complex the classifier cannot pin down
 * but which still carries personal-datatype evidence - a `{ text }` or `{ use, text }` representation
 * with no part to key on, or a `{ family, given, nickname }` whose unrecognized sibling means the pass
 * cannot read the structure it was promised - is **blocked whole** rather than descended into.
 *
 * At any other position that same evidence is left exactly as it arrived, and deliberately: `{ text }`
 * is far more often a `CodeableConcept` carrying only its text, and `{ prefix, linkId, text, type }` is
 * a conformant `Questionnaire.item`. Blocking there would destroy clinical and structural content,
 * which is the mirror defect and the one no re-run undoes. That residual is stated in
 * `docs-content/limitations.md` rather than left implicit.
 *
 * A plain string at one of these names is untouched either way, and deliberately: `Organization.name`
 * and `Endpoint.address` are both R4 string elements, and neither is a person's name or a postal
 * address.
 *
 * @internal
 */
export const TYPED_PERSONAL_ELEMENT_NAMES: ReadonlySet<string> = new Set<string>([
  "name",
  "address",
  "locationAddress",
  "valueAddress",
  "valueHumanName",
]);

/**
 * The `Address` properties at or above state level, which Safe Harbor permits and the address edit
 * therefore **keeps** (every finer part is dropped and `postalCode` is replaced by its generalized
 * 3-digit prefix).
 *
 * Held here, in the map both halves already read, because the applier and the enumeration have to agree
 * on it exactly: the applier re-emits a kept property **verbatim, its `_`-sibling metadata included**, so
 * what rides through inside one is a position the enumeration owes a record. Two copies of this set
 * would let the two answers drift apart silently.
 *
 * @internal
 */
export const FHIR_KEPT_ADDRESS_PARTS: ReadonlySet<string> = new Set<string>(["state", "country"]);

/**
 * The **positive allow-list** of person-resource top-level element names whose own primitive value is
 * recognized structural / coded / administrative data (not free PHI): the over-scrub guard for the
 * fail-closed person sweep. A **bare-string** top-level property of a person resource that is neither a
 * mapped demographic, an `identifier`/`text`/`extension`/`contained`, nor on this list is **blocked**
 * (the (R) catch-all): a vendor `<Patient>`-level string field (`ssn`, `motherMaidenName`)
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
  "birthDate", // a date: generalized generically; recognized here so it is not blocked as unknown
  "deceasedDateTime", // a date: generalized generically
  // Structural links (references, walked; a Reference.display is blocked by the universal rule).
  "generalPractitioner",
  "managingOrganization",
  "organization",
  "link",
  "relationship",
  "patient",
  "contact", // BackboneElement: descended (its name/telecom/address are person PHI, §4.6)
  "qualification", // Practitioner
]);

/**
 * FHIR identifier `system` URIs that denote a **Social Security number**: an id under one of these is
 * an SSN (redacted), not an MRN (pseudonymized). The US SSN system is published as both the canonical
 * HL7 URL and its OID form; both are recognized. Every other person/organization identifier system
 * defaults to MRN (a consistent keyed surrogate, the `system` retained): the FHIR analogue of the CDA
 * `id/@root` and HL7 CX-5 identifier-type routing knife-edge.
 */
const SSN_SYSTEMS: ReadonlySet<string> = new Set<string>([
  "http://hl7.org/fhir/sid/us-ssn",
  "urn:oid:2.16.840.1.113883.4.1",
]);

/**
 * Resolve the Safe Harbor category for a FHIR `Identifier` from its `system` URI: a US-SSN system is an
 * **SSN** (redacted); every other identifier defaults to **MRN** (pseudonymized to a consistent
 * surrogate, the `system` retained). Structural, parser-typed routing, never a guess from the value's
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
 * or finer: i.e. a PHI element of a date under Safe Harbor §164.514(b)(2)(i)(C). A bare four-digit year
 * (`"1985"`) is already Safe-Harbor-safe and returns `false` (it is retained, not re-generalized).
 *
 * Detection is **value-shaped and validated**, not element-name-based: any primitive whose whole value
 * is a real calendar date (`YYYY-MM`, `YYYY-MM-DD`, or a full `YYYY-MM-DDThh:mm:ss…` instant, with a
 * plausible year, month `01–12`, and day `01–31`) is a date wherever it sits, so a date in an
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
 * isFhirDateValue("1985");                // => false  (year only, already safe)
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
