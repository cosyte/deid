/**
 * The NCPDP Telecom **extractor** — walks a parsed `@cosyte/ncpdp` `TelecomTransaction` (its fixed
 * header plus its ordered segments of `{ id, value }` fields) and produces the format-agnostic
 * {@link GenericLocus} list the core engine transforms, plus a **parallel coordinate list**
 * ({@link TelecomCoord}) telling the applier exactly which field (or the header date) to rewrite. Loci
 * and coordinates are produced in the same order, so `result.document.loci[i]` corresponds to `coords[i]`.
 *
 * PHI is located **structurally**, per the cited {@link "./locus-map.js"}: the Patient (`01`),
 * Prescriber (`03`), Insurance (`04`), and Coordination-of-Benefits (`05`) segment fields, plus the
 * header's Date of Service. A free-text field ({@link TELECOM_FREE_TEXT_FIELDS}) **fails closed**
 * wherever it appears; a recognized clinical / financial segment is retained untouched (the over-scrub
 * guard); an **unknown segment** fails closed (every field blocked).
 *
 * The `@cosyte/ncpdp` model is immutable, so the extractor never edits it; the applier rebuilds a fresh
 * transaction from these coordinates (see `./apply.js`).
 *
 * @packageDocumentation
 */

import { type TelecomTransaction } from "@cosyte/ncpdp/telecom";

import { SAFE_HARBOR_CATEGORIES, type SafeHarborCategory } from "../categories.js";
import type { GenericLocus } from "../locus.js";
import {
  TELECOM_FREE_TEXT_FIELDS,
  TELECOM_LOCUS_MAP,
  TELECOM_RETAIN_SEGMENTS,
  TELECOM_SEGMENT_RETAIN_FIELDS,
  type TelecomFieldRule,
} from "./locus-map.js";

/**
 * A write-back coordinate — the structural location of one extracted locus in the transaction. Either
 * the fixed header's Date of Service, or the field at `fieldIndex` of the segment at `segmentIndex`.
 * Carries no value.
 */
export type TelecomCoord =
  | { readonly target: "header-date-of-service" }
  | { readonly target: "field"; readonly segmentIndex: number; readonly fieldIndex: number };

/** The paired output of {@link extractTelecomLoci}: loci for the engine + coordinates for the applier. */
export interface TelecomExtraction {
  /** The located candidate values, in document order. */
  readonly loci: GenericLocus[];
  /** The write-back coordinates, index-aligned with {@link loci}. */
  readonly coords: TelecomCoord[];
}

/** Append a locus + its coordinate to the accumulator. */
function push(out: TelecomExtraction, locus: GenericLocus, coord: TelecomCoord): void {
  out.loci.push(locus);
  out.coords.push(coord);
}

/** The generic-locus kind for a mapped field mode. */
function kindForMode(mode: TelecomFieldRule["mode"]): GenericLocus["kind"] {
  if (mode === "date") return "date";
  if (mode === "zip") return "zip";
  return "identifier";
}

/** Emit a fail-closed block locus for a field (category omitted → engine blocks it as (R)). */
function blockField(
  out: TelecomExtraction,
  segId: string,
  fieldId: string,
  value: string,
  coord: TelecomCoord,
): void {
  push(out, { path: `${segId}/${fieldId}`, kind: "identifier", value }, coord);
}

/** Emit a mapped-field locus per its rule (or fail closed when a direct rule lacks a category). */
function emitRule(
  out: TelecomExtraction,
  segId: string,
  fieldId: string,
  value: string,
  rule: TelecomFieldRule,
  coord: TelecomCoord,
): void {
  if (rule.mode === "block" || rule.category === undefined) {
    blockField(out, segId, fieldId, value, coord);
    return;
  }
  const category: SafeHarborCategory = rule.category;
  push(out, { path: `${segId}/${fieldId}`, kind: kindForMode(rule.mode), category, value }, coord);
}

/**
 * Walk a parsed NCPDP Telecom transaction and extract every PHI-bearing (or fail-closed) locus,
 * structurally, from the `@cosyte/ncpdp` model. Never mutates the transaction.
 *
 * @param tx - The parsed Telecom transaction (`parseTelecom(raw)`).
 * @returns The loci (for the engine) and their index-aligned write-back coordinates.
 * @example
 * ```ts
 * import { parseTelecom } from "@cosyte/ncpdp/telecom";
 * import { extractTelecomLoci } from "@cosyte/deid/ncpdp";
 *
 * const { loci } = extractTelecomLoci(parseTelecom(raw));
 * loci.length; // number of located candidate values
 * ```
 */
export function extractTelecomLoci(tx: TelecomTransaction): TelecomExtraction {
  const out: TelecomExtraction = { loci: [], coords: [] };

  // The request header's Date of Service is a date of the individual's care → generalized to year.
  if (tx.kind === "request" && tx.header.dateOfService.trim().length > 0) {
    push(
      out,
      {
        path: "header/dateOfService",
        kind: "date",
        category: SAFE_HARBOR_CATEGORIES.DATES,
        value: tx.header.dateOfService,
      },
      { target: "header-date-of-service" },
    );
  }

  tx.segments.forEach((seg, segmentIndex) => {
    const segId = seg.segmentId;
    const fieldMap = TELECOM_LOCUS_MAP[segId];
    const isMapped = fieldMap !== undefined;
    const isRetained = TELECOM_RETAIN_SEGMENTS.has(segId);
    const retainFields = TELECOM_SEGMENT_RETAIN_FIELDS[segId];

    seg.fields.forEach((field, fieldIndex) => {
      if (field.value.length === 0) return;
      const coord: TelecomCoord = { target: "field", segmentIndex, fieldIndex };

      // Free text fails closed wherever it sits — including inside a retained clinical/response segment.
      if (TELECOM_FREE_TEXT_FIELDS.has(field.id)) {
        push(
          out,
          {
            path: `${segId}/${field.id}`,
            kind: "freetext",
            category: SAFE_HARBOR_CATEGORIES.OTHER_UNIQUE_ID,
            value: field.value,
          },
          coord,
        );
        return;
      }

      if (isMapped && fieldMap !== undefined) {
        const rule = fieldMap[field.id];
        if (rule !== undefined) {
          emitRule(out, segId, field.id, field.value, rule, coord);
          return;
        }
        // Fail closed INSIDE a PHI segment: a populated field that is neither scrubbed nor on the
        // segment's explicit non-identifier retain list is a candidate identifier (Safe Harbor (R)) —
        // blocked, never passed through. This closes the "unmapped identifier field" leak: a Patient
        // e-mail (350-HN), a Medigap id (359-2A), or any un-enumerated id cannot ride through in the clear.
        if (retainFields !== undefined && retainFields.has(field.id)) return; // recognized non-identifier
        blockField(out, segId, field.id, field.value, coord);
        return;
      }
      if (isRetained) return; // recognized clinical / financial segment — retained untouched
      blockField(out, segId, field.id, field.value, coord); // unknown segment → fail closed
    });
  });

  return out;
}
