/**
 * The HL7 v2 **extractor** — walks a parsed `@cosyte/hl7` model and produces the format-agnostic
 * {@link GenericLocus} list the core engine transforms, plus a **parallel coordinate list** that tells
 * the applier exactly where to write each transformed value back. Loci and coordinates are produced in
 * the same order, so `result.document.loci[i]` corresponds to `coords[i]` (the engine preserves input
 * order) — no locus string ever has to be parsed back.
 *
 * PHI is located **structurally**: the mapped PHI fields of PID / NK1 / GT1 / IN1 / IN2 (the
 * {@link HL7_LOCUS_MAP}) and the OBX-5 / NTE-3 free text. The **fail-closed** rule governs everything
 * else — a recognized segment is retained only if it is on the explicit {@link RETAIN_SEGMENTS}
 * clinical/administrative list, so a *known* patient-identity segment absent from the map (MRG / FAM /
 * ACC / PEO / PDA) is blocked exactly like a Z-segment or a segment unknown to the parser. A non-mapped
 * field inside a mapped segment, and a retained clinical segment, are left untouched (the over-scrub
 * guard); OBX-5 is retained only when OBX-2 positively types it as a structured clinical value.
 *
 * @packageDocumentation
 */

import { type Hl7Message, type Segment } from "@cosyte/hl7";

import { SAFE_HARBOR_CATEGORIES } from "../categories.js";
import type { GenericLocus } from "../locus.js";
import { HL7_LOCUS_MAP, categoryForIdentifierType, type Hl7FieldRule } from "./locus-map.js";
import { RETAIN_SEGMENTS } from "./retain.js";

/** How the applier writes a transformed locus back onto the cloned raw tree. */
export type Hl7EditKind = "whole-field" | "id-number" | "address-zip";

/**
 * A write-back coordinate — the exact structural location of one extracted locus in the message's raw
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
}

/** The paired output of {@link extractHl7Loci}: loci for the engine + coordinates for the applier. */
export interface Hl7Extraction {
  /** The located candidate values, in document order. */
  readonly loci: GenericLocus[];
  /** The write-back coordinates, index-aligned with {@link loci}. */
  readonly coords: Hl7Coord[];
}

/**
 * HL7 v2 value types (OBX-2, HL7 Table 0125) that make OBX-5 a **structured clinical value** that must
 * **survive** the over-scrub test — numeric, coded, and date/time types. OBX-5 is retained **only** for
 * these; every other value type — narrative `TX`/`FT`, ambiguous String `ST`, and any **empty or unknown**
 * OBX-2 — **fails closed** and is blocked (roadmap §4.5). This is the inverse (fail-closed) reflex: OBX-5
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
function push(out: Hl7Extraction, locus: GenericLocus, coord: Hl7Coord): void {
  out.loci.push(locus);
  out.coords.push(coord);
}

/** Build the human-readable, value-free manifest path for a field (optionally a specific repetition). */
function fieldPath(type: string, occ: number, field: number, rep?: number): string {
  const seg = occ > 0 ? `${type}[${String(occ)}]` : type;
  const repSuffix = rep !== undefined ? `[${String(rep)}]` : "";
  return `${seg}-${String(field)}${repSuffix}`;
}

/** Extract the loci for one mapped-segment field rule. */
function extractRule(
  out: Hl7Extraction,
  seg: Segment,
  type: string,
  occ: number,
  rule: Hl7FieldRule,
): void {
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
      // as category (R) — omitting the category forces the engine's fail-closed block.
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

/** Extract the OBX-5 locus, failing closed unless OBX-2 positively types it as a structured value. */
function extractObx(out: Hl7Extraction, seg: Segment, occ: number): void {
  if (!hasContent(seg, 5)) return;
  const valueType = seg.field(2).value.toUpperCase();
  // Over-scrub guard: a positively-typed structured clinical value (NM / coded / date) survives.
  // Fail closed otherwise — narrative (TX/FT), ambiguous String (ST), and an empty/unknown OBX-2 block.
  if (STRUCTURED_VALUE_TYPES.has(valueType)) return;
  push(
    out,
    {
      path: fieldPath("OBX", occ, 5),
      kind: "freetext",
      category: SAFE_HARBOR_CATEGORIES.OTHER_UNIQUE_ID,
      value: seg.field(5).value,
    },
    { segIndex: seg.absoluteIndex, field: 5, rep: 0, edit: "whole-field" },
  );
}

/** Extract the free-text locus for an NTE segment (NTE-3, the comment). */
function extractNte(out: Hl7Extraction, seg: Segment, occ: number): void {
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
function extractUnknownSegment(out: Hl7Extraction, seg: Segment, occ: number): void {
  // fields[0] is the segment-name placeholder — start at HL7 position 1.
  for (let field = 1; field < seg.fields.length; field += 1) {
    if (!hasContent(seg, field)) continue;
    push(
      out,
      { path: fieldPath(seg.type, occ, field), kind: "unknown", value: seg.field(field).value },
      { segIndex: seg.absoluteIndex, field, rep: 0, edit: "whole-field" },
    );
  }
}

/**
 * Walk a parsed HL7 v2 message and extract every PHI-bearing (or fail-closed) locus, structurally, from
 * the `@cosyte/hl7` model. Never mutates the message.
 *
 * @param msg - The parsed HL7 v2 message.
 * @returns The loci (for the engine) and their index-aligned write-back coordinates.
 * @example
 * ```ts
 * import { parseHL7 } from "@cosyte/hl7";
 * import { extractHl7Loci } from "@cosyte/deid/hl7";
 *
 * const { loci } = extractHl7Loci(parseHL7(raw));
 * loci.length; // number of located candidate values
 * ```
 */
export function extractHl7Loci(msg: Hl7Message): Hl7Extraction {
  const out: Hl7Extraction = { loci: [], coords: [] };
  const occurrences = new Map<string, number>();

  for (const seg of msg.allSegments()) {
    const type = seg.type;
    const occ = occurrences.get(type) ?? 0;
    occurrences.set(type, occ + 1);

    if (type === "MSH") continue; // message envelope — no patient PHI

    const rules = HL7_LOCUS_MAP[type];
    if (rules !== undefined) {
      for (const rule of rules) extractRule(out, seg, type, occ, rule);
      continue;
    }
    if (type === "OBX") {
      extractObx(out, seg, occ);
      continue;
    }
    if (type === "NTE") {
      extractNte(out, seg, occ);
      continue;
    }
    // Fail-closed rule: retain a recognized segment ONLY if it is on the explicit clinical/administrative
    // retain-list. Everything else — a Z-segment, a segment unknown to the parser, OR a *known*
    // patient/relative-identity segment absent from the map and the retain-list (MRG / ACC / FAM / PEO /
    // PDA) — is blocked, so a merge message's prior name + MRN can never ride through in the clear.
    if (RETAIN_SEGMENTS.has(type)) continue;
    extractUnknownSegment(out, seg, occ);
  }

  return out;
}
