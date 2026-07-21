/**
 * The NCPDP Telecom **applier** — writes the engine's transformed loci back onto a **fresh
 * reconstruction** of the transaction and re-serializes it with `@cosyte/ncpdp`'s `serializeTelecom`.
 * The caller's input transaction is never mutated.
 *
 * `serializeTelecom` emits from the generic `{ id, value }` field model (and the fixed header), so every
 * field survives the round-trip and a de-identified value is written simply by rebuilding the field with
 * a new value. A field the extractor did not touch keeps its **verbatim** value, so every clinical /
 * financial value — NDC drug codes, quantities, pricing amounts, DUR reason codes — survives the
 * over-scrub test unchanged. A removed / blocked field becomes the empty string; the field id is kept so
 * the segment structure is preserved.
 *
 * @packageDocumentation
 */

import {
  serializeTelecom,
  type TelecomSegment,
  type TelecomTransaction,
} from "@cosyte/ncpdp/telecom";

import type { TransformedLocus } from "../locus.js";
import type { TelecomCoord } from "./extract.js";

/** A working set of field edits for one segment: field index → new value. */
type SegmentEdits = Map<number, string>;

/** Rebuild one segment with the collected field edits applied to fresh field objects. */
function rebuildSegment(seg: TelecomSegment, edits: SegmentEdits): TelecomSegment {
  const fields = seg.fields.map((field, i) => {
    const value = edits.get(i);
    return value === undefined ? field : { ...field, value };
  });
  return { ...seg, fields };
}

/**
 * Write the engine's transformed loci back onto a reconstruction of `original` and return the
 * de-identified NCPDP Telecom byte stream. `transformed` and `coords` are index-aligned (both preserve
 * extraction order).
 *
 * @param original - The parsed transaction to de-identify (never mutated).
 * @param transformed - The engine's transformed loci, in extraction order.
 * @param coords - The write-back coordinates, index-aligned with `transformed`.
 * @returns The de-identified NCPDP Telecom string (canonical, per `serializeTelecom`).
 * @example
 * ```ts
 * import { parseTelecom } from "@cosyte/ncpdp/telecom";
 * import { extractTelecomLoci, applyTelecom } from "@cosyte/deid/ncpdp";
 * import { deidentify } from "@cosyte/deid";
 *
 * const tx = parseTelecom(raw);
 * const { loci, coords } = extractTelecomLoci(tx);
 * const { document } = deidentify({ loci }, { context });
 * const clean = applyTelecom(tx, document.loci, coords); // de-identified Telecom text
 * ```
 */
export function applyTelecom(
  original: TelecomTransaction,
  transformed: readonly TransformedLocus[],
  coords: readonly TelecomCoord[],
): string {
  const bySegment = new Map<number, SegmentEdits>();
  let headerDateOfService: string | undefined;

  for (let i = 0; i < coords.length; i += 1) {
    const coord = coords[i];
    const t = transformed[i];
    if (coord === undefined || t === undefined) continue;
    const value = t.value ?? ""; // removed / blocked → empty value

    if (coord.target === "header-date-of-service") {
      headerDateOfService = value;
      continue;
    }
    const edits = bySegment.get(coord.segmentIndex) ?? new Map<number, string>();
    bySegment.set(coord.segmentIndex, edits);
    edits.set(coord.fieldIndex, value);
  }

  const segments = original.segments.map((seg, segmentIndex) => {
    const edits = bySegment.get(segmentIndex);
    return edits === undefined ? seg : rebuildSegment(seg, edits);
  });

  const header =
    headerDateOfService === undefined
      ? original.header
      : { ...original.header, dateOfService: headerDateOfService };

  const deidentified: TelecomTransaction = { ...original, header, segments };
  return serializeTelecom(deidentified);
}
