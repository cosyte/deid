/**
 * The FHIR **applier** — rebuilds a fresh, de-identified `@cosyte/fhir` resource tree from the engine's
 * transformed loci and the extractor's write-back coordinates. The `@cosyte/fhir` model is **immutable**
 * (every node is deeply `readonly`), so — unlike the HL7 / C-CDA appliers, which edit a cloned mutable
 * tree — this applier **reconstructs** the tree: it recurses the original nodes and, guided by a
 * node-identity map, emits new {@link "@cosyte/fhir".FhirComplex} / `FhirList` / `FhirPrimitive` nodes.
 * The caller's model is therefore never touched.
 *
 * Each coordinate names the exact node to rewrite and how:
 *
 * - `drop` — the node is omitted (a redacted `name`/`telecom`/`photo`, a blocked extension value, a
 *   blocked `Reference.display`, a blocked narrative `div`, a blocked unknown person string, a redacted
 *   SSN `Identifier.value`). A dropped property vanishes from its complex; a dropped list item from its
 *   list; a list that empties is dropped in turn.
 * - `set-primitive` — the primitive's value becomes the transformed string (a generalized date, a
 *   pseudonymized `Identifier.value`); a `null` result degrades to a drop.
 * - `address` — the `Address` complex is rebuilt to `state` + `country` + the generalized 3-digit
 *   `postalCode`, dropping every finer geographic component.
 *
 * **Primitive-extension guard.** A FHIR primitive can carry an `extension` (the JSON `_`-sibling) that
 * holds PHI (`_birthDate.extension[…]`). The structural walk does not descend that side-channel, so the
 * applier **fails closed**: every rebuilt primitive is emitted **without** its `extension` metadata (its
 * value and `id` are kept). Primitive extensions are uncommon and demographic/annotative; dropping them
 * guarantees no `_`-sibling leak, at the documented cost of not preserving them (profile-aware retention
 * is Phase 10).
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
  type FhirComplex,
  type FhirNode,
  type FhirPrimitive,
  type FhirProperty,
} from "@cosyte/fhir";

import type { TransformedLocus } from "../locus.js";
import type { FhirCoord, FhirEditKind } from "./extract.js";

/** Sentinel returned by {@link rebuildNode} when a node is removed (dropped from its parent). @internal */
const REMOVE = Symbol("deid.fhir.remove");
type Rebuilt = FhirNode | typeof REMOVE;

/** Address components at or above state level, permitted under Safe Harbor and retained. @internal */
const KEEP_ADDRESS_PARTS: ReadonlySet<string> = new Set(["state", "country"]);

/** One resolved edit: how to rewrite a node, and the engine's transformed value for it. */
interface Edit {
  readonly edit: FhirEditKind;
  readonly value: string | null;
}

/** Re-emit a primitive without its `extension` side-channel (fail-closed), keeping value + `id`. */
function stripPrimitive(node: FhirPrimitive): FhirNode {
  if (node.extension === undefined) return node; // nothing to strip — preserve identity exactly
  return node.id === undefined ? primitive(node.value) : primitive(node.value, { id: node.id });
}

/** Rebuild an `Address` complex to the Safe Harbor residual: state / country + generalized 3-digit ZIP. */
function rebuildAddress(node: FhirComplex, zip: string | null): Rebuilt {
  const props: FhirProperty[] = [];
  for (const prop of node.properties) {
    if (KEEP_ADDRESS_PARTS.has(prop.name)) {
      props.push(prop);
    } else if (prop.name === "postalCode" && zip !== null) {
      props.push({ name: "postalCode", value: primitive(zip) });
    }
    // Every finer component (line / city / district / text) and an un-generalizable ZIP is dropped.
  }
  return props.length === 0 ? REMOVE : complex(props);
}

/** Apply the resolved edit for a node the map named. */
function applyEdit(node: FhirNode, edit: Edit): Rebuilt {
  switch (edit.edit) {
    case "drop":
      return REMOVE;
    case "set-primitive":
      return edit.value === null ? REMOVE : primitive(edit.value);
    case "address":
      return isComplex(node) ? rebuildAddress(node, edit.value) : REMOVE;
  }
}

/** Rebuild any node: apply its edit if the map named it, else structurally reconstruct its children. */
function rebuildNode(node: FhirNode, edits: ReadonlyMap<FhirNode, Edit>): Rebuilt {
  const edit = edits.get(node);
  if (edit !== undefined) return applyEdit(node, edit);

  if (isPrimitive(node)) return stripPrimitive(node);

  if (isList(node)) {
    const items: FhirNode[] = [];
    for (const item of node.items) {
      const rebuilt = rebuildNode(item, edits);
      if (rebuilt !== REMOVE) items.push(rebuilt);
    }
    return items.length === 0 ? REMOVE : list(items); // an emptied list is dropped (FHIR forbids `[]`)
  }

  // complex
  const props: FhirProperty[] = [];
  for (const prop of node.properties) {
    const rebuilt = rebuildNode(prop.value, edits);
    if (rebuilt !== REMOVE) props.push({ name: prop.name, value: rebuilt });
  }
  return complex(props);
}

/**
 * Rebuild a de-identified resource from the engine's transformed loci and the extractor's coordinates.
 * `transformed` and `coords` are index-aligned (both preserve extraction order). Returns a fresh,
 * independent {@link "@cosyte/fhir".FhirComplex}; the input `resource` is never mutated.
 *
 * @param resource - The original parsed resource the extractor walked.
 * @param transformed - The engine's transformed loci, in extraction order.
 * @param coords - The write-back coordinates, index-aligned with `transformed`.
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
): FhirComplex {
  const edits = new Map<FhirNode, Edit>();
  for (let i = 0; i < coords.length; i += 1) {
    const coord = coords[i];
    const t = transformed[i];
    if (coord === undefined || t === undefined) continue;
    edits.set(coord.node, { edit: coord.edit, value: t.value });
  }
  const rebuilt = rebuildNode(resource, edits);
  // The root resource never rebuilds to REMOVE (its `resourceType` property is retained), but guard so a
  // pathological empty root fails closed to an empty resource rather than leaking the original.
  return rebuilt === REMOVE || !isComplex(rebuilt) ? complex([]) : rebuilt;
}
