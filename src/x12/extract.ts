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
 * Everything else is either a recognized clinical / financial segment (each element kept when it has
 * the shape its position expects, the over-scrub guard) or a segment whose identifier the pass does not
 * recognize, which **fails closed**: it is removed whole, identifier included, and every value it
 * carried is recorded.
 *
 * The `@cosyte/x12` model is immutable and its serializer reconstructs from the verbatim `rawSegments`
 * strings, so the extractor never edits the tree; the applier rebuilds the affected raw segments (see
 * `./apply.js`).
 *
 * @packageDocumentation
 */

import { type X12Interchange, type X12Segment } from "@cosyte/x12";

import { SAFE_HARBOR_CATEGORIES, type SafeHarborCategory } from "../categories.js";
import { WITHHELD_LOCUS_TOKEN, safeLocusToken } from "../derived-token.js";
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
  isRecognizedX12Code,
  type X12ElementRule,
} from "./locus-map.js";
import {
  X12_ELEMENT_SHAPES,
  X12_RULE_DATE_FORMATS,
  isX12DateInFormat,
  type X12DateFormatSource,
  type X12ElementShape,
  type X12ShapeContext,
} from "./element-shapes.js";

/**
 * Where a segment outside every transaction set sits: the interchange header (`ISA`), an envelope-level
 * acknowledgment (`TA1`, by its index), a functional group's header or trailer (`GS` / `GE`, by the
 * group's index), the interchange trailer (`IEA`), a segment the parser found outside every transaction
 * set (`orphan`, by its index in `orphanSegments`), or the bytes the parser kept after the `IEA`
 * (`trailing`, index `0`).
 */
export interface X12EnvelopeAddress {
  /** Which envelope segment, `orphan`, or `trailing`. */
  readonly segment: "ISA" | "TA1" | "GS" | "GE" | "IEA" | "orphan" | "trailing";
  /** The index of that segment among its kind (`0` for `ISA` and `IEA`). */
  readonly index: number;
}

/**
 * A write-back coordinate: the structural location of one extracted locus in the interchange. The
 * applier resolves `groups[groupIndex].transactions[txIndex]` and rewrites `elements[e]` (for each `e`
 * in {@link elements}) of the segment at `segIndex` in that transaction's raw stream. Carries no value.
 */
export interface X12Coord {
  /** Index of the functional group in `interchange.groups` (`-1` for an {@link envelope} segment). */
  readonly groupIndex: number;
  /** Index of the transaction set in the group's `transactions` (`-1` for an {@link envelope} segment). */
  readonly txIndex: number;
  /**
   * Index of the segment in the transaction's `segments` / `rawSegments` (they are index-aligned), or
   * `-1` for an {@link envelope} segment.
   */
  readonly segIndex: number;
  /**
   * The 1-based element position(s) this locus governs. A single-value transform (date / zip / id)
   * lists one element and the applier writes the transformed value there; a multi-element redact (a
   * whole `NM1` name) lists every component and the applier clears them all. An **empty** list is the
   * write-nothing coordinate of a party-role record: the party's bytes survive untouched.
   */
  readonly elements: readonly number[];
  /**
   * The 1-based component this locus governs inside the one element {@link elements} lists, when the
   * locus is one component of a composite (a date inside an `HI` entry, a free-text description inside
   * a procedure composite). The applier rewrites that component and leaves its siblings as they were.
   */
  readonly component?: number;
  /**
   * Set when the segment sits outside every transaction set: the interchange and functional-group
   * envelope, or a segment the parser found outside every transaction set. The applier rewrites that
   * segment instead of a transaction's.
   */
  readonly envelope?: X12EnvelopeAddress;
  /**
   * Set when the segment this locus sits in is **removed whole**: a segment whose identifier the pass
   * does not recognize, or a segment outside every transaction set. The applier drops the segment from
   * the output instead of rewriting one element, and reduces the `SE-01` segment count of the
   * transaction set it sat in by one.
   */
  readonly segmentRemoved?: boolean;
}

/** The paired output of {@link extractX12Loci}: loci for the engine + coordinates for the applier. */
export interface X12Extraction {
  /** The located candidate values, in document order. */
  readonly loci: GenericLocus[];
  /** The write-back coordinates, index-aligned with {@link loci}. */
  readonly coords: X12Coord[];
  /**
   * Every **value-bearing element the pass hands through that no rule decided**. Every element of every
   * segment is now decided: acted on by a locus rule, kept because it has the shape its position
   * expects (see `./element-shapes.js`), or removed and recorded. So this is a measured zero; it stays
   * as the independent count that would show a position a future rule forgot to decide.
   */
  readonly unexaminedResiduals: readonly UnexaminedResidual[];
}

/** The mutable pair the walk accumulates into, before it is frozen into an {@link X12Extraction}. */
interface X12LocusAccumulator {
  readonly loci: GenericLocus[];
  readonly coords: X12Coord[];
  /**
   * The elements a rule **decided**, keyed by segment position: the ones a coordinate writes to, plus
   * the ones a rule reached and decided to keep (a party the scope clause does not reach, a recognized
   * administrative `REF`, a code or date of the shape its position expects).
   */
  readonly named: Map<string, Set<number>>;
  /** The interchange's component and repetition separators, which a composite or repeating shape reads. */
  readonly delimiters: { readonly component: string; readonly repetition: string };
}

/**
 * The value-free identity of one segment: what a manifest path and a named-element set are keyed on.
 * Held by every segment the pass sees, inside a transaction set or in the envelope around one.
 */
interface SegPos {
  /** This segment's unique identity inside the interchange; the named-element sets are held under it. */
  readonly key: string;
  /**
   * The root of every path this segment prints: the bounded `ST-01` transaction-set id (`837`), `orphan`
   * for a segment the parser found outside every transaction set, or `""` for the envelope.
   */
  readonly stId: string;
  /** The bounded segment id, e.g. `NM1`; the key every rule lookup uses. */
  readonly segId: string;
  /** The value-free segment label scoped by occurrence, e.g. `NM1[1]`. */
  readonly segIdBracket: string;
  /** Where the applier finds this segment: everything a coordinate carries except its elements. */
  readonly at: Omit<X12Coord, "elements" | "component">;
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
 * The segment identifiers the pass **recognizes inside a transaction set**: every segment a locus rule
 * acts on, and every segment it retains and decides by shape (`ST` and `SE` among them). An identifier
 * outside this set is not trusted as an identifier at all. The usual way one gets there is an extra
 * segment terminator or a missing element separator after the identifier, which puts a value (a member
 * id, a date of birth, a last name, a whole segment run together) where the identifier belongs, so a
 * segment with any other identifier is removed whole.
 */
const X12_RECOGNIZED_SEGMENT_IDS: ReadonlySet<string> = new Set<string>([
  "NM1",
  "N1",
  "REF",
  ...X12_ACCOUNT_SEGMENTS,
  ...Object.keys(X12_FREE_TEXT_ELEMENTS),
  ...Object.keys(X12_UNIVERSAL_SEGMENT_RULES),
  ...X12_RETAIN_SEGMENTS,
]);

/**
 * The envelope segment identifiers. Inside a transaction set none of them is a body segment, but a
 * segment the parser found outside every transaction set can be one (a `TA1` inside an open group, a
 * `GE` closing nothing), and its identifier is then printed in its `orphan` path like any it knows.
 */
const X12_ENVELOPE_SEGMENT_IDS: ReadonlySet<string> = new Set<string>([
  "ISA",
  "TA1",
  "GS",
  "GE",
  "IEA",
]);

/**
 * The one X12 segment whose elements are **fixed-width and space-padded by the standard**: the `ISA` is
 * exactly 106 bytes, and every element in it is padded to its declared width, so an all-blank `ISA-02`
 * is the standard's own spelling of "not used" rather than a value the sender wrote. Every other segment
 * is variable-length and pads nothing, so whitespace there is content.
 */
const FIXED_WIDTH_SEGMENT_ID = "ISA";

/**
 * `true` when the element at position `n` is a **value-bearing position**: one carrying a non-empty value
 * in the document being processed, which is what the measurement counts.
 *
 * The test is `length > 0`, the same one the locus rules use, **except inside the `ISA`**
 * ({@link FIXED_WIDTH_SEGMENT_ID}), where the standard's own padding makes an all-blank element an
 * absence rather than a value. Everywhere else a whitespace-only element is content the serializer
 * re-emits from the segment's verbatim `raw` text, so it is handed through and is counted: the
 * definition says non-empty, and reading it as "non-blank" would silently drop a class of position the
 * pass really does pass on. The rules themselves are untouched by any of this: what is de-identified may
 * not move on account of a measurement.
 */
function isValueBearing(seg: SegmentElements, segId: string, n: number): boolean {
  const raw = el(seg, n);
  return segId === FIXED_WIDTH_SEGMENT_ID ? raw.trim().length > 0 : raw.length > 0;
}

/** A segment's identity inside the interchange, the key the named-element sets are held under. */
function segKey(pos: SegPos): string {
  return pos.key;
}

/**
 * Record that a rule **decided** these elements of this segment: acted on them, kept them, or removed
 * them. A decided element is never an unexamined residual, and the closing sweep
 * ({@link closeSegment}) leaves it alone.
 */
function name(out: X12LocusAccumulator, pos: SegPos, elements: readonly number[]): void {
  const key = segKey(pos);
  const set = out.named.get(key) ?? new Set<number>();
  for (const element of elements) set.add(element);
  out.named.set(key, set);
}

/** Append a locus + its coordinate to the accumulator; the coordinate's elements are named by it. */
function push(out: X12LocusAccumulator, pos: SegPos, locus: GenericLocus, coord: X12Coord): void {
  out.loci.push(locus);
  out.coords.push(coord);
  name(out, pos, coord.elements);
}

/**
 * Build a value-free manifest path for a segment element (`837/NM1[1]-3`). A segment outside every
 * transaction set - the interchange and functional-group envelope - has no `ST-01` to root its path in
 * and prints its own coordinates alone (`ISA[0]-6`), exactly as HL7 v2's `MSH-1` and the CDA document
 * envelope's `title` print theirs. A segment the parser found outside every transaction set prints under
 * `orphan` (`orphan/NM1[0]-3`), which no three-character `ST-01` can spell.
 */
function path(pos: SegPos, element: number): string {
  const at = `${pos.segIdBracket}-${String(element)}`;
  return pos.stId === "" ? at : `${pos.stId}/${at}`;
}

/** Build a coord for a set of elements at this segment. */
function coord(pos: SegPos, elements: readonly number[]): X12Coord {
  return { ...pos.at, elements };
}

/** Emit a fail-closed block locus for one element (category omitted → engine blocks as (R)). */
function blockElement(
  out: X12LocusAccumulator,
  seg: SegmentElements,
  pos: SegPos,
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

/** Read the declared format a date position names, exactly as written (`""` when absent). */
function declaredFormat(
  source: X12DateFormatSource,
  seg: SegmentElements,
  components: readonly string[],
): string {
  if (source.from === "fixed") return source.format;
  if (source.from === "element") return el(seg, source.position);
  return components[source.position - 1] ?? "";
}

/**
 * Emit a date locus for one element when its value is a valid date in the format the segment declares,
 * and remove and record it otherwise. A value that is no date in the declared format (an identifier
 * shifted there, a date in some other format, a time of day) is not trusted as a date: a date transform
 * would keep whatever its front looked like.
 */
function emitDate(
  out: X12LocusAccumulator,
  seg: SegmentElements,
  pos: SegPos,
  element: number,
  category: SafeHarborCategory,
  source: X12DateFormatSource | undefined,
): void {
  const value = el(seg, element);
  const format = source === undefined ? "" : declaredFormat(source, seg, []);
  if (!isX12DateInFormat(value, format)) {
    blockElement(out, seg, pos, element);
    return;
  }
  push(
    out,
    pos,
    { path: path(pos, element), kind: "date", category, value },
    coord(pos, [element]),
  );
}

/** Emit a direct-category locus for one element (redact / date / zip). */
function emitRule(
  out: X12LocusAccumulator,
  seg: X12Segment,
  pos: SegPos,
  rule: X12ElementRule,
): void {
  name(out, pos, [rule.element]);
  if (!has(seg, rule.element)) return;
  if (rule.mode === "block") {
    blockElement(out, seg, pos, rule.element);
    return;
  }
  // rule.category is required for every non-block mode (the discriminated union guarantees it).
  if (rule.mode === "date") {
    const source = X12_RULE_DATE_FORMATS.get(`${pos.segId}-${String(rule.element)}`);
    emitDate(out, seg, pos, rule.element, rule.category, source);
    return;
  }
  const kind: GenericLocus["kind"] = rule.mode === "zip" ? "zip" : "identifier";
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
  pos: SegPos,
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
 * Decide a **code position** the rules read and keep (an entity code, an identification code qualifier, a
 * `REF` qualifier, an `N4` state or country). A recognized code stays where it is: the position is named
 * and nothing is written. Anything else is not trusted as a code. The usual way an identifier gets there
 * is a missing element separator that shifts it left by one position, and a kept value would leave with
 * no manifest row and no unexamined residual, because the position counts as examined. So it fails
 * closed exactly as an unrecognized structure does: removed, and recorded at its own position.
 */
function keepCodeOrBlock(
  out: X12LocusAccumulator,
  seg: X12Segment,
  pos: SegPos,
  element: number,
): void {
  name(out, pos, [element]);
  if (!has(seg, element)) return;
  if (isRecognizedX12Code(pos.segId, element, el(seg, element))) return;
  blockElement(out, seg, pos, element);
}

/**
 * Read the code at a code position for a classifier, **only when it passed the exact check**. A value
 * the position's code list does not hold, exactly as written, was removed by {@link keepCodeOrBlock};
 * it is equally untrusted as a code to route on, so the classifier sees `""` and routes the party or
 * reference as unknown, which fails closed. A classifier that folded case or trimmed the raw value
 * instead would keep a name or an identifier on the strength of a code the pass itself refused.
 */
function trustedCode(seg: X12Segment, segId: string, element: number): string {
  const value = el(seg, element);
  return isRecognizedX12Code(segId, element, value) ? value : "";
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
  pos: SegPos,
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

/** Handle an `NM1`: entity-classified name (03 to 07) + identifier (09 routed by the 08 qualifier). */
function handleNm1(out: X12LocusAccumulator, seg: X12Segment, pos: SegPos): void {
  keepCodeOrBlock(out, seg, pos, 1);
  // The classifier reads the entity code only when it passed the exact check; anything else is unknown.
  const party = classifyNm1Party(trustedCode(seg, "NM1", 1));
  if (party.scope === "outside-scope") {
    // Recognized provider / organization: retained, and the role code that placed it outside the scope
    // clause is recorded at its locus rather than left to be inferred from an absence. Its qualifier is
    // still only kept when it is a qualifier.
    emitRetainedParty(out, seg, pos, party.roleCode, [3, 4, 5, 6, 7, 9]);
    keepCodeOrBlock(out, seg, pos, 8);
    return;
  }
  // A party the clause reaches: the individual, a relative, or the individual's EMPLOYER, all on the
  // same footing. An unknown role is not one of them and is not established as outside either, so it
  // fails closed.
  const subject = party.scope === "safe-harbor-subject";

  // Name components NM1-03..07. A subject entity redacts (category NAMES); an unknown entity fails
  // closed (blocked): an unrecognized entity could be the patient, so its name is never passed through.
  name(out, pos, [3, 4, 5, 6, 7]);
  const nameElements = [3, 4, 5, 6, 7].filter((n) => has(seg, n));
  if (nameElements.length > 0) {
    push(
      out,
      pos,
      {
        path: path(pos, 3),
        kind: "identifier",
        ...(subject ? { category: SAFE_HARBOR_CATEGORIES.NAMES } : {}),
        value: nameElements.map((n) => el(seg, n)).join(" "),
      },
      coord(pos, nameElements),
    );
  }

  // Identifier NM1-09, routed by the NM1-08 qualifier. An unknown/absent qualifier fails closed, and a
  // qualifier position holding something that is no qualifier is itself removed and routes nothing.
  keepCodeOrBlock(out, seg, pos, 8);
  const category = subject ? categoryForNm1IdQualifier(trustedCode(seg, "NM1", 8)) : undefined;
  emitId(out, seg, pos, 9, category);
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
function handleN1(out: X12LocusAccumulator, seg: X12Segment, pos: SegPos): void {
  keepCodeOrBlock(out, seg, pos, 1);
  const party = classifyNm1Party(trustedCode(seg, "N1", 1));
  if (party.scope === "outside-scope") {
    // Recognized org / payer / provider party: retained, with the role code recorded at its locus.
    emitRetainedParty(out, seg, pos, party.roleCode, [2, 4]);
    keepCodeOrBlock(out, seg, pos, 3);
    return;
  }
  const subject = party.scope === "safe-harbor-subject";

  if (subject) {
    emitId(out, seg, pos, 2, SAFE_HARBOR_CATEGORIES.NAMES);
  } else {
    blockElement(out, seg, pos, 2); // unknown entity → fail closed
  }
  keepCodeOrBlock(out, seg, pos, 3);
  const category = subject ? categoryForNm1IdQualifier(trustedCode(seg, "N1", 3)) : undefined;
  emitId(out, seg, pos, 4, category);
}

/** Handle a `REF`: `REF-02` routed by the `REF-01` qualifier (phi → scrub, retain, unknown → block). */
function handleRef(out: X12LocusAccumulator, seg: X12Segment, pos: SegPos): void {
  keepCodeOrBlock(out, seg, pos, 1);
  // The qualifier routes REF-02 only when it passed the exact check; anything else routes as unknown.
  const disposition = classifyRefQualifier(trustedCode(seg, "REF", 1));
  if (disposition.kind === "retain") {
    name(out, pos, [2]); // recognized administrative / provider reference
    return;
  }
  // An unknown qualifier fails closed (category R); a patient identifier is routed to its category.
  emitId(out, seg, pos, 2, disposition.kind === "phi" ? disposition.category : undefined);
}

/** Handle a `CLM` / `CLP`: pseudonymize the `-01` patient account number; the sweep decides the rest. */
function handleAccount(out: X12LocusAccumulator, seg: X12Segment, pos: SegPos): void {
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
  pos: SegPos,
  rules: readonly X12ElementRule[],
): void {
  const ruleByElement = new Map<number, X12ElementRule>();
  for (const rule of rules) ruleByElement.set(rule.element, rule);
  const retain = X12_GEO_RETAIN_ELEMENTS[pos.segId] ?? new Set<number>();
  for (let n = 1; n < seg.elements.length; n += 1) {
    if (!has(seg, n)) continue;
    const rule = ruleByElement.get(n);
    if (rule !== undefined) {
      emitRule(out, seg, pos, rule);
    } else if (retain.has(n)) {
      keepCodeOrBlock(out, seg, pos, n); // a state or country is kept only when it is one
    } else {
      blockElement(out, seg, pos, n); // unmapped geographic element → fail closed
    }
  }
}

/**
 * Block the free-text element(s) of a message segment (`MSG` / `III` / `K3` / `NTE`): free text can
 * carry any of the 18 categories in prose, so it fails closed (never a naive scrub). The segment's other
 * (coded) elements are kept only when they hold a code (the closing sweep decides them).
 */
function handleFreeTextSegment(
  out: X12LocusAccumulator,
  seg: X12Segment,
  pos: SegPos,
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

/**
 * **Remove a segment whole** and record every value it carried, its identifier (element `0`) included,
 * each at its own position (`837/<withheld>[0]-0`). This is how a segment whose identifier the pass does
 * not recognize fails closed, and how a segment outside every transaction set leaves: no part of it is
 * re-emitted, so an identifier that landed where the segment identifier belongs never leaves in the
 * clear. Each coordinate is marked {@link X12Coord.segmentRemoved}, so the applier drops the segment.
 */
function removeSegment(out: X12LocusAccumulator, seg: SegmentElements, pos: SegPos): void {
  for (let n = 0; n < seg.elements.length; n += 1) {
    name(out, pos, [n]);
    if (!has(seg, n)) continue;
    push(
      out,
      pos,
      { path: path(pos, n), kind: "identifier", value: el(seg, n) },
      { ...coord(pos, [n]), segmentRemoved: true },
    );
  }
}

/** Dispatch one segment through the X12 PHI rules. */
function handleSegment(out: X12LocusAccumulator, seg: X12Segment, pos: SegPos): void {
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
    // Geographic segments decide every element themselves (a location identifier could leak). The
    // demographic segments (DMG/PER/DTP/DTM/SBR) act on their mapped elements here and leave the rest
    // to the closing sweep, which keeps a code or qualifier only when it is one.
    if (X12_GEO_SEGMENTS.has(id)) {
      handleGeoSegment(out, seg, pos, universal);
      return;
    }
    for (const rule of universal) emitRule(out, seg, pos, rule);
    return;
  }
  // A recognized clinical, financial or control segment: the closing sweep decides every element by
  // its shape. A segment whose identifier is not recognized never reaches here (see closeSegment).
}

/**
 * Decide one composite element component by component against its shape. A composite with more
 * components than the shape names, or a kept component that fails its test, is not trusted at all and
 * is removed whole. Otherwise the element is kept, except that a free-text component is removed and a
 * date component is transformed as a date (or removed, when it is no date in its declared format), each
 * recorded at its own component position (`837/HI[0]-1-4`).
 */
function decideComposite(
  out: X12LocusAccumulator,
  seg: SegmentElements,
  pos: SegPos,
  element: number,
  shape: Extract<X12ElementShape, { kind: "composite" }>,
  ctx: X12ShapeContext,
): void {
  const components = el(seg, element).split(out.delimiters.component);
  const decisions: { readonly component: number; readonly date: boolean }[] = [];
  const whole = (): void => {
    blockElement(out, seg, pos, element);
  };
  if (components.length > shape.components.length) {
    whole();
    return;
  }
  for (const [i, value] of components.entries()) {
    if (value.length === 0) continue;
    // `i` is in range: the length check above bounds it by the shape's own component list.
    const spec = shape.components[i] as (typeof shape.components)[number];
    if (spec.kind === "keep") {
      if (!spec.test(value, { ...ctx, components })) {
        whole();
        return;
      }
    } else if (spec.kind === "free") {
      decisions.push({ component: i + 1, date: false });
    } else {
      const valid = isX12DateInFormat(value, declaredFormat(spec.format, seg, components));
      decisions.push({ component: i + 1, date: valid });
    }
  }
  name(out, pos, [element]);
  for (const { component, date } of decisions) {
    const value = components[component - 1] ?? "";
    const at = `${path(pos, element)}-${String(component)}`;
    push(
      out,
      pos,
      date
        ? { path: at, kind: "date", category: SAFE_HARBOR_CATEGORIES.DATES, value }
        : { path: at, kind: "identifier", value },
      { ...coord(pos, [element]), component },
    );
  }
}

/**
 * Decide one element no locus rule acted on, against the shape its position expects (see
 * `./element-shapes.js`). A position with no shape is not kept: it is removed and recorded. A kept
 * position keeps a value only when it has the shape: a code the position knows, a valid date in the
 * declared format, a number, a bounded administrative reference. Anything else is removed and recorded
 * at its own position, because the usual way a value lands where it does not belong is a missing or
 * an extra element separator that shifted an identifier there.
 */
function decideByShape(
  out: X12LocusAccumulator,
  seg: SegmentElements,
  pos: SegPos,
  element: number,
): void {
  const shape = X12_ELEMENT_SHAPES[pos.segId]?.[element];
  if (shape === undefined) {
    blockElement(out, seg, pos, element); // a position no rule names → fail closed
    return;
  }
  const ctx: X12ShapeContext = { ...out.delimiters, elements: seg.elements };
  if (shape.kind === "keep") {
    if (shape.test(el(seg, element), ctx)) name(out, pos, [element]);
    else blockElement(out, seg, pos, element);
    return;
  }
  if (shape.kind === "date") {
    emitDate(out, seg, pos, element, SAFE_HARBOR_CATEGORIES.DATES, shape.format);
    return;
  }
  decideComposite(out, seg, pos, element, shape, ctx);
}

/**
 * The **closing sweep** every segment the pass hands through gets after its rules ran. It starts at the
 * segment identifier (element `0`): a segment the pass does not keep (`recognized` is `false`) is
 * removed whole ({@link removeSegment}); otherwise the identifier is one the pass knows, which is
 * structure rather than a value, and each value-bearing element no rule decided is decided by its shape
 * ({@link decideByShape}). After it, no element of the segment is unexamined: each was acted on, kept
 * because it has the shape its position expects, or removed and recorded.
 */
function closeSegment(
  out: X12LocusAccumulator,
  seg: SegmentElements,
  pos: SegPos,
  recognized: boolean,
): void {
  if (!recognized) {
    removeSegment(out, seg, pos);
    return;
  }
  name(out, pos, [0]);
  for (let n = 1; n < seg.elements.length; n += 1) {
    if (out.named.get(segKey(pos))?.has(n) === true) continue;
    if (!isValueBearing(seg, pos.segId, n)) continue;
    decideByShape(out, seg, pos, n);
  }
}

/** The element a coordinate is ordered by: its first element, or `1` for a party-role row (no elements). */
function orderOf(coordinate: X12Coord): number {
  return coordinate.elements[0] ?? 1;
}

/**
 * Put the loci one segment produced since `start` in element order (and component order inside an
 * element), keeping the loci and coordinates aligned. A segment's rules run before its closing sweep,
 * so without this a code the sweep removed would be recorded after a name the rule removed further
 * along the same segment; the manifest reads in document order instead.
 */
function orderSegmentLoci(out: X12LocusAccumulator, start: number): void {
  const pairs = out.coords
    .slice(start)
    .map((c, i) => ({ c, l: out.loci[start + i] as GenericLocus }));
  pairs.sort((a, b) => orderOf(a.c) - orderOf(b.c) || (a.c.component ?? 0) - (b.c.component ?? 0));
  pairs.forEach(({ c, l }, i) => {
    out.coords[start + i] = c;
    out.loci[start + i] = l;
  });
}

/**
 * The **envelope** the pass hands through around every transaction set, in the order `serializeX12`
 * re-emits it: the interchange header and trailer, any envelope-level `TA1` acknowledgment, and each
 * functional group's header and trailer. No locus rule acts on one, so every element is decided by its
 * shape, and one that fails it is removed from the envelope and recorded, as anywhere else.
 *
 * An envelope segment identifier is **not document-derived**: `@cosyte/x12` types each of these as raw
 * text plus decoded elements with no `id` field of its own, so the identifier a caller passes here is the
 * one the standard fixes for that envelope position. Nothing read out of the document is interpolated,
 * which is why these are not passed through {@link safeLocusToken} the way an `X12Segment.id` is.
 */
function envelopePos(segId: X12EnvelopeAddress["segment"], occurrence: number): SegPos {
  // A group's header and trailer are indexed by the group's own position, so `GS[1]` and `GE[1]` name
  // the same group even when an earlier group arrived truncated with no trailer at all.
  const segIdBracket = `${segId}[${String(occurrence)}]`;
  return {
    key: `envelope:${segIdBracket}`,
    stId: "",
    segId,
    segIdBracket,
    at: {
      groupIndex: -1,
      txIndex: -1,
      segIndex: -1,
      envelope: { segment: segId, index: occurrence },
    },
  };
}

/**
 * Walk a parsed X12 interchange and extract every PHI-bearing (or fail-closed) locus, structurally,
 * from the `@cosyte/x12` model. Never mutates the interchange.
 *
 * Every element of every segment the output carries is **decided**: acted on by a locus rule, kept
 * because it has the shape its position expects, or removed and recorded. That covers the transaction
 * bodies, the `ST` / `SE` control pair, the interchange and functional-group envelope, and any segment
 * the parser found outside every transaction set (which is removed whole). The unexamined residual count
 * is still taken over all of them, and it is a measured zero.
 *
 * @param interchange - The parsed X12 interchange (`parseX12(raw)`).
 * @returns The loci (for the engine), their index-aligned write-back coordinates, and the unexamined
 *   residual positions the pass hands through (none).
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
  const out: X12LocusAccumulator = {
    loci: [],
    coords: [],
    named: new Map<string, Set<number>>(),
    delimiters: {
      component: interchange.delimiters.component,
      repetition: interchange.delimiters.repetition,
    },
  };
  const enumerated: { readonly seg: SegmentElements; readonly pos: SegPos }[] = [];
  const envelope = (
    seg: SegmentElements | undefined,
    segId: X12EnvelopeAddress["segment"],
    occurrence: number,
  ): void => {
    if (seg === undefined) return;
    const pos = envelopePos(segId, occurrence);
    closeSegment(out, seg, pos, true);
    enumerated.push({ seg, pos });
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
      // transaction produces; it is bounded before it is interpolated. `X12Segment.id` is the token
      // before the first element separator, which can be a value that landed there; it is printed
      // only when it is an identifier the pass recognizes, and withheld otherwise, because a short
      // value (a name suffix, a two-letter last name) passes the bare shape. The occurrence counter
      // keys on the printed id so withheld segments stay distinguishable.
      const stId = safeLocusToken(tx.st.elements[1] ?? "", "x12TransactionSetId");
      const occ = new Map<string, number>();
      tx.segments.forEach((seg, segIndex) => {
        const recognized = X12_RECOGNIZED_SEGMENT_IDS.has(seg.id);
        const segId = recognized ? safeLocusToken(seg.id, "x12SegmentId") : WITHHELD_LOCUS_TOKEN;
        const n = occ.get(segId) ?? 0;
        occ.set(segId, n + 1);
        const pos: SegPos = {
          key: `${String(groupIndex)}:${String(txIndex)}:${String(segIndex)}`,
          stId,
          segId,
          segIdBracket: `${segId}[${String(n)}]`,
          at: { groupIndex, txIndex, segIndex },
        };
        // The control pair carries no rule of its own; the closing sweep decides it like any other.
        // A segment whose identifier is not recognized gets no rule: the sweep removes it whole.
        const start = out.loci.length;
        if (recognized && seg.id !== "ST" && seg.id !== "SE") handleSegment(out, seg, pos);
        closeSegment(out, seg, pos, recognized);
        orderSegmentLoci(out, start);
        enumerated.push({ seg, pos });
      });
    });
    envelope(group.ge, "GE", groupIndex);
  });
  envelope(interchange.iea, "IEA", 0);

  // A segment the parser found outside every transaction set belongs to no structure a rule knows, so
  // it fails closed: removed whole, identifier included, and every value it carried recorded under
  // `orphan`. Recorded after the interchange, in the order the parser kept them. Its identifier is
  // printed only when the pass recognizes it, as inside a transaction set.
  const orphanOcc = new Map<string, number>();
  // A peer older than the orphan list carries none.
  (interchange.orphanSegments ?? []).forEach((orphan, index) => {
    const seg = orphan.segment;
    const known = X12_RECOGNIZED_SEGMENT_IDS.has(seg.id) || X12_ENVELOPE_SEGMENT_IDS.has(seg.id);
    const segId = known ? safeLocusToken(seg.id, "x12SegmentId") : WITHHELD_LOCUS_TOKEN;
    const n = orphanOcc.get(segId) ?? 0;
    orphanOcc.set(segId, n + 1);
    const pos: SegPos = {
      key: `orphan:${String(index)}`,
      stId: "orphan",
      segId,
      segIdBracket: `${segId}[${String(n)}]`,
      at: { groupIndex: -1, txIndex: -1, segIndex: -1, envelope: { segment: "orphan", index } },
    };
    closeSegment(out, seg, pos, false);
    enumerated.push({ seg, pos });
  });

  // Bytes after the `IEA` are re-emitted as the parser kept them, and they commonly hold a whole second
  // interchange the parser did not decode. Nothing here can decide them, so anything there that is not
  // blank fails closed: removed and recorded at `trailingBytes`. Blank bytes (whitespace and segment
  // terminators after the last segment) carry no value and stay.
  const trailing = interchange.trailingBytes ?? "";
  if (trailing.split(interchange.delimiters.segment).join("").trim().length > 0) {
    out.loci.push({ path: "trailingBytes", kind: "identifier", value: trailing });
    out.coords.push({
      groupIndex: -1,
      txIndex: -1,
      segIndex: -1,
      elements: [1],
      envelope: { segment: "trailing", index: 0 },
    });
  }

  const residuals = new UnexaminedResidualBuilder();
  for (const { seg, pos } of enumerated) {
    enumerateOrFail(pos.segIdBracket, () => {
      recordUnexaminedX12Positions(residuals, seg, pos, out.named.get(segKey(pos)));
    });
  }
  return { loci: out.loci, coords: out.coords, unexaminedResiduals: residuals.build() };
}

/**
 * Enumerate one segment's value-bearing elements and record the ones no rule decided. A **position**
 * here is one element of one segment (`837/DTP[0]-2`), the unit every X12 locus already uses, and it
 * starts at element `0`, the segment identifier: an identifier is structure only when the pass
 * recognized it, and a value that landed there is a position like any other. The closing sweep decides
 * every element, so this records nothing; it is the independent count that would show one it missed.
 */
function recordUnexaminedX12Positions(
  residuals: UnexaminedResidualBuilder,
  seg: SegmentElements,
  pos: SegPos,
  named: ReadonlySet<number> | undefined,
): void {
  for (let n = 0; n < seg.elements.length; n += 1) {
    if (named?.has(n) === true) continue;
    if (!isValueBearing(seg, pos.segId, n)) continue;
    residuals.record(path(pos, n));
  }
}
