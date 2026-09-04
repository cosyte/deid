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
 * **Two separate questions, asked separately.** Positive classification (act on this element) and
 * fail-closed evidence (this element is a name or an address the pass could not read) are different
 * bars, and collapsing them into one test is what makes a classifier wrong in both directions at once.
 *
 * {@link classifyFhirPersonalDatatype} answers the first, and it is deliberately hard to satisfy. A
 * complex is a `HumanName` only when **every** property it carries is one R4 defines on `HumanName`,
 * **and** at least one of them is a marker property nothing else carries
 * (`family` / `given` / `prefix` / `suffix`), **and** that marker holds the value shape R4 gives it: a
 * string, or a list of strings. An `Address` the same way (`line` / `city` / `district` / `state` /
 * `postalCode` / `country`). All three halves are load-bearing:
 *
 * - Without the **closed** half, a node carrying an `Address` marker plus an unrelated sibling would be
 *   generalized away as an address.
 * - Without the **marker** half, `{ "text": "Sodium" }` classifies, and that is a `CodeableConcept`
 *   with only its text: an `Observation` code, a dose unit and an order status all take that shape.
 *   Scrubbing one is the mirror defect of leaking a name, and it destroys clinical meaning that no
 *   re-run restores.
 * - Without the **value-shape** half, a marker **name** alone decides, and R4 gives several resources a
 *   `country` element of their own (`MedicinalProductAuthorization.country`,
 *   `MedicinalProductAuthorization.jurisdictionalAuthorization.country`,
 *   `MedicinalProduct.name.countryLanguage.country`, `MarketingStatus.country`). Every one of those is
 *   a `CodeableConcept`, and every child of those backbones is optional, so a conformant instance
 *   carrying nothing but `country` is closed for `Address` and marked - and would be destroyed whole.
 *   `Address.country` is a **string**, so requiring the shape tells the two apart at the position
 *   rather than by luck.
 *
 * {@link carriesFhirPersonalEvidence} answers the second, and it is deliberately easy to satisfy: a
 * non-empty complex that carries a marker property of either datatype **by name whatever its shape**,
 * or whose every property belongs to one of the two datatypes. A `{ family, nickname }` is caught by
 * the first arm, a `{ use, text }` by the second, and neither is something this pass can pin down.
 *
 * That test is only meaningful **at a position R4 types as a `HumanName` or an `Address`**, and its one
 * caller consults it nowhere else. At an arbitrary position `{ prefix, linkId, text, type }` is a
 * conformant `Questionnaire.item`, not a name, and `{ text }` is far more often a `CodeableConcept`
 * carrying its text; blocking those would destroy clinical and structural content. At `contact.name` or
 * `address` the standard already promised a name or an address, so the same evidence resolves the other
 * way: the pass cannot locate the structure it was told is there, and it blocks the whole element.
 *
 * The residual is stated rather than hidden: a `HumanName` or an `Address` carrying a property R4 does
 * not define, at a position R4 does **not** type as one of these two datatypes, is neither classified
 * nor blocked. It is left exactly as it arrived, because at such a position the same evidence is
 * indistinguishable from a conformant backbone that merely shares a property name, and that is the
 * direction that cannot destroy a clinical value.
 *
 * @packageDocumentation
 */

import { isComplex, isList, isPrimitive, type FhirComplex, type FhirNode } from "@cosyte/fhir";

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
 * The `HumanName` properties **no other R4 datatype carries**: one of these present, holding the
 * string or list-of-strings value R4 gives it, is what turns "nothing here contradicts a name" into
 * "this is a name". Deliberately excludes `text`, `use` and `period`, each of which several datatypes
 * share. R4 gives one **resource** element the name `prefix` (`Questionnaire.item.prefix`), which is
 * why a marker is never read on its own: it is read closed, and a `Questionnaire.item` carries
 * `linkId`.
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
 * The `Address` properties no other R4 **datatype** carries. Disjoint from
 * {@link HUMAN_NAME_MARKER_PROPERTIES}, so a complex can never classify as both.
 *
 * `country` is the one that collides with resource elements rather than with datatypes:
 * `MedicinalProductAuthorization.country`, its `jurisdictionalAuthorization.country`,
 * `MedicinalProduct.name.countryLanguage.country` and `MarketingStatus.country` all exist, and every
 * child of those backbones is optional, so a conformant instance can carry `country` and nothing else.
 * Every one of them is a `CodeableConcept` while `Address.country` is a `string`, which is why the
 * classifier reads a marker's **value shape** and not only its name.
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

/**
 * `true` when a value carries the shape R4 gives **every** marker property of both datatypes: a
 * string, or a repeating string (`HumanName.given` / `.prefix` / `.suffix`, `Address.line`). A complex
 * at a marker name is R4 telling you this is not that datatype: `Address.country` is a `string`, while
 * every other R4 element named `country` is a `CodeableConcept`.
 */
function isMarkerShaped(node: FhirNode): boolean {
  if (isPrimitive(node)) return true;
  return isList(node) && node.items.every((item) => isPrimitive(item));
}

/** `true` when no property lies outside `allowed`: nothing here contradicts the datatype. */
function isClosedFor(node: FhirComplex, allowed: ReadonlySet<string>): boolean {
  return node.properties.every((prop) => allowed.has(prop.name));
}

/** `true` when a marker property is present **by name**, whatever value shape it holds. */
function carriesMarkerName(node: FhirComplex, markers: ReadonlySet<string>): boolean {
  return node.properties.some((prop) => markers.has(prop.name));
}

/** `true` when a marker property is present **and** holds the value shape R4 gives it. */
function carriesShapedMarker(node: FhirComplex, markers: ReadonlySet<string>): boolean {
  return node.properties.some((prop) => markers.has(prop.name) && isMarkerShaped(prop.value));
}

/**
 * Classify a node as a FHIR R4 `HumanName` or `Address` from its own structure, or `undefined` when
 * it is neither. Structural, closed, and marker-bound by value shape as well as by name: see this
 * module's own documentation for why all three halves of the test are required and what the test
 * deliberately does not reach.
 *
 * A node this returns `undefined` for is **not** thereby safe. It is only "not positively one of the
 * two", which is a different statement; at a position R4 types as one of these datatypes the caller
 * asks {@link carriesFhirPersonalEvidence} next and fails closed on the answer.
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
 * // A coded `country`: R4 types Address.country as a string, so a complex there is another datatype.
 * const coded = complex([{ name: "country", value: complex([{ name: "text", value: primitive("US") }]) }]);
 * classifyFhirPersonalDatatype(coded); // => undefined
 *
 * // An organisation's own name is a plain string, so no datatype rule reaches it.
 * classifyFhirPersonalDatatype(primitive("Springfield Clinic")); // => undefined
 * ```
 */
export function classifyFhirPersonalDatatype(node: FhirNode): FhirPersonalDatatype | undefined {
  if (!isComplex(node)) return undefined;
  if (
    isClosedFor(node, HUMAN_NAME_PROPERTIES) &&
    carriesShapedMarker(node, HUMAN_NAME_MARKER_PROPERTIES)
  ) {
    return "human-name";
  }
  if (
    isClosedFor(node, ADDRESS_PROPERTIES) &&
    carriesShapedMarker(node, ADDRESS_MARKER_PROPERTIES)
  ) {
    return "address";
  }
  return undefined;
}

/**
 * `true` when a **non-empty complex** carries evidence of one of the two personal datatypes that
 * {@link classifyFhirPersonalDatatype} could not turn into a classification. Two arms, because the two
 * ways a name or an address escapes the classifier are different shapes:
 *
 * - It carries a **marker property by name** (`family` / `given` / `prefix` / `suffix` / `line` /
 *   `city` / `district` / `state` / `postalCode` / `country`), whatever that property holds and
 *   whatever else sits beside it. `{ family, given, nickname }` can be nothing but a person's name;
 *   `{ line, city, state, postalCode, county }` can be nothing but a street address. Each is rejected
 *   by the classifier - the first for its unrecognized sibling, the second likewise - and each would
 *   otherwise be descended into and released primitive by primitive.
 * - **Every** property belongs to one of the two datatypes but none is a marker: `{ text }`,
 *   `{ use, text }`, `{ period }`. There is nothing here to key on at all.
 *
 * This is **not** a claim the node is personal data, and at an arbitrary position it is usually wrong:
 * `{ prefix, linkId, text, type }` is a conformant `Questionnaire.item` and `{ text }` is usually a
 * `CodeableConcept` carrying its text. So the caller must consult this **only at a position R4 types
 * as a `HumanName` or an `Address`**, where the standard has already said what is supposed to be
 * there. At those positions the ambiguity resolves the fail-closed way: the pass cannot locate the
 * structure it was promised, so it blocks the whole element rather than let any part of a name or an
 * address ride through.
 *
 * @param node - Any node of the parsed `@cosyte/fhir` element tree.
 * @returns `true` when the node carries personal-datatype evidence the classifier could not pin down.
 * @internal
 */
export function carriesFhirPersonalEvidence(node: FhirNode): boolean {
  if (!isComplex(node)) return false;
  if (node.properties.length === 0) return false;
  if (
    carriesMarkerName(node, HUMAN_NAME_MARKER_PROPERTIES) ||
    carriesMarkerName(node, ADDRESS_MARKER_PROPERTIES)
  ) {
    return true;
  }
  return node.properties.every(
    (prop) => HUMAN_NAME_PROPERTIES.has(prop.name) || ADDRESS_PROPERTIES.has(prop.name),
  );
}
