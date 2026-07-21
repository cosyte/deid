/**
 * The FHIR **extractor** — walks a parsed `@cosyte/fhir` resource (the generic `FhirComplex` element
 * tree the sibling parser produces) and yields the format-agnostic {@link GenericLocus} list the core
 * engine transforms, plus a **parallel coordinate list** ({@link FhirCoord}) holding a direct handle to
 * the exact node each locus came from and how the applier must write it back. Loci and coordinates are
 * produced in the same order, so `result.document.loci[i]` corresponds to `coords[i]`.
 *
 * PHI is located **structurally**, per the cited {@link "./locus-map.js"}: the demographic elements
 * (`name` / `telecom` / `address` / `photo` / dates) of the **person resources**
 * (`Patient` / `RelatedPerson` / `Practitioner` / `Person`, plus the nested `Patient.contact` relative —
 * §4.6), and the **universal** vectors that leak from any resource — `identifier`, PHI-bearing dates,
 * the narrative `text.div`, extension values, and a `Reference.display`. The **fail-closed** rule
 * governs the person sweep: a value-bearing top-level person-resource property that is neither mapped
 * PHI nor on the recognized allow-list is blocked. Everything else — the codes, values, units, and
 * statuses of the clinical resources — is left untouched (the over-scrub guard). Contained resources and
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
import type { GenericLocus } from "../locus.js";
import {
  FHIR_DATE_CATEGORY,
  FHIR_DEMOGRAPHIC_ELEMENTS,
  PERSON_RESOURCE_TYPES,
  RECOGNIZED_PERSON_ELEMENTS,
  categoryForIdentifierSystem,
  isFhirDateValue,
} from "./locus-map.js";

/**
 * How the applier rewrites one extracted locus onto a fresh copy of the node it came from:
 *
 * - `drop` — remove the node entirely (a redacted `name`/`telecom`/`photo` property, a blocked
 *   extension value, a blocked `Reference.display`, a blocked unknown person string, a blocked
 *   narrative `div`, or a redacted SSN `Identifier.value`). The parent complex omits the property; a
 *   parent list omits the item.
 * - `set-primitive` — replace a primitive's value with the transformed string (a generalized date, a
 *   pseudonymized `Identifier.value`); a `null` transform result degrades to `drop`.
 * - `address` — rebuild an `Address` complex, keeping `state`/`country` and the generalized 3-digit
 *   `postalCode`, dropping every finer geographic component.
 */
export type FhirEditKind = "drop" | "set-primitive" | "address";

/**
 * A write-back coordinate — a direct handle to the exact model node one extracted locus came from, plus
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
}

/** Append a locus + its coordinate to the accumulator. */
function push(out: FhirExtraction, locus: GenericLocus, coord: FhirCoord): void {
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

/** The string form of a primitive value (`FhirDecimal` → its exact lexical text). `""` when absent. */
function primitiveString(p: FhirPrimitive): string {
  const v = p.value;
  if (v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "boolean") return v ? "true" : "false";
  return v.raw; // FhirDecimal — exact lexical text, never routed through a JS number
}

/** `true` when a primitive carries a (non-empty) string value — the shape a bare-PHI leak takes. */
function isStringPrimitive(node: FhirNode): node is FhirPrimitive {
  return isPrimitive(node) && typeof node.value === "string" && node.value.length > 0;
}

/** Concatenate every primitive string value in a subtree (for a value-free locus/count — consumed, never emitted). */
function collectText(node: FhirNode): string {
  if (isPrimitive(node)) return primitiveString(node);
  if (isList(node)) return node.items.map(collectText).join(" ");
  return node.properties.map((p) => collectText(p.value)).join(" ");
}

/**
 * `true` when a complex is a FHIR `Coding` — the one element whose `display` is a coded term to retain
 * (`Sodium`), positively identified by a `code` or `system` sibling (the two properties that define a
 * Coding, and that a `Reference` never carries). Every other complex bearing a `display` is treated as a
 * `Reference` — including a **display-only** (`{ display }`) or **type+display** (`{ type, display }`)
 * reference that carries neither `reference` nor `identifier` — so its `display` (a person label) **fails
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
function blockNode(out: FhirExtraction, node: FhirNode, path: string): void {
  push(out, { path, kind: "unknown", value: collectText(node) }, { node, edit: "drop" });
}

/**
 * Leaf string element names that carry **human free-text prose** — blocked by default (roadmap §4.5):
 * a `contentString` (a `Communication`/message body) and a `valueString` (an *uncoded* string result,
 * the direct FHIR analogue of an HL7 OBX-5 typed `ST`, which the sibling HL7 adapter also fails closed
 * on — a structured `valueQuantity` / `valueCodeableConcept` / `valueDateTime` result is retained). A
 * free-text field can carry any of the 18 categories in prose, so a naive scrub is a false-safety
 * hazard; the v1 default blocks. `Annotation` free-text (the `note` element) is handled separately.
 */
const FREE_TEXT_STRING_ELEMENTS: ReadonlySet<string> = new Set<string>([
  "contentString",
  "valueString",
]);

/** Emit a fail-closed **free-text** block locus (engine → `DEID_FREETEXT_BLOCKED`). */
function blockFreeText(out: FhirExtraction, node: FhirNode, path: string): void {
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
function dateEmit(out: FhirExtraction, node: FhirPrimitive, path: string): boolean {
  const v = primitiveString(node);
  if (!isFhirDateValue(v)) return false;
  push(
    out,
    { path, kind: "date", category: FHIR_DATE_CATEGORY, value: v },
    { node, edit: "set-primitive" },
  );
  return true;
}

/** Extract one `Identifier` complex — the `value` primitive, routed to SSN (redact) or MRN (pseudonymize). */
function handleIdentifier(out: FhirExtraction, id: FhirComplex, path: string): void {
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

/** Handle an `identifier` property — one locus per `Identifier` in the list (or a single complex). */
function handleIdentifiers(out: FhirExtraction, value: FhirNode, path: string): void {
  const items = isList(value) ? value.items : [value];
  items.forEach((item, i) => {
    if (!isComplex(item)) return;
    handleIdentifier(out, item, items.length > 1 ? idx(path, i) : path);
  });
}

/** Handle an `address` property — one generalize locus per `Address` complex (ZIP → safe 3-digit form). */
function handleAddresses(out: FhirExtraction, value: FhirNode, path: string): void {
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
function handleDemographic(out: FhirExtraction, name: string, value: FhirNode, path: string): void {
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
 * extension), and the reader preserves unknown extensions verbatim — so the value is dropped
 * unconditionally (roadmap §Phase 4: fail closed on an unknown extension carrying a value).
 */
function blockExtension(out: FhirExtraction, value: FhirNode, path: string): void {
  if (isList(value)) {
    value.items.forEach((item, i) => blockExtension(out, item, idx(path, i)));
    return;
  }
  if (isPrimitive(value)) {
    // A bare primitive where an extension object is expected is malformed input — fail closed and block
    // it (it could carry any PHI), rather than let the unexpected shape ride through.
    if (primitiveString(value).length > 0) blockNode(out, value, path);
    return;
  }
  if (!isComplex(value)) return;
  for (const prop of value.properties) {
    if (prop.name === "url") continue; // structural — a definitional URI, never PHI
    if (prop.name === "extension" || prop.name === "modifierExtension") {
      blockExtension(out, prop.value, join(path, prop.name)); // nested extension — recurse
      continue;
    }
    if (prop.name.startsWith("value")) {
      blockNode(out, prop.value, join(path, prop.name)); // value[x] — the PHI payload, dropped
    }
    // any other extension child (id) is structural and retained
  }
}

/** Block the `div` of a `Narrative` (rendered PHI) — at any depth (resource-, section-, entry-level). */
function blockNarrativeDiv(out: FhirExtraction, narrative: FhirComplex, path: string): void {
  const div = getProperty(narrative, "div");
  if (div !== undefined && isPrimitive(div)) {
    blockNode(out, div, join(path, "div"));
  }
}

/** Recurse into a list value, applying the property rules to each item in document order. */
function walkList(out: FhirExtraction, value: FhirNode, path: string, personCtx: boolean): void {
  if (!isList(value)) return;
  value.items.forEach((item, i) => walkValue(out, item, idx(path, i), personCtx));
}

/** Recurse into a value node reached during descent (a list item or a non-mapped complex/primitive). */
function walkValue(out: FhirExtraction, node: FhirNode, path: string, personCtx: boolean): void {
  if (isComplex(node)) {
    walkComplex(out, node, path, personCtx);
    return;
  }
  if (isList(node)) {
    walkList(out, node, path, personCtx);
    return;
  }
  // a bare primitive reached during descent — generalize it only if it is a date (else retained).
  dateEmit(out, node, path);
}

/** Dispatch one property of a complex through the FHIR PHI rules. */
function handleProperty(
  out: FhirExtraction,
  name: string,
  value: FhirNode,
  path: string,
  personCtx: boolean,
  isPersonTop: boolean,
  parentIsCoding: boolean,
): void {
  if (name === "resourceType") return; // retained (structural)
  if (name === "extension" || name === "modifierExtension") {
    blockExtension(out, value, path);
    return;
  }
  if (name === "text" && isNarrative(value)) {
    blockNarrativeDiv(out, value, path);
    return;
  }
  if (name === "note") {
    blockFreeText(out, value, path); // Annotation free-text (text + author + time) — fail closed as a unit
    return;
  }
  if (name === "identifier") {
    handleIdentifiers(out, value, path);
    return;
  }
  if (name === "display" && !parentIsCoding && isPrimitive(value)) {
    // A `display` that is not on a Coding is a Reference label (a person name) — fail closed. This
    // catches a display-only / type+display Reference that carries neither `reference` nor `identifier`.
    blockNode(out, value, path);
    return;
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
  // Otherwise descend (universal rules apply within); a retained scalar code/boolean is left untouched.
  walkValue(out, value, path, personCtx);
}

/** Walk a complex, re-deriving the person/clinical role at a `resourceType` boundary. */
function walkComplex(
  out: FhirExtraction,
  complex: FhirComplex,
  path: string,
  personCtx: boolean,
): void {
  const rt = resourceType(complex);
  const ctx = rt !== undefined ? PERSON_RESOURCE_TYPES.has(rt) : personCtx;
  const isPersonTop = rt !== undefined && ctx; // fail-closed scalar block only at a person resource root
  const parentIsCoding = isCodingComplex(complex);
  for (const prop of complex.properties) {
    handleProperty(
      out,
      prop.name,
      prop.value,
      join(path, prop.name),
      ctx,
      isPersonTop,
      parentIsCoding,
    );
  }
}

/**
 * Walk a parsed FHIR resource (or `Bundle`) and extract every PHI-bearing (or fail-closed) locus,
 * structurally, from the `@cosyte/fhir` model. Never mutates the tree — the applier rebuilds a fresh
 * tree from the returned coordinates.
 *
 * @param resource - The parsed FHIR resource (`parseResource(json).resource`).
 * @returns The loci (for the engine) and their index-aligned write-back coordinates.
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
  const out: FhirExtraction = { loci: [], coords: [] };
  const rt = resourceType(resource) ?? "";
  walkComplex(out, resource, rt, false);
  return out;
}
