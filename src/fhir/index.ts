/**
 * `@cosyte/deid/fhir` — the **FHIR R4 de-identification adapter**. The FHIR binding of the
 * format-agnostic core (roadmap §Phase 4): it locates PHI **structurally** in a parsed `@cosyte/fhir`
 * resource, applies the configured de-identification policy, and returns a transformed `FhirComplex`
 * plus the core's value-free manifest.
 *
 * **`@cosyte/fhir` is an optional peer dependency**, consumed only from this subpath — a consumer who
 * only de-identifies FHIR installs it alongside `@cosyte/deid`; the core stays third-party-dep-free. The
 * adapter reaches FHIR data **only** through `@cosyte/fhir`'s own exported model (`FhirComplex` /
 * `FhirList` / `FhirPrimitive`, `getProperty`, `resourceType`, the `complex`/`list`/`primitive`
 * constructors) and its `parseResource` / `serializeResource` codec — it never touches a third-party
 * JSON substrate, so `@cosyte/deid` declares no third-party runtime dependency of its own.
 *
 * **What it covers.** FHIR is a **graph of typed resources**, so the map splits by role (roadmap §5):
 * - **Person resources** — `Patient` / `RelatedPerson` / `Practitioner` / `Person` (and the nested
 *   `Patient.contact` relative, §4.6): `name` / `telecom` / `photo` removed; `address` → safe 3-digit
 *   ZIP; `birthDate` and every date → year.
 * - **Every resource (the universal vectors that leak from any type):** `identifier` pseudonymized by
 *   `system` (a US-SSN system removed); PHI-bearing **dates** → year; the narrative **`text.div`** blocked
 *   at any depth; **extension** values blocked (the fail-closed frontier — an unknown extension can carry
 *   any PHI, incl. an MRN in a local extension); a `Reference.display` (a person label) blocked.
 * - **Contained resources and `Bundle` entries** are walked, re-deriving each resource's role at its own
 *   `resourceType`; **clinical resources** (`Observation`, `Condition`, …) are otherwise **retained
 *   untouched** (the over-scrub guard) — their codes, values, units, and statuses survive byte-identical.
 *
 * **Fail closed** governs the person sweep and the frontier: a bare unrecognized string at a person
 * resource's top level is blocked (an open-ended allow-list can never satisfy Safe Harbor category (R)),
 * every extension value is blocked, and primitive-level `_`-sibling extensions are dropped by the applier
 * (the side-channel the structural walk cannot otherwise reach). The honesty line is unchanged: the
 * output is **"Safe-Harbor-transformed per the configured policy"**, never "de-identified".
 *
 * **Known limitations (this phase).** Extension values are block-only (no profile-aware retention — a
 * `us-core-*` demographic extension is dropped, not kept — deferred to Phase 10 policy profiles).
 * Reference **wiring** (`Reference.reference` pointers and resource logical `id`s) is preserved
 * structurally; coordinated pseudonymization of resource ids across a corpus is the longitudinal Phase 7.
 * Structured free-text elements inside clinical resources (`Observation.valueString`, `Annotation.text`)
 * are retained (the over-scrub guard) — narrative free-text de-id is the separately-scoped Phase 8; only
 * the rendered narrative `text.div` is blocked here.
 *
 * @packageDocumentation
 */

import { parseResource, serializeResource, type FhirComplex } from "@cosyte/fhir";

import { deidentify, type DeidOptions } from "../deidentify.js";
import { type DeidManifestEntry } from "../manifest.js";
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
 * result.manifest; // value-free audit — category + locus, never a value
 * ```
 */
export interface FhirDeidResult {
  /** The de-identified resource — a fresh, independent `FhirComplex`; the input is never mutated. */
  readonly document: FhirComplex;
  /** The value-free audit of every action, in locus order (never a value, never a key). */
  readonly manifest: readonly DeidManifestEntry[];
}

/**
 * De-identify a parsed FHIR resource (or `Bundle`) under a policy (Safe Harbor by default). PHI is
 * located structurally from the `@cosyte/fhir` model — the person-resource demographics and the
 * universal identifier / date / narrative / extension / reference vectors; the input resource is never
 * mutated (the immutable model is rebuilt into a fresh tree).
 *
 * The output is **"Safe-Harbor-transformed per the configured policy"** — it is not certified
 * de-identified, and Expert Determination is not rendered.
 *
 * @param resource - The parsed FHIR resource to de-identify (`parseResource(json).resource`).
 * @param options - The policy and (for keyed transforms — identifier pseudonymization) the key context.
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
  const { loci, coords } = extractFhirLoci(resource);
  const { document, manifest } = deidentify({ loci }, options);
  const deidentified = applyFhir(resource, document.loci, coords);
  return { document: deidentified, manifest };
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
export {
  extractFhirLoci,
  type FhirCoord,
  type FhirExtraction,
  type FhirEditKind,
} from "./extract.js";
export { applyFhir } from "./apply.js";
export { SAFE_HARBOR_CATEGORIES, type SafeHarborCategory } from "../categories.js";
