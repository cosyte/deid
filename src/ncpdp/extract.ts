/**
 * The NCPDP Telecom **extractor**: walks a parsed `@cosyte/ncpdp` `TelecomTransaction` (its fixed
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

import { type TelecomResponseHeader, type TelecomTransaction } from "@cosyte/ncpdp/telecom";

import { SAFE_HARBOR_CATEGORIES, type SafeHarborCategory } from "../categories.js";
import { isWithheldToken, safeLocusToken } from "../derived-token.js";
import type { GenericLocus } from "../locus.js";
import {
  enumerateOrFail,
  UnexaminedResidualBuilder,
  type UnexaminedResidual,
} from "../residual.js";
import {
  TELECOM_FREE_TEXT_FIELDS,
  TELECOM_LOCUS_MAP,
  TELECOM_RETAIN_SEGMENTS,
  TELECOM_SEGMENT_RETAIN_FIELDS,
  type TelecomFieldRule,
} from "./locus-map.js";

/**
 * A write-back coordinate: the structural location of one extracted locus in the transaction. Either
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
  /**
   * Every **value-bearing field the pass hands through that no locus rule named**: the fields of a
   * retained clinical / financial segment, and the positions of the transmission header that is emitted
   * (the response header's own, on a response). Counted and located, never transformed.
   */
  readonly unexaminedResiduals: readonly UnexaminedResidual[];
}

/** The mutable pair the walk accumulates into, before it is frozen into a {@link TelecomExtraction}. */
interface TelecomLocusAccumulator {
  readonly loci: GenericLocus[];
  readonly coords: TelecomCoord[];
}

/** Append a locus + its coordinate to the accumulator. */
function push(out: TelecomLocusAccumulator, locus: GenericLocus, coord: TelecomCoord): void {
  out.loci.push(locus);
  out.coords.push(coord);
}

/**
 * Bound a Segment Identification (111-AM) code or a field identifier before it becomes part of a
 * manifest path. Both are two-character codes on the wire, but the tokenizer reads them off a message
 * it may not have been able to frame, so neither is an identifier until it is checked. A refused code
 * keeps its **structural position** (`<withheld>[2]`) so two refused codes stay distinguishable.
 */
function codeSegment(code: string, position: number): string {
  const token = safeLocusToken(code, "ncpdpCode");
  return isWithheldToken(token) ? `${token}[${String(position)}]` : token;
}

/** The generic-locus kind for a mapped field mode. */
function kindForMode(mode: TelecomFieldRule["mode"]): GenericLocus["kind"] {
  if (mode === "date") return "date";
  if (mode === "zip") return "zip";
  return "identifier";
}

/** Emit a fail-closed block locus for a field (category omitted → engine blocks it as (R)). */
function blockField(
  out: TelecomLocusAccumulator,
  segId: string,
  fieldId: string,
  value: string,
  coord: TelecomCoord,
): void {
  push(out, { path: `${segId}/${fieldId}`, kind: "identifier", value }, coord);
}

/** Emit a mapped-field locus per its rule (or fail closed when a direct rule lacks a category). */
function emitRule(
  out: TelecomLocusAccumulator,
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
 * The transaction is also **enumerated**: the value-bearing fields it hands through that no rule above
 * named are counted and located as unexamined residuals. The retained clinical / financial segments'
 * fields are the bulk of it, and the emitted transmission header's own positions join them: only a
 * request's Date of Service is named. Nothing is transformed on account of the measurement.
 *
 * @param tx - The parsed Telecom transaction (`parseTelecom(raw)`).
 * @returns The loci (for the engine), their index-aligned write-back coordinates, and the unexamined
 *   residual positions the pass hands through.
 * @throws {@link DeidError} `DEID_POSITIONS_UNENUMERABLE` when a segment's value-bearing fields cannot
 *   be enumerated: the pass fails rather than emit a zero or a partial count.
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
  const out: TelecomLocusAccumulator = { loci: [], coords: [] };
  const residuals = new UnexaminedResidualBuilder();

  enumerateOrFail("header", () => {
    recordUnexaminedHeaderPositions(residuals, tx);
  });

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
    // The bounded form is what reaches the manifest; the raw form still drives the rule lookups, which
    // are set/record reads and can never interpolate anything.
    const segPath = codeSegment(segId, segmentIndex);
    const fieldMap = TELECOM_LOCUS_MAP[segId];
    const isMapped = fieldMap !== undefined;
    const isRetained = TELECOM_RETAIN_SEGMENTS.has(segId);
    const retainFields = TELECOM_SEGMENT_RETAIN_FIELDS[segId];

    enumerateOrFail(segPath, () =>
      seg.fields.forEach((field, fieldIndex) => {
        if (field.value.length === 0) return;
        const coord: TelecomCoord = { target: "field", segmentIndex, fieldIndex };
        const fieldPath = codeSegment(field.id, fieldIndex);

        // Free text fails closed wherever it sits, including inside a retained clinical/response segment.
        if (TELECOM_FREE_TEXT_FIELDS.has(field.id)) {
          push(
            out,
            {
              path: `${segPath}/${fieldPath}`,
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
            emitRule(out, segPath, fieldPath, field.value, rule, coord);
            return;
          }
          // Fail closed INSIDE a PHI segment: a populated field that is neither scrubbed nor on the
          // segment's explicit non-identifier retain list is a candidate identifier (Safe Harbor (R)):
          // blocked, never passed through. This closes the "unmapped identifier field" leak: a Patient
          // e-mail (350-HN), a Medigap id (359-2A), or any un-enumerated id cannot ride through in the clear.
          // A field the retain list DOES name is examined: the list is a rule that reached it and kept it.
          if (retainFields !== undefined && retainFields.has(field.id)) return;
          blockField(out, segPath, fieldPath, field.value, coord);
          return;
        }
        if (isRetained) {
          // Recognized clinical / financial segment: the STRUCTURE is retained, which names no field
          // inside it, so every populated field of it is an unexamined residual and is measured as one.
          residuals.record(`${segPath}/${fieldPath}`);
          return;
        }
        blockField(out, segPath, fieldPath, field.value, coord); // unknown segment → fail closed
      }),
    );
  });

  return { loci: out.loci, coords: out.coords, unexaminedResiduals: residuals.build() };
}

/**
 * The transmission header's own value-bearing positions, minus the ones a locus rule names.
 *
 * A header is a fixed-width struct rather than a run of `{ id, value }` fields, so the positions are
 * read off the **decoded header object itself** ({@link headerPositions}) instead of from a list of
 * names written here. That is deliberate and is the difference between an enumeration that is correct
 * and one that stays correct: a hand-written list is right only until the parser's header view grows a
 * field, and a position missing from such a list is exactly the silence this measurement exists to end.
 */
function recordUnexaminedHeaderPositions(
  residuals: UnexaminedResidualBuilder,
  tx: TelecomTransaction,
): void {
  const named = namedHeaderPositions(tx);
  for (const [name, value] of headerPositions(handedThroughHeader(tx))) {
    if (named.has(name)) continue;
    if (value.trim().length > 0) residuals.record(`header/${name}`);
  }
}

/**
 * The positions a locus rule names on the header this pass hands through.
 *
 * Only one rule reaches a header position at all: a **request**'s Date of Service is a date of the
 * individual's care and is generalized to its year. Everything else on either header - the routing,
 * version, transaction, processor-control, count, response-status, service-provider and
 * software-certification positions - is handed through with no decision reached at it.
 */
function namedHeaderPositions(tx: TelecomTransaction): ReadonlySet<string> {
  return tx.kind === "request" ? new Set(["dateOfService"]) : new Set<string>();
}

/**
 * **The header this pass actually hands through**, which is not always `tx.header`.
 *
 * A response transmission is serialized from its own {@link TelecomResponseHeader} (the applier spreads
 * the parsed transaction, so `serializeTelecom` re-emits that header verbatim), and `tx.header` is a
 * *derived view* of it: five of its six fields are lifted across, the request-only fields are left
 * empty, and the Date of Service is not carried at all. Enumerating the derived view instead of the
 * emitted header therefore both **misses** a position - the Header Response Status (501-F1), which the
 * lift does not carry - and would **double-count** the five wire positions it does carry if both were
 * enumerated. So exactly one of the two is enumerated: the one whose bytes reach the output.
 *
 * A transaction that says it is a response but carries no response header is serialized from the
 * request header like any other, so that is the header returned for it.
 */
function handedThroughHeader(
  tx: TelecomTransaction,
): TelecomTransaction["header"] | TelecomResponseHeader {
  const response = tx.responseHeader;
  return tx.kind === "response" && response !== undefined ? response : tx.header;
}

/**
 * Every position a decoded header carries, read off **its own keys**.
 *
 * The parser hands back a frozen object of `string` fields, one per positional header field, each named
 * for the field it decoded. Iterating that object is what makes the enumeration closed: a field the
 * parser's header view gains is enumerated the day it appears, under its own name, without this module
 * being told about it. A non-string property (were one ever added) is not a decoded wire position and is
 * skipped rather than stringified, which would put a shape into a locus.
 *
 * The key is the parser's own field name, not document content: it is fixed by the header's type and no
 * byte of the transmission can change it, so nothing document-derived reaches the locus here.
 */
function headerPositions(
  header: TelecomTransaction["header"] | TelecomResponseHeader,
): readonly (readonly [string, string])[] {
  const positions: (readonly [string, string])[] = [];
  for (const [name, value] of Object.entries(header)) {
    if (typeof value === "string") positions.push([name, value]);
  }
  return positions;
}
