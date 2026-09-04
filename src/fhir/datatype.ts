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
 * **and** at least one of them is a marker property (`family` / `given` / `prefix` / `suffix`),
 * **and** that marker holds **the exact value shape R4 gives it on that datatype**: `family` a single
 * string, `given` / `prefix` / `suffix` a repeating one. An `Address` the same way, with `line`
 * repeating and `city` / `district` / `state` / `postalCode` / `country` single. All three halves are
 * load-bearing:
 *
 * - Without the **closed** half, a node carrying an `Address` marker plus an unrelated sibling would be
 *   generalized away as an address.
 * - Without the **marker** half, `{ "text": "Sodium" }` classifies, and that is a `CodeableConcept`
 *   with only its text: an `Observation` code, a dose unit and an order status all take that shape.
 *   Scrubbing one is the mirror defect of leaking a name, and it destroys clinical meaning that no
 *   re-run restores.
 * - Without the **value-shape** half, a marker **name** alone decides. R4 hands two of the ten marker
 *   names to elements outside these datatypes, and both collisions sit on backbones whose every child
 *   is `0..1` or `0..*`, so a conformant instance can arrive carrying nothing but the marker: closed
 *   for the datatype, marked for it, and not remotely personal data. Reading the marker's shape at the
 *   position is what tells them apart; see {@link HUMAN_NAME_MARKERS} for the enumeration and for what
 *   this test does **not** claim.
 *
 * **The shape test is read per marker, not per datatype, and that is the whole of the discrimination.**
 * A closed complex carrying a marker at the wrong shape is not a positive classification anywhere, and
 * nothing about the *other* element's instance is assumed: not that it carries a required sibling, not
 * that a producer filled its optional children in. An earlier form of this rule leant on a required
 * sibling (`Questionnaire.item` carries `linkId`) and was wrong twice over: that is an assumption about
 * a document rather than a property of the code, and this pass does no conformance validation, so a
 * `Questionnaire.item` arriving without its `linkId` would have been destroyed.
 *
 * {@link carriesFhirPersonalEvidence} answers the second, and it is deliberately easy to satisfy,
 * because it is only ever asked **at an element name R4 types as a `HumanName` or an `Address`**. At
 * such a position the standard has already said what belongs there, so the question is not "does this
 * look like a name?" but "can the pass read the name or the address it was promised?". Any non-empty
 * complex the classifier declined is an answer of no, and is evidence. Keying that on which properties
 * the node happens to carry is what makes the boundary arbitrary: `{ text }` and
 * `{ text, streetAddress }` are the same unreadable element, and a rule that blocks the first while
 * releasing the second (street included) is a rule about a foreign key, not about readability.
 *
 * The exception is positive, enumerated and small: {@link NON_PERSONAL_TYPED_BACKBONES} holds the R4
 * backbones that legitimately sit at one of those element names and are **not** personal data. There
 * are two, both at `name` (`MedicinalProduct.name` and `SubstanceSpecification.name`), and each is
 * recognized the way the classifier recognizes its own datatypes: closed for the backbone's property
 * set **and** carrying the property R4 makes `1..1` on it. Nothing conformant sits at `address`,
 * `locationAddress`, `valueAddress` or `valueHumanName` that is not the datatype itself. A plain string
 * at any of these names is not a complex and is never a candidate, which is what leaves
 * `Organization.name` and `Endpoint.address` alone.
 *
 * That test is only meaningful at those positions, and its one caller consults it nowhere else. At an
 * arbitrary position `{ prefix, linkId, text, type }` is a conformant `Questionnaire.item`, not a name,
 * and `{ text }` is far more often a `CodeableConcept` carrying its text; blocking those would destroy
 * clinical and structural content.
 *
 * The residual is stated rather than hidden, and it has two halves, both of them at a position R4 does
 * **not** type as one of these two datatypes. A `HumanName` or an `Address` carrying a property R4 does
 * not define is neither classified nor blocked there; so is one whose only marker holds a shape R4 does
 * not give that marker (a single `line`, a repeating `family`). Both are left exactly as they arrived,
 * because at such a position that same evidence is indistinguishable from a conformant backbone that
 * merely shares a property name, and that is the direction that cannot destroy a clinical value. **At**
 * a typed element name neither residual applies: the standard promised a name or an address there, so
 * {@link carriesFhirPersonalEvidence} blocks whatever the classifier declined.
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
 * The value shape FHIR R4 gives a marker property **on the personal datatype that defines it**, and the
 * only shape at which that marker is evidence of the datatype:
 *
 * - `single`: R4 types it `0..1`, so conformant FHIR JSON carries a bare value there, never an array.
 * - `repeating`: R4 types it `0..*`, so conformant FHIR JSON carries an array there, even for one item.
 *
 * @internal
 */
export type MarkerValueShape = "single" | "repeating";

/**
 * The `HumanName` marker properties, each with the value shape R4 gives it: `family` is `0..1 string`,
 * while `given`, `prefix` and `suffix` are `0..* string`. One of these present **at its own shape** is
 * what turns "nothing here contradicts a name" into "this is a name". Deliberately excludes `text`,
 * `use` and `period`, each of which several datatypes share.
 *
 * **What the shape buys, and the one R4 collision it resolves.** R4 also gives the name `prefix` to
 * three elements outside `HumanName`: `Questionnaire.item.prefix`, `PlanDefinition.action.prefix` and
 * `RequestGroup.action.prefix`. Every one of them is `0..1 string`, and the last two sit on backbones
 * with **no** required child, so `{ "prefix": "1." }` alone is a conformant instance of either: closed
 * for `HumanName`, marked for it, and a numbered workflow step rather than a person. `HumanName.prefix`
 * is `0..*`, so its conformant JSON is `["Dr."]` and theirs is `"1."`, and the shape separates them at
 * the position. `family`, `given` and `suffix` are R4 names no element outside `HumanName` carries.
 *
 * **What this does not claim.** It is a discriminator, not a proof that the marker names are disjoint
 * from the rest of R4. An element sharing a marker name **at the same shape** would still classify, and
 * this pass does no conformance validation, so nothing here may be read as "the instance must also
 * carry X". The enumeration above is what was checked; where it is short, the sweep acts and the cost
 * is the over-removal this module exists to bound, which is why the check is written down rather than
 * assumed. See {@link ADDRESS_MARKERS} for the mirror case on the address side.
 *
 * @internal
 */
export const HUMAN_NAME_MARKERS: ReadonlyMap<string, MarkerValueShape> = new Map<
  string,
  MarkerValueShape
>([
  ["family", "single"],
  ["given", "repeating"],
  ["prefix", "repeating"],
  ["suffix", "repeating"],
]);

/**
 * The `HumanName` marker property **names**, without their shapes: the closed-property half of the test
 * reads names only.
 *
 * @internal
 */
export const HUMAN_NAME_MARKER_PROPERTIES: ReadonlySet<string> = new Set<string>(
  HUMAN_NAME_MARKERS.keys(),
);

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
 * The `Address` marker properties, each with the value shape R4 gives it: `line` is `0..* string`,
 * every other one is `0..1 string`. Disjoint by name from {@link HUMAN_NAME_MARKERS}, so a complex can
 * never classify as both.
 *
 * **The one R4 collision the shape resolves.** `country` is the address marker R4 also gives to
 * elements outside the datatype: `MedicinalProductAuthorization.country`, its
 * `jurisdictionalAuthorization.country`, `MedicinalProduct.name.countryLanguage.country` and
 * `MarketingStatus.country`. Every child of those backbones is optional, so a conformant instance can
 * carry `country` and nothing else; every one of those elements is a `CodeableConcept` while
 * `Address.country` is a `string`, so the shape separates them. `line`, `city`, `district`, `state` and
 * `postalCode` are R4 names no element outside `Address` carries.
 *
 * The same limit stated on {@link HUMAN_NAME_MARKERS} applies here without change.
 *
 * @internal
 */
export const ADDRESS_MARKERS: ReadonlyMap<string, MarkerValueShape> = new Map<
  string,
  MarkerValueShape
>([
  ["line", "repeating"],
  ["city", "single"],
  ["district", "single"],
  ["state", "single"],
  ["postalCode", "single"],
  ["country", "single"],
]);

/**
 * The `Address` marker property **names**, without their shapes. Same contract as
 * {@link HUMAN_NAME_MARKER_PROPERTIES}.
 *
 * @internal
 */
export const ADDRESS_MARKER_PROPERTIES: ReadonlySet<string> = new Set<string>(
  ADDRESS_MARKERS.keys(),
);

/**
 * The properties every element can carry, whatever its type. Present on each set below because a node
 * carrying one is not thereby disqualified from being what its position says it is.
 */
const ELEMENT_LEVEL_PROPERTIES: readonly string[] = ["id", "extension", "modifierExtension"];

/**
 * One R4 backbone that legitimately sits at an element name R4 also types as a `HumanName` or an
 * `Address`, and is not personal data.
 *
 * @internal
 */
export interface NonPersonalTypedBackbone {
  /** The element name it sits at: one of `TYPED_PERSONAL_ELEMENT_NAMES`. */
  readonly element: string;
  /** The property R4 makes `1..1` on it, so a conformant instance always carries it. */
  readonly required: string;
  /** Every property R4 defines on it, element-level three included. */
  readonly properties: ReadonlySet<string>;
}

/**
 * The **complete** enumeration of conformant R4 backbones that share an element name with one of the
 * two personal datatypes. Both sit at `name`, and both are product/substance nomenclature rather than
 * a person:
 *
 * - `MedicinalProduct.name` - `productName` (`1..1`), `namePart`, `countryLanguage`.
 * - `SubstanceSpecification.name` - `name` (`1..1`), plus its optional descriptors.
 *
 * Nothing else in R4 puts a complex at `name`, `address`, `locationAddress`, `valueAddress` or
 * `valueHumanName` that is not the datatype itself: every other `name` is either a `HumanName` or a
 * plain string (`Organization.name`, `Location.name`, `HealthcareService.name`), and every `address`
 * is either an `Address` or a url string (`Endpoint.address`).
 *
 * Recognition is **closed plus required**, the same shape as the positive classification: an
 * unrecognized sibling means the pass is not looking at the backbone it thinks it is, so it fails
 * closed rather than trusting one property name. That is deliberately strict, and the direction is
 * the safe one: the cost is a manifest row and a removed element on a **non-conformant** product
 * name, and the alternative cost is a released person name.
 *
 * @internal
 */
export const NON_PERSONAL_TYPED_BACKBONES: readonly NonPersonalTypedBackbone[] = [
  {
    element: "name",
    required: "productName",
    properties: new Set<string>([
      ...ELEMENT_LEVEL_PROPERTIES,
      "productName",
      "namePart",
      "countryLanguage",
    ]),
  },
  {
    element: "name",
    required: "name",
    properties: new Set<string>([
      ...ELEMENT_LEVEL_PROPERTIES,
      "name",
      "type",
      "status",
      "preferred",
      "language",
      "domain",
      "jurisdiction",
      "synonym",
      "translation",
      "official",
      "source",
    ]),
  },
];

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
 * `true` when a value carries the shape R4 gives **this** marker property on its own datatype.
 *
 * A `single` marker is `0..1` in R4, so its conformant JSON is a bare value and an array there is not
 * the datatype's element. A `repeating` marker is `0..*`, so its conformant JSON is an array even for
 * one item and a bare value there is not the datatype's element either. Reading the shape per marker,
 * rather than accepting either shape for all of them, is what separates a marker from an R4 element
 * that merely shares its name: `Address.country` is a string where every colliding `country` is a
 * `CodeableConcept`, and `HumanName.prefix` is repeating where every colliding `prefix` is a single
 * string.
 */
function isMarkerShaped(node: FhirNode, shape: MarkerValueShape): boolean {
  if (shape === "single") return isPrimitive(node);
  return isList(node) && node.items.every((item) => isPrimitive(item));
}

/** `true` when no property lies outside `allowed`: nothing here contradicts the datatype. */
function isClosedFor(node: FhirComplex, allowed: ReadonlySet<string>): boolean {
  return node.properties.every((prop) => allowed.has(prop.name));
}

/** `true` when a property of that name is present, whatever value it holds. */
function carriesProperty(node: FhirComplex, name: string): boolean {
  return node.properties.some((prop) => prop.name === name);
}

/** `true` when a marker property is present **and** holds the value shape R4 gives that marker. */
function carriesShapedMarker(
  node: FhirComplex,
  markers: ReadonlyMap<string, MarkerValueShape>,
): boolean {
  return node.properties.some((prop) => {
    const shape = markers.get(prop.name);
    return shape !== undefined && isMarkerShaped(prop.value, shape);
  });
}

/**
 * Classify a node as a FHIR R4 `HumanName` or `Address` from its own structure, or `undefined` when
 * it is neither. Structural, closed, and marker-bound by the value shape R4 gives **that** marker as
 * well as by its name: see this module's own documentation for why all three halves of the test are
 * required and what the test deliberately does not reach.
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
 * // R4 types HumanName.prefix as repeating, so a name's prefix arrives as a list ...
 * classifyFhirPersonalDatatype(complex([{ name: "prefix", value: list([primitive("Dr.")]) }])); // => "human-name"
 * // ... while a single string at `prefix` is a numbered workflow step, not a person.
 * classifyFhirPersonalDatatype(complex([{ name: "prefix", value: primitive("1.") }])); // => undefined
 *
 * // An organisation's own name is a plain string, so no datatype rule reaches it.
 * classifyFhirPersonalDatatype(primitive("Springfield Clinic")); // => undefined
 * ```
 */
export function classifyFhirPersonalDatatype(node: FhirNode): FhirPersonalDatatype | undefined {
  if (!isComplex(node)) return undefined;
  if (isClosedFor(node, HUMAN_NAME_PROPERTIES) && carriesShapedMarker(node, HUMAN_NAME_MARKERS)) {
    return "human-name";
  }
  if (isClosedFor(node, ADDRESS_PROPERTIES) && carriesShapedMarker(node, ADDRESS_MARKERS)) {
    return "address";
  }
  return undefined;
}

/**
 * `true` when a node is one of the {@link NON_PERSONAL_TYPED_BACKBONES} at the element name it was
 * found under: closed for that backbone's property set **and** carrying the property R4 makes `1..1`
 * on it. Both halves are load-bearing. Without the required property, `{ text }` at `name` reads as a
 * `SubstanceSpecification.name` with everything optional omitted; without the closed half,
 * `{ productName, family, given }` reads as a product name while carrying a person's.
 */
function isNonPersonalTypedBackbone(node: FhirComplex, elementName: string): boolean {
  return NON_PERSONAL_TYPED_BACKBONES.some(
    (backbone) =>
      backbone.element === elementName &&
      carriesProperty(node, backbone.required) &&
      isClosedFor(node, backbone.properties),
  );
}

/**
 * `true` when a **non-empty complex** found at an element name R4 **types** as a `HumanName` or an
 * `Address` is a name or an address this pass could not read. At such a position the standard has
 * already committed to what belongs there, so {@link classifyFhirPersonalDatatype} having declined the
 * node is itself the evidence: whatever arrived, the pass cannot pin down the name or the address it
 * was promised, and descending would release it one primitive at a time.
 *
 * So the test is the position plus one positive exclusion, and deliberately not a property-set test.
 * A property-set test draws the boundary at the presence of a foreign key rather than at readability:
 * it blocks `{ text }` at `Location.address` while releasing `{ text, streetAddress }`, street
 * included, though the second is strictly less readable than the first. What is excluded instead is an
 * enumerated shape that is conformantly there and is not a person:
 * {@link NON_PERSONAL_TYPED_BACKBONES}, two product/substance nomenclature backbones at `name`.
 *
 * This is **not** a claim the node is personal data, and at an arbitrary position it would usually be
 * wrong: `{ prefix, linkId, text, type }` is a conformant `Questionnaire.item` and `{ text }` is
 * usually a `CodeableConcept` carrying its text. So the caller must consult this **only at a position
 * R4 types as a `HumanName` or an `Address`**, and passes the element name here so the exclusion is
 * read at the position it belongs to rather than everywhere.
 *
 * An **empty** complex is not evidence: there is nothing inside it to release, and blocking it would
 * put a manifest row against a position that carried no value.
 *
 * @param node - Any node of the parsed `@cosyte/fhir` element tree.
 * @param elementName - The element name the node was found under; must be one R4 types as one of the
 *   two datatypes, which is the caller's precondition and the whole basis of the rule.
 * @returns `true` when the node is an unreadable name or address at a position that promised one.
 * @internal
 */
export function carriesFhirPersonalEvidence(node: FhirNode, elementName: string): boolean {
  if (!isComplex(node)) return false;
  if (node.properties.length === 0) return false;
  return !isNonPersonalTypedBackbone(node, elementName);
}
