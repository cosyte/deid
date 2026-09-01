/**
 * The X12 **extractor**: walks a parsed `@cosyte/x12` interchange (Interchange → FunctionalGroup →
 * TransactionSet → Segment) and produces the format-agnostic {@link GenericLocus} list the core engine
 * transforms, plus a **parallel coordinate list** ({@link X12Coord}) telling the applier exactly which
 * element(s) of which raw segment to rewrite. Loci and coordinates are produced in the same order, so
 * `result.document.loci[i]` corresponds to `coords[i]`.
 *
 * PHI is located **structurally**, per the cited {@link "./locus-map.js"}: `NM1` names + identifiers
 * (entity-classified), `N3` / `N4` address, `DMG` date of birth, `PER` telecom, `REF` identifiers
 * (qualifier-classified), `DTP` / `DTM` dates, and the `CLM-01` / `CLP-01` patient account number.
 * Everything else is either a recognized clinical / financial segment (retained untouched, the
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
import { safeLocusToken } from "../derived-token.js";
import type { GenericLocus } from "../locus.js";
import {
  enumerateOrFail,
  UnexaminedResidualBuilder,
  type UnexaminedResidual,
} from "../residual.js";
import {
  X12_ACCOUNT_SEGMENTS,
  X12_FREE_TEXT_ELEMENTS,
  X12_GEO_RETAIN_ELEMENTS,
  X12_GEO_SEGMENTS,
  X12_RETAIN_SEGMENTS,
  X12_UNIVERSAL_SEGMENT_RULES,
  categoryForNm1IdQualifier,
  classifyNm1Party,
  classifyRefQualifier,
  type X12ElementRule,
} from "./locus-map.js";

/**
 * A write-back coordinate: the structural location of one extracted locus in the interchange. The
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
   * whole `NM1` name) lists every component and the applier clears them all. An **empty** list is the
   * write-nothing coordinate of a party-role record: the party's bytes survive untouched.
   */
  readonly elements: readonly number[];
}

/** The paired output of {@link extractX12Loci}: loci for the engine + coordinates for the applier. */
export interface X12Extraction {
  /** The located candidate values, in document order. */
  readonly loci: GenericLocus[];
  /** The write-back coordinates, index-aligned with {@link loci}. */
  readonly coords: X12Coord[];
  /**
   * Every **value-bearing element the pass hands through that no locus rule named**: the elements of a
   * retained clinical / financial / control segment, the unmapped positions of a segment whose mapped
   * ones were acted on, and the interchange and functional-group envelope around them. Counted and
   * located, never transformed.
   */
  readonly unexaminedResiduals: readonly UnexaminedResidual[];
}

/** The mutable pair the walk accumulates into, before it is frozen into an {@link X12Extraction}. */
interface X12LocusAccumulator {
  readonly loci: GenericLocus[];
  readonly coords: X12Coord[];
  /**
   * The elements a locus rule **named**, keyed by segment position: the ones a coordinate writes to,
   * plus the ones a rule reached and decided to leave alone (a party the scope clause does not reach,
   * a recognized administrative `REF`, a geographic element on a segment's non-identifier safe list).
   */
  readonly named: Map<string, Set<number>>;
}

/**
 * The value-free identity of one segment: what a manifest path and a named-element set are keyed on.
 * Held by every segment the pass sees, inside a transaction set or in the envelope around one.
 */
interface SegPos {
  /** This segment's unique identity inside the interchange; the named-element sets are held under it. */
  readonly key: string;
  /** The bounded `ST-01` transaction-set id (`837`), or `""` for a segment outside every transaction set. */
  readonly stId: string;
  /** The bounded segment id, e.g. `NM1`; the key every rule lookup uses. */
  readonly segId: string;
  /** The value-free segment label scoped by occurrence, e.g. `NM1[1]`. */
  readonly segIdBracket: string;
}

/** A {@link SegPos} inside a transaction set, which additionally locates the applier's write-back. */
interface TxSegPos extends SegPos {
  readonly groupIndex: number;
  readonly txIndex: number;
  readonly segIndex: number;
}

/** The only thing reading an element position needs: the 1-indexed element list the parser decoded. */
interface SegmentElements {
  readonly elements: readonly string[];
}

/** Read a 1-indexed raw element value from a segment (`""` when absent). */
function el(seg: SegmentElements, n: number): string {
  return seg.elements[n] ?? "";
}

/** `true` when the element at position `n` carries a non-empty value. */
function has(seg: SegmentElements, n: number): boolean {
  return el(seg, n).length > 0;
}

/**
 * `true` when the element at position `n` is a **value-bearing position**: one carrying a value in the
 * document being processed, which is what the measurement counts.
 *
 * Blank-filled counts as absent, and that is not a convenience: X12 fixes the `ISA` at 106 bytes and
 * space-pads every element in it to its declared width, so an all-blank `ISA-02` is the standard's own
 * spelling of "not used" rather than a value handed through. The rules above keep using {@link has}: what
 * is de-identified may not move on account of a measurement.
 */
function isValueBearing(seg: SegmentElements, n: number): boolean {
  return el(seg, n).trim().length > 0;
}

/** A segment's identity inside the interchange, the key the named-element sets are held under. */
function segKey(pos: SegPos): string {
  return pos.key;
}

/**
 * Record that a locus rule **named** these elements of this segment, whatever it then decided about
 * them. A named element is examined and is never an unexamined residual; an element no rule names is
 * exactly what the enumeration measures.
 */
function name(out: X12LocusAccumulator, pos: SegPos, elements: readonly number[]): void {
  const key = segKey(pos);
  const set = out.named.get(key) ?? new Set<number>();
  for (const element of elements) set.add(element);
  out.named.set(key, set);
}

/** Append a locus + its coordinate to the accumulator; the coordinate's elements are named by it. */
function push(out: X12LocusAccumulator, pos: TxSegPos, locus: GenericLocus, coord: X12Coord): void {
  out.loci.push(locus);
  out.coords.push(coord);
  name(out, pos, coord.elements);
}

/**
 * Build a value-free manifest path for a segment element (`837/NM1[1]-3`). A segment outside every
 * transaction set - the interchange and functional-group envelope - has no `ST-01` to root its path in
 * and prints its own coordinates alone (`ISA[0]-6`), exactly as HL7 v2's `MSH-1` and the CDA document
 * envelope's `title` print theirs.
 */
function path(pos: SegPos, element: number): string {
  const at = `${pos.segIdBracket}-${String(element)}`;
  return pos.stId === "" ? at : `${pos.stId}/${at}`;
}

/** Build a coord for a set of elements at this segment. */
function coord(pos: TxSegPos, elements: readonly number[]): X12Coord {
  return {
    groupIndex: pos.groupIndex,
    txIndex: pos.txIndex,
    segIndex: pos.segIndex,
    elements,
  };
}

/** Emit a fail-closed block locus for one element (category omitted → engine blocks as (R)). */
function blockElement(
  out: X12LocusAccumulator,
  seg: X12Segment,
  pos: TxSegPos,
  element: number,
): void {
  name(out, pos, [element]);
  if (!has(seg, element)) return;
  push(
    out,
    pos,
    { path: path(pos, element), kind: "identifier", value: el(seg, element) },
    coord(pos, [element]),
  );
}

/** Emit a direct-category locus for one element (redact / date / zip). */
function emitRule(
  out: X12LocusAccumulator,
  seg: X12Segment,
  pos: TxSegPos,
  rule: X12ElementRule,
): void {
  name(out, pos, [rule.element]);
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
    pos,
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
  out: X12LocusAccumulator,
  seg: X12Segment,
  pos: TxSegPos,
  element: number,
  category: SafeHarborCategory | undefined,
): void {
  name(out, pos, [element]);
  if (!has(seg, element)) return;
  if (category === undefined) {
    blockElement(out, seg, pos, element); // unknown identifier qualifier → fail closed
    return;
  }
  push(
    out,
    pos,
    { path: path(pos, element), kind: "identifier", category, value: el(seg, element) },
    coord(pos, [element]),
  );
}

/**
 * Record a party the pass is leaving in place because the role its `-01` entity-identifier code names
 * puts it outside §164.514(b)(2)(i)'s scope clause. The record sits at the party's own structural locus
 * (the `-01` element, where the role code lives), carries the role code and **no value at all**, and is
 * given an empty coordinate so the applier writes nothing: the party's bytes are untouched.
 *
 * It is emitted only when the party actually had something to leave in place, so a bare party position
 * with neither a name nor an identifier does not manufacture a row.
 */
function emitRetainedParty(
  out: X12LocusAccumulator,
  seg: X12Segment,
  pos: TxSegPos,
  roleCode: string,
  identityElements: readonly number[],
): void {
  // The party-role test named the role code AND the identity elements it decided to leave in place, so
  // none of them is an unexamined residual: they were retained under a rule, not passed over in silence.
  name(out, pos, [1, ...identityElements]);
  if (!identityElements.some((n) => has(seg, n))) return;
  push(
    out,
    pos,
    { path: path(pos, 1), kind: "identifier", partyRole: roleCode, value: "" },
    coord(pos, []),
  );
}

/** Handle an `NM1`: entity-classified name (03–07) + identifier (09 routed by the 08 qualifier). */
function handleNm1(out: X12LocusAccumulator, seg: X12Segment, pos: TxSegPos): void {
  // The `NM1` rules name the entity code the classification reads, the five name components, the
  // identifier and the qualifier that routes it, whichever branch the party classification then takes.
  name(out, pos, [1, 3, 4, 5, 6, 7, 8, 9]);
  const party = classifyNm1Party(el(seg, 1));
  if (party.scope === "outside-scope") {
    // Recognized provider / organization: retained, and the role code that placed it outside the scope
    // clause is recorded at its locus rather than left to be inferred from an absence.
    emitRetainedParty(out, seg, pos, party.roleCode, [3, 4, 5, 6, 7, 9]);
    return;
  }
  // A party the clause reaches: the individual, a relative, or the individual's EMPLOYER, all on the
  // same footing. An unknown role is not one of them and is not established as outside either, so it
  // fails closed.
  const subject = party.scope === "safe-harbor-subject";

  // Name components NM1-03..07. A subject entity redacts (category NAMES); an unknown entity fails
  // closed (blocked): an unrecognized entity could be the patient, so its name is never passed through.
  const nameElements = [3, 4, 5, 6, 7].filter((n) => has(seg, n));
  if (nameElements.length > 0) {
    if (subject) {
      push(
        out,
        pos,
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
        pos,
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
    const category = subject ? categoryForNm1IdQualifier(el(seg, 8)) : undefined;
    emitId(out, seg, pos, 9, category);
  }
}

/**
 * Handle an `N1` (Party Identification) with the same entity classification as `NM1`: a recognized
 * provider / organization party is retained (payer / payee / provider org identity is not the
 * individual's PHI) **and its role code is recorded** at its locus; a party the scope clause reaches,
 * the individual, a relative or the individual's **employer**, has its name (`N1-02`) removed and its
 * identifier (`N1-04`) routed by the `N1-03` qualifier; an unknown entity code **fails closed** (name +
 * id blocked). `N1` shares the entity-identifier-code (element 98) and identification-code-qualifier
 * (element 66) semantics with `NM1`, so the classifiers are reused.
 */
function handleN1(out: X12LocusAccumulator, seg: X12Segment, pos: TxSegPos): void {
  // The `N1` rules name the same four positions: the entity code, the organisation name, the
  // identification-code qualifier and the identifier it routes.
  name(out, pos, [1, 2, 3, 4]);
  const party = classifyNm1Party(el(seg, 1));
  if (party.scope === "outside-scope") {
    // Recognized org / payer / provider party: retained, with the role code recorded at its locus.
    emitRetainedParty(out, seg, pos, party.roleCode, [2, 4]);
    return;
  }
  const subject = party.scope === "safe-harbor-subject";

  if (has(seg, 2)) {
    if (subject) {
      push(
        out,
        pos,
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
    const category = subject ? categoryForNm1IdQualifier(el(seg, 3)) : undefined;
    emitId(out, seg, pos, 4, category);
  }
}

/** Handle a `REF`: `REF-02` routed by the `REF-01` qualifier (phi → scrub, retain, unknown → block). */
function handleRef(out: X12LocusAccumulator, seg: X12Segment, pos: TxSegPos): void {
  // The qualifier table names both elements on every branch: the qualifier the routing reads and the
  // value it routes. A `retain` outcome is a decision about that value, not a position nothing reached.
  name(out, pos, [1, 2]);
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
function handleAccount(out: X12LocusAccumulator, seg: X12Segment, pos: TxSegPos): void {
  emitId(out, seg, pos, 1, SAFE_HARBOR_CATEGORIES.ACCOUNT);
}

/**
 * Handle a **geographic** segment (`N3` / `N4`) with a fail-closed sweep: every populated element is
 * either applied by its mapped rule (city removed, ZIP generalized), retained if on the segment's
 * non-identifier safe list (`N4-02` state, `N4-04` country), or **blocked**, so an un-enumerated
 * location identifier (`N4-06`) can never ride through in the clear.
 */
function handleGeoSegment(
  out: X12LocusAccumulator,
  seg: X12Segment,
  pos: TxSegPos,
  rules: readonly X12ElementRule[],
): void {
  const ruleByElement = new Map<number, X12ElementRule>();
  for (const rule of rules) ruleByElement.set(rule.element, rule);
  const retain = X12_GEO_RETAIN_ELEMENTS[pos.segId] ?? new Set<number>();
  // The sweep is exhaustive over the segment, so every element of it is named: acted on by its mapped
  // rule, kept because the safe list says it is not an identifier, or blocked. None goes unexamined.
  name(out, pos, [...retain]);
  for (let n = 1; n < seg.elements.length; n += 1) {
    if (!has(seg, n)) continue;
    name(out, pos, [n]);
    const rule = ruleByElement.get(n);
    if (rule !== undefined) {
      emitRule(out, seg, pos, rule);
    } else if (!retain.has(n)) {
      blockElement(out, seg, pos, n); // unmapped geographic element → fail closed
    }
  }
}

/**
 * Block the free-text element(s) of a message segment (`MSG` / `III` / `K3` / `NTE`): free text can
 * carry any of the 18 categories in prose, so it fails closed (never a naive scrub). The segment's other
 * (coded) elements are retained (the over-scrub guard).
 */
function handleFreeTextSegment(
  out: X12LocusAccumulator,
  seg: X12Segment,
  pos: TxSegPos,
  elements: readonly number[],
): void {
  name(out, pos, elements);
  for (const n of elements) {
    if (!has(seg, n)) continue;
    push(
      out,
      pos,
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
function handleUnknown(out: X12LocusAccumulator, seg: X12Segment, pos: TxSegPos): void {
  for (let n = 1; n < seg.elements.length; n += 1) blockElement(out, seg, pos, n);
}

/** Dispatch one segment through the X12 PHI rules. */
function handleSegment(out: X12LocusAccumulator, seg: X12Segment, pos: TxSegPos): void {
  const id = pos.segId;
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
  if (X12_RETAIN_SEGMENTS.has(id)) return; // recognized clinical / financial / control: retained
  handleUnknown(out, seg, pos); // fail closed
}

/**
 * The **envelope** the pass hands through around every transaction set, in the order `serializeX12`
 * re-emits it from the verbatim `raw` text the parser preserved: the interchange header and trailer, any
 * envelope-level `TA1` acknowledgment, and each functional group's header and trailer.
 *
 * All of them are retained structures under exactly the reasoning the `ST` / `SE` pair is: no locus rule
 * looks at one, and retaining a STRUCTURE names no position inside it, so their elements are enumerated
 * rather than passing through in silence. This mirrors the other adapters' envelopes, HL7 v2's `MSH` and
 * the CDA document envelope, both of which are counted.
 *
 * An envelope segment identifier is **not document-derived**: `@cosyte/x12` types each of these as raw
 * text plus decoded elements with no `id` field of its own, so the identifier a caller passes here is the
 * one the standard fixes for that envelope position. Nothing read out of the document is interpolated,
 * which is why these are not passed through {@link safeLocusToken} the way an `X12Segment.id` is.
 */
function envelopePos(segId: string, occurrence: number): SegPos {
  // A group's header and trailer are indexed by the group's own position, so `GS[1]` and `GE[1]` name
  // the same group even when an earlier group arrived truncated with no trailer at all.
  const segIdBracket = `${segId}[${String(occurrence)}]`;
  return { key: `envelope:${segIdBracket}`, stId: "", segId, segIdBracket };
}

/**
 * Walk a parsed X12 interchange and extract every PHI-bearing (or fail-closed) locus, structurally,
 * from the `@cosyte/x12` model. Never mutates the interchange.
 *
 * Every segment is also **enumerated**: the value-bearing elements it hands through that no rule above
 * named are counted and located as unexamined residuals. A retained clinical / financial / control
 * segment contributes all of its elements, because retaining a STRUCTURE names no position inside it;
 * the `ST` / `SE` transaction-set control pair contributes its own, and so does the interchange and
 * functional-group envelope around them ({@link envelopePos}). Nothing is transformed by the count.
 *
 * @param interchange - The parsed X12 interchange (`parseX12(raw)`).
 * @returns The loci (for the engine), their index-aligned write-back coordinates, and the unexamined
 *   residual positions the pass hands through.
 * @throws {@link DeidError} `DEID_POSITIONS_UNENUMERABLE` when a segment's value-bearing elements
 *   cannot be enumerated: the pass fails rather than emit a zero or a partial count.
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
  const out: X12LocusAccumulator = { loci: [], coords: [], named: new Map<string, Set<number>>() };
  const enumerated: { readonly seg: SegmentElements; readonly pos: SegPos }[] = [];
  const envelope = (seg: SegmentElements | undefined, segId: string, occurrence: number): void => {
    if (seg !== undefined) enumerated.push({ seg, pos: envelopePos(segId, occurrence) });
  };

  // Document order, which is the order `serializeX12` re-emits these in and the order the inventory
  // reads in: the interchange header, any envelope-level acknowledgment, then each group wrapping its
  // transaction sets, then the interchange trailer.
  envelope(interchange.isa, "ISA", 0);
  interchange.ta1Segments.forEach((ta1, i) => {
    envelope(ta1, "TA1", i);
  });
  interchange.groups.forEach((group, groupIndex) => {
    envelope(group.gs, "GS", groupIndex);
    group.transactions.forEach((tx, txIndex) => {
      // `ST-01` is a data element the parser copies verbatim, and it is the ROOT of every path this
      // transaction produces; `X12Segment.id` is the token before the first element separator on a
      // line the parser may not have recognized at all. Both are bounded before they are interpolated,
      // and the occurrence counter keys on the bounded id so refused segments stay distinguishable.
      const stId = safeLocusToken(tx.st.elements[1] ?? "", "x12TransactionSetId");
      const occ = new Map<string, number>();
      tx.segments.forEach((seg, segIndex) => {
        const segId = safeLocusToken(seg.id, "x12SegmentId");
        const n = occ.get(segId) ?? 0;
        occ.set(segId, n + 1);
        const pos: TxSegPos = {
          key: `${String(groupIndex)}:${String(txIndex)}:${String(segIndex)}`,
          groupIndex,
          txIndex,
          segIndex,
          stId,
          segId,
          segIdBracket: `${segId}[${String(n)}]`,
        };
        // The envelope control pair carries no patient PHI and no rule looks at it, which is exactly
        // why it is enumerated below rather than skipped: it is handed through, so it is measured.
        if (seg.id !== "ST" && seg.id !== "SE") handleSegment(out, seg, pos);
        enumerated.push({ seg, pos });
      });
    });
    envelope(group.ge, "GE", groupIndex);
  });
  envelope(interchange.iea, "IEA", 0);

  const residuals = new UnexaminedResidualBuilder();
  for (const { seg, pos } of enumerated) {
    enumerateOrFail(pos.segIdBracket, () => {
      recordUnexaminedX12Positions(residuals, seg, pos, out.named.get(segKey(pos)));
    });
  }
  return { loci: out.loci, coords: out.coords, unexaminedResiduals: residuals.build() };
}

/**
 * Enumerate one segment's value-bearing elements and record the ones no locus rule named. A **position**
 * here is one element of one segment (`837/DTP[0]-2`), the unit every X12 locus already uses; element 0
 * is the segment identifier itself and is structure, not a value.
 */
function recordUnexaminedX12Positions(
  residuals: UnexaminedResidualBuilder,
  seg: SegmentElements,
  pos: SegPos,
  named: ReadonlySet<number> | undefined,
): void {
  for (let n = 1; n < seg.elements.length; n += 1) {
    if (named?.has(n) === true) continue;
    if (!isValueBearing(seg, n)) continue;
    residuals.record(path(pos, n));
  }
}
