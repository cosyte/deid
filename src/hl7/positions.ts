/**
 * The HL7 v2 **position enumeration**: which value-bearing positions of a segment the pass hands
 * through, and which of them no locus rule named.
 *
 * The extractor's tables say what is *acted on*. This module answers the complementary question the
 * manifest could not answer before it existed: **what did the pass hand through without reaching a
 * decision at all?** A retained segment carries far more than the fields the carve-out and date tables
 * name, and every one of those positions used to leave in the clear and unrecorded.
 *
 * ## What a position is here
 *
 * One **component of one repetition of one field**: `PV1-7`, `PID-3[1]`, `OBR-32.1`. That is the finest
 * unit the loci themselves already address, and the granularity matters: `OBR-32` is a provider name
 * whose *start* and *end* date components the v2.5.1 enumeration types as dates, so a field-granular
 * answer would report the provider's name at `OBR-32.1` as examined on the strength of a rule that
 * never looked at it. A position is counted only when it carries a non-empty value; an absent or empty
 * position is not a residual.
 *
 * ## What "examined" means
 *
 * A position is examined when a **locus rule names it**, whatever the rule then decided:
 *
 * - a mapped-segment rule, a carve-out rule, an organisation-party rule or a field-granular date rule
 *   names the whole **field**, so every component of every repetition of it is examined;
 * - a component-granular date rule names one **component**, and only that component;
 * - `OBX-5` kept by the over-scrub guard is examined, because the guard is a decision the engine
 *   reached (a positively-typed structured clinical value survives *on purpose*), not a silence.
 *
 * Retaining a **segment** is not naming a position: the retain-list keeps a structure, and the
 * positions inside it are exactly the class measured here.
 *
 * @packageDocumentation
 */

import { type Segment } from "@cosyte/hl7";

import type { UnexaminedResidualBuilder } from "../residual.js";

/**
 * The positions of one segment a locus rule named, at the granularity the rule names them.
 *
 * @internal
 */
export class Hl7ExaminedPositions {
  private readonly wholeFields = new Set<number>();
  private readonly fieldComponents = new Set<string>();

  /** A rule named the whole field: every component of every repetition of it is examined. */
  public field(field: number): void {
    this.wholeFields.add(field);
  }

  /** A rule named one component of a field: only that component, in every repetition, is examined. */
  public component(field: number, component: number): void {
    this.fieldComponents.add(`${String(field)}.${String(component)}`);
  }

  /** `true` when some rule named this position. */
  public covers(field: number, component: number): boolean {
    return (
      this.wholeFields.has(field) ||
      this.fieldComponents.has(`${String(field)}.${String(component)}`)
    );
  }
}

/**
 * The highest user-facing field number a segment carries.
 *
 * `MSH` numbers its fields from the field separator itself, so `@cosyte/hl7` offsets its raw array by
 * one for that segment and by nothing for every other, where index 0 holds the segment name. Reading
 * past the end is harmless (the model returns a synthetic empty field) but reading short would silently
 * drop the last position of every segment, so the offset is applied rather than guessed at.
 */
function highestField(seg: Segment, type: string): number {
  return type === "MSH" ? seg.fields.length : seg.fields.length - 1;
}

/**
 * The value-free path of one enumerated position, at the granularity it was enumerated: the repetition
 * ordinal only when the field repeats, the component ordinal only when the field has components. An
 * ordinal is a position, never a value.
 */
function positionPath(
  type: string,
  occ: number,
  field: number,
  rep: number,
  repetitions: number,
  component: number,
  components: number,
): string {
  const segment = occ > 0 ? `${type}[${String(occ)}]` : type;
  const repSuffix = repetitions > 1 ? `[${String(rep)}]` : "";
  const componentSuffix = components > 1 ? `.${String(component)}` : "";
  return `${segment}-${String(field)}${repSuffix}${componentSuffix}`;
}

/**
 * Enumerate every value-bearing position of one segment the pass hands through and record the ones no
 * locus rule named.
 *
 * @param residuals - The accumulator the unexamined positions are recorded into.
 * @param seg - The segment as the pass received it.
 * @param type - The **bounded** segment identifier (`safeLocusToken`), as it will print in a locus.
 * @param occ - The 0-based occurrence of this segment type in the message.
 * @param examined - The positions the extractor's rules named while handling this segment.
 * @internal
 */
export function recordUnexaminedHl7Positions(
  residuals: UnexaminedResidualBuilder,
  seg: Segment,
  type: string,
  occ: number,
  examined: Hl7ExaminedPositions,
): void {
  const highest = highestField(seg, type);
  for (let field = 1; field <= highest; field += 1) {
    const repetitions = seg.field(field).repetitions;
    for (let rep = 0; rep < repetitions.length; rep += 1) {
      const components = repetitions[rep]?.components ?? [];
      for (let i = 0; i < components.length; i += 1) {
        const component = i + 1;
        if (examined.covers(field, component)) continue;
        // Value-bearing is decided over the WHOLE component: a composite's later subcomponents carry
        // values too, and a position whose first subcomponent happens to be empty is still populated.
        const subcomponents = components[i]?.subcomponents ?? [];
        if (!subcomponents.some((s) => s.length > 0)) continue;
        residuals.record(
          positionPath(type, occ, field, rep, repetitions.length, component, components.length),
        );
      }
    }
  }
}
