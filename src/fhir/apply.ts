/**
 * The FHIR **applier**: rebuilds a fresh, de-identified `@cosyte/fhir` resource tree from the engine's
 * transformed loci and the extractor's write-back coordinates. The `@cosyte/fhir` model is **immutable**
 * (every node is deeply `readonly`), so, unlike the HL7 / C-CDA appliers, which edit a cloned mutable
 * tree, this applier **reconstructs** the tree: it recurses the original nodes and, guided by a
 * node-identity map, emits new {@link "@cosyte/fhir".FhirComplex} / `FhirList` / `FhirPrimitive` nodes.
 * The caller's model is therefore never touched.
 *
 * Each coordinate names the exact node to rewrite and how:
 *
 * - `drop`, with a `null` value the node is omitted (a redacted `name`/`telecom`/`photo`, a blocked
 *   extension value, a blocked `Reference.display`, a blocked narrative `div`, a blocked unknown person
 *   string, a redacted SSN `Identifier.value`). A dropped property vanishes from its complex; a dropped
 *   list item from its list; a list that empties is dropped in turn. With a **non-null** value the locus
 *   is a **BYO-redacted free-text** locus: the redacted prose is written back in place
 *   (a `contentString`/`valueString` primitive stays a primitive; a `note` Annotation/array becomes a
 *   `text`-only Annotation, dropping author/time).
 * - `set-primitive`: the primitive's value becomes the transformed string (a generalized date, a
 *   pseudonymized `Identifier.value`); a `null` result degrades to a drop.
 * - `address`: the `Address` complex is rebuilt to `state` + `country` + the generalized 3-digit
 *   `postalCode`, dropping every finer geographic component. A kept `state` or `country` keeps its
 *   `_`-sibling `id` and extensions, each extension rebuilt through the same edits, so what the
 *   extractor blocked in one is gone.
 * - `age`: the `value` of an age `Quantity` is kept exactly as it arrived when the pass kept the age,
 *   and dropped otherwise (an age over 89, an age it could not read, or a surrogate a custom policy
 *   computed, which a number cannot hold).
 * - `reference`: a literal carrying a logical id is rebuilt as the structure around the id followed by
 *   the replacement, with any `/_history/vid` suffix dropped; a `null` result drops it.
 *
 * **Primitive-extension guard.** A FHIR primitive can carry an `extension` (the JSON `_`-sibling) that
 * holds PHI (`_birthDate.extension[…]`). The structural walk does not descend that side-channel, so the
 * applier **fails closed**: every primitive it writes is built anew from its value and its element `id`
 * alone, **without** its `extension` metadata. The one exception is a part a rebuilt `Address` keeps,
 * whose extensions the extractor walks and blocks like every other extension, and which are rebuilt
 * through the same edits. Nothing else the reader kept on a primitive reaches the output: a
 * `_`-sibling that arrived as a string, a number, a boolean, a `null` or a list rather than an object
 * is not written back (the extractor records it as a block at its own locus). Primitive extensions are
 * uncommon and demographic/annotative; dropping them guarantees no `_`-sibling leak, at the documented
 * cost of not preserving them (profile-aware retention is not offered).
 *
 * **Transform labels (opt-in).** With `transformLabels`, every resource the rebuild changed (a value
 * transformed, removed or blocked, or a primitive extension dropped) gets the `meta.security` coding
 * `FHIR_TRANSFORMED_SECURITY_LABEL`; a contained resource is never labeled (R4 `dom-5`), and
 * what changed inside one counts for the resource that contains it. Where the rebuild removes an
 * element R4 requires, a Data Absent Reason (`FHIR_DATA_ABSENT_REASON`) stands in its place.
 * Off, the rebuild is exactly as above.
 *
 * @packageDocumentation
 */

import {
  complex,
  isComplex,
  isList,
  isPrimitive,
  list,
  primitive,
  resourceType,
  type FhirComplex,
  type FhirNode,
  type FhirPrimitive,
  type FhirProperty,
} from "@cosyte/fhir";

import type { LocusKind, TransformedLocus } from "../locus.js";
import { FHIR_KEPT_ADDRESS_PARTS } from "./locus-map.js";
import { primitiveString, type FhirCoord, type FhirEditKind } from "./extract.js";
import { readFhirLiteral } from "./reference.js";
import {
  absentPlaceholder,
  childElementPath,
  isRequiredElement,
  withSecurityLabel,
} from "./transform-labels.js";

/** Sentinel returned by {@link rebuildNode} when a node is removed (dropped from its parent). @internal */
const REMOVE = Symbol("deid.fhir.remove");
type Rebuilt = FhirNode | typeof REMOVE;

/** One resolved edit: how to rewrite a node, the locus kind, and the engine's transformed value. */
interface Edit {
  readonly edit: FhirEditKind;
  readonly kind: LocusKind;
  readonly value: string | null;
  readonly disposition: TransformedLocus["disposition"];
}

/**
 * Options for {@link applyFhir}.
 *
 * @example
 * ```ts
 * import { type FhirApplyOptions } from "@cosyte/deid/fhir";
 *
 * const options: FhirApplyOptions = { transformLabels: true };
 * ```
 */
export interface FhirApplyOptions {
  /**
   * Write the transform labels: the `meta.security` coding on each resource the rebuild changed, and
   * a Data Absent Reason in place of a removed element R4 requires. Off by default.
   */
  readonly transformLabels?: boolean;
}

/**
 * What changed in the resource being rebuilt, the node of each change: the security label rests on it
 * being non-empty. `undefined` above the first resource, where a change belongs to no resource.
 */
type ResourceMark = FhirNode[] | undefined;

/** The definition path above the first resource: no element path starts from it. */
const ABOVE_RESOURCES = "";

/**
 * Write a primitive back from its value, its element `id` and the extensions the caller passes, and
 * from nothing else. Whatever else the reader kept on the node does not reach the output: an
 * `extension` the caller does not pass, and the text of a `_`-sibling that arrived as something other
 * than an object (a string, a number, a boolean, a `null` or a list), which the reader keeps so its
 * writer can hand it back. The extractor records that text as a block at the `_`-sibling's own locus.
 */
function rebuildPrimitive(node: FhirPrimitive, extension?: readonly FhirComplex[]): FhirPrimitive {
  // Stryker disable ConditionalExpression: `primitive` writes no `id` or `extension` it is handed as undefined, so either branch builds the same node
  return primitive(node.value, {
    ...(node.id === undefined ? {} : { id: node.id }),
    ...(extension === undefined ? {} : { extension }),
  });
  // Stryker restore ConditionalExpression
}

/**
 * `true` when rebuilding the primitive leaves something of it behind: anything the reader kept beyond
 * its value and its element `id`. The transform labels count it as a change.
 */
function carriesMoreThanValueAndId(node: FhirPrimitive): boolean {
  return Object.keys(node).some((key) => key !== "kind" && key !== "value" && key !== "id");
}

/**
 * Re-emit a part an `Address` keeps. A primitive part keeps its value and its `id`, and each extension
 * on its `_`-sibling is rebuilt through the same edits as every other node, so what the extractor
 * blocked inside one (a `value[x]`, a key R4 does not define on an extension) is gone and the `url`
 * skeleton stays. Nothing else on the part is written back. A part the extractor blocked (any shape
 * but a single string) is removed by its edit.
 */
function rebuildKeptPart(node: FhirNode, edits: ReadonlyMap<FhirNode, Edit>): Rebuilt {
  // The extractor blocks a kept part that is not a single string: its edit removes it.
  const edit = edits.get(node);
  if (edit !== undefined) return applyEdit(node, edit, edits);
  // Stryker disable next-line ConditionalExpression: a part reached here is always a primitive, so the test only narrows the type
  /* v8 ignore if -- every part that is not a string is blocked above; this guard narrows the type */
  if (!isPrimitive(node)) return REMOVE;
  // The extractor never names an extension object itself, only what is inside one, so each is
  // rebuilt property by property.
  return rebuildPrimitive(
    node,
    node.extension?.map((ext) => rebuildComplex(ext, edits)),
  );
}

/** Rebuild an `Address` complex to the Safe Harbor residual: state / country + generalized 3-digit ZIP. */
function rebuildAddress(
  node: FhirComplex,
  zip: string | null,
  edits: ReadonlyMap<FhirNode, Edit>,
): Rebuilt {
  const props: FhirProperty[] = [];
  for (const prop of node.properties) {
    if (FHIR_KEPT_ADDRESS_PARTS.has(prop.name)) {
      const part = rebuildKeptPart(prop.value, edits);
      if (part !== REMOVE) props.push({ name: prop.name, value: part });
    } else if (prop.name === "postalCode" && zip !== null) {
      props.push({ name: "postalCode", value: primitive(zip) });
    }
    // Every finer component (line / city / district / text) and an un-generalizable ZIP is dropped.
  }
  return props.length === 0 ? REMOVE : complex(props);
}

/** An `Annotation` reduced to its redacted `text` only: author / time (potential PHI) are dropped. */
function textAnnotation(value: string): FhirComplex {
  return complex([{ name: "text", value: primitive(value) }]);
}

/**
 * Write a BYO-redacted free-text value back in place, faithful to the node's kind: a redacted
 * string primitive (`contentString` / `valueString`) stays a primitive; a `note` Annotation (complex)
 * or a `note` array (list) becomes a `text`-only Annotation carrying the redacted prose. Reached only
 * for a `freetext` locus with a non-null value (the caller gates on `kind`), so a name/telecom locus
 * that a custom policy pseudonymized, which shares the `drop` edit, is never routed through here; it
 * drops as before.
 */
function writeFreeText(node: FhirNode, value: string): Rebuilt {
  if (isPrimitive(node)) return primitive(value);
  if (isList(node)) return list([textAnnotation(value)]);
  return textAnnotation(value);
}

/** Apply the resolved edit for a node the map named. */
function applyEdit(node: FhirNode, edit: Edit, edits: ReadonlyMap<FhirNode, Edit>): Rebuilt {
  switch (edit.edit) {
    case "drop":
      // A BYO-redacted free-text locus with a non-null value → write the redacted prose back
      // in place. Gated on `kind`, so a name/telecom locus a custom policy pseudonymized (which shares
      // the `drop` edit) still drops rather than being written through the free-text path. Every other
      // case (a removed/blocked locus, or a null value) omits the node.
      return edit.kind === "freetext" && edit.value !== null
        ? writeFreeText(node, edit.value)
        : REMOVE;
    case "set-primitive":
      return edit.value === null ? REMOVE : primitive(edit.value);
    case "address":
      return isComplex(node) ? rebuildAddress(node, edit.value, edits) : REMOVE;
    case "age":
      // A kept age is the number exactly as it arrived, rebuilt like every primitive the pass
      // re-emits, so a decimal stays a decimal. Anything else goes: an age over 89, one the pass could
      // not read, and a surrogate a custom policy computed, which a number field cannot hold.
      return isPrimitive(node) && edit.value !== null && edit.value === primitiveString(node)
        ? primitive(node.value)
        : REMOVE;
    case "reference":
      return rebuildLiteral(node, edit.value);
  }
}

/**
 * Rebuild a literal whose id was replaced: the structure the extractor kept (the `#`, the resource
 * type, the `urn:` scheme or the server base) in front of the replacement, and no version suffix. The
 * literal is read again with the same reader the extractor used, so the two cannot disagree about
 * which part is the id. A `null` replacement drops the literal.
 */
function rebuildLiteral(node: FhirNode, value: string | null): Rebuilt {
  if (value === null) return REMOVE;
  // The extractor names only a primitive the same reader read as an id, so neither guard below ever
  // holds; they are kept so a coordinate that did not come from the extractor drops rather than writes.
  /* v8 ignore if -- the extractor's reference coordinate always names a primitive */
  if (!isPrimitive(node)) return REMOVE;
  const literal = readFhirLiteral(primitiveString(node), true);
  /* v8 ignore if -- the same reader read this same string as an id when the extractor named it */
  if (literal?.kind !== "id") return REMOVE;
  return primitive(`${literal.prefix}${value}`);
}

/**
 * `true` when the rebuild left nothing of an element: it was removed, or it is a complex with no
 * property left, or a list of nothing else.
 */
function isEmptied(rebuilt: Rebuilt): boolean {
  if (rebuilt === REMOVE) return true;
  if (isComplex(rebuilt)) return rebuilt.properties.length === 0;
  return isList(rebuilt) && rebuilt.items.every(isEmptied);
}

/** Rebuild any node: apply its edit if the map named it, else structurally reconstruct its children. */
function rebuildNode(node: FhirNode, edits: ReadonlyMap<FhirNode, Edit>): Rebuilt {
  const edit = edits.get(node);
  if (edit !== undefined) return applyEdit(node, edit, edits);

  if (isPrimitive(node)) return rebuildPrimitive(node);

  if (isList(node)) {
    const items: FhirNode[] = [];
    for (const item of node.items) {
      const rebuilt = rebuildNode(item, edits);
      if (rebuilt !== REMOVE) items.push(rebuilt);
    }
    return items.length === 0 ? REMOVE : list(items); // an emptied list is dropped (FHIR forbids `[]`)
  }

  return rebuildComplex(node, edits);
}

/** Rebuild a complex the map did not name: each property rebuilt, a removed one omitted. */
function rebuildComplex(node: FhirComplex, edits: ReadonlyMap<FhirNode, Edit>): FhirComplex {
  const props: FhirProperty[] = [];
  for (const prop of node.properties) {
    const rebuilt = rebuildNode(prop.value, edits);
    if (rebuilt !== REMOVE) props.push({ name: prop.name, value: rebuilt });
  }
  return complex(props);
}

/**
 * {@link rebuildNode} with the transform labels: the same rebuild, which also notes in `mark` each
 * change in the resource it is in, labels each resource that changed, and writes a Data Absent Reason
 * in place of a required element it removed. `path` is the node's definition path (`""` above the
 * first resource) and `contained` is set for the items of a `contained` list. A separate walk, so a
 * call without the labels runs exactly the rebuild it ran before.
 */
function rebuildLabeled(
  node: FhirNode,
  edits: ReadonlyMap<FhirNode, Edit>,
  path: string,
  mark: ResourceMark,
  contained: boolean,
): Rebuilt {
  const edit = edits.get(node);
  if (edit !== undefined) {
    const rebuilt = applyEdit(node, edit, edits);
    if (rebuilt === REMOVE || edit.disposition !== "retained") mark?.push(node);
    return rebuilt;
  }

  if (isPrimitive(node)) {
    if (carriesMoreThanValueAndId(node)) mark?.push(node);
    return rebuildPrimitive(node);
  }

  if (isList(node)) {
    const items: FhirNode[] = [];
    for (const item of node.items) {
      const rebuilt = rebuildLabeled(item, edits, path, mark, contained);
      if (rebuilt !== REMOVE) items.push(rebuilt);
    }
    return items.length === 0 ? REMOVE : list(items);
  }

  // complex: a resource starts its own definition path, and its own mark unless it is contained
  const type = resourceType(node);
  const own = type ?? path;
  const resourceMark: ResourceMark = type !== undefined && !contained ? [] : undefined;
  const ownMark = resourceMark ?? mark;
  const props: FhirProperty[] = [];
  for (const prop of node.properties) {
    const childPath = childElementPath(own, prop.name);
    const rebuilt = rebuildLabeled(
      prop.value,
      edits,
      childPath,
      ownMark,
      prop.name === "contained",
    );
    if (isEmptied(rebuilt) && !isEmptied(prop.value) && isRequiredElement(childPath)) {
      props.push({ name: prop.name, value: absentPlaceholder(prop.value) });
    } else if (rebuilt !== REMOVE) {
      props.push({ name: prop.name, value: rebuilt });
    }
  }
  return resourceMark !== undefined && resourceMark.length > 0
    ? complex(withSecurityLabel(props))
    : complex(props);
}

/**
 * Rebuild a de-identified resource from the engine's transformed loci and the extractor's coordinates.
 * `transformed` and `coords` are index-aligned (both preserve extraction order). Returns a fresh,
 * independent {@link "@cosyte/fhir".FhirComplex}; the input `resource` is never mutated.
 *
 * @param resource - The original parsed resource the extractor walked.
 * @param transformed - The engine's transformed loci, in extraction order.
 * @param coords - The write-back coordinates, index-aligned with `transformed`.
 * @param options - `transformLabels` writes the transform labels (off by default).
 * @returns The de-identified resource tree.
 * @example
 * ```ts
 * import { parseResource } from "@cosyte/fhir";
 * import { extractFhirLoci, applyFhir } from "@cosyte/deid/fhir";
 * import { deidentify } from "@cosyte/deid";
 *
 * const { resource } = parseResource(json);
 * const { loci, coords } = extractFhirLoci(resource);
 * const { document } = deidentify({ loci }, { context });
 * const deidentified = applyFhir(resource, document.loci, coords);
 * ```
 */
export function applyFhir(
  resource: FhirComplex,
  transformed: readonly TransformedLocus[],
  coords: readonly FhirCoord[],
  options: FhirApplyOptions = {},
): FhirComplex {
  const edits = new Map<FhirNode, Edit>();
  for (let i = 0; i < coords.length; i += 1) {
    const coord = coords[i];
    const t = transformed[i];
    if (coord === undefined || t === undefined) continue;
    edits.set(coord.node, {
      edit: coord.edit,
      kind: t.kind,
      value: t.value,
      disposition: t.disposition,
    });
  }
  const rebuilt =
    options.transformLabels === true
      ? rebuildLabeled(resource, edits, ABOVE_RESOURCES, undefined, false)
      : rebuildNode(resource, edits);
  // The root resource never rebuilds to REMOVE (its `resourceType` property is retained), but guard so a
  // pathological empty root fails closed to an empty resource rather than leaking the original.
  return rebuilt === REMOVE || !isComplex(rebuilt) ? complex([]) : rebuilt;
}
