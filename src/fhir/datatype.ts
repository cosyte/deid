/**
 * The FHIR **personal-datatype classifier**: the rule that decides whether an element is a person
 * name or a postal address from the **element's own R4 datatype**, rather than from the type of the
 * resource carrying it.
 *
 * FHIR is a graph, and which resource a `HumanName` or an `Address` ends up on is a choice the
 * producer makes: the same person's home address arrives at `Patient.address` from one system and at
 * `Location.address` from another. Deciding by enclosing resource type therefore makes a consumer's
 * coverage depend on how a document was shaped. Deciding by datatype does not, and it needs no
 * cross-resource role derivation to reach: `Organization.contact.name` is a `HumanName` because R4
 * types it as one.
 *
 * **The classification is closed, and that is the over-scrub guard.** A complex is a `HumanName` only
 * when **every** property it carries is one R4 defines on `HumanName` **and** at least one of them is
 * a property nothing else carries (`family` / `given` / `prefix` / `suffix`); an `Address` the same
 * way (`line` / `city` / `district` / `state` / `postalCode` / `country`). Both halves are
 * load-bearing:
 *
 * - Without the **closed** half, a marker alone decides, and R4 resources carry marker-named elements
 *   of their own (`MedicinalProductAuthorization.country`), so a whole resource would classify as an
 *   address and be generalized away.
 * - Without the **marker** half, `{ "text": "Sodium" }` classifies, and that is a `CodeableConcept`
 *   with only its text: an `Observation` code, a dose unit and an order status all take that shape.
 *   Scrubbing one is the mirror defect of leaking a name, and it destroys clinical meaning that no
 *   re-run restores.
 *
 * The cost of the closed half is stated rather than hidden: a name or an address whose only content
 * is its `text` representation carries **no** marker, so it does not classify, and neither does a
 * datatype a producer extended with a property R4 does not define (R4 spells an extension as
 * `extension`, which is inside the set). At a position R4 **types** as one of these datatypes the
 * gap closes the other way, fail-closed, via {@link isFhirPersonalShape}; anywhere else the value is
 * left exactly as it arrived, which is the direction that cannot destroy a clinical value.
 *
 * @packageDocumentation
 */

import { isComplex, type FhirComplex, type FhirNode } from "@cosyte/fhir";

/**
 * Every property FHIR R4 defines on `HumanName`, plus the two an element can always carry (`id`,
 * `extension`) and the `modifierExtension` an invalid document may still put there: carrying one is
 * not evidence a node is a `HumanName`, but carrying anything **outside** this set is evidence it is
 * not.
 *
 * @internal
 */
export const HUMAN_NAME_PROPERTIES: ReadonlySet<string> = new Set<string>([
  "id",
  "extension",
  "modifierExtension",
  "use",
  "text",
  "family",
  "given",
  "prefix",
  "suffix",
  "period",
]);

/**
 * The `HumanName` properties **no other R4 datatype carries**: one of these present is what turns
 * "nothing here contradicts a name" into "this is a name". Deliberately excludes `text`, `use` and
 * `period`, each of which several datatypes share.
 *
 * @internal
 */
export const HUMAN_NAME_MARKER_PROPERTIES: ReadonlySet<string> = new Set<string>([
  "family",
  "given",
  "prefix",
  "suffix",
]);

/**
 * Every property FHIR R4 defines on `Address`, plus the element-level three. Same contract as
 * {@link HUMAN_NAME_PROPERTIES}: membership proves nothing, non-membership disproves.
 *
 * @internal
 */
export const ADDRESS_PROPERTIES: ReadonlySet<string> = new Set<string>([
  "id",
  "extension",
  "modifierExtension",
  "use",
  "type",
  "text",
  "line",
  "city",
  "district",
  "state",
  "postalCode",
  "country",
  "period",
]);

/**
 * The `Address` properties no other R4 datatype carries. Disjoint from
 * {@link HUMAN_NAME_MARKER_PROPERTIES}, so a complex can never classify as both.
 *
 * @internal
 */
export const ADDRESS_MARKER_PROPERTIES: ReadonlySet<string> = new Set<string>([
  "line",
  "city",
  "district",
  "state",
  "postalCode",
  "country",
]);

/**
 * The two FHIR R4 datatypes this adapter acts on wherever they sit: `HumanName` (removed whole) and
 * `Address` (reduced to the geographic granularity Safe Harbor permits).
 *
 * @example
 * ```ts
 * import { type FhirPersonalDatatype } from "@cosyte/deid/fhir";
 *
 * const datatype: FhirPersonalDatatype = "human-name";
 * ```
 */
export type FhirPersonalDatatype = "human-name" | "address";

/** `true` when every property is in `allowed` and at least one is in `markers`. */
function matchesDatatype(
  node: FhirComplex,
  allowed: ReadonlySet<string>,
  markers: ReadonlySet<string>,
): boolean {
  let marked = false;
  for (const prop of node.properties) {
    if (!allowed.has(prop.name)) return false;
    if (markers.has(prop.name)) marked = true;
  }
  return marked;
}

/**
 * Classify a node as a FHIR R4 `HumanName` or `Address` from its own structure, or `undefined` when
 * it is neither. Structural and closed: see this module's own documentation for why both halves of
 * the test are required and what the closed half deliberately does not reach.
 *
 * @param node - Any node of the parsed `@cosyte/fhir` element tree.
 * @returns The datatype, or `undefined` when the node is not positively one of the two.
 * @example
 * ```ts
 * import { complex, list, primitive } from "@cosyte/fhir";
 * import { classifyFhirPersonalDatatype } from "@cosyte/deid/fhir";
 *
 * const name = complex([{ name: "family", value: primitive("ZZFAMILY") }]);
 * classifyFhirPersonalDatatype(name); // => "human-name"
 *
 * const address = complex([{ name: "city", value: primitive("ZZCITY") }]);
 * classifyFhirPersonalDatatype(address); // => "address"
 *
 * // A CodeableConcept carrying only its text is a clinical code, never a name.
 * classifyFhirPersonalDatatype(complex([{ name: "text", value: primitive("Sodium") }])); // => undefined
 *
 * // An organisation's own name is a plain string, so no datatype rule reaches it.
 * classifyFhirPersonalDatatype(primitive("Springfield Clinic")); // => undefined
 * ```
 */
export function classifyFhirPersonalDatatype(node: FhirNode): FhirPersonalDatatype | undefined {
  if (!isComplex(node)) return undefined;
  if (matchesDatatype(node, HUMAN_NAME_PROPERTIES, HUMAN_NAME_MARKER_PROPERTIES)) {
    return "human-name";
  }
  if (matchesDatatype(node, ADDRESS_PROPERTIES, ADDRESS_MARKER_PROPERTIES)) return "address";
  return undefined;
}

/**
 * `true` when a node is a **non-empty complex whose every property belongs to one of the two personal
 * datatypes** but which carries no marker of either, so {@link classifyFhirPersonalDatatype} cannot
 * say which one it is: `{ "text": "..." }`, `{ "use": "work", "text": "..." }`, `{ "period": {...} }`.
 *
 * On its own that shape is ambiguous, and at an arbitrary position it is far more likely to be a
 * `CodeableConcept` carrying only its text, so the caller must consult this **only at a position R4
 * types as a `HumanName` or an `Address`**. There the ambiguity resolves the fail-closed way: the
 * pass cannot locate the structure it was promised, so it blocks the whole element rather than let a
 * text representation of a name or an address ride through.
 *
 * @param node - Any node of the parsed `@cosyte/fhir` element tree.
 * @returns `true` when the node is personal-datatype shaped but carries no marker.
 * @internal
 */
export function isFhirPersonalShape(node: FhirNode): boolean {
  if (!isComplex(node)) return false;
  if (node.properties.length === 0) return false;
  return node.properties.every(
    (prop) => HUMAN_NAME_PROPERTIES.has(prop.name) || ADDRESS_PROPERTIES.has(prop.name),
  );
}
