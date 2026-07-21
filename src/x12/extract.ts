/**
 * The X12 **extractor** — walks a parsed `@cosyte/x12` interchange (Interchange → FunctionalGroup →
 * TransactionSet → Segment) and produces the format-agnostic {@link GenericLocus} list the core engine
 * transforms, plus a **parallel coordinate list** ({@link X12Coord}) telling the applier exactly which
 * element(s) of which raw segment to rewrite. Loci and coordinates are produced in the same order, so
 * `result.document.loci[i]` corresponds to `coords[i]`.
 *
 * PHI is located **structurally**, per the cited {@link "./locus-map.js"}: `NM1` names + identifiers
 * (entity-classified), `N3` / `N4` address, `DMG` date of birth, `PER` telecom, `REF` identifiers
 * (qualifier-classified), `DTP` / `DTM` dates, and the `CLM-01` / `CLP-01` patient account number.
 * Everything else is either a recognized clinical / financial segment (retained untouched — the
 * over-scrub guard) or an **unknown segment**, which **fails closed** (every populated element blocked).
 *
 * The `@cosyte/x12` model is immutable and its serializer reconstructs from the verbatim `rawSegments`
 * strings, so the extractor never edits the tree; the applier rebuilds the affected raw segments (see
 * `./apply.js`).
 *
 * @packageDocumentation
 */

import { type X12Interchange, type X12Segment } from "@cosyte/x12";

import { SAFE_HARBOR_CATEGORIES, type SafeHarborCategory } from "../categories.js";
import type { GenericLocus } from "../locus.js";
import {
  X12_ACCOUNT_SEGMENTS,
  X12_FREE_TEXT_ELEMENTS,
  X12_GEO_RETAIN_ELEMENTS,
  X12_GEO_SEGMENTS,
  X12_RETAIN_SEGMENTS,
  X12_UNIVERSAL_SEGMENT_RULES,
  categoryForNm1IdQualifier,
  classifyNm1Entity,
  classifyRefQualifier,
  type X12ElementRule,
} from "./locus-map.js";

/**
 * A write-back coordinate — the structural location of one extracted locus in the interchange. The
 * applier resolves `groups[groupIndex].transactions[txIndex]` and rewrites `elements[e]` (for each `e`
 * in {@link elements}) of the segment at `segIndex` in that transaction's raw stream. Carries no value.
 */
export interface X12Coord {
  /** Index of the functional group in `interchange.groups`. */
  readonly groupIndex: number;
  /** Index of the transaction set in the group's `transactions`. */
  readonly txIndex: number;
  /** Index of the segment in the transaction's `segments` / `rawSegments` (they are index-aligned). */
  readonly segIndex: number;
  /**
   * The 1-based element position(s) this locus governs. A single-value transform (date / zip / id)
   * lists one element and the applier writes the transformed value there; a multi-element redact (a
   * whole `NM1` name) lists every component and the applier clears them all.
   */
  readonly elements: readonly number[];
}

/** The paired output of {@link extractX12Loci}: loci for the engine + coordinates for the applier. */
export interface X12Extraction {
  /** The located candidate values, in document order. */
  readonly loci: GenericLocus[];
  /** The write-back coordinates, index-aligned with {@link loci}. */
  readonly coords: X12Coord[];
}

/** The per-segment position needed to build a coord and a value-free path. */
interface SegPos {
  readonly groupIndex: number;
  readonly txIndex: number;
  readonly segIndex: number;
  readonly stId: string;
  /** The value-free segment label scoped by occurrence, e.g. `NM1[1]`. */
  readonly segIdBracket: string;
}

/** Read a 1-indexed raw element value from a segment (`""` when absent). */
function el(seg: X12Segment, n: number): string {
  return seg.elements[n] ?? "";
}

/** `true` when the element at position `n` carries a non-empty value. */
function has(seg: X12Segment, n: number): boolean {
  return el(seg, n).length > 0;
}

/** Append a locus + its coordinate to the accumulator. */
function push(out: X12Extraction, locus: GenericLocus, coord: X12Coord): void {
  out.loci.push(locus);
  out.coords.push(coord);
}

/** Build a value-free manifest path for a segment element (`837/NM1[1]-03`). */
function path(pos: SegPos, element: number): string {
  return `${pos.stId}/${pos.segIdBracket}-${String(element)}`;
}

/** Build a coord for a set of elements at this segment. */
function coord(pos: SegPos, elements: readonly number[]): X12Coord {
  return {
    groupIndex: pos.groupIndex,
    txIndex: pos.txIndex,
    segIndex: pos.segIndex,
    elements,
  };
}

/** Emit a fail-closed block locus for one element (category omitted → engine blocks as (R)). */
function blockElement(out: X12Extraction, seg: X12Segment, pos: SegPos, element: number): void {
  if (!has(seg, element)) return;
  push(
    out,
    { path: path(pos, element), kind: "identifier", value: el(seg, element) },
    coord(pos, [element]),
  );
}

/** Emit a direct-category locus for one element (redact / date / zip). */
function emitRule(out: X12Extraction, seg: X12Segment, pos: SegPos, rule: X12ElementRule): void {
  if (!has(seg, rule.element)) return;
  if (rule.mode === "block") {
    blockElement(out, seg, pos, rule.element);
    return;
  }
  // rule.category is required for every non-block mode (the discriminated union guarantees it).
  const kind: GenericLocus["kind"] =
    rule.mode === "date" ? "date" : rule.mode === "zip" ? "zip" : "identifier";
  push(
    out,
    {
      path: path(pos, rule.element),
      kind,
      category: rule.category,
      value: el(seg, rule.element),
    },
    coord(pos, [rule.element]),
  );
}

/** Emit an identifier locus routed to a resolved category, or fail closed when the category is unknown. */
function emitId(
  out: X12Extraction,
  seg: X12Segment,
  pos: SegPos,
  element: number,
  category: SafeHarborCategory | undefined,
): void {
  if (!has(seg, element)) return;
  if (category === undefined) {
    blockElement(out, seg, pos, element); // unknown identifier qualifier → fail closed
    return;
  }
  push(
    out,
    { path: path(pos, element), kind: "identifier", category, value: el(seg, element) },
    coord(pos, [element]),
  );
}

/** Handle an `NM1`: entity-classified name (03–07) + identifier (09 routed by the 08 qualifier). */
function handleNm1(out: X12Extraction, seg: X12Segment, pos: SegPos): void {
  const disposition = classifyNm1Entity(el(seg, 1));
  if (disposition === "provider") return; // recognized provider / organization — retained (§5)

  // Name components NM1-03..07. A patient entity redacts (category NAMES); an unknown entity fails
  // closed (blocked) — an unrecognized entity could be the patient, so its name is never passed through.
  const nameElements = [3, 4, 5, 6, 7].filter((n) => has(seg, n));
  if (nameElements.length > 0) {
    if (disposition === "patient") {
      push(
        out,
        {
          path: path(pos, 3),
          kind: "identifier",
          category: SAFE_HARBOR_CATEGORIES.NAMES,
          value: nameElements.map((n) => el(seg, n)).join(" "),
        },
        coord(pos, nameElements),
      );
    } else {
      push(
        out,
        {
          path: path(pos, 3),
          kind: "identifier",
          value: nameElements.map((n) => el(seg, n)).join(" "),
        },
        coord(pos, nameElements),
      );
    }
  }

  // Identifier NM1-09, routed by the NM1-08 qualifier. An unknown/absent qualifier fails closed.
  if (has(seg, 9)) {
    const category = disposition === "patient" ? categoryForNm1IdQualifier(el(seg, 8)) : undefined;
    emitId(out, seg, pos, 9, category);
  }
}

/**
 * Handle an `N1` (Party Identification) with the same entity classification as `NM1`: a recognized
 * provider / organization party is retained (payer / payee / provider org identity is not the
 * individual's PHI); a patient-side individual party has its name (`N1-02`) removed and its identifier
 * (`N1-04`) routed by the `N1-03` qualifier; an unknown entity code **fails closed** (name + id blocked).
 * `N1` shares the entity-identifier-code (element 98) and identification-code-qualifier (element 66)
 * semantics with `NM1`, so the classifiers are reused.
 */
function handleN1(out: X12Extraction, seg: X12Segment, pos: SegPos): void {
  const disposition = classifyNm1Entity(el(seg, 1));
  if (disposition === "provider") return; // recognized org / payer / provider party — retained

  if (has(seg, 2)) {
    if (disposition === "patient") {
      push(
        out,
        {
          path: path(pos, 2),
          kind: "identifier",
          category: SAFE_HARBOR_CATEGORIES.NAMES,
          value: el(seg, 2),
        },
        coord(pos, [2]),
      );
    } else {
      blockElement(out, seg, pos, 2); // unknown entity → fail closed
    }
  }
  if (has(seg, 4)) {
    const category = disposition === "patient" ? categoryForNm1IdQualifier(el(seg, 3)) : undefined;
    emitId(out, seg, pos, 4, category);
  }
}

/** Handle a `REF`: `REF-02` routed by the `REF-01` qualifier (phi → scrub, retain, unknown → block). */
function handleRef(out: X12Extraction, seg: X12Segment, pos: SegPos): void {
  if (!has(seg, 2)) return;
  const disposition = classifyRefQualifier(el(seg, 1));
  if (disposition.kind === "retain") return; // recognized administrative / provider reference
  if (disposition.kind === "block") {
    blockElement(out, seg, pos, 2); // unknown qualifier → fail closed (category R)
    return;
  }
  emitId(out, seg, pos, 2, disposition.category);
}

/** Handle a `CLM` / `CLP`: pseudonymize the `-01` patient account number; retain the rest. */
function handleAccount(out: X12Extraction, seg: X12Segment, pos: SegPos): void {
  emitId(out, seg, pos, 1, SAFE_HARBOR_CATEGORIES.ACCOUNT);
}

/**
 * Handle a **geographic** segment (`N3` / `N4`) with a fail-closed sweep: every populated element is
 * either applied by its mapped rule (city removed, ZIP generalized), retained if on the segment's
 * non-identifier safe list (`N4-02` state, `N4-04` country), or **blocked** — so an un-enumerated
 * location identifier (`N4-06`) can never ride through in the clear.
 */
function handleGeoSegment(
  out: X12Extraction,
  seg: X12Segment,
  pos: SegPos,
  rules: readonly X12ElementRule[],
): void {
  const ruleByElement = new Map<number, X12ElementRule>();
  for (const rule of rules) ruleByElement.set(rule.element, rule);
  const retain = X12_GEO_RETAIN_ELEMENTS[seg.id] ?? new Set<number>();
  for (let n = 1; n < seg.elements.length; n += 1) {
    if (!has(seg, n)) continue;
    const rule = ruleByElement.get(n);
    if (rule !== undefined) {
      emitRule(out, seg, pos, rule);
    } else if (!retain.has(n)) {
      blockElement(out, seg, pos, n); // unmapped geographic element → fail closed
    }
  }
}

/**
 * Block the free-text element(s) of a message segment (`MSG` / `III` / `K3` / `NTE`) — free text can
 * carry any of the 18 categories in prose, so it fails closed (never a naive scrub). The segment's other
 * (coded) elements are retained (the over-scrub guard).
 */
function handleFreeTextSegment(
  out: X12Extraction,
  seg: X12Segment,
  pos: SegPos,
  elements: readonly number[],
): void {
  for (const n of elements) {
    if (!has(seg, n)) continue;
    push(
      out,
      {
        path: path(pos, n),
        kind: "freetext",
        category: SAFE_HARBOR_CATEGORIES.OTHER_UNIQUE_ID,
        value: el(seg, n),
      },
      coord(pos, [n]),
    );
  }
}

/** Fail closed on an unknown segment: block every populated element (unrecognized structure). */
function handleUnknown(out: X12Extraction, seg: X12Segment, pos: SegPos): void {
  for (let n = 1; n < seg.elements.length; n += 1) blockElement(out, seg, pos, n);
}

/** Dispatch one segment through the X12 PHI rules. */
function handleSegment(out: X12Extraction, seg: X12Segment, pos: SegPos): void {
  const id = seg.id;
  if (id === "NM1") {
    handleNm1(out, seg, pos);
    return;
  }
  if (id === "N1") {
    handleN1(out, seg, pos);
    return;
  }
  if (id === "REF") {
    handleRef(out, seg, pos);
    return;
  }
  if (X12_ACCOUNT_SEGMENTS.has(id)) {
    handleAccount(out, seg, pos);
    return;
  }
  const freeText = X12_FREE_TEXT_ELEMENTS[id];
  if (freeText !== undefined) {
    handleFreeTextSegment(out, seg, pos, freeText);
    return;
  }
  const universal = X12_UNIVERSAL_SEGMENT_RULES[id];
  if (universal !== undefined) {
    // Geographic segments fail closed on unmapped elements (a location identifier could leak); the
    // demographic segments (DMG/PER/DTP/DTM) carry only non-identifier codes in their unmapped
    // positions and retain them (the over-scrub guard), matching the HL7 adapter.
    if (X12_GEO_SEGMENTS.has(id)) {
      handleGeoSegment(out, seg, pos, universal);
      return;
    }
    for (const rule of universal) emitRule(out, seg, pos, rule);
    return;
  }
  if (X12_RETAIN_SEGMENTS.has(id)) return; // recognized clinical / financial / control — retained
  handleUnknown(out, seg, pos); // fail closed
}

/**
 * Walk a parsed X12 interchange and extract every PHI-bearing (or fail-closed) locus, structurally,
 * from the `@cosyte/x12` model. Never mutates the interchange.
 *
 * @param interchange - The parsed X12 interchange (`parseX12(raw)`).
 * @returns The loci (for the engine) and their index-aligned write-back coordinates.
 * @example
 * ```ts
 * import { parseX12 } from "@cosyte/x12";
 * import { extractX12Loci } from "@cosyte/deid/x12";
 *
 * const { loci } = extractX12Loci(parseX12(raw));
 * loci.length; // number of located candidate values
 * ```
 */
export function extractX12Loci(interchange: X12Interchange): X12Extraction {
  const out: X12Extraction = { loci: [], coords: [] };

  interchange.groups.forEach((group, groupIndex) => {
    group.transactions.forEach((tx, txIndex) => {
      const stId = tx.st.elements[1] ?? "";
      const occ = new Map<string, number>();
      tx.segments.forEach((seg, segIndex) => {
        if (seg.id === "ST" || seg.id === "SE") return; // envelope control — no patient PHI
        const n = occ.get(seg.id) ?? 0;
        occ.set(seg.id, n + 1);
        const pos: SegPos = {
          groupIndex,
          txIndex,
          segIndex,
          stId,
          segIdBracket: `${seg.id}[${String(n)}]`,
        };
        handleSegment(out, seg, pos);
      });
    });
  });

  return out;
}
