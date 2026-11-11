/**
 * The X12 **applier**: writes the engine's transformed loci back into a **reconstructed** interchange
 * and re-serializes it with `@cosyte/x12`'s own `serializeX12`. The caller's input interchange is never
 * mutated.
 *
 * The `@cosyte/x12` serializer is **byte-faithful**: it reconstructs the transaction body from the
 * verbatim `rawSegments` strings, not from the decoded element model. So the applier rewrites at the raw
 * layer, for each affected segment it takes the parser's decoded (1-indexed) `elements`, substitutes
 * the transformed value(s), and re-joins them with the interchange's element separator (the exact
 * inverse of the parser's element split, matching `serializeX12`'s own `substituteElement`). A segment
 * the extractor did not touch keeps its **verbatim** raw string, so every clinical / financial value
 * (diagnosis codes, charge amounts, NDCs) survives the over-scrub test byte-identical.
 *
 * Removal is clean: a redacted or blocked element becomes the empty string (it serializes as an empty
 * element between two separators), never a fabricated placeholder. A pseudonymized identifier and a
 * generalized date / ZIP replace only their own element; every sibling element is retained. A locus on
 * one component of a composite (a date inside an `HI` entry) rewrites that component alone.
 *
 * The envelope is rewritten the same way when the extractor removed one of its elements: a `GS`, `GE`,
 * `TA1` or `IEA` element becomes empty, and an `ISA` element becomes blanks of its own width, so the
 * header keeps its fixed 106 bytes.
 *
 * A segment the extractor **removed whole** (one whose identifier it does not recognize, or one outside
 * every transaction set) is dropped from the output, and the `SE-01` segment count of the transaction
 * set it sat in is reduced by one for each, so a count that was right stays right. Removed bytes after
 * the `IEA` are dropped too.
 *
 * @packageDocumentation
 */

import { serializeX12, type X12Interchange } from "@cosyte/x12";

import type { TransformedLocus } from "../locus.js";
import type { X12Coord } from "./extract.js";

/**
 * A working set of edits for one segment: 1-based element index → the element's new value, or → the
 * new values of some of its components (1-based component index → value).
 */
type SegmentEdits = Map<number, string | Map<number, string>>;

/** The parts of the interchange the edits rewrite, beside its transaction bodies. */
type EnvelopeKind = NonNullable<X12Coord["envelope"]>["segment"];

/** Apply the edits to a copy of a segment's decoded elements and return the new element list. */
function editedElements(
  elements: readonly string[],
  edits: SegmentEdits,
  componentSep: string,
): string[] {
  const out = elements.slice();
  // A coord only ever references an element the extractor read from this same segment, so every index is
  // in range against the copy; the assignment is always valid.
  for (const [index, edit] of edits) {
    if (typeof edit === "string") {
      out[index] = edit;
      continue;
    }
    const components = (out[index] as string).split(componentSep);
    for (const [component, value] of edit) components[component - 1] = value;
    out[index] = components.join(componentSep);
  }
  return out;
}

/** Rebuild one segment's raw text from its decoded elements with the collected edits applied. */
function rebuildSegmentRaw(
  elements: readonly string[],
  edits: SegmentEdits,
  elementSep: string,
  componentSep: string,
): string {
  return editedElements(elements, edits, componentSep).join(elementSep);
}

/**
 * Rebuild the fixed-width `ISA`. Every element there is padded to its declared width, and an all-blank
 * element is the standard's spelling of "not used", so a removed element is written as blanks of its
 * own width and the header keeps its 106 bytes. The bytes after the last element (the segment
 * terminator the raw text carries) are kept as they were.
 */
function rebuildIsaRaw(
  isa: { readonly raw: string; readonly elements: readonly string[] },
  edits: SegmentEdits,
  elementSep: string,
  componentSep: string,
): string {
  const original = isa.elements.join(elementSep);
  // The edited list is index-aligned with the original: an edit replaces an element, never adds one.
  const padded = editedElements(isa.elements, edits, componentSep).map((value, index) =>
    value.padEnd((isa.elements[index] as string).length, " "),
  );
  return padded.join(elementSep) + isa.raw.slice(original.length);
}

/**
 * Reduce a transaction set's `SE-01` segment count by the segments removed from it, as an edit on the
 * `SE`. A count that is not a whole number (or one the extractor itself removed) is not a count the
 * applier can reduce, so it is left as the edits already have it.
 */
function reduceSegmentCount(edits: SegmentEdits, se: readonly string[], removed: number): void {
  // SE-01 is never a composite, so an edit there is always a whole value.
  const current = (edits.get(1) as string | undefined) ?? se[1] ?? "";
  if (!/^\d+$/.test(current)) return;
  edits.set(1, String(Math.max(0, Number(current) - removed)));
}

/** Record one coordinate's write into a segment's edit set. */
function recordEdit(edits: SegmentEdits, coord: X12Coord, value: string): void {
  for (const element of coord.elements) {
    if (coord.component === undefined) {
      edits.set(element, value);
      continue;
    }
    const existing = edits.get(element);
    const components = existing instanceof Map ? existing : new Map<number, string>();
    components.set(coord.component, value);
    edits.set(element, components);
  }
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
 * const clean = applyX12(ix, document.loci, coords); // transformed X12 text
 * ```
 */
export function applyX12(
  original: X12Interchange,
  transformed: readonly TransformedLocus[],
  coords: readonly X12Coord[],
): string {
  const elementSep = original.delimiters.element;
  const componentSep = original.delimiters.component;

  // Collect edits: groupIndex → txIndex → segIndex → edits, and envelope kind → index → edits. A
  // segment removed whole is collected apart, by the same keys, and dropped rather than rewritten.
  const byGroup = new Map<number, Map<number, Map<number, SegmentEdits>>>();
  const byEnvelope = new Map<EnvelopeKind, Map<number, SegmentEdits>>();
  const removedSegments = new Set<string>();
  const removedOrphans = new Set<number>();
  const editsFor = <K>(map: Map<K, SegmentEdits>, key: K): SegmentEdits => {
    const edits = map.get(key) ?? new Map<number, string | Map<number, string>>();
    map.set(key, edits);
    return edits;
  };
  for (let i = 0; i < coords.length; i += 1) {
    const coord = coords[i];
    const t = transformed[i];
    if (coord === undefined || t === undefined) continue;
    // A coordinate with NO elements is a record about a position, not an edit to it: the party-role
    // row a retained out-of-scope party emits. It must not even reach the edit map, because merely
    // registering the segment would rebuild its raw text from the decoded elements, and a retained
    // party has to survive BYTE-identical.
    if (coord.elements.length === 0) continue;
    const value = t.value ?? ""; // removed / blocked → empty element

    if (coord.segmentRemoved === true) {
      if (coord.envelope === undefined) {
        removedSegments.add(
          `${String(coord.groupIndex)}:${String(coord.txIndex)}:${String(coord.segIndex)}`,
        );
      } else {
        removedOrphans.add(coord.envelope.index);
      }
      continue;
    }
    if (coord.envelope !== undefined) {
      const byIndex = byEnvelope.get(coord.envelope.segment) ?? new Map<number, SegmentEdits>();
      byEnvelope.set(coord.envelope.segment, byIndex);
      recordEdit(editsFor(byIndex, coord.envelope.index), coord, value);
      continue;
    }
    const byTx = byGroup.get(coord.groupIndex) ?? new Map<number, Map<number, SegmentEdits>>();
    byGroup.set(coord.groupIndex, byTx);
    const bySeg = byTx.get(coord.txIndex) ?? new Map<number, SegmentEdits>();
    byTx.set(coord.txIndex, bySeg);
    recordEdit(editsFor(bySeg, coord.segIndex), coord, value);
  }

  /** Rewrite one envelope segment's raw text when it carries an edit, and return it unchanged when not. */
  const envelopeSegment = <
    S extends { readonly raw: string; readonly elements: readonly string[] },
  >(
    kind: EnvelopeKind,
    index: number,
    seg: S,
  ): S => {
    const edits = byEnvelope.get(kind)?.get(index);
    if (edits === undefined) return seg;
    const raw =
      kind === "ISA"
        ? rebuildIsaRaw(seg, edits, elementSep, componentSep)
        : rebuildSegmentRaw(seg.elements, edits, elementSep, componentSep);
    return { ...seg, raw, elements: editedElements(seg.elements, edits, componentSep) };
  };

  // A peer older than the orphan list carries none.
  const orphans = original.orphanSegments ?? [];
  // How many segments were removed from each transaction set, keyed `group:transaction`: the ones in
  // its body, and a removed segment the parser lifted out from between its ST and SE (only a TA1 can
  // be one), which its SE-01 counted too.
  const removedFromTx = new Map<string, number>();
  const countRemoved = (key: string): void => {
    removedFromTx.set(key, (removedFromTx.get(key) ?? 0) + 1);
  };
  for (const key of removedSegments) countRemoved(key.slice(0, key.lastIndexOf(":")));
  for (const index of removedOrphans) {
    const anchor = orphans[index]?.anchor;
    if (anchor?.kind === "transaction") {
      countRemoved(`${String(anchor.groupIndex)}:${String(anchor.transactionIndex)}`);
    }
  }

  // Reconstruct the interchange, rewriting only the raw segments that carry an edit and dropping the
  // ones removed whole.
  const groups = original.groups.map((group, groupIndex) => {
    const byTx = byGroup.get(groupIndex) ?? new Map<number, Map<number, SegmentEdits>>();
    const gs = envelopeSegment("GS", groupIndex, group.gs);
    const ge = group.ge === undefined ? undefined : envelopeSegment("GE", groupIndex, group.ge);
    const transactions = group.transactions.map((tx, txIndex) => {
      const txKey = `${String(groupIndex)}:${String(txIndex)}`;
      const removed = removedFromTx.get(txKey) ?? 0;
      const bySeg = byTx.get(txIndex);
      if (bySeg === undefined && removed === 0) return tx;
      const edits = bySeg ?? new Map<number, SegmentEdits>();
      // The parser puts a transaction set's SE last in its segments, when it has one.
      if (removed > 0 && tx.se !== undefined) {
        reduceSegmentCount(editsFor(edits, tx.segments.length - 1), tx.se.elements, removed);
      }
      const kept = tx.segments
        .map((seg, segIndex) => ({ seg, segIndex }))
        .filter(({ segIndex }) => !removedSegments.has(`${txKey}:${String(segIndex)}`));
      const rawSegments = kept.map(({ seg, segIndex }) => {
        const segEdits = edits.get(segIndex);
        const raw = tx.rawSegments[segIndex] as string;
        if (segEdits === undefined) return raw;
        return rebuildSegmentRaw(seg.elements, segEdits, elementSep, componentSep);
      });
      return { ...tx, segments: kept.map(({ seg }) => seg), rawSegments };
    });
    return { ...group, gs, ge, transactions };
  });

  // Every segment outside a transaction set that the extractor removed is dropped. The extractor
  // removes every one, so no orphan that stays is anchored after a segment dropped from a body.
  const orphanSegments = orphans.filter((_, index) => !removedOrphans.has(index));

  // Bytes after the IEA the extractor removed are dropped whole; blank ones were never touched.
  const keepTrailing = !byEnvelope.has("trailing");
  const { trailingBytes, ...rest } = original;
  const deidentified: X12Interchange = {
    ...rest,
    ...(keepTrailing && trailingBytes !== undefined ? { trailingBytes } : {}),
    isa: envelopeSegment("ISA", 0, original.isa),
    ta1Segments: original.ta1Segments.map((ta1, index) => envelopeSegment("TA1", index, ta1)),
    groups,
    iea: original.iea === undefined ? undefined : envelopeSegment("IEA", 0, original.iea),
    orphanSegments,
  };
  return serializeX12(deidentified);
}
