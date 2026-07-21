/**
 * The C-CDA **applier** — writes the engine's transformed loci back onto the CDA DOM the extractor
 * walked (a fresh, independent `@xmldom/xmldom` tree parsed from the input document's serialized form,
 * so the caller's parsed model is never mutated). Each coordinate holds a direct handle to its node, so
 * write-back is a direct DOM edit with no path re-resolution; `transformed` and `coords` are
 * index-aligned (both preserve extraction order).
 *
 * Removal is clean: a redacted name / blocked narrative becomes an empty element (`<name/>`,
 * `<text/>`) — while a **BYO-redacted** narrative (§Phase 8) keeps the redactor's prose as the element's
 * text; a redacted telecom loses its `@value`; a generalized date keeps only its year; a
 * pseudonymized id replaces only the id value (the assigning-authority `root` retained); a generalized
 * address keeps only the Safe Harbor 3-digit ZIP (state / country retained) and drops every finer
 * geographic child. Elements the extractor did not touch — the clinical `structuredBody` entries — are
 * left byte-faithful, so structured clinical values survive the over-scrub test unchanged.
 *
 * @packageDocumentation
 */

import { childElements } from "@cosyte/ccda";

import type { TransformedLocus } from "../locus.js";
import type { CcdaCoord } from "./extract.js";
import type { Element, Node } from "@xmldom/xmldom";

/** DOM `Node.TEXT_NODE`. @internal */
const TEXT_NODE = 3 as const;
/** Geographic address components at or above state level, retained under Safe Harbor. @internal */
const KEEP_ADDRESS_PARTS: ReadonlySet<string> = new Set(["state", "country"]);

/** Remove every child node of an element (elements + text), leaving it empty. */
function removeAllChildren(el: Element): void {
  while (el.firstChild !== null) el.removeChild(el.firstChild);
}

/** Replace an element's content with a single text node. */
function setElementText(el: Element, value: string): void {
  removeAllChildren(el);
  const doc = el.ownerDocument;
  if (doc !== null) el.appendChild(doc.createTextNode(value));
}

/** Remove an element's direct text nodes. */
function removeDirectText(el: Element): void {
  const doomed: Node[] = [];
  const nodes = el.childNodes;
  for (let i = 0; i < nodes.length; i += 1) {
    const n = nodes[i];
    if (n !== null && n !== undefined && n.nodeType === TEXT_NODE) doomed.push(n);
  }
  for (const n of doomed) el.removeChild(n);
}

/** Apply a pseudonymized / redacted id: replace the id value it carries, retaining the assigning root. */
function applyId(el: Element, value: string | null): void {
  const hasExtension = (el.getAttribute("extension") ?? "").length > 0;
  if (value === null) {
    // Redacted (SSN) or blocked: drop the identifying value component.
    if (hasExtension) el.removeAttribute("extension");
    else el.removeAttribute("root");
    return;
  }
  // Pseudonymized surrogate replaces only the value component; the assigning authority (root) stays.
  if (hasExtension) el.setAttribute("extension", value);
  else el.setAttribute("root", value);
}

/** Apply an address edit: keep only the generalized 3-digit ZIP (+ state/country); drop finer geography. */
function applyAddress(el: Element, value: string | null): void {
  for (const child of childElements(el)) {
    const ln = child.localName ?? "";
    if (ln === "postalCode") {
      if (value === null) el.removeChild(child);
      else setElementText(child, value);
    } else if (!KEEP_ADDRESS_PARTS.has(ln)) {
      // Street / city / county / precinct / postBox / … dropped. Fail closed: an un-generalizable ZIP
      // (value === null) drops the whole address, so every geographic component is gone.
      el.removeChild(child);
    }
  }
}

/** Fail closed on an unrecognized element: strip its direct text and value-bearing attrs (keep children). */
function applyBlock(el: Element): void {
  removeDirectText(el);
  el.removeAttribute("value");
  el.removeAttribute("extension");
  el.removeAttribute("root");
}

/**
 * Write the engine's transformed loci back onto the CDA DOM the extractor walked. Mutates the tree in
 * place (it is a fresh parse, never the caller's model). `transformed` and `coords` are index-aligned.
 *
 * @param transformed - The engine's transformed loci, in extraction order.
 * @param coords - The write-back coordinates, index-aligned with `transformed`.
 * @example
 * ```ts
 * import { parseSecureXml, resolveLimits } from "@cosyte/ccda";
 * import { extractCcdaLoci, applyCcda } from "@cosyte/deid/ccda";
 * import { deidentify } from "@cosyte/deid";
 *
 * const dom = parseSecureXml(xml, resolveLimits(undefined), () => {});
 * const { loci, coords } = extractCcdaLoci(dom.documentElement);
 * const { document } = deidentify({ loci }, { context });
 * applyCcda(document.loci, coords);
 * // dom now serializes to spec-clean, de-identified C-CDA XML.
 * ```
 */
export function applyCcda(
  transformed: readonly TransformedLocus[],
  coords: readonly CcdaCoord[],
): void {
  for (let i = 0; i < coords.length; i += 1) {
    const coord = coords[i];
    const t = transformed[i];
    if (coord === undefined || t === undefined) continue;
    const { node } = coord;
    switch (coord.edit) {
      case "clear-element":
        // A BYO-redacted narrative (DEID-8, `kind === "freetext"`) with a non-null value → write the
        // redacted prose back in place. Gated on `kind`, so a name locus a custom policy pseudonymized
        // (which shares `clear-element`) still empties rather than writing a surrogate as flat text. A
        // removed name or a blocked narrative (null value) empties the element.
        if (t.kind === "freetext" && t.value !== null) setElementText(node, t.value);
        else removeAllChildren(node);
        break;
      case "clear-telecom":
        node.removeAttribute("value");
        removeAllChildren(node);
        break;
      case "id":
        applyId(node, t.value);
        break;
      case "date-value":
        if (t.value === null) node.removeAttribute("value");
        else node.setAttribute("value", t.value);
        break;
      case "address":
        applyAddress(node, t.value);
        break;
      case "block":
        applyBlock(node);
        break;
      case "block-text":
        // Strip stray direct text on a recognized coded element; its coded attributes are retained.
        removeDirectText(node);
        break;
    }
  }
}
