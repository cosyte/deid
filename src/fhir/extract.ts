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
 * the narrative `text.div`, extension values, and a `Reference.display`. The **fail-closed** rule
 * governs the person sweep: a value-bearing top-level person-resource property that is neither mapped
 * PHI nor on the recognized allow-list is blocked. Everything else: the codes, values, units, and
 * statuses of the clinical resources: is left untouched (the over-scrub guard). Contained resources and
 * Bundle entries are walked by re-deriving the resource role at every `resourceType` boundary.
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

import { SAFE_HARBOR_CATEGORIES } from "../categories.js";
import { isWithheldToken, safeLocusToken } from "../derived-token.js";
import type { GenericLocus } from "../locus.js";
import {
  enumerateOrFail,
  UnexaminedResidualBuilder,
  type UnexaminedResidual,
} from "../residual.js";
import {
  FHIR_DATE_CATEGORY,
  FHIR_DEMOGRAPHIC_ELEMENTS,
  FHIR_KEPT_ADDRESS_PARTS,
  PERSON_RESOURCE_TYPES,
  RECOGNIZED_PERSON_ELEMENTS,
  categoryForIdentifierSystem,
  isFhirDateValue,
} from "./locus-map.js";

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
 */
export type FhirEditKind = "drop" | "set-primitive" | "address";

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
}

/** Append a locus + its coordinate to the accumulator. */
function push(out: FhirLocusAccumulator, locus: GenericLocus, coord: FhirCoord): void {
  out.loci.push(locus);
  out.coords.push(coord);
}

/** Join a running value-free path with a child segment. */
function join(base: string, seg: string): string {
  return base === "" ? seg : `${base}.${seg}`;
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

/** The string form of a primitive value (`FhirDecimal` → its exact lexical text). `""` when absent. */
function primitiveString(p: FhirPrimitive): string {
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

/** Emit a date locus for a primitive whose value is a real calendar date; returns `true` if it did. */
function dateEmit(out: FhirLocusAccumulator, node: FhirPrimitive, path: string): boolean {
  const v = primitiveString(node);
  if (!isFhirDateValue(v)) return false;
  push(
    out,
    { path, kind: "date", category: FHIR_DATE_CATEGORY, value: v },
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

/** Handle an `identifier` property: one locus per `Identifier` in the list (or a single complex). */
function handleIdentifiers(out: FhirLocusAccumulator, value: FhirNode, path: string): void {
  const items = isList(value) ? value.items : [value];
  items.forEach((item, i) => {
    if (!isComplex(item)) return;
    handleIdentifier(out, item, items.length > 1 ? idx(path, i) : path);
  });
}

/** Handle an `address` property: one generalize locus per `Address` complex (ZIP → safe 3-digit form). */
function handleAddresses(out: FhirLocusAccumulator, value: FhirNode, path: string): void {
  const items = isList(value) ? value.items : [value];
  items.forEach((item, i) => {
    if (!isComplex(item)) return;
    const postal = getProperty(item, "postalCode");
    const zip = postal !== undefined && isPrimitive(postal) ? primitiveString(postal) : "";
    push(
      out,
      {
        path: items.length > 1 ? idx(path, i) : path,
        kind: "zip",
        category: SAFE_HARBOR_CATEGORIES.GEOGRAPHIC,
        value: zip,
      },
      { node: item, edit: "address" },
    );
  });
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
): void {
  if (!isList(value)) return;
  value.items.forEach((item, i) => walkValue(out, item, idx(path, i), personCtx));
}

/** Recurse into a value node reached during descent (a list item or a non-mapped complex/primitive). */
function walkValue(
  out: FhirLocusAccumulator,
  node: FhirNode,
  path: string,
  personCtx: boolean,
): void {
  if (isComplex(node)) {
    walkComplex(out, node, path, personCtx);
    return;
  }
  if (isList(node)) {
    walkList(out, node, path, personCtx);
    return;
  }
  // a bare primitive reached during descent: generalize it only if it is a date (else retained).
  dateEmit(out, node, path);
}

/** Dispatch one property of a complex through the FHIR PHI rules. */
function handleProperty(
  out: FhirLocusAccumulator,
  name: string,
  value: FhirNode,
  path: string,
  personCtx: boolean,
  isPersonTop: boolean,
  parentIsCoding: boolean,
): void {
  if (name === "resourceType") {
    // Retained (structural), and NAMED: the walk reads it to derive the person/clinical role at every
    // resource boundary, so the discriminant is a position the pass examined rather than one it missed.
    out.ruleReached.add(value);
    return;
  }
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
  // A date-shaped primitive anywhere is a PHI date → generalized (fail closed on dates).
  if (isPrimitive(value) && dateEmit(out, value, path)) return;
  // Fail-closed person sweep: a bare unrecognized string at a person resource's top level is blocked.
  if (isPersonTop && isStringPrimitive(value) && !RECOGNIZED_PERSON_ELEMENTS.has(name)) {
    blockNode(out, value, path);
    return;
  }
  // The other half of that sweep: a string the person allow-list DOES recognize is kept by name, which
  // is a decision at the position and not a silence, so it is examined.
  if (isPersonTop && isStringPrimitive(value) && RECOGNIZED_PERSON_ELEMENTS.has(name)) {
    out.ruleReached.add(value);
  }
  // Otherwise descend (universal rules apply within); a retained scalar code/boolean is left untouched.
  walkValue(out, value, path, personCtx);
}

/** Walk a complex, re-deriving the person/clinical role at a `resourceType` boundary. */
function walkComplex(
  out: FhirLocusAccumulator,
  complex: FhirComplex,
  path: string,
  personCtx: boolean,
): void {
  const rt = resourceType(complex);
  const ctx = rt !== undefined ? PERSON_RESOURCE_TYPES.has(rt) : personCtx;
  const isPersonTop = rt !== undefined && ctx; // fail-closed scalar block only at a person resource root
  const parentIsCoding = isCodingComplex(complex);
  complex.properties.forEach((prop, i) => {
    // The rule dispatch reads the RAW name (a set lookup can never interpolate it); only the path
    // segment is bounded, because that is the one that reaches the manifest.
    handleProperty(
      out,
      prop.name,
      prop.value,
      join(path, elementSegment(prop.name, i)),
      ctx,
      isPersonTop,
      parentIsCoding,
    );
  });
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
  const out: FhirLocusAccumulator = { loci: [], coords: [], ruleReached: new Set<FhirNode>() };
  // `resourceType` is a JSON string VALUE, not a checked identifier, and it is the ROOT of every path
  // in the manifest, so an unbounded one prefixes the whole audit with document content.
  const rt = safeLocusToken(resourceType(resource) ?? "", "fhirElementName");
  walkComplex(out, resource, rt, false);

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
