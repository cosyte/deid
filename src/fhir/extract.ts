/**
 * The FHIR **extractor**: walks a parsed `@cosyte/fhir` resource (the generic `FhirComplex` element
 * tree the sibling parser produces) and yields the format-agnostic {@link GenericLocus} list the core
 * engine transforms, plus a **parallel coordinate list** ({@link FhirCoord}) holding a direct handle to
 * the exact node each locus came from and how the applier must write it back. Loci and coordinates are
 * produced in the same order, so `result.document.loci[i]` corresponds to `coords[i]`.
 *
 * PHI is located **structurally**, per the cited {@link "./locus-map.js"}: the demographic elements
 * (`name` / `telecom` / `address` / `photo` / dates) of the **person resources**
 * (`Patient` / `RelatedPerson` / `Practitioner` / `Person`, plus the nested `Patient.contact`
 * relative), and the **universal** vectors that leak from any resource: `identifier`, PHI-bearing dates,
 * the narrative `text.div`, extension values, and a `Reference.display`. Outside a person resource a
 * **datatype-keyed sweep** adds the two datatypes whose position in the graph is the producer's choice
 * rather than the standard's: a `HumanName` is removed and an `Address` is reduced wherever they sit,
 * so `Organization.contact.name` and `Location.address` are reached without any cross-resource role
 * derivation (see `./datatype.js` for the closed, marker-bound classification that keeps the sweep off
 * an organisation's own `name` string and off a clinical code). A contact's name is reached by the
 * same sweep through its R4 element path, whatever shape it arrives in: the `name` of an
 * `Organization` or `InsurancePlan` contact (a `HumanName`) and the `name` of every `ContactDetail`
 * (a string R4 documents as the individual to contact). The **fail-closed** rule governs the
 * person sweep, and the datatype sweep with it: a value-bearing top-level person-resource property that
 * is neither mapped PHI nor on the recognized allow-list is blocked, a swept `Address` the pass cannot
 * read faithfully is removed whole rather than partly retained, and at an element name R4 types as one
 * of the two datatypes any complex the classifier cannot pin down is blocked whole, bar the two
 * conformant R4 backbones `./datatype.js` excludes by name. Everything else: the codes,
 * values, units, and statuses of the clinical resources: is left untouched (the over-scrub guard).
 * Contained resources and Bundle entries are walked by re-deriving the resource role at every
 * `resourceType` boundary.
 *
 * Every resource's logical `id`, and the id part of every literal that names one (a
 * `Bundle.entry.fullUrl`, a `Reference.reference`, a `Bundle.entry.request.url`, a
 * `Bundle.entry.response.location`), is a medical record number locus marked `referencedId`, so the
 * engine writes one replacement per distinct id for the whole call and the references still resolve.
 * A literal is read by `./reference.js`; one it cannot read, and an absolute reference to a server the
 * input's own `fullUrl`s do not name, is blocked.
 *
 * The `@cosyte/fhir` model is **immutable**, so the extractor never edits the tree; the applier rebuilds
 * a fresh tree from these coordinates (see `./apply.js`).
 *
 * @packageDocumentation
 */

import {
  getProperty,
  isComplex,
  isList,
  isPrimitive,
  resourceType,
  type FhirComplex,
  type FhirNode,
  type FhirPrimitive,
} from "@cosyte/fhir";

import { isAgeCode, isBirthDateCode, type ObservationCodeSystem } from "../age-codes.js";
import { SAFE_HARBOR_CATEGORIES } from "../categories.js";
import { isWithheldToken, safeLocusToken } from "../derived-token.js";
import type { GenericLocus } from "../locus.js";
import {
  enumerateOrFail,
  UnexaminedResidualBuilder,
  type UnexaminedResidual,
} from "../residual.js";
import { isRetainableZipCode } from "../retention.js";
import { carriesFhirPersonalEvidence, classifyFhirPersonalDatatype } from "./datatype.js";
import {
  FHIR_AGE_ELEMENTS,
  FHIR_AGE_RANGE_ELEMENTS,
  FHIR_BIRTH_DATE_ELEMENTS,
  FHIR_DATE_CATEGORY,
  FHIR_DEMOGRAPHIC_ELEMENTS,
  FHIR_KEPT_ADDRESS_PARTS,
  HUMAN_NAME_ELEMENT_PATHS,
  PERSON_RESOURCE_TYPES,
  RECOGNIZED_PERSON_ELEMENTS,
  TYPED_PERSONAL_ELEMENT_NAMES,
  categoryForIdentifierSystem,
  isContactDetailName,
  isContactElement,
  codings,
  isFhirDateValue,
  locationMayBeResidence,
} from "./locus-map.js";
import { readFhirLiteral } from "./reference.js";

/**
 * How the applier rewrites one extracted locus onto a fresh copy of the node it came from:
 *
 * - `drop`: remove the node entirely (a redacted `name`/`telecom`/`photo` property, a blocked
 *   extension value, a blocked `Reference.display`, a blocked unknown person string, a blocked
 *   narrative `div`, or a redacted SSN `Identifier.value`). The parent complex omits the property; a
 *   parent list omits the item.
 * - `set-primitive`: replace a primitive's value with the transformed string (a generalized date, a
 *   pseudonymized `Identifier.value`); a `null` transform result degrades to `drop`.
 * - `address`: rebuild an `Address` complex, keeping `state`/`country` and the generalized 3-digit
 *   `postalCode`, dropping every finer geographic component.
 * - `age`: the `value` of a `Quantity` that holds an age. The number is kept exactly as it arrived when
 *   the pass kept the age, and dropped otherwise: an age over 89, one the pass could not read, or a
 *   surrogate a custom policy computed, since a decimal is never written back as a string.
 * - `reference`: a literal that carries a logical id (a `fullUrl`, a `Reference.reference`, a request
 *   url or a response location). The id part is replaced by the transformed value and the structure
 *   around it is kept: the `#`, the resource type, the `urn:uuid:` or `urn:oid:` scheme, or the server
 *   base. A version suffix (`/_history/vid`) is dropped. A `null` transform result drops the literal.
 */
export type FhirEditKind = "drop" | "set-primitive" | "address" | "age" | "reference";

/**
 * A write-back coordinate: a direct handle to the exact model node one extracted locus came from, plus
 * how to rewrite it. Node identity ties the coordinate to the tree the applier rebuilds. Carries no value.
 */
export interface FhirCoord {
  /** The model node to rewrite (a primitive, an `Address` complex, or a property-value node to drop). */
  readonly node: FhirNode;
  /** How to write the transformed value back. */
  readonly edit: FhirEditKind;
}

/** The paired output of {@link extractFhirLoci}: loci for the engine + coordinates for the applier. */
export interface FhirExtraction {
  /** The located candidate values, in document order. */
  readonly loci: GenericLocus[];
  /** The write-back coordinates, index-aligned with {@link loci}. */
  readonly coords: FhirCoord[];
  /**
   * Every **value-bearing position the pass hands through that no locus rule named**: a primitive
   * carrying a non-empty value that neither a PHI rule nor the fail-closed person sweep reached. The
   * clinical resources' codes, units and statuses are the bulk of it, and that is the honest answer:
   * nothing examined them. Counted and located, never transformed.
   */
  readonly unexaminedResiduals: readonly UnexaminedResidual[];
}

/** The mutable pair the walk accumulates into, before it is frozen into a {@link FhirExtraction}. */
interface FhirLocusAccumulator {
  readonly loci: GenericLocus[];
  readonly coords: FhirCoord[];
  /**
   * Nodes a locus rule **reached and decided about** without emitting a coordinate: a `resourceType`
   * discriminant, a recognized person element the allow-list keeps, a `Coding.display` the pass
   * positively typed as a coded term rather than a person label.
   */
  readonly ruleReached: Set<FhirNode>;
  /**
   * The server bases the input's own `Bundle.entry.fullUrl`s name. An absolute reference keeps its
   * base only when it is one of these, because only then can it resolve inside the document.
   */
  readonly bases: ReadonlySet<string>;
}

/** Append a locus + its coordinate to the accumulator. */
function push(out: FhirLocusAccumulator, locus: GenericLocus, coord: FhirCoord): void {
  out.loci.push(locus);
  out.coords.push(coord);
}

/** Join a running value-free path with a child segment. */
function join(base: string, seg: string): string {
  return base === ""
    ? /* v8 ignore next -- every path starts at the resource type token, which safeLocusToken never returns empty */ seg
    : `${base}.${seg}`;
}

/** Append a list-index segment to a value-free path (`entry` + `0` → `entry[0]`). */
function idx(base: string, i: number): string {
  return `${base}[${String(i)}]`;
}

/**
 * Bound a JSON property name before it becomes a path segment. A JSON object key is an arbitrary
 * string (the reader has no obligation to have recognized it as a FHIR element), so a key is only an
 * "element name" by convention. A refused key keeps its **position** (`<withheld>[3]`) so two refused
 * keys on the same object stay distinguishable in the manifest.
 */
function elementSegment(name: string, position: number): string {
  const token = safeLocusToken(name, "fhirElementName");
  return isWithheldToken(token) ? idx(token, position) : token;
}

/**
 * The string form of a primitive value (`FhirDecimal` → its exact lexical text). `""` when absent.
 *
 * @internal
 */
export function primitiveString(p: FhirPrimitive): string {
  const v = p.value;
  if (v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "boolean") return v ? "true" : "false";
  return v.raw; // FhirDecimal: exact lexical text, never routed through a JS number
}

/** `true` when a primitive carries a (non-empty) string value: the shape a bare-PHI leak takes. */
function isStringPrimitive(node: FhirNode): node is FhirPrimitive {
  return isPrimitive(node) && typeof node.value === "string" && node.value.length > 0;
}

/** Concatenate every primitive string value in a subtree (for a value-free locus/count, consumed, never emitted). */
function collectText(node: FhirNode): string {
  if (isPrimitive(node)) return primitiveString(node);
  if (isList(node)) return node.items.map(collectText).join(" ");
  return node.properties.map((p) => collectText(p.value)).join(" ");
}

/**
 * `true` when a complex is a FHIR `Coding`: the one element whose `display` is a coded term to retain
 * (`Sodium`), positively identified by a `code` or `system` sibling (the two properties that define a
 * Coding, and that a `Reference` never carries). Every other complex bearing a `display` is treated as a
 * `Reference`, including a **display-only** (`{ display }`) or **type+display** (`{ type, display }`)
 * reference that carries neither `reference` nor `identifier`, so its `display` (a person label) **fails
 * closed** and is blocked. Deciding by "is it positively a Coding?" rather than "is it positively a
 * Reference?" is the inverted, fail-closed reflex: an unrecognized `display`-bearing shape is blocked,
 * never passed through.
 */
function isCodingComplex(node: FhirComplex): boolean {
  return getProperty(node, "code") !== undefined || getProperty(node, "system") !== undefined;
}

/** `true` when a `text` property value is a `Narrative` (a complex carrying a `div`), not a coded `.text` string. */
function isNarrative(node: FhirNode): node is FhirComplex {
  return isComplex(node) && isPrimitive(getProperty(node, "div") ?? node);
}

/** Emit a fail-closed block locus for a node (category omitted → the engine blocks it as (R)). */
function blockNode(out: FhirLocusAccumulator, node: FhirNode, path: string): void {
  push(out, { path, kind: "unknown", value: collectText(node) }, { node, edit: "drop" });
}

/**
 * Leaf string element names that carry **human free-text prose**, blocked by default:
 * a `contentString` (a `Communication`/message body) and a `valueString` (an *uncoded* string result,
 * the direct FHIR analogue of an HL7 OBX-5 typed `ST`, which the sibling HL7 adapter also fails closed
 * on: a structured `valueQuantity` / `valueCodeableConcept` / `valueDateTime` result is retained). A
 * free-text field can carry any of the 18 categories in prose, so a naive scrub is a false-safety
 * hazard; the v1 default blocks. `Annotation` free-text (the `note` element) is handled separately.
 */
const FREE_TEXT_STRING_ELEMENTS: ReadonlySet<string> = new Set<string>([
  "contentString",
  "valueString",
]);

/** Emit a fail-closed **free-text** block locus (engine → `DEID_FREETEXT_BLOCKED`). */
function blockFreeText(out: FhirLocusAccumulator, node: FhirNode, path: string): void {
  push(
    out,
    {
      path,
      kind: "freetext",
      category: SAFE_HARBOR_CATEGORIES.OTHER_UNIQUE_ID,
      value: collectText(node),
    },
    { node, edit: "drop" },
  );
}

/** A year-only R4 `date` (`1950`): the coarsest precision the datatype allows. */
const FHIR_YEAR_ONLY = /^[1-9]\d{3}$/;

/**
 * Emit a date locus for a primitive whose value is a real calendar date; returns `true` if it did.
 * `dateOfBirth` marks a `birthDate`, which R4 defines only as a person's date of birth, so a year that
 * shows an age over 89 is removed rather than kept. A birth date given as a **year alone** is a date
 * too: it is the very year the rule reads, so it is located and recorded like a full one rather than
 * kept by name.
 */
function dateEmit(
  out: FhirLocusAccumulator,
  node: FhirPrimitive,
  path: string,
  dateOfBirth = false,
): boolean {
  const v = primitiveString(node);
  if (!isFhirDateValue(v) && !(dateOfBirth && FHIR_YEAR_ONLY.test(v))) return false;
  push(
    out,
    {
      path,
      kind: "date",
      category: FHIR_DATE_CATEGORY,
      ...(dateOfBirth ? { dateOfBirth: true } : {}),
      value: v,
    },
    { node, edit: "set-primitive" },
  );
  return true;
}

/** Extract one `Identifier` complex: the `value` primitive, routed to SSN (redact) or MRN (pseudonymize). */
function handleIdentifier(out: FhirLocusAccumulator, id: FhirComplex, path: string): void {
  const valueNode = getProperty(id, "value");
  if (valueNode === undefined || !isPrimitive(valueNode)) return; // no value → nothing to transform
  const systemNode = getProperty(id, "system");
  const system =
    systemNode !== undefined && isPrimitive(systemNode) ? primitiveString(systemNode) : undefined;
  push(
    out,
    {
      path: join(path, "value"),
      kind: "identifier",
      category: categoryForIdentifierSystem(system),
      value: primitiveString(valueNode),
    },
    { node: valueNode, edit: "set-primitive" },
  );
}

/**
 * Handle an `identifier` property: one locus per `Identifier` in the list (or a single complex). An
 * item that is not an object (a bare string where an `Identifier` belongs) is a shape the pass cannot
 * locate a value in, so it is blocked whole rather than handed through.
 */
function handleIdentifiers(out: FhirLocusAccumulator, value: FhirNode, path: string): void {
  const items = isList(value) ? value.items : [value];
  items.forEach((item, i) => {
    const itemPath = items.length > 1 ? idx(path, i) : path;
    if (!isComplex(item)) {
      blockNode(out, item, itemPath);
      return;
    }
    handleIdentifier(out, item, itemPath);
  });
}

/**
 * Handle an `address` property: one generalize locus per `Address` complex (ZIP → safe 3-digit form).
 * An item that is not an object (a bare string where an `Address` belongs) cannot be reduced to its
 * Safe Harbor parts, so it is blocked whole rather than handed through.
 */
function handleAddresses(out: FhirLocusAccumulator, value: FhirNode, path: string): void {
  const items = isList(value) ? value.items : [value];
  items.forEach((item, i) => {
    const itemPath = items.length > 1 ? idx(path, i) : path;
    if (!isComplex(item)) {
      blockNode(out, item, itemPath);
      return;
    }
    const postal = getProperty(item, "postalCode");
    const zip = postal !== undefined && isPrimitive(postal) ? primitiveString(postal) : "";
    push(
      out,
      {
        path: itemPath,
        kind: "zip",
        category: SAFE_HARBOR_CATEGORIES.GEOGRAPHIC,
        value: zip,
      },
      { node: item, edit: "address" },
    );
  });
}

/** The code system a FHIR `Coding.system` URI names, as the shared age and birth-date code sets know it. */
function fhirCodeSystem(system: string): ObservationCodeSystem {
  if (system === "") return "unstated";
  if (system === "http://loinc.org") return "loinc";
  if (system === "http://snomed.info/sct") return "snomed";
  return "other";
}

/** What a complex's own `code` says its value is: an age, a date of birth, or neither. */
type CodedAs = "age" | "birth-date" | undefined;

/**
 * Read a complex's `code` (a `CodeableConcept`) and say whether any of its codings names an age or a
 * date of birth. This is how an `Observation`, or one of its `component`s, says what its `value[x]`
 * holds: an age-coded `valueQuantity` is an age, a birth-date-coded `valueDateTime` a date of birth.
 */
function codedAs(complex: FhirComplex): CodedAs {
  for (const { system, code } of codings(getProperty(complex, "code"))) {
    const named = fhirCodeSystem(system);
    if (isAgeCode(named, code)) return "age";
    if (isBirthDateCode(named, code)) return "birth-date";
  }
  return undefined;
}

/** A primitive's string value, or `""` when the property is absent or is not a primitive. */
function primitiveProperty(complex: FhirComplex, name: string): string {
  const node = getProperty(complex, name);
  return node !== undefined && isPrimitive(node) ? primitiveString(node) : "";
}

/**
 * Emit the age locus of a `Quantity` that holds an age: its `value`, with the unit read from the UCUM
 * `code` (or the human `unit` when there is no code). Returns `true` when it emitted one. A quantity
 * with no `value` has no age to act on, and one whose `value` is not a primitive is blocked whole.
 *
 * The quantity's other properties are left to the ordinary walk by the caller, so an extension inside
 * it is still blocked and its unit, system and code are still measured.
 */
function emitAge(out: FhirLocusAccumulator, quantity: FhirComplex, path: string): void {
  const valueNode = getProperty(quantity, "value");
  if (valueNode === undefined) return;
  const valuePath = join(path, "value");
  if (!isPrimitive(valueNode)) {
    blockNode(out, valueNode, valuePath);
    return;
  }
  const code = primitiveProperty(quantity, "code");
  push(
    out,
    {
      path: valuePath,
      kind: "age",
      category: FHIR_DATE_CATEGORY,
      ageUnit: code !== "" ? code : primitiveProperty(quantity, "unit"),
      value: primitiveString(valueNode),
    },
    { node: valueNode, edit: "age" },
  );
}

/** Handle a mapped person demographic element (redact whole, or generalize an address). */
function handleDemographic(
  out: FhirLocusAccumulator,
  name: string,
  value: FhirNode,
  path: string,
): void {
  const mode = FHIR_DEMOGRAPHIC_ELEMENTS[name];
  if (mode === "address") {
    handleAddresses(out, value, path);
    return;
  }
  // redact: drop the whole property value (all names / telecoms / photos), handled as a unit.
  const category = name === "telecom" ? SAFE_HARBOR_CATEGORIES.PHONE : SAFE_HARBOR_CATEGORIES.NAMES;
  push(
    out,
    { path, kind: "identifier", category, value: collectText(value) },
    { node: value, edit: "drop" },
  );
}

/**
 * Fail closed on an `extension` / `modifierExtension` subtree: block every `value[x]` it carries at any
 * nesting, retaining the `url` and the nested `extension` skeleton. An extension can carry any of the 18
 * categories (an MRN in a local extension, a name in a `valueHumanName`, an address in a birthplace
 * extension), and the reader preserves unknown extensions verbatim, so the value is dropped
 * unconditionally: fail closed on an unknown extension carrying a value.
 */
function blockExtension(out: FhirLocusAccumulator, value: FhirNode, path: string): void {
  if (isList(value)) {
    value.items.forEach((item, i) => blockExtension(out, item, idx(path, i)));
    return;
  }
  if (isPrimitive(value)) {
    // A bare primitive where an extension object is expected is malformed input: fail closed and block
    // it (it could carry any PHI), rather than let the unexpected shape ride through.
    if (primitiveString(value).length > 0) blockNode(out, value, path);
    return;
  }
  if (!isComplex(value)) return;
  value.properties.forEach((prop, i) => {
    if (prop.name === "url") return; // structural: a definitional URI, never PHI
    if (prop.name === "extension" || prop.name === "modifierExtension") {
      blockExtension(out, prop.value, join(path, prop.name)); // nested extension: recurse
      return;
    }
    if (prop.name.startsWith("value")) {
      // `startsWith` is a prefix test, not an identifier check: a key of "value" followed by any
      // number of arbitrary bytes satisfies it, so the name is bounded before it is interpolated.
      blockNode(out, prop.value, join(path, elementSegment(prop.name, i))); // value[x]: the PHI payload, dropped
    }
    // any other extension child (id) is structural and retained
  });
}

/** Block the `div` of a `Narrative` (rendered PHI): at any depth (resource-, section-, entry-level). */
function blockNarrativeDiv(out: FhirLocusAccumulator, narrative: FhirComplex, path: string): void {
  const div = getProperty(narrative, "div");
  /* v8 ignore else -- the only caller passes a node isNarrative accepted, so its div is a primitive */
  if (div !== undefined && isPrimitive(div)) {
    blockNode(out, div, join(path, "div"));
  }
}

/** Recurse into a list value, applying the property rules to each item in document order. */
function walkList(
  out: FhirLocusAccumulator,
  value: FhirNode,
  path: string,
  personCtx: boolean,
  elementPath: string,
): void {
  /* v8 ignore next -- the only caller checks isList first; this guard narrows the type */
  if (!isList(value)) return;
  value.items.forEach((item, i) => walkValue(out, item, idx(path, i), personCtx, elementPath));
}

/**
 * Recurse into a value node reached during descent (a list item or a non-mapped complex/primitive).
 *
 * @param elementPath - The R4 element path of the node, without list indexes (see {@link walkComplex}).
 */
function walkValue(
  out: FhirLocusAccumulator,
  node: FhirNode,
  path: string,
  personCtx: boolean,
  elementPath: string,
): void {
  if (isComplex(node)) {
    walkComplex(out, node, path, personCtx, elementPath);
    return;
  }
  if (isList(node)) {
    walkList(out, node, path, personCtx, elementPath);
    return;
  }
  // a bare primitive reached during descent: generalize it only if it is a date (else retained).
  dateEmit(out, node, path);
}

/**
 * What the datatype-keyed sweep does with one element it reached: act on the datatype it recognized,
 * or **block** the element whole because a position R4 types as one of those datatypes carries a shape
 * the pass cannot locate.
 */
type PersonalAction = "human-name" | "address" | "block";

/**
 * The two elements named `address` that R4 types as a url rather than an `Address`, by their R4 element
 * path. Each holds the network address of a system, never a person's postal address, and R4 makes both
 * `1..1`, so removing one would leave a resource the standard rejects.
 */
const URL_TYPED_ADDRESS_ELEMENTS: ReadonlySet<string> = new Set<string>([
  "Endpoint.address",
  "CapabilityStatement.messaging.endpoint.address",
]);

/**
 * Whether a plain primitive at this typed element name is one this sweep leaves to the ordinary
 * descent, for an element at the R4 path `elementPath`. Two cases: `name`, which R4 types as a string
 * on many resources and backbones (`Organization.name`, `Location.name`), and the url-typed `address`
 * elements in {@link URL_TYPED_ADDRESS_ELEMENTS}. The `name` case stops at the contact backbones whose
 * `name` R4 types as a `HumanName` ({@link HUMAN_NAME_ELEMENT_PATHS}): a string there is a person's
 * name the pass cannot read, not an organisation's own. R4 has one more string at `address`,
 * `AuditEvent.agent.network.address`, and it is deliberately not here: it holds a machine name, an IP
 * address or a telephone number, which identify a person when the agent is one, so it is blocked. At
 * every other typed element name, and at every other `address`, a primitive is not the `HumanName` or
 * `Address` the standard promised there.
 */
function primitiveConformsAt(name: string, elementPath: string): boolean {
  if (name === "name") return !HUMAN_NAME_ELEMENT_PATHS.has(elementPath);
  return URL_TYPED_ADDRESS_ELEMENTS.has(elementPath);
}

/** What the sweep knows about the position one candidate node sits at, from its R4 element path. */
interface SweepPosition {
  /**
   * The element name when R4 types it as a `HumanName` or an `Address`, and `undefined` at every other
   * position: the fail-closed arm exists only where the standard already promised a name or an address.
   */
  readonly typedElementName: string | undefined;
  /** Whether R4 puts a plain primitive at this element, which leaves one there to the ordinary descent. */
  readonly primitiveConforms: boolean;
  /** The element is a `ContactDetail`'s `name`: a string in R4, and an individual's name. */
  readonly contactName: boolean;
  /** The element is a contact (a `ContactDetail`, or an `Organization` or `InsurancePlan` contact). */
  readonly contact: boolean;
}

/**
 * Decide what the sweep does with one node at a `ContactDetail`'s `name`. R4 types it as a string and
 * documents it as the name of the individual to contact, so a string there is a person's name and is
 * removed as one, exactly as a `HumanName` would be. Any other shape (a number, a `null`, a list nested
 * in a list, an object that is not a `HumanName`) is a name the pass cannot read, so it is blocked
 * whole. An empty object carries nothing to release and is left alone.
 */
function contactNameAction(node: FhirNode): PersonalAction | undefined {
  if (isStringPrimitive(node)) return "human-name";
  if (isComplex(node)) return node.properties.length > 0 ? "block" : undefined;
  return "block";
}

/**
 * Decide what the sweep does with one candidate node. A positively classified `HumanName` or `Address`
 * is acted on wherever it sits. At a `ContactDetail`'s `name` the position decides
 * ({@link contactNameAction}). A contact that arrives as anything but an object (a bare string, a
 * number, a `null`) is blocked whole: the pass cannot find the name in it. A complex the classifier
 * could not pin down is **blocked**, but only at an element name R4 types as one of those datatypes
 * (see {@link carriesFhirPersonalEvidence} for why the position carries the whole weight of that
 * decision, and for the two conformant backbones it excludes). So is anything there that is not a
 * complex at all (a bare string, a number, a `null`, a list nested in the list a model built by hand
 * can hold), unless it is a primitive at an element R4 itself types as a string
 * ({@link primitiveConformsAt}): the pass cannot locate a value in it. Everything else is left to the
 * ordinary descent, which is what keeps an organisation's own `name` string, a url at
 * `Endpoint.address`, a `Coding.display` and a clinical code, value, unit or status byte-identical.
 */
function personalAction(node: FhirNode, position: SweepPosition): PersonalAction | undefined {
  const datatype = classifyFhirPersonalDatatype(node);
  if (datatype !== undefined) return datatype;
  if (position.contactName) return contactNameAction(node);
  if (position.contact) return isComplex(node) ? undefined : "block";
  const { typedElementName } = position;
  if (typedElementName === undefined) return undefined;
  if (isComplex(node)) {
    return carriesFhirPersonalEvidence(node, typedElementName) ? "block" : undefined;
  }
  return isPrimitive(node) && position.primitiveConforms ? undefined : "block";
}

/**
 * The ZIP value to hand the engine for a swept `Address`, or `null` to **fail closed on the whole
 * element**. Two conditions produce the `null`, and both are the same rule: a part the applier would
 * re-emit must be one the pass can actually read.
 *
 * - **The ZIP is present but is not a whole zip code** of a shape this library recognizes
 *   ({@link isRetainableZipCode}, the same five-or-nine-digit gate the HL7 retention path uses). A
 *   four-digit `postalCode` still yields three leading digits, so generalizing it would retain a
 *   fragment of something that was never a zip code. An **absent or empty** `postalCode` is not that
 *   case: there is no zip code to misread, and the element is reduced exactly as a person resource's
 *   address carrying none is.
 * - **A part Safe Harbor lets the applier keep is not a plain primitive.** `state` and `country` are
 *   re-emitted verbatim, metadata included, so an unexpected JSON shape at one of them would carry
 *   content out of the pass unread.
 */
function sweptAddressZip(node: FhirComplex): string | null {
  const postal = getProperty(node, "postalCode");
  let zip = "";
  if (postal !== undefined) {
    if (!isPrimitive(postal)) return null;
    zip = primitiveString(postal);
    if (zip.length > 0 && !isRetainableZipCode(zip)) return null;
  }
  for (const prop of node.properties) {
    if (FHIR_KEPT_ADDRESS_PARTS.has(prop.name) && !isPrimitive(prop.value)) return null;
  }
  return zip;
}

/** Emit the swept `Address` locus: the Safe Harbor reduction, or the fail-closed removal of it all. */
function emitSweptAddress(out: FhirLocusAccumulator, node: FhirComplex, path: string): void {
  const zip = sweptAddressZip(node);
  const category = SAFE_HARBOR_CATEGORIES.GEOGRAPHIC;
  if (zip === null) {
    // Fail closed as a UNIT. The empty value is what the engine cannot generalize, so it blocks and
    // returns nothing to write, and the `drop` edit takes the whole `Address` with it: no street, no
    // city, no state, no country and no ZIP fragment survives an element the pass could not read.
    push(out, { path, kind: "zip", category, value: "" }, { node, edit: "drop" });
    return;
  }
  push(out, { path, kind: "zip", category, value: zip }, { node, edit: "address" });
}

/**
 * The **datatype-keyed sweep**: act on a `HumanName` or an `Address` because of what it *is*, not
 * because of the resource it sits in.
 *
 * Applied outside the person resource types only, because inside one the person demographic map has
 * already decided every `name` / `telecom` / `photo` / `address` and the fail-closed person sweep has
 * decided the rest, so nothing here would change what a person resource emits.
 *
 * A list is unwrapped and each item decided on its own, so a list mixing a swept element with an
 * unrelated one still walks the unrelated one exactly as before. When no item is claimed the sweep
 * reports so without walking anything, and the caller's ordinary dispatch continues untouched.
 *
 * @param elementPath - The R4 element path of this property (see {@link walkComplex}): it is what tells
 *   a url-typed `address` from any other `address`.
 * @returns `true` when the sweep took ownership of this property value.
 */
function sweepPersonalDatatypes(
  out: FhirLocusAccumulator,
  name: string,
  value: FhirNode,
  path: string,
  elementPath: string,
): boolean {
  const position: SweepPosition = {
    typedElementName: TYPED_PERSONAL_ELEMENT_NAMES.has(name) ? name : undefined,
    primitiveConforms: primitiveConformsAt(name, elementPath),
    contactName: isContactDetailName(elementPath),
    contact: isContactElement(elementPath),
  };
  const items = isList(value) ? value.items : [value];
  const actions = items.map((item) => personalAction(item, position));
  if (actions.every((action) => action === undefined)) return false;
  const multi = items.length > 1;
  items.forEach((item, i) => {
    const itemPath = multi ? idx(path, i) : path;
    const action = actions[i];
    if (action === undefined) {
      walkValue(out, item, itemPath, false, elementPath);
      return;
    }
    if (action === "human-name") {
      push(
        out,
        {
          path: itemPath,
          kind: "identifier",
          category: SAFE_HARBOR_CATEGORIES.NAMES,
          value: collectText(item),
        },
        { node: item, edit: "drop" },
      );
      return;
    }
    if (action === "address" && isComplex(item)) {
      emitSweptAddress(out, item, itemPath);
      return;
    }
    blockNode(out, item, itemPath);
  });
  return true;
}

/** The bounds of a `Range`, each a `Quantity`. */
const RANGE_BOUNDS: readonly string[] = ["low", "high"];
/** The properties of a range the age rule decides itself, so the walk of the rest skips them. */
const RANGE_BOUNDS_DECIDED: ReadonlySet<string> = new Set(RANGE_BOUNDS);
/** The property of an age quantity the age rule decides itself. */
const AGE_DECIDED: ReadonlySet<string> = new Set(["value"]);
/** No property decided ahead of the walk. */
const NONE_DECIDED: ReadonlySet<string> = new Set();

/** What the complex a property sits in says about the property, read once per complex. */
interface ParentFacts {
  /** The complex is a `Coding`, so its `display` is a coded term rather than a person label. */
  readonly parentIsCoding: boolean;
  /** What the complex's own `code` says its `value[x]` holds. */
  readonly codedAs: CodedAs;
  /** The complex is a `Location` that may be a patient's residence (see `locationMayBeResidence`). */
  readonly residence: boolean;
  /** The complex is a resource (it carries a `resourceType`), so its `id` is a logical id. */
  readonly resource: boolean;
}

/**
 * The rules for an **age held as a number**, a **date of birth no name rule reaches**, and the
 * **position of a residence**. Returns `true` when one of them took the property.
 *
 * - An element R4 types as an `Age` (`Condition.onsetAge`, `FamilyMemberHistory.ageAge`, ...) and an
 *   age-coded `valueQuantity`: the quantity's `value` becomes an age locus, and the rest of the
 *   quantity is walked as before.
 * - An `Age` range (`FamilyMemberHistory.ageRange`, `Condition.onsetRange`, ...) and an age-coded
 *   `valueRange`: each bound alike. An age-coded `valueInteger` is an age in years.
 * - `FamilyMemberHistory.bornPeriod`: each bound is a date of birth. `bornString`: a date of birth
 *   written as text, generalized to its leading year when it has one and blocked when it has none.
 * - `Location.position` on a Location that may be a residence: removed whole, as geography finer than
 *   a State. The value handed to the engine is empty, so no transform can keep any of it.
 */
function handleAgesAndBirthDates(
  out: FhirLocusAccumulator,
  name: string,
  value: FhirNode,
  path: string,
  personCtx: boolean,
  parent: ParentFacts,
  elementPath: string,
): boolean {
  // The age's own `value` is decided here, so the walk of the rest of the quantity skips it.
  const walkAge = (quantity: FhirComplex, at: string): void => {
    emitAge(out, quantity, at);
    walkComplex(out, quantity, at, personCtx, elementPath, AGE_DECIDED);
  };
  if (
    isComplex(value) &&
    (FHIR_AGE_ELEMENTS.has(name) || (name === "valueQuantity" && parent.codedAs === "age"))
  ) {
    walkAge(value, path);
    return true;
  }
  if (name === "valueInteger" && parent.codedAs === "age" && isPrimitive(value)) {
    // An age-coded integer result: a whole number of years, with no unit to read.
    push(
      out,
      {
        path,
        kind: "age",
        category: FHIR_DATE_CATEGORY,
        ageUnit: "",
        value: primitiveString(value),
      },
      { node: value, edit: "age" },
    );
    return true;
  }
  if (
    isComplex(value) &&
    (FHIR_AGE_RANGE_ELEMENTS.has(name) || (name === "valueRange" && parent.codedAs === "age"))
  ) {
    for (const bound of RANGE_BOUNDS) {
      const quantity = getProperty(value, bound);
      if (quantity !== undefined && isComplex(quantity)) walkAge(quantity, join(path, bound));
    }
    walkComplex(out, value, path, personCtx, elementPath, RANGE_BOUNDS_DECIDED);
    return true;
  }
  if (isComplex(value) && name === "bornPeriod") {
    const decided = new Set<string>();
    for (const bound of ["start", "end"]) {
      const date = getProperty(value, bound);
      if (date !== undefined && isPrimitive(date) && dateEmit(out, date, join(path, bound), true)) {
        decided.add(bound);
      }
    }
    walkComplex(out, value, path, personCtx, elementPath, decided);
    return true;
  }
  if (name === "bornString" && isStringPrimitive(value)) {
    push(
      out,
      {
        path,
        kind: "date",
        category: FHIR_DATE_CATEGORY,
        dateOfBirth: true,
        value: primitiveString(value),
      },
      { node: value, edit: "set-primitive" },
    );
    return true;
  }
  if (name === "position" && parent.residence) {
    push(
      out,
      { path, kind: "zip", category: SAFE_HARBOR_CATEGORIES.GEOGRAPHIC, value: "" },
      { node: value, edit: "drop" },
    );
    return true;
  }
  return false;
}

/**
 * Where a literal sits, which decides the forms it may take:
 *
 * - `reference`: a `Reference.reference`. `#` alone is the container itself and is kept.
 * - `full-url`: a `Bundle.entry.fullUrl`. It names its own server, so its base is kept unchecked.
 * - `request`: a `Bundle.entry.request.url` or `response.location`. A resource type alone is a create
 *   and is kept.
 */
type LiteralPosition = "reference" | "full-url" | "request";

/** The literal positions of a `Bundle` entry, by R4 element path. */
const BUNDLE_LITERAL_ELEMENTS: ReadonlyMap<string, LiteralPosition> = new Map<
  string,
  LiteralPosition
>([
  ["Bundle.entry.fullUrl", "full-url"],
  ["Bundle.entry.request.url", "request"],
  ["Bundle.entry.response.location", "request"],
]);

/**
 * The conditional headers of a `Bundle.entry.request`. Each can carry an identifier: `ifNoneExist` is a
 * search string (`identifier=system|value`, `_id=value`) and `ifMatch` / `ifNoneMatch` hold an entity
 * tag, a server's version id. None is a form the pass reads, so each is removed whole, whatever it
 * holds, and recorded as blocked. The entry loses its condition, not its method or its url.
 */
const BUNDLE_CONDITIONAL_HEADERS: ReadonlySet<string> = new Set<string>([
  "Bundle.entry.request.ifNoneExist",
  "Bundle.entry.request.ifMatch",
  "Bundle.entry.request.ifNoneMatch",
]);

/** Emit the replacement locus for a logical id: a medical record number that others point at. */
function pushLogicalId(
  out: FhirLocusAccumulator,
  node: FhirPrimitive,
  path: string,
  id: string,
  edit: FhirEditKind,
): void {
  push(
    out,
    {
      path,
      kind: "identifier",
      category: SAFE_HARBOR_CATEGORIES.MRN,
      referencedId: true,
      value: id,
    },
    { node, edit },
  );
}

/**
 * Decide one literal that may carry a logical id. A literal carrying one has its id replaced and its
 * structure kept. `#` alone in a reference and a resource type alone in a request url or a response
 * location carry no id, and are kept as decided. Everything else is **removed**: a form the pass
 * cannot read ({@link readFhirLiteral}), a form that does not belong at the position, a value that is
 * not a primitive, and, outside a `fullUrl`, an absolute URL to a server the input's own `fullUrl`s do
 * not name, which cannot resolve inside the document.
 */
function emitLiteral(
  out: FhirLocusAccumulator,
  node: FhirNode,
  path: string,
  position: LiteralPosition,
): void {
  if (!isPrimitive(node)) {
    blockNode(out, node, path);
    return;
  }
  const literal = readFhirLiteral(primitiveString(node), position === "request");
  if (
    (literal?.kind === "self" && position === "reference") ||
    (literal?.kind === "type" && position === "request")
  ) {
    out.ruleReached.add(node);
    return;
  }
  if (
    literal?.kind !== "id" ||
    (position !== "full-url" && literal.base !== undefined && !out.bases.has(literal.base))
  ) {
    blockNode(out, node, path);
    return;
  }
  pushLogicalId(out, node, path, literal.id, "reference");
}

/**
 * The **logical id** rule: a resource's own `id`, and every literal that names one. Returns `true`
 * when it took the property.
 *
 * - A resource's `id` (the `id` of a complex carrying a `resourceType`, a contained resource and a
 *   Bundle entry's resource included) is replaced. One that is not a primitive is removed whole.
 * - A `Reference.reference` (a `reference` property holding a string, at any depth outside a person
 *   resource's own top level) is read by {@link emitLiteral}. A `reference` holding an object is a
 *   `Reference` datatype R4 names `reference` (`Consent.provision.data.reference`), so it is walked
 *   like any other complex, and its own inner `reference` is read in turn.
 * - A `Bundle.entry.fullUrl`, `request.url` and `response.location` are read the same way. A
 *   `fullUrl` names its own server, so its base is kept without the check a reference gets.
 *
 * Each replacement is a locus of the medical record number category marked `referencedId`, so the
 * engine writes the same replacement for the same id throughout the call and every link resolves.
 */
function handleLogicalIds(
  out: FhirLocusAccumulator,
  name: string,
  value: FhirNode,
  path: string,
  personCtx: boolean,
  isPersonTop: boolean,
  parent: ParentFacts,
  elementPath: string,
): boolean {
  if (name === "id" && parent.resource) {
    if (!isPrimitive(value)) {
      blockNode(out, value, path);
    } else if (primitiveString(value).length > 0) {
      pushLogicalId(out, value, path, primitiveString(value), "set-primitive");
    }
    return true;
  }
  if (name === "reference" && !isPersonTop && !isComplex(value)) {
    const items = isList(value) ? value.items : [value];
    items.forEach((item, i) => {
      const itemPath = isList(value) ? idx(path, i) : path;
      if (isComplex(item)) walkValue(out, item, itemPath, personCtx, elementPath);
      else emitLiteral(out, item, itemPath, "reference");
    });
    return true;
  }
  if (BUNDLE_CONDITIONAL_HEADERS.has(elementPath)) {
    blockNode(out, value, path);
    return true;
  }
  const position = BUNDLE_LITERAL_ELEMENTS.get(elementPath);
  if (position === undefined) return false;
  if (isComplex(value)) {
    blockNode(out, value, path);
    return true;
  }
  const items = isList(value) ? value.items : [value];
  items.forEach((item, i) => {
    emitLiteral(out, item, isList(value) ? idx(path, i) : path, position);
  });
  return true;
}

/**
 * Dispatch one property of a complex through the FHIR PHI rules.
 *
 * @param elementPath - The R4 element path of this property (see {@link walkComplex}).
 */
function handleProperty(
  out: FhirLocusAccumulator,
  name: string,
  value: FhirNode,
  path: string,
  personCtx: boolean,
  isPersonTop: boolean,
  parent: ParentFacts,
  elementPath: string,
): void {
  const { parentIsCoding } = parent;
  if (name === "resourceType") {
    // Retained (structural), and NAMED: the walk reads it to derive the person/clinical role at every
    // resource boundary, so the discriminant is a position the pass examined rather than one it missed.
    out.ruleReached.add(value);
    return;
  }
  if (handleLogicalIds(out, name, value, path, personCtx, isPersonTop, parent, elementPath)) return;
  if (name === "extension" || name === "modifierExtension") {
    blockExtension(out, value, path);
    return;
  }
  if (name === "text" && isNarrative(value)) {
    blockNarrativeDiv(out, value, path);
    return;
  }
  if (name === "note") {
    blockFreeText(out, value, path); // Annotation free-text (text + author + time): fail closed as a unit
    return;
  }
  if (name === "identifier") {
    handleIdentifiers(out, value, path);
    return;
  }
  if (name === "display" && !parentIsCoding && isPrimitive(value)) {
    // A `display` that is not on a Coding is a Reference label (a person name): fail closed. This
    // catches a display-only / type+display Reference that carries neither `reference` nor `identifier`.
    blockNode(out, value, path);
    return;
  }
  if (name === "display" && parentIsCoding && isPrimitive(value)) {
    // The mirror decision: a Coding's `display` is a coded term (`Sodium`), positively identified as one
    // by a `code` or `system` sibling and kept on purpose. Naming it is all that happens here; the
    // dispatch continues exactly as it did, so what the pass emits is untouched by the measurement.
    out.ruleReached.add(value);
  }
  if (FREE_TEXT_STRING_ELEMENTS.has(name) && isStringPrimitive(value)) {
    blockFreeText(out, value, path); // uncoded free-text string (contentString / valueString)
    return;
  }
  if (personCtx && FHIR_DEMOGRAPHIC_ELEMENTS[name] !== undefined) {
    handleDemographic(out, name, value, path);
    return;
  }
  if (handleAgesAndBirthDates(out, name, value, path, personCtx, parent, elementPath)) return;
  // Outside a person resource the DATATYPE decides: a `HumanName` or an `Address` is acted on wherever
  // the graph put it, so coverage stops depending on whether a producer shaped the document the way
  // the person map expected.
  if (!personCtx && sweepPersonalDatatypes(out, name, value, path, elementPath)) return;
  // A date-shaped primitive anywhere is a PHI date → generalized (fail closed on dates). A date of
  // birth by name, or a value its own observation codes as one, is marked so an over-89 year goes.
  const dateOfBirth =
    FHIR_BIRTH_DATE_ELEMENTS.has(name) ||
    (name === "valueDateTime" && parent.codedAs === "birth-date");
  if (isPrimitive(value) && dateEmit(out, value, path, dateOfBirth)) return;
  // Fail-closed person sweep: a bare string at a person resource's top level is blocked unless it is a
  // code the pass can check at an element R4 types as that code (`keepsPersonString`). A recognized
  // element name is not enough: a string where R4 puts a structure (`link`, `contact`), or a gender
  // outside its value set, is a shape no rule here reads, and it is removed rather than kept.
  if (isPersonTop && isStringPrimitive(value)) {
    if (!keepsPersonString(name, primitiveString(value))) {
      blockNode(out, value, path);
      return;
    }
    // The other half of that sweep: a checked code is kept by name, which is a decision at the
    // position and not a silence, so it is examined.
    out.ruleReached.add(value);
  }
  // Otherwise descend (universal rules apply within); a retained scalar code/boolean is left untouched.
  walkValue(out, value, path, personCtx, elementPath);
}

/** The R4 `AdministrativeGender` codes, a required binding on every person resource's `gender`. */
const ADMINISTRATIVE_GENDER: ReadonlySet<string> = new Set(["male", "female", "other", "unknown"]);

/**
 * The primary language subtags a person resource's `language` may start with: the 184 two-letter
 * language codes of ISO 639-1, written out here. A fixed list, so a short name (`Smith`, `Mary-Ann`) is
 * not read as a language because it is a run of letters. Three-letter primary subtags are not on it,
 * and a tag that starts with one is removed.
 */
const LANGUAGE_PRIMARY_SUBTAGS: ReadonlySet<string> = new Set(
  (
    "aa ab ae af ak am an ar as av ay az ba be bg bh bi bm bn bo br bs ca ce ch co cr cs cu cv cy " +
    "da de dv dz ee el en eo es et eu fa ff fi fj fo fr fy ga gd gl gn gu gv ha he hi ho hr ht hu " +
    "hy hz ia id ie ig ii ik io is it iu ja jv ka kg ki kj kk kl km kn ko kr ks ku kv kw ky la lb lg " +
    "li ln lo lt lu lv mg mh mi mk ml mn mr ms mt my na nb nd ne ng nl nn no nr nv ny oc oj om or os " +
    "pa pi pl ps pt qu rm rn ro ru rw sa sc sd se sg si sk sl sm sn so sq sr ss st su sv sw ta te tg " +
    "th ti tk tl tn to tr ts tt tw ty ug uk ur uz ve vi vo wa wo xh yi yo za zh zu"
  ).split(" "),
);

/**
 * A language tag in the canonical form R4's `Resource.language` binding (BCP-47) writes one: a primary
 * subtag in small letters, then optionally a script (four letters, the first a capital) and a region
 * (two capitals, or three digits). No variant, extension or private-use subtag: those are free runs of
 * letters and digits.
 */
const LANGUAGE_TAG = /^[a-z]{2}(-[A-Z][a-z]{3})?(-(?:[A-Z]{2}|[0-9]{3}))?$/;

/** Whether a string is a language tag {@link LANGUAGE_TAG} accepts, from {@link LANGUAGE_PRIMARY_SUBTAGS}. */
function isLanguageTag(value: string): boolean {
  // The pattern fixes the primary subtag at the first two characters.
  return LANGUAGE_TAG.test(value) && LANGUAGE_PRIMARY_SUBTAGS.has(value.slice(0, 2));
}

/**
 * Whether a string at a person resource's top level is kept: only a `gender` in its required value set
 * and a `language` that is a language tag from a fixed list of primary subtags ({@link isLanguageTag}).
 * Every other string there is removed, at an element R4 types as a structure, a reference, a boolean or
 * a number, and at `implicitRules` too, a URI the pass cannot check. A date there is decided before
 * this, by the date rule.
 */
function keepsPersonString(name: string, value: string): boolean {
  if (!RECOGNIZED_PERSON_ELEMENTS.has(name)) return false;
  if (name === "gender") return ADMINISTRATIVE_GENDER.has(value);
  if (name === "language") return isLanguageTag(value);
  return false;
}

/**
 * Walk a complex, re-deriving the person/clinical role at a `resourceType` boundary.
 *
 * @param elementPath - The R4 element path of this complex, built from the raw element names with no
 *   list index (`CapabilityStatement.messaging.endpoint`). It starts again at every `resourceType`
 *   boundary, so a contained resource or a Bundle entry has its own. It is only ever compared with a
 *   fixed set and never reaches the manifest, which takes `path`.
 * @param decided - Properties a rule already decided before the walk (an age quantity's `value`), so
 *   the walk does not reach them a second time.
 */
function walkComplex(
  out: FhirLocusAccumulator,
  complex: FhirComplex,
  path: string,
  personCtx: boolean,
  elementPath: string,
  decided: ReadonlySet<string> = NONE_DECIDED,
): void {
  const rt = resourceType(complex);
  const ownPath = rt ?? elementPath;
  const ctx = rt !== undefined ? PERSON_RESOURCE_TYPES.has(rt) : personCtx;
  const isPersonTop = rt !== undefined && ctx; // fail-closed scalar block only at a person resource root
  const parent: ParentFacts = {
    parentIsCoding: isCodingComplex(complex),
    codedAs: codedAs(complex),
    residence: rt === "Location" && locationMayBeResidence(complex),
    resource: rt !== undefined,
  };
  complex.properties.forEach((prop, i) => {
    if (decided.has(prop.name)) return;
    // The rule dispatch reads the RAW name (a set lookup can never interpolate it); only the path
    // segment is bounded, because that is the one that reaches the manifest.
    handleProperty(
      out,
      prop.name,
      prop.value,
      join(path, elementSegment(prop.name, i)),
      ctx,
      isPersonTop,
      parent,
      `${ownPath}.${prop.name}`,
    );
  });
}

/**
 * Collect the server bases the input's own `Bundle.entry.fullUrl`s name, in every `Bundle` at any
 * depth. Read before the walk, because a reference can come before the entry it points at.
 */
function fullUrlBases(resource: FhirComplex): ReadonlySet<string> {
  const bases = new Set<string>();
  const visit = (node: FhirNode): void => {
    if (isList(node)) {
      node.items.forEach(visit);
      return;
    }
    if (!isComplex(node)) return;
    const entries = resourceType(node) === "Bundle" ? getProperty(node, "entry") : undefined;
    for (const entry of entries === undefined ? [] : isList(entries) ? entries.items : [entries]) {
      const fullUrl = isComplex(entry) ? getProperty(entry, "fullUrl") : undefined;
      if (fullUrl === undefined || !isPrimitive(fullUrl)) continue;
      const literal = readFhirLiteral(primitiveString(fullUrl), false);
      if (literal?.kind === "id" && literal.base !== undefined) bases.add(literal.base);
    }
    for (const prop of node.properties) visit(prop.value);
  };
  visit(resource);
  return bases;
}

/**
 * Walk a parsed FHIR resource (or `Bundle`) and extract every PHI-bearing (or fail-closed) locus,
 * structurally, from the `@cosyte/fhir` model. Never mutates the tree: the applier rebuilds a fresh
 * tree from the returned coordinates.
 *
 * The tree is also **enumerated**: every primitive carrying a value that no rule above named is counted
 * and located as an unexamined residual. The clinical resources are the bulk of that, and honestly so:
 * this adapter has no `clinical` locus at all, it simply descends past a code, a unit and a status
 * without deciding anything, so those positions are unexamined and the measurement says so.
 *
 * @param resource - The parsed FHIR resource (`parseResource(json).resource`).
 * @returns The loci (for the engine), their index-aligned write-back coordinates, and the unexamined
 *   residual positions the pass hands through.
 * @throws {@link DeidError} `DEID_POSITIONS_UNENUMERABLE` when the resource's value-bearing positions
 *   cannot be enumerated: the pass fails rather than emit a zero or a partial count.
 * @example
 * ```ts
 * import { parseResource } from "@cosyte/fhir";
 * import { extractFhirLoci } from "@cosyte/deid/fhir";
 *
 * const { resource } = parseResource(json);
 * const { loci } = extractFhirLoci(resource);
 * loci.length; // number of located candidate values
 * ```
 */
export function extractFhirLoci(resource: FhirComplex): FhirExtraction {
  const out: FhirLocusAccumulator = {
    loci: [],
    coords: [],
    ruleReached: new Set<FhirNode>(),
    bases: fullUrlBases(resource),
  };
  // `resourceType` is a JSON string VALUE, not a checked identifier, and it is the ROOT of every path
  // in the manifest, so an unbounded one prefixes the whole audit with document content.
  const rt = safeLocusToken(resourceType(resource) ?? "", "fhirElementName");
  walkComplex(out, resource, rt, false, "");

  const residuals = new UnexaminedResidualBuilder();
  enumerateOrFail(rt, () => {
    const edits = new Map<FhirNode, FhirEditKind>();
    for (const coord of out.coords) edits.set(coord.node, coord.edit);
    recordUnexaminedFhirPositions(residuals, resource, rt, {
      edits,
      ruleReached: out.ruleReached,
      valueDecided: false,
    });
  });
  return { loci: out.loci, coords: out.coords, unexaminedResiduals: residuals.build() };
}

/**
 * What each of the applier's edits does to the node its coordinate names, which is the only thing that
 * lets the enumeration stop descending.
 *
 * - `replaces-node`: the node is removed, or replaced by one this library composes. Nothing that arrived
 *   at or below it reaches the output - not its value, not its `_`-sibling metadata.
 * - `rebuilds-address`: the `Address` complex is rebuilt from its parts. The finer geographic parts are
 *   dropped and `postalCode` is replaced, but every part in {@link FHIR_KEPT_ADDRESS_PARTS} is re-emitted
 *   **verbatim**, so its metadata rides through and is enumerated.
 *
 * A `Record` keyed by {@link FhirEditKind} makes this **exhaustive**: a new edit cannot be added without
 * deciding here what it hands through, which is what keeps the enumeration closed rather than merely
 * correct today.
 */
const EDIT_REACH: Readonly<Record<FhirEditKind, "replaces-node" | "rebuilds-address">> = {
  drop: "replaces-node",
  "set-primitive": "replaces-node",
  address: "rebuilds-address",
  age: "replaces-node",
  reference: "replaces-node",
};

/** What the enumeration carries down the tree: the pass's decisions, and whether a value was decided. */
interface FhirEnumerationState {
  /** The edit each coordinate wrote, keyed by the node it names. */
  readonly edits: ReadonlyMap<FhirNode, FhirEditKind>;
  /** Nodes a rule reached without editing them: their VALUE is examined, their metadata is not. */
  readonly ruleReached: ReadonlySet<FhirNode>;
  /** `true` when a rule already decided the value at (or above) this node. */
  readonly valueDecided: boolean;
}

/**
 * The `_`-sibling spelling of a primitive's path: FHIR JSON carries a primitive's `id` and `extension`
 * on a sibling key prefixed with `_`, so `Observation.status`'s metadata sits at `Observation._status`.
 *
 * Composed from the value-free path this module already built, by prefixing the last segment. The result
 * is a coordinate a reader can look up in the wire, and it carries no more document content than the
 * path it is derived from.
 */
function underscoreSibling(path: string): string {
  const cut = path.lastIndexOf(".");
  return cut === -1 ? `_${path}` : `${path.slice(0, cut + 1)}_${path.slice(cut + 1)}`;
}

/**
 * Record the positions a primitive's **`_`-sibling metadata** hands through.
 *
 * `@cosyte/fhir` models the JSON `_`-sibling as first-class metadata on the primitive
 * (`FhirPrimitive.id`, `FhirPrimitive.extension`) rather than as a literal `_`-prefixed key, so a walk
 * that reads `value` and returns at the leaf never sees it. Both are document values that can reach the
 * output, and which of them does is decided by the applier, not by this module:
 *
 * - **`id` always rides through.** Every primitive the applier re-emits is rebuilt keeping its value and
 *   its `id`, so a primitive that survives at all survives with its element id, whatever the pass decided
 *   about the value beside it.
 * - **`extension` rides through only where the applier re-emits the primitive verbatim**, which is the
 *   kept part of a rebuilt `Address`. Everywhere else the applier's primitive-extension guard drops it,
 *   and a position the pass removes is not one it hands through.
 */
function recordPrimitiveMetadata(
  residuals: UnexaminedResidualBuilder,
  node: FhirPrimitive,
  path: string,
  state: FhirEnumerationState,
  verbatim: boolean,
): void {
  const meta = underscoreSibling(path);
  if ((node.id ?? "").length > 0) residuals.record(join(meta, "id"));
  if (!verbatim) return;
  (node.extension ?? []).forEach((ext, i) => {
    recordUnexaminedFhirPositions(residuals, ext, idx(join(meta, "extension"), i), {
      ...state,
      valueDecided: false,
    });
  });
}

/**
 * Enumerate every value-bearing position of the resource tree and record the ones no locus rule named.
 *
 * A **position** here is one **primitive carrying a non-empty value**, plus the two places FHIR JSON
 * lets a value sit beside one: the `_`-sibling element `id` and, where the applier re-emits a primitive
 * verbatim, its `_`-sibling extensions ({@link recordPrimitiveMetadata}).
 *
 * The descent stops **only where the applier replaces the node**, which is a fact about the edit
 * ({@link EDIT_REACH}) rather than about the rule that produced it. A rule that merely *reached* a
 * position decides that position's value and nothing else: the primitive is still re-emitted, so its
 * metadata is still handed through and is still measured.
 */
function recordUnexaminedFhirPositions(
  residuals: UnexaminedResidualBuilder,
  node: FhirNode,
  path: string,
  state: FhirEnumerationState,
): void {
  const edit = state.edits.get(node);
  // The node (and everything under it) is removed or replaced: nothing here reaches the output.
  if (edit !== undefined && EDIT_REACH[edit] === "replaces-node") return;
  const valueDecided = state.valueDecided || state.ruleReached.has(node);

  if (isPrimitive(node)) {
    if (!valueDecided && primitiveString(node).length > 0) residuals.record(path);
    recordPrimitiveMetadata(residuals, node, path, state, false);
    return;
  }
  if (edit !== undefined && isComplex(node)) {
    recordKeptAddressParts(residuals, node, path, state);
    return;
  }
  if (isList(node)) {
    node.items.forEach((item, i) => {
      recordUnexaminedFhirPositions(residuals, item, idx(path, i), { ...state, valueDecided });
    });
    return;
  }
  node.properties.forEach((prop, i) => {
    recordUnexaminedFhirPositions(residuals, prop.value, join(path, elementSegment(prop.name, i)), {
      ...state,
      valueDecided,
    });
  });
}

/**
 * Enumerate what a rebuilt `Address` hands through: the parts Safe Harbor permits it to keep, which the
 * applier re-emits **verbatim** rather than rebuilding.
 *
 * The rule decided about each part's VALUE - keep the state and the country, drop the line and the city,
 * generalize the ZIP - so no part's value is a residual. It decided nothing about the metadata riding
 * beside a kept value, and the applier's verbatim re-emission carries that metadata into the output, so
 * the `_`-sibling `id` and extensions of a kept part are exactly the positions this measures. A dropped
 * part and the replaced `postalCode` contribute nothing: they do not reach the output at all.
 */
function recordKeptAddressParts(
  residuals: UnexaminedResidualBuilder,
  node: FhirComplex,
  path: string,
  state: FhirEnumerationState,
): void {
  node.properties.forEach((prop, i) => {
    if (!FHIR_KEPT_ADDRESS_PARTS.has(prop.name)) return;
    const partPath = join(path, elementSegment(prop.name, i));
    if (isPrimitive(prop.value)) {
      recordPrimitiveMetadata(residuals, prop.value, partPath, state, true);
      return;
    }
    // Not a primitive: the whole part is re-emitted verbatim, so every value inside it is handed
    // through and none of it was decided.
    recordUnexaminedFhirPositions(residuals, prop.value, partPath, {
      ...state,
      valueDecided: false,
    });
  });
}
