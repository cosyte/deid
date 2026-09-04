/**
 * `@cosyte/deid/fhir`: the **FHIR R4 de-identification adapter**. The FHIR binding of the
 * format-agnostic core: it locates PHI **structurally** in a parsed `@cosyte/fhir`
 * resource, applies the configured de-identification policy, and returns a transformed `FhirComplex`
 * plus the core's value-free manifest.
 *
 * **`@cosyte/fhir` is an optional peer dependency**, consumed only from this subpath: a consumer who
 * only de-identifies FHIR installs it alongside `@cosyte/deid`; the core stays third-party-dep-free. The
 * adapter reaches FHIR data **only** through `@cosyte/fhir`'s own exported model (`FhirComplex` /
 * `FhirList` / `FhirPrimitive`, `getProperty`, `resourceType`, the `complex`/`list`/`primitive`
 * constructors) and its `parseResource` / `serializeResource` codec: it never touches a third-party
 * JSON substrate, so `@cosyte/deid` declares no third-party runtime dependency of its own.
 *
 * **What it covers.** FHIR is a **graph of typed resources**, so the map splits by role:
 * - **Person resources**: `Patient` / `RelatedPerson` / `Practitioner` / `Person` (and the nested
 *   `Patient.contact` relative): `name` / `telecom` / `photo` removed; `address` → safe 3-digit
 *   ZIP; `birthDate` and every date → year.
 * - **Every resource (the universal vectors that leak from any type):** `identifier` pseudonymized by
 *   `system` (a US-SSN system removed); PHI-bearing **dates** → year; the narrative **`text.div`** blocked
 *   at any depth; **extension** values blocked (the fail-closed frontier, an unknown extension can carry
 *   any PHI, incl. an MRN in a local extension); a `Reference.display` (a person label) blocked.
 * - **Every resource, by DATATYPE:** outside a person resource a `HumanName` is removed and an
 *   `Address` is reduced to the safe 3-digit ZIP **wherever the graph puts it**, so
 *   `Organization.contact.name` and `Location.address` are treated exactly as `Patient.name` and
 *   `Patient.address` are. Which resource carries a person's name is the producer's shaping choice;
 *   coverage does not depend on it. **Inside** a person resource the demographic map above decides, so
 *   the sweep adds nothing there and a name or an address at a person-resource property the map does
 *   not list is a residual, stated below.
 * - **Contained resources and `Bundle` entries** are walked, re-deriving each resource's role at its own
 *   `resourceType`; **clinical resources** (`Observation`, `Condition`, …) are otherwise **retained
 *   untouched** (the over-scrub guard): their codes, values, units, and statuses survive byte-identical.
 *
 * **Fail closed** governs the person sweep, the datatype sweep and the frontier: a bare unrecognized
 * string at a person resource's top level is blocked (an open-ended allow-list can never satisfy Safe
 * Harbor category (R)), every extension value is blocked, primitive-level `_`-sibling extensions are
 * dropped by the applier (the side-channel the structural walk cannot otherwise reach), and a swept
 * `Address` the pass cannot read faithfully (a `postalCode` that is not a whole zip code, an
 * unexpected JSON shape at a part Safe Harbor would let it keep) is removed **whole** rather than
 * partly retained. At an element name R4 **types** as one of the two datatypes (`name`, `address`, a
 * choice-type `locationAddress`, an open `valueAddress` / `valueHumanName`) **any** complex the
 * classifier cannot pin down is blocked whole - a text-only representation with no part to key on, one
 * carrying a property R4 does not define beside a `family` or a `line`, and equally one whose every
 * property is foreign to both datatypes - because the standard promised a name or an address there and
 * the pass could not read the one it was given. Exactly two conformant R4 backbones share one of those
 * element names (`MedicinalProduct.name`, `SubstanceSpecification.name`) and both are excluded
 * positively, by the property R4 makes `1..1` on each plus that backbone's own closed property set. The
 * honesty line is unchanged: the output is **"Safe-Harbor-transformed per the configured policy"**,
 * never "de-identified".
 *
 * **Known limitations.** Extension values are block-only (no profile-aware retention, a
 * `us-core-*` demographic extension is dropped, not kept).
 * Reference **wiring** (`Reference.reference` pointers and resource logical `id`s) is preserved
 * structurally; coordinated pseudonymization of resource ids across a corpus is **not** performed here.
 * Structured free-text elements inside clinical resources (`Observation.valueString`, `Annotation.text`)
 * are retained (the over-scrub guard): narrative free-text de-id is separately scoped (the BYO
 * redaction interface); only the rendered narrative `text.div` is blocked here.
 * Five surfaces the datatype sweep deliberately does **not** reach. Three because no datatype types a
 * person at the position: a **`ContactPoint` outside a person resource** (widening to telecom would put
 * a payer's own switchboard number in scope, which the sibling adapters keep); an **organisation's own
 * `name`**, a plain string and not a `HumanName`; and the **individual's employer carried as a separate
 * `Organization` resource**, which would need a cross-resource role derivation R4 types nowhere (the
 * `Reference.display` naming it is blocked either way). The fourth is the stated cost of the closed,
 * shape-read classification: a name or an address carrying a property R4 does not define, **or**
 * carrying its only marker at a value shape R4 does not give that marker, at an element name R4 does
 * not type as one of the two datatypes, because there that same evidence is routinely a conformant
 * structural element (`{ prefix: "1." }` is a `RequestGroup.action`) and blocking it would destroy
 * content no re-run restores. At a **typed** element name neither half is a residual, because the
 * fail-closed rule above blocks whatever the classifier declined. The fifth is the scope of the sweep
 * itself: **inside** a person resource it does not
 * run, because the demographic map has already decided `name` / `telecom` / `photo` / `address` there,
 * so a `HumanName` or an `Address` at a person-resource property that map does not list is passed
 * through and counted as unexamined - the same bytes an `Organization` would have had removed.
 *
 * @packageDocumentation
 */

import { parseResource, serializeResource, type FhirComplex } from "@cosyte/fhir";

import { deidentify, type DeidOptions } from "../deidentify.js";
import { type DeidManifestEntry } from "../manifest.js";
import { type UnexaminedResidual } from "../residual.js";
import { applyFhir } from "./apply.js";
import { extractFhirLoci } from "./extract.js";

/**
 * The result of de-identifying a FHIR resource: the transformed resource model plus the core's
 * value-free manifest of every category acted on and every locus blocked.
 *
 * @example
 * ```ts
 * import { parseResource } from "@cosyte/fhir";
 * import { deidentifyFhir } from "@cosyte/deid/fhir";
 * import { createDeidContext } from "@cosyte/deid";
 *
 * const { resource } = parseResource(json);
 * const result: FhirDeidResult = deidentifyFhir(resource, {
 *   context: createDeidContext({ key: "secret" }),
 * });
 * result.manifest; // value-free audit: category + locus, never a value
 * ```
 */
export interface FhirDeidResult {
  /** The de-identified resource: a fresh, independent `FhirComplex`; the input is never mutated. */
  readonly document: FhirComplex;
  /** The value-free audit of every action, in locus order (never a value, never a key). */
  readonly manifest: readonly DeidManifestEntry[];
  /**
   * The manifest's **second list**: every value-bearing position this pass handed through that **no
   * locus rule named**, counted and located. In FHIR that is largely the clinical resources' codes,
   * units and statuses, which no rule here examines. An empty list is a **measured zero**, not a
   * silence.
   */
  readonly unexaminedResiduals: readonly UnexaminedResidual[];
}

/**
 * De-identify a parsed FHIR resource (or `Bundle`) under a policy (Safe Harbor by default). PHI is
 * located structurally from the `@cosyte/fhir` model: the person-resource demographics, every
 * `HumanName` and `Address` by its datatype wherever the graph carries it **outside** a person
 * resource, and the universal identifier / date / narrative / extension / reference vectors; the
 * input resource is never mutated (the immutable model is rebuilt into a fresh tree). The surfaces
 * this does not reach are stated rather than implied: see this module's own **Known limitations**
 * above, and `docs-content/limitations.md` for the shipped enumeration.
 *
 * The output is **"Safe-Harbor-transformed per the configured policy"**: it is not certified
 * de-identified, and Expert Determination is not rendered.
 *
 * @param resource - The parsed FHIR resource to de-identify (`parseResource(json).resource`).
 * @param options - The policy and (for keyed transforms, identifier pseudonymization) the key context.
 *   A keyed transform with no context is a fatal `DEID_NO_KEY`, never an unkeyed fallback.
 * @returns The de-identified resource and the value-free manifest.
 * @throws {@link "@cosyte/deid".DeidError} `DEID_NO_KEY` when a keyed transform is required for a
 *   category present in the resource but no key context was supplied.
 * @example
 * ```ts
 * import { parseResource, serializeResource } from "@cosyte/fhir";
 * import { deidentifyFhir } from "@cosyte/deid/fhir";
 * import { createDeidContext } from "@cosyte/deid";
 *
 * const context = createDeidContext({ key: process.env.DEID_KEY! });
 * const { resource } = parseResource(json);
 * const { document, manifest } = deidentifyFhir(resource, { context });
 * serializeResource(document); // de-identified FHIR JSON
 * ```
 */
export function deidentifyFhir(resource: FhirComplex, options: DeidOptions = {}): FhirDeidResult {
  const { loci, coords, unexaminedResiduals } = extractFhirLoci(resource);
  const { document, manifest } = deidentify({ loci }, options);
  const deidentified = applyFhir(resource, document.loci, coords);
  return { document: deidentified, manifest, unexaminedResiduals };
}

/**
 * Convenience: parse raw FHIR JSON, de-identify it, and return the transformed resource, the serialized
 * de-identified JSON, and the value-free manifest in one call. Parse warnings are not part of the de-id
 * contract and are discarded here; call `parseResource` directly if you need them.
 *
 * @param json - Raw FHIR JSON text.
 * @param options - The policy and key context (see {@link deidentifyFhir}).
 * @returns The transformed resource, its serialized JSON, and the value-free manifest.
 * @example
 * ```ts
 * import { deidentifyFhirJson } from "@cosyte/deid/fhir";
 * import { createDeidContext } from "@cosyte/deid";
 *
 * const { json, manifest } = deidentifyFhirJson(input, {
 *   context: createDeidContext({ key: "secret" }),
 * });
 * ```
 */
export function deidentifyFhirJson(
  json: string,
  options: DeidOptions = {},
): FhirDeidResult & { readonly json: string } {
  const { resource } = parseResource(json);
  const result = deidentifyFhir(resource, options);
  return { ...result, json: serializeResource(result.document) };
}

export {
  PERSON_RESOURCE_TYPES,
  FHIR_DEMOGRAPHIC_ELEMENTS,
  RECOGNIZED_PERSON_ELEMENTS,
  categoryForIdentifierSystem,
  isFhirDateValue,
  type FhirDemographicMode,
} from "./locus-map.js";
export { classifyFhirPersonalDatatype, type FhirPersonalDatatype } from "./datatype.js";
export {
  extractFhirLoci,
  type FhirCoord,
  type FhirExtraction,
  type FhirEditKind,
} from "./extract.js";
export { applyFhir } from "./apply.js";
export { type UnexaminedResidual } from "../residual.js";
export { SAFE_HARBOR_CATEGORIES, type SafeHarborCategory } from "../categories.js";
