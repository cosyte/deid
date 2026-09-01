/**
 * The HL7 v2 **extractor**: walks a parsed `@cosyte/hl7` model and produces the format-agnostic
 * {@link GenericLocus} list the core engine transforms, plus a **parallel coordinate list** that tells
 * the applier exactly where to write each transformed value back. Loci and coordinates are produced in
 * the same order, so `result.document.loci[i]` corresponds to `coords[i]` (the engine preserves input
 * order), no locus string ever has to be parsed back.
 *
 * PHI is located **structurally**: the mapped PHI fields of PID / NK1 / GT1 / IN1 / IN2 (the
 * {@link HL7_LOCUS_MAP}), the organisation-typed party positions those segments carry (the
 * {@link HL7_ORGANISATION_PARTY_RULES}, decided by the shared party-role test rather than by a category
 * rule) and the OBX-5 / NTE-3 free text. The **fail-closed** rule governs everything
 * else: a recognized segment is retained only if it is on the explicit {@link RETAIN_SEGMENTS}
 * clinical/administrative list, so a *known* patient-identity segment absent from the map (MRG / FAM /
 * ACC / PEO / PDA) is blocked exactly like a Z-segment or a segment unknown to the parser. A non-mapped
 * field inside a mapped segment is left untouched (the over-scrub guard). Inside a **retained** segment
 * the {@link RETAINED_LOCUS_RULES} carve-out still applies: its identifying dates and encounter / order
 * numbers are handed to the engine unless the configured profile names their retention class.
 *
 * **Dates inside a passed-through segment are located from {@link HL7_DATE_LOCI}**, the committed HL7
 * v2.5.1 enumeration, at the unit the standard gives them: a whole field for a `DT` / `TS` field, a
 * single component for a date inside a composite, and one locus **per repetition** either way, so a
 * sibling repetition is never disturbed by what happened to its neighbour. That sweep covers **OBX**
 * too: the segment is passed through by the value-type branch below rather than by the retain-list, so
 * its own observation / analysis / reference-range timestamps would otherwise leave in the clear and
 * unrecorded. `OBX-5` is the one date position the message types for itself: `OBX-2` decides, and a
 * value type that is not a date leaves the pinned behaviour untouched (structured values survive,
 * narrative fails closed).
 *
 * @packageDocumentation
 */

import { type Hl7Message, type Segment } from "@cosyte/hl7";

import { SAFE_HARBOR_CATEGORIES } from "../categories.js";
import { safeLocusToken } from "../derived-token.js";
import type { GenericLocus } from "../locus.js";
import { classifyPartyRole } from "../party-role.js";
import {
  enumerateOrFail,
  UnexaminedResidualBuilder,
  type UnexaminedResidual,
} from "../residual.js";
import { isRetainableCategory, retains, type RetainedLocusClass } from "../retention.js";
import { Hl7ExaminedPositions, recordUnexaminedHl7Positions } from "./positions.js";
import { DR_DATE_COMPONENTS, HL7_DATE_LOCI, OBX_DATE_VALUE_TYPES } from "./date-loci.js";
import {
  HL7_LOCUS_MAP,
  HL7_ORGANISATION_PARTY_RULES,
  HL7_PARTY_ROLE_TABLE,
  categoryForIdentifierType,
  type Hl7FieldRule,
} from "./locus-map.js";
import { RETAIN_SEGMENTS, RETAINED_LOCUS_RULES, type Hl7RetainedFieldRule } from "./retain.js";

/**
 * How the applier writes a transformed locus back onto the cloned raw tree. `none` writes **nothing**:
 * it is the coordinate of a locus the profile's retention set kept, which must stay byte-identical
 * (a whole-field write would flatten its components and repetitions into a single value).
 *
 * `date-field` and `date-component` are the two units a date locus can have: the first rewrites the
 * date component of **one repetition** of a field, the second rewrites **one component** of one
 * repetition and leaves every sibling component at its own ordinal.
 */
export type Hl7EditKind =
  | "whole-field"
  | "id-number"
  | "address-zip"
  | "date-field"
  | "date-component"
  | "none";

/**
 * A write-back coordinate: the exact structural location of one extracted locus in the message's raw
 * segment tree. Carries no value.
 */
export interface Hl7Coord {
  /** Absolute index of the segment in `Hl7Message.rawSegments`. */
  readonly segIndex: number;
  /** 1-based HL7 field number. */
  readonly field: number;
  /** 0-based repetition index. */
  readonly rep: number;
  /** How to write the transformed value back. */
  readonly edit: Hl7EditKind;
  /** 1-based component number, for a `date-component` edit. Absent for every other edit. */
  readonly component?: number;
}

/**
 * Options for {@link extractHl7Loci}. The retention set comes from the configured profile via
 * {@link profileOptions}; **omitting it retains nothing**, which is the fail-closed default.
 */
export interface Hl7ExtractOptions {
  /** The retention classes the profile permits. Absent or empty keeps no identifying locus. */
  readonly retainedLoci?: readonly RetainedLocusClass[];
}

/** The paired output of {@link extractHl7Loci}: loci for the engine + coordinates for the applier. */
export interface Hl7Extraction {
  /** The located candidate values, in document order. */
  readonly loci: GenericLocus[];
  /** The write-back coordinates, index-aligned with {@link loci}. */
  readonly coords: Hl7Coord[];
  /**
   * Every **value-bearing position the pass hands through that no locus rule named**, counted and
   * located. Not loci: nothing here is transformed, blocked or retained by a decision, and the list is
   * the measurement of what the pass never examined (see `./positions.ts`).
   */
  readonly unexaminedResiduals: readonly UnexaminedResidual[];
}

/** The mutable pair the sweep accumulates into, before it is frozen into an {@link Hl7Extraction}. */
interface Hl7LocusAccumulator {
  readonly loci: GenericLocus[];
  readonly coords: Hl7Coord[];
}

/**
 * HL7 v2 value types (OBX-2, HL7 Table 0125) that make OBX-5 a **structured clinical value** that must
 * **survive** the over-scrub test: numeric, coded, and date/time types. OBX-5 is retained **only** for
 * these; every other value type (narrative `TX`/`FT`, ambiguous String `ST`, and any **empty or unknown**
 * OBX-2) **fails closed** and is blocked. This is the inverse (fail-closed) reflex: OBX-5
 * is passed through only when the parser positively types it as a non-narrative clinical value.
 */
const STRUCTURED_VALUE_TYPES: ReadonlySet<string> = new Set([
  "NM",
  "SN",
  "SI",
  "MO",
  "NA",
  "NR",
  "CP",
  "DR", // numeric / quantity / range
  "ID",
  "IS",
  "CE",
  "CWE",
  "CF",
  "CNE",
  "CX", // coded / identifier
  "DT",
  "TM",
  "DTM",
  "TS", // date / time
]);

/** `true` when a field carries any content (at least one repetition). An absent/HL7-null field is `[]`. */
function hasContent(seg: Segment, field: number): boolean {
  return seg.field(field).repetitions.length > 0;
}

/** Read a raw component's first subcomponent at 1-based `component` of repetition `rep`, or `""`. */
function componentValue(seg: Segment, field: number, rep: number, component: number): string {
  const repetition = seg.field(field).repetitions[rep];
  const comp = repetition?.components[component - 1];
  return comp?.subcomponents[0] ?? "";
}

/** Append a locus + its coordinate to the accumulator. */
function push(out: Hl7LocusAccumulator, locus: GenericLocus, coord: Hl7Coord): void {
  out.loci.push(locus);
  out.coords.push(coord);
}

/**
 * Build the human-readable, value-free manifest path for a field (optionally a specific repetition).
 *
 * `type` is already bounded by {@link extractHl7Loci} before it reaches here; see the note there on
 * why a segment "name" the parser could not recognize is not an identifier.
 */
function fieldPath(type: string, occ: number, field: number, rep?: number): string {
  const seg = occ > 0 ? `${type}[${String(occ)}]` : type;
  const repSuffix = rep !== undefined ? `[${String(rep)}]` : "";
  return `${seg}-${String(field)}${repSuffix}`;
}

/**
 * The locus path of a date position, at its own unit: segment occurrence, field, **repetition**, and
 * the component ordinal when the date is a component of a composite. Two date components of one field
 * therefore never share a path, never aggregate into one manifest entry, and are each individually
 * addressable by a consumer reading the manifest. An ordinal is a position, not a value.
 */
function datePath(
  type: string,
  occ: number,
  field: number,
  rep: number,
  component: number | undefined,
): string {
  const suffix = component === undefined ? "" : `.${String(component)}`;
  return `${fieldPath(type, occ, field, rep)}${suffix}`;
}

/**
 * Extract the loci for one mapped-segment field rule.
 *
 * The rule **names the whole field**, so the field is marked examined before any of its own guards run:
 * a rule that looked at a position and produced nothing (an id repetition whose CX.1 is empty) still
 * reached it, and a position a rule reached is not an unexamined residual.
 */
function extractRule(
  out: Hl7LocusAccumulator,
  seg: Segment,
  type: string,
  occ: number,
  rule: Hl7FieldRule,
  examined: Hl7ExaminedPositions,
): void {
  examined.field(rule.field);
  if (!hasContent(seg, rule.field)) return;
  const field = seg.field(rule.field);

  switch (rule.mode) {
    case "redact":
      push(
        out,
        {
          path: fieldPath(type, occ, rule.field),
          kind: "identifier",
          category: rule.category,
          value: field.value,
        },
        { segIndex: seg.absoluteIndex, field: rule.field, rep: 0, edit: "whole-field" },
      );
      return;

    case "date":
      push(
        out,
        {
          path: fieldPath(type, occ, rule.field),
          kind: "date",
          category: rule.category,
          value: field.value,
        },
        { segIndex: seg.absoluteIndex, field: rule.field, rep: 0, edit: "whole-field" },
      );
      return;

    case "block":
      // Fail closed: a geographic/other identifier with no clean structured generalization is removed
      // as category (R): omitting the category forces the engine's fail-closed block.
      push(
        out,
        { path: fieldPath(type, occ, rule.field), kind: "identifier", value: field.value },
        { segIndex: seg.absoluteIndex, field: rule.field, rep: 0, edit: "whole-field" },
      );
      return;

    case "id": {
      // One locus per repetition so each identifier gets its own consistent surrogate.
      const reps = field.repetitions.length;
      for (let rep = 0; rep < reps; rep += 1) {
        const idNumber = componentValue(seg, rule.field, rep, 1); // CX.1
        if (idNumber.length === 0) continue;
        const category = rule.routeByTypeCode
          ? categoryForIdentifierType(componentValue(seg, rule.field, rep, 5), rule.category) // CX.5
          : rule.category;
        push(
          out,
          {
            path: fieldPath(type, occ, rule.field, rep),
            kind: "identifier",
            category,
            value: idNumber,
          },
          { segIndex: seg.absoluteIndex, field: rule.field, rep, edit: "id-number" },
        );
      }
      return;
    }

    case "address": {
      // One locus per repetition; the engine generalizes the ZIP (XAD.5) and the applier drops every
      // finer geographic component (street / city / county).
      const reps = field.repetitions.length;
      for (let rep = 0; rep < reps; rep += 1) {
        const zip = componentValue(seg, rule.field, rep, 5); // XAD.5 (Zip or Postal Code)
        push(
          out,
          {
            path: fieldPath(type, occ, rule.field, rep),
            kind: "zip",
            category: SAFE_HARBOR_CATEGORIES.GEOGRAPHIC,
            value: zip,
          },
          { segIndex: seg.absoluteIndex, field: rule.field, rep, edit: "address-zip" },
        );
      }
      return;
    }
  }
}

/**
 * Extract the **organisation-typed party positions** of a mapped segment (`IN2-70` today) under the
 * **same party-role test** the X12 adapter applies to an `NM1` / `N1` organisation party: the role the
 * v2.5.1 field definition types at the party is looked up in the committed
 * {@link HL7_PARTY_ROLE_TABLE}, and only a role that table establishes as **outside**
 * §164.514(b)(2)(i)'s scope clause leaves the party in place, with the role code recorded value-free at
 * the party's own locus.
 *
 * Anything else fails closed. The insured's employer is the case that matters: the clause names
 * employers, so the role can never be established as outside it and the whole field goes, the
 * organisation's name (`XON.1`) and its identifier (`XON.10`) together, recorded as a block.
 *
 * Emitted after the segment's flat field rules, and the positions are high-numbered, so the segment's
 * loci stay in document order.
 */
function extractOrganisationParties(
  out: Hl7LocusAccumulator,
  seg: Segment,
  type: string,
  occ: number,
  examined: Hl7ExaminedPositions,
): void {
  const rules = HL7_ORGANISATION_PARTY_RULES[type];
  if (rules === undefined) return;
  for (const rule of rules) {
    // The party-role test names the whole organisation position, name and identifier together, whether
    // it then leaves the party in place or fails closed on it.
    examined.field(rule.field);
    if (!hasContent(seg, rule.field)) continue;
    const party = classifyPartyRole(rule.role, HL7_PARTY_ROLE_TABLE);
    if (party.scope === "outside-scope") {
      // The party is not the individual, a relative, an employer or a household member: its name and
      // identifier stay, and the role code that placed it outside the clause is recorded instead of
      // being left to be inferred from an absence. The `none` edit writes nothing back.
      push(
        out,
        {
          path: fieldPath(type, occ, rule.field),
          kind: "identifier",
          partyRole: party.roleCode,
          value: "",
        },
        { segIndex: seg.absoluteIndex, field: rule.field, rep: 0, edit: "none" },
      );
      continue;
    }
    // Fail closed: a role the table cannot establish as outside the clause takes the whole field,
    // omitting the category so the engine blocks it as the (R) catch-all.
    push(
      out,
      {
        path: fieldPath(type, occ, rule.field),
        kind: "identifier",
        value: seg.field(rule.field).value,
      },
      { segIndex: seg.absoluteIndex, field: rule.field, rep: 0, edit: "whole-field" },
    );
  }
}

/**
 * One extracted locus plus the position it sits at, so a segment's loci can be emitted in **document
 * order** (ascending field, then repetition, then component) however many tables contributed them.
 * `component` is `0` for a field-granular locus, which sorts it before that field's components.
 */
interface PositionedLocus {
  readonly field: number;
  readonly rep: number;
  readonly component: number;
  readonly locus: GenericLocus;
  readonly coord: Hl7Coord;
}

/**
 * Collect the identifying fields carved out of a **retained** segment: the encounter dates and the
 * encounter / order identifiers. When the configured profile names the rule's retention class the
 * locus is marked with its retention class (passed through unchanged, and recorded as a residual) and
 * given a **`none`** coordinate so the applier writes nothing; otherwise it is an ordinary locus the
 * policy acts on: a date generalizes to its year, an identifier is blocked as the (R) catch-all.
 */
function collectCarveOutLoci(
  found: PositionedLocus[],
  seg: Segment,
  type: string,
  occ: number,
  retainedLoci: readonly RetainedLocusClass[] | undefined,
  examined: Hl7ExaminedPositions,
): void {
  const rules = RETAINED_LOCUS_RULES[type];
  if (rules === undefined) return;
  const classEnabled = (rule: Hl7RetainedFieldRule): boolean =>
    retains(retainedLoci, rule.retention);

  for (const rule of rules) {
    // The carve-out table names the whole field, at whichever outcome the retention keys reach.
    examined.field(rule.field);
    if (!hasContent(seg, rule.field)) continue;

    if (rule.routeByTypeCode === true) {
      // A CX list: one locus per repetition, category read from the CX-5 identifier-type code, so an
      // `MR`/`AN`/`SS`-typed value in a visit-number field is transformed like the identifier it is
      // (and gets the SAME keyed surrogate as the matching PID-3 entry) instead of being retained.
      const reps = seg.field(rule.field).repetitions.length;
      for (let rep = 0; rep < reps; rep += 1) {
        const idNumber = componentValue(seg, rule.field, rep, 1); // CX.1
        if (idNumber.length === 0) continue;
        const category = categoryForIdentifierType(
          componentValue(seg, rule.field, rep, 5), // CX.5
          rule.category,
        );
        const kept = classEnabled(rule) && isRetainableCategory(category);
        found.push({
          field: rule.field,
          rep,
          component: 0,
          locus: {
            path: fieldPath(type, occ, rule.field, rep),
            kind: rule.kind,
            category,
            ...(kept ? { retention: rule.retention } : {}),
            value: idNumber,
          },
          coord: {
            segIndex: seg.absoluteIndex,
            field: rule.field,
            rep,
            edit: kept ? "none" : "id-number",
          },
        });
      }
      continue;
    }

    const kept = classEnabled(rule) && isRetainableCategory(rule.category);
    found.push({
      field: rule.field,
      rep: 0,
      component: 0,
      locus: {
        path: fieldPath(type, occ, rule.field),
        kind: rule.kind,
        category: rule.category,
        ...(kept ? { retention: rule.retention } : {}),
        value: seg.field(rule.field).value,
      },
      coord: {
        segIndex: seg.absoluteIndex,
        field: rule.field,
        rep: 0,
        edit: kept ? "none" : "whole-field",
      },
    });
  }
}

/** The fields of a segment the carve-out table already owns, whole-field, at their own granularity. */
function carvedFields(type: string): ReadonlySet<number> {
  const rules = RETAINED_LOCUS_RULES[type];
  return new Set(rules === undefined ? [] : rules.map((r) => r.field));
}

/** Build one date locus at the unit the enumeration gives it, or `undefined` when it is empty. */
function dateLocus(
  seg: Segment,
  type: string,
  occ: number,
  field: number,
  rep: number,
  component: number | undefined,
): PositionedLocus | undefined {
  // A field-granular date is the first component of its repetition (a `TS` field's date part); a
  // component-granular one is the component the enumeration names. Empty or absent: no locus, no
  // manifest entry, and the position is emitted exactly as it arrived.
  const value = componentValue(seg, field, rep, component ?? 1);
  if (value.length === 0) return undefined;
  return {
    field,
    rep,
    component: component ?? 0,
    locus: {
      path: datePath(type, occ, field, rep, component),
      kind: "date",
      category: SAFE_HARBOR_CATEGORIES.DATES,
      value,
    },
    coord: {
      segIndex: seg.absoluteIndex,
      field,
      rep,
      edit: component === undefined ? "date-field" : "date-component",
      ...(component === undefined ? {} : { component }),
    },
  };
}

/**
 * Collect every date locus of a passed-through segment from the committed HL7 v2.5.1 enumeration: one
 * locus per **repetition** of each enumerated field, at the field or the component the standard types
 * as a date. A field the carve-out table already owns whole is left to it, so no position is acted on
 * twice.
 */
function collectDateLoci(
  found: PositionedLocus[],
  seg: Segment,
  type: string,
  occ: number,
  examined: Hl7ExaminedPositions,
): void {
  const table = HL7_DATE_LOCI[type];
  if (table === undefined) return;
  const carved = carvedFields(type);

  for (const rule of table.loci) {
    // The enumeration names a position at ITS OWN unit, and the difference matters to the measurement:
    // a whole-field date rule reaches the field, while a component-granular one reaches exactly one
    // component and leaves its siblings untouched. `OBR-32` is the case that makes this concrete: its
    // start and end date/time components are typed as dates, and the provider name at `OBR-32.1` that
    // they qualify is not, so it stays an unexamined position rather than riding on their coat-tails.
    if (rule.component === undefined) examined.field(rule.field);
    else examined.component(rule.field, rule.component);
    if (rule.component === undefined && carved.has(rule.field)) continue;
    const reps = seg.field(rule.field).repetitions.length;
    for (let rep = 0; rep < reps; rep += 1) {
      const positioned = dateLocus(seg, type, occ, rule.field, rep, rule.component);
      if (positioned !== undefined) found.push(positioned);
    }
  }
}

/** Emit a retained segment's loci in document order: ascending field, repetition, then component. */
function extractRetainedSegment(
  out: Hl7LocusAccumulator,
  seg: Segment,
  type: string,
  occ: number,
  retainedLoci: readonly RetainedLocusClass[] | undefined,
  examined: Hl7ExaminedPositions,
): void {
  const found: PositionedLocus[] = [];
  collectCarveOutLoci(found, seg, type, occ, retainedLoci, examined);
  collectDateLoci(found, seg, type, occ, examined);
  found.sort((a, b) => a.field - b.field || a.rep - b.rep || a.component - b.component);
  for (const entry of found) push(out, entry.locus, entry.coord);
}

/**
 * Collect the OBX-5 locus: the one position whose datatype the **message** declares. `OBX-2` types the
 * value, so no table is consulted; a `DR` makes the locus component-granular (range start, range end)
 * and the other date types make it the field, one locus per repetition either way. A positively-typed
 * structured clinical value survives (the over-scrub guard); everything else fails closed.
 */
function collectObxValueLoci(
  found: PositionedLocus[],
  seg: Segment,
  occ: number,
  examined: Hl7ExaminedPositions,
): void {
  // `OBX-2` names `OBX-5`, and it names it on EVERY branch below, the over-scrub guard's included: a
  // structured clinical value that survives on purpose is a decision the engine reached, not a silence,
  // so it is examined and is not an unexamined residual.
  examined.field(5);
  if (!hasContent(seg, 5)) return;
  const valueType = seg.field(2).value.toUpperCase();
  // A date/time value type is the message declaring a date locus: act on it under the policy rather
  // than passing a full-precision patient-related date through as a structured clinical value.
  if (OBX_DATE_VALUE_TYPES.has(valueType)) {
    const reps = seg.field(5).repetitions.length;
    for (let rep = 0; rep < reps; rep += 1) {
      const components = valueType === "DR" ? DR_DATE_COMPONENTS : [undefined];
      for (const component of components) {
        const positioned = dateLocus(seg, "OBX", occ, 5, rep, component);
        if (positioned !== undefined) found.push(positioned);
      }
    }
    return;
  }
  // Over-scrub guard: a positively-typed structured clinical value (NM / coded / time of day) survives.
  // Fail closed otherwise: narrative (TX/FT), ambiguous String (ST), and an empty/unknown OBX-2 block.
  if (STRUCTURED_VALUE_TYPES.has(valueType)) return;
  found.push({
    field: 5,
    rep: 0,
    component: 0,
    locus: {
      path: fieldPath("OBX", occ, 5),
      kind: "freetext",
      category: SAFE_HARBOR_CATEGORIES.OTHER_UNIQUE_ID,
      value: seg.field(5).value,
    },
    coord: { segIndex: seg.absoluteIndex, field: 5, rep: 0, edit: "whole-field" },
  });
}

/**
 * Extract an OBX: the message-typed OBX-5 locus **and** the segment's own enumerated date positions.
 *
 * OBX is not on the retain-list, and it is passed through all the same: the value-type branch decides
 * OBX-5 and every other field of the segment keeps its bytes. That is the shape a date hides in, so the
 * observation (`OBX-14`), analysis (`OBX-19`) and reference-range (`OBX-12`) timestamps are swept from
 * the same committed v2.5.1 enumeration every retained segment is swept from. Loci are emitted in
 * document order, so OBX-5 precedes them.
 */
function extractObx(
  out: Hl7LocusAccumulator,
  seg: Segment,
  occ: number,
  examined: Hl7ExaminedPositions,
): void {
  const found: PositionedLocus[] = [];
  collectObxValueLoci(found, seg, occ, examined);
  collectDateLoci(found, seg, "OBX", occ, examined);
  found.sort((a, b) => a.field - b.field || a.rep - b.rep || a.component - b.component);
  for (const entry of found) push(out, entry.locus, entry.coord);
}

/** Extract the free-text locus for an NTE segment (NTE-3, the comment). */
function extractNte(
  out: Hl7LocusAccumulator,
  seg: Segment,
  occ: number,
  examined: Hl7ExaminedPositions,
): void {
  examined.field(3);
  if (!hasContent(seg, 3)) return;
  push(
    out,
    {
      path: fieldPath("NTE", occ, 3),
      kind: "freetext",
      category: SAFE_HARBOR_CATEGORIES.OTHER_UNIQUE_ID,
      value: seg.field(3).value,
    },
    { segIndex: seg.absoluteIndex, field: 3, rep: 0, edit: "whole-field" },
  );
}

/** Fail closed on an unknown/Z-segment: block every populated field (unrecognized structure). */
function extractUnknownSegment(
  out: Hl7LocusAccumulator,
  seg: Segment,
  type: string,
  occ: number,
  examined: Hl7ExaminedPositions,
): void {
  // fields[0] is the segment-name placeholder: start at HL7 position 1.
  for (let field = 1; field < seg.fields.length; field += 1) {
    // Fail-closed sweeps the whole segment, so every field of it is named and none is unexamined.
    examined.field(field);
    if (!hasContent(seg, field)) continue;
    push(
      out,
      { path: fieldPath(type, occ, field), kind: "unknown", value: seg.field(field).value },
      { segIndex: seg.absoluteIndex, field, rep: 0, edit: "whole-field" },
    );
  }
}

/**
 * Walk a parsed HL7 v2 message and extract every PHI-bearing (or fail-closed) locus, structurally, from
 * the `@cosyte/hl7` model. Never mutates the message.
 *
 * Every segment is also **enumerated**: the value-bearing positions it hands through that no rule above
 * named are counted and located as unexamined residuals, so a position that used to pass through in
 * silence is measured. Nothing is transformed on account of that measurement, and a structure whose
 * positions cannot be enumerated fails the pass rather than contributing a zero.
 *
 * @param msg - The parsed HL7 v2 message.
 * @param options - The configured profile's retention classes. Omitted retains nothing (fail closed).
 * @returns The loci (for the engine), their index-aligned write-back coordinates, and the unexamined
 *   residual positions the pass hands through.
 * @throws {@link DeidError} `DEID_POSITIONS_UNENUMERABLE` when a segment's value-bearing positions
 *   cannot be enumerated: the pass fails rather than emit a zero or a partial count.
 * @example
 * ```ts
 * import { parseHL7 } from "@cosyte/hl7";
 * import { extractHl7Loci } from "@cosyte/deid/hl7";
 *
 * const { loci } = extractHl7Loci(parseHL7(raw));
 * loci.length; // number of located candidate values
 * ```
 */
export function extractHl7Loci(msg: Hl7Message, options: Hl7ExtractOptions = {}): Hl7Extraction {
  const out: Hl7LocusAccumulator = { loci: [], coords: [] };
  const residuals = new UnexaminedResidualBuilder();
  const occurrences = new Map<string, number>();

  for (const seg of msg.allSegments()) {
    // `Segment.type` is the parser's reading of the line prefix, not a checked identifier: on a line
    // it could not recognize (an unterminated narrative continuation, say) it is the prefix of that
    // line's content. Bound it BEFORE it is used for anything, including the occurrence counter, so
    // that two refused segments stay distinguishable as `<withheld>` and `<withheld>[1]` rather than
    // aggregating into one manifest row.
    const type = safeLocusToken(seg.type, "hl7SegmentId");
    const occ = occurrences.get(type) ?? 0;
    occurrences.set(type, occ + 1);
    const examined = new Hl7ExaminedPositions();

    extractSegment(out, seg, type, occ, options.retainedLoci, examined);
    // The enumeration runs for EVERY segment, the fail-closed ones included: there it finds nothing,
    // because a blocked segment is swept field by field, and that zero is the honest answer rather
    // than a case the walk skips.
    enumerateOrFail(`${type}-*`, () =>
      recordUnexaminedHl7Positions(residuals, seg, type, occ, examined),
    );
  }

  return { loci: out.loci, coords: out.coords, unexaminedResiduals: residuals.build() };
}

/** Dispatch one segment through the HL7 v2 PHI rules, recording what each rule names as examined. */
function extractSegment(
  out: Hl7LocusAccumulator,
  seg: Segment,
  type: string,
  occ: number,
  retainedLoci: readonly RetainedLocusClass[] | undefined,
  examined: Hl7ExaminedPositions,
): void {
  {
    if (type === "MSH") {
      // The message envelope carries no patient identity, but it is on the retain-list and it does
      // carry a date the standard types: sweep its date loci and nothing else.
      extractRetainedSegment(out, seg, type, occ, retainedLoci, examined);
      return;
    }

    const rules = HL7_LOCUS_MAP[type];
    if (rules !== undefined) {
      for (const rule of rules) extractRule(out, seg, type, occ, rule, examined);
      // A position the standard types as a whole ORGANISATION is decided by the party-role test, not
      // by a category rule. Emitted after the flat rules, and high-numbered, so document order holds.
      extractOrganisationParties(out, seg, type, occ, examined);
      return;
    }
    if (type === "OBX") {
      // NOT on the retain-list, and passed through all the same: OBX-2 decides OBX-5 and the rest of
      // the segment keeps its bytes. Its enumerated date positions are swept here for that reason.
      extractObx(out, seg, occ, examined);
      return;
    }
    if (type === "NTE") {
      extractNte(out, seg, occ, examined);
      return;
    }
    // Fail-closed rule: retain a recognized segment ONLY if it is on the explicit clinical/administrative
    // retain-list. Everything else is blocked: a Z-segment, a segment unknown to the parser, OR a
    // *known* patient/relative-identity segment absent from the map and the retain-list (MRG / ACC /
    // FAM / PEO / PDA). A merge message's prior name + MRN can never ride through in the clear.
    if (RETAIN_SEGMENTS.has(type)) {
      // Retaining the SEGMENT does not retain every field in it: the identifying dates and the
      // encounter / order identifiers are carved back out, and every date position the committed
      // v2.5.1 enumeration names is handed to the engine alongside them. Retaining a STRUCTURE is not
      // naming a POSITION, so every field of it the tables miss is enumerated as an unexamined residual.
      extractRetainedSegment(out, seg, type, occ, retainedLoci, examined);
      return;
    }
    extractUnknownSegment(out, seg, type, occ, examined);
  }
}
