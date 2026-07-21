/**
 * The X12 **applier** — writes the engine's transformed loci back into a **reconstructed** interchange
 * and re-serializes it with `@cosyte/x12`'s own `serializeX12`. The caller's input interchange is never
 * mutated.
 *
 * The `@cosyte/x12` serializer is **byte-faithful**: it reconstructs the transaction body from the
 * verbatim `rawSegments` strings, not from the decoded element model. So the applier rewrites at the raw
 * layer — for each affected segment it takes the parser's decoded (1-indexed) `elements`, substitutes
 * the transformed value(s), and re-joins them with the interchange's element separator (the exact
 * inverse of the parser's element split, matching `serializeX12`'s own `substituteElement`). A segment
 * the extractor did not touch keeps its **verbatim** raw string, so every clinical / financial value —
 * diagnosis codes, charge amounts, NDCs — survives the over-scrub test byte-identical.
 *
 * Removal is clean: a redacted or blocked element becomes the empty string (it serializes as an empty
 * element between two separators), never a fabricated placeholder. A pseudonymized identifier and a
 * generalized date / ZIP replace only their own element; every sibling element is retained.
 *
 * @packageDocumentation
 */

import { serializeX12, type X12Interchange, type X12Segment } from "@cosyte/x12";

import type { TransformedLocus } from "../locus.js";
import type { X12Coord } from "./extract.js";

/** A working set of element edits for one segment: 1-based element index → new value. */
type SegmentEdits = Map<number, string>;

/** Rebuild one segment's raw text from its decoded elements with the collected edits applied. */
function rebuildSegmentRaw(seg: X12Segment, edits: SegmentEdits, elementSep: string): string {
  const elements = seg.elements.slice();
  for (const [index, value] of edits) {
    // Guard against an out-of-range index (a coord can only reference an element the extractor read).
    if (index >= 0 && index < elements.length) {
      elements[index] = value;
    }
  }
  return elements.join(elementSep);
}

/**
 * Write the engine's transformed loci back onto a reconstruction of `original` and return the
 * de-identified X12 byte stream. `transformed` and `coords` are index-aligned (both preserve extraction
 * order).
 *
 * @param original - The parsed interchange to de-identify (never mutated).
 * @param transformed - The engine's transformed loci, in extraction order.
 * @param coords - The write-back coordinates, index-aligned with `transformed`.
 * @returns The de-identified X12 string (byte-faithful for untouched segments).
 * @example
 * ```ts
 * import { parseX12 } from "@cosyte/x12";
 * import { extractX12Loci, applyX12 } from "@cosyte/deid/x12";
 * import { deidentify } from "@cosyte/deid";
 *
 * const ix = parseX12(raw);
 * const { loci, coords } = extractX12Loci(ix);
 * const { document } = deidentify({ loci }, { context });
 * const clean = applyX12(ix, document.loci, coords); // de-identified X12 text
 * ```
 */
export function applyX12(
  original: X12Interchange,
  transformed: readonly TransformedLocus[],
  coords: readonly X12Coord[],
): string {
  const elementSep = original.delimiters.element;

  // Collect edits: groupIndex → txIndex → segIndex → (elementIndex → value).
  const byGroup = new Map<number, Map<number, Map<number, SegmentEdits>>>();
  for (let i = 0; i < coords.length; i += 1) {
    const coord = coords[i];
    const t = transformed[i];
    if (coord === undefined || t === undefined) continue;
    const value = t.value ?? ""; // removed / blocked → empty element

    const byTx = byGroup.get(coord.groupIndex) ?? new Map<number, Map<number, SegmentEdits>>();
    byGroup.set(coord.groupIndex, byTx);
    const bySeg = byTx.get(coord.txIndex) ?? new Map<number, SegmentEdits>();
    byTx.set(coord.txIndex, bySeg);
    const edits = bySeg.get(coord.segIndex) ?? new Map<number, string>();
    bySeg.set(coord.segIndex, edits);
    for (const element of coord.elements) edits.set(element, value);
  }

  // Reconstruct the interchange, rewriting only the raw segments that carry an edit.
  const groups = original.groups.map((group, groupIndex) => {
    const byTx = byGroup.get(groupIndex);
    if (byTx === undefined) return group;
    const transactions = group.transactions.map((tx, txIndex) => {
      const bySeg = byTx.get(txIndex);
      if (bySeg === undefined) return tx;
      const rawSegments = tx.rawSegments.map((raw, segIndex) => {
        const edits = bySeg.get(segIndex);
        const seg = tx.segments[segIndex];
        if (edits === undefined || seg === undefined) return raw;
        return rebuildSegmentRaw(seg, edits, elementSep);
      });
      return { ...tx, rawSegments };
    });
    return { ...group, transactions };
  });

  const deidentified: X12Interchange = { ...original, groups };
  return serializeX12(deidentified);
}
