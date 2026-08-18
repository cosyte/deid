/**
 * The HL7 v2 **applier**: writes the engine's transformed loci back onto a **deep clone** of the
 * message's raw segment tree and reconstructs a fresh, independent {@link Hl7Message}. The caller's
 * input message is never mutated; every field the extractor did not touch is cloned **byte-faithfully**
 * (escape overlay included), so structured clinical values survive the over-scrub test unchanged.
 *
 * Removal is clean: a redacted or blocked field's repetitions are dropped to `[]` (it serializes as an
 * empty field), never zero-length-padded into `^^^` residue. A pseudonymized identifier replaces only
 * the id-number component (CX.1); a generalized address keeps only the Safe Harbor 3-digit ZIP. A
 * locus the profile's retention set kept carries the `none` edit and is not written at all, so it
 * survives byte-identical.
 *
 * @packageDocumentation
 */

import { Hl7Message, type RawSegment } from "@cosyte/hl7";

import type { TransformedLocus } from "../locus.js";
import type { Hl7Coord } from "./extract.js";

/** Mutable mirror of `@cosyte/hl7`'s readonly `RawComponent`. */
interface MutComponent {
  subcomponents: string[];
  rawSubcomponents?: (string | undefined)[];
}
/** Mutable mirror of `RawRepetition`. */
interface MutRepetition {
  components: MutComponent[];
}
/** Mutable mirror of `RawField`. */
interface MutField {
  repetitions: MutRepetition[];
  isNull: boolean;
}
/** Mutable mirror of `RawSegment`. */
interface MutSegment {
  name: string;
  fields: MutField[];
}

/** Deep-clone one readonly component, preserving the escape-fidelity overlay when present. */
function cloneComponent(c: {
  readonly subcomponents: readonly string[];
  readonly rawSubcomponents?: readonly (string | undefined)[];
}): MutComponent {
  const out: MutComponent = { subcomponents: [...c.subcomponents] };
  if (c.rawSubcomponents !== undefined) out.rawSubcomponents = [...c.rawSubcomponents];
  return out;
}

/** Deep-clone the whole readonly raw segment tree into an independent mutable tree. */
function cloneSegments(segments: readonly RawSegment[]): MutSegment[] {
  return segments.map((seg) => ({
    name: seg.name,
    fields: seg.fields.map((f) => ({
      isNull: f.isNull,
      repetitions: f.repetitions.map((r) => ({ components: r.components.map(cloneComponent) })),
    })),
  }));
}

/** A single-value field body: one repetition, one component, one subcomponent. */
function singleValueField(value: string): MutField {
  return { isNull: false, repetitions: [{ components: [{ subcomponents: [value] }] }] };
}

/** An empty component (`{ subcomponents: [""] }`): a placeholder slot in a rebuilt composite. */
function emptyComponent(): MutComponent {
  return { subcomponents: [""] };
}

/** Apply a whole-field edit: clear the field (removed/blocked) or replace it with a single value. */
function applyWholeField(field: MutField, t: TransformedLocus): void {
  if (t.value === null) {
    field.repetitions = []; // removed / blocked → empty field
  } else {
    field.repetitions = singleValueField(t.value).repetitions;
  }
}

/** Apply an id-number edit: replace only CX.1 of the target repetition, retaining authority/type. */
function applyIdNumber(field: MutField, rep: number, t: TransformedLocus): void {
  const repetition = field.repetitions[rep];
  if (repetition === undefined) return;
  // Assign component 1 (CX.1); index-0 assignment also covers the (parser-unreachable) empty-components
  // case without a dead branch. Components 2+ (assigning authority / type code) are retained.
  repetition.components[0] = { subcomponents: [t.value ?? ""] };
}

/**
 * Apply a **date-field** edit: rewrite the date component of ONE repetition, never the whole field.
 *
 * A transformed value replaces component 1 of that repetition and leaves every sibling component (a
 * degree-of-precision marker, say) at its own ordinal. A blocked value empties the locus at its own
 * unit: when the field carries a single repetition the field itself is emptied, position preserved
 * and no component residue left behind; when it repeats, only the offending repetition is emptied, so
 * a sibling repetition keeps both its bytes and its ordinal.
 */
function applyDateField(field: MutField, rep: number, t: TransformedLocus): void {
  const repetition = field.repetitions[rep];
  if (repetition === undefined) return;
  if (t.value === null) {
    if (field.repetitions.length === 1) {
      field.repetitions = []; // blocked → empty field, nothing left behind
      return;
    }
    repetition.components = [emptyComponent()];
    return;
  }
  repetition.components[0] = { subcomponents: [t.value] };
}

/**
 * Apply a **date-component** edit: rewrite exactly one component of one repetition. The field that
 * contains it is never emptied, and every sibling component keeps its bytes and its ordinal, so
 * reading component `n` after the pass yields what it yielded before at every `n` the pass did not act
 * on. A blocked value leaves an empty component in place rather than deleting it, so nothing shifts.
 */
function applyDateComponent(
  field: MutField,
  rep: number,
  component: number | undefined,
  t: TransformedLocus,
): void {
  const repetition = field.repetitions[rep];
  if (repetition === undefined || component === undefined) return;
  const index = component - 1;
  if (index < 0 || index >= repetition.components.length) return;
  repetition.components[index] = { subcomponents: [t.value ?? ""] };
}

/** Apply an address edit: keep only the generalized 3-digit ZIP at XAD.5; drop every finer component. */
function applyAddressZip(field: MutField, rep: number, t: TransformedLocus): void {
  const repetition = field.repetitions[rep];
  if (repetition === undefined) return;
  if (t.value === null) {
    // Fail closed: no generalizable ZIP → drop the whole address repetition (street/city/county gone).
    repetition.components = [];
    return;
  }
  // Street (1), other (2), city (3), state (4) dropped; only the safe 3-digit ZIP (5) retained.
  repetition.components = [
    emptyComponent(),
    emptyComponent(),
    emptyComponent(),
    emptyComponent(),
    { subcomponents: [t.value] },
  ];
}

/**
 * Write the engine's transformed loci back onto a clone of `original` and return a fresh
 * {@link Hl7Message}. `transformed` and `coords` are index-aligned (both preserve extraction order).
 *
 * @param original - The parsed message to de-identify (never mutated).
 * @param transformed - The engine's transformed loci, in extraction order.
 * @param coords - The write-back coordinates, index-aligned with `transformed`.
 * @returns A new, independent de-identified {@link Hl7Message}.
 * @example
 * ```ts
 * import { parseHL7 } from "@cosyte/hl7";
 * import { extractHl7Loci, applyHl7 } from "@cosyte/deid/hl7";
 * import { deidentify } from "@cosyte/deid";
 *
 * const msg = parseHL7(raw);
 * const { loci, coords } = extractHl7Loci(msg);
 * const { document } = deidentify({ loci }, { context });
 * const clean = applyHl7(msg, document.loci, coords);
 * clean.toString(); // spec-clean, de-identified HL7
 * ```
 */
export function applyHl7(
  original: Hl7Message,
  transformed: readonly TransformedLocus[],
  coords: readonly Hl7Coord[],
): Hl7Message {
  const segments = cloneSegments(original.rawSegments);

  for (let i = 0; i < coords.length; i += 1) {
    const coord = coords[i];
    const t = transformed[i];
    if (coord === undefined || t === undefined) continue;
    const seg = segments[coord.segIndex];
    // MSH carries the field separator in its first position, so its raw slot for HL7 field N is
    // N - 1: the same offset the parser's own field accessor applies. Every other segment is 1-indexed
    // with a name placeholder at slot 0.
    const slot = seg?.name === "MSH" ? coord.field - 1 : coord.field;
    const field = seg?.fields[slot];
    if (field === undefined) continue;

    switch (coord.edit) {
      case "whole-field":
        applyWholeField(field, t);
        break;
      case "id-number":
        applyIdNumber(field, coord.rep, t);
        break;
      case "address-zip":
        applyAddressZip(field, coord.rep, t);
        break;
      case "date-field":
        applyDateField(field, coord.rep, t);
        break;
      case "date-component":
        applyDateComponent(field, coord.rep, coord.component, t);
        break;
      case "none":
        // A locus the profile's retention set kept: byte-identical is the whole point, so nothing is
        // written back. A whole-field write would flatten its components/repetitions into one value.
        break;
    }
  }

  return new Hl7Message({
    segments,
    encodingCharacters: original.encodingCharacters,
    version: original.version,
    warnings: [],
  });
}
