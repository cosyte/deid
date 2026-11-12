/**
 * The **value-free manifest**: the auditable record of what a de-id pass did. Every entry carries the
 * category acted on, the transform applied, the **locus** (a path, never a value), a count, a
 * disposition, and a stable disposition code. It records *what was acted on and where*, **never the
 * value that was removed, generalized, or pseudonymized**: a manifest that logged a value would be a
 * PHI leak in the audit trail.
 *
 * **The record a pass returns has two lists, and this is the first of them.** A {@link DeidManifestEntry}
 * describes a position the engine reached a **decision** at, and every such entry names the Safe Harbor
 * category that decision was made under. The second list is the **unexamined residual positions**
 * (`./residual.ts`): value-bearing positions inside a structure the pass handed through that **no locus
 * rule named**, which by construction have no category, no transform and no disposition, because nothing
 * was decided there. They are kept apart for that reason: an entry here is a decision, and an entry
 * there is the absence of one. Each format adapter returns both.
 *
 * @packageDocumentation
 */

import type { SafeHarborCategory } from "./categories.js";
import type { DeidDispositionCode } from "./codes.js";
import type { DeidDocument } from "./locus.js";
import { KEYED_TRANSFORMS, type TransformName } from "./policy.js";

/**
 * A single value-free manifest entry.
 *
 * @example
 * ```ts
 * import { type DeidManifestEntry, SAFE_HARBOR_CATEGORIES, DEID_DISPOSITION_CODES } from "@cosyte/deid";
 *
 * const entry: DeidManifestEntry = {
 *   category: SAFE_HARBOR_CATEGORIES.SSN,
 *   transform: "redact",
 *   locus: "PID-19",
 *   count: 1,
 *   disposition: "removed",
 *   code: DEID_DISPOSITION_CODES.DEID_CATEGORY_REMOVED,
 *   reidentificationCode: false,
 * };
 * ```
 */
export interface DeidManifestEntry {
  /** The Safe Harbor category acted on. */
  readonly category: SafeHarborCategory;
  /** The transform applied. */
  readonly transform: TransformName;
  /** The format-neutral locus (segment/field index · path · tag), **never** a value. */
  readonly locus: string;
  /** How many values at this locus/category/disposition were acted on. */
  readonly count: number;
  /**
   * The disposition. `retained` is the honest fourth outcome, and it covers three different kept things,
   * told apart by the entry's `code`:
   *
   * - an **identifying** locus the configured profile's retention set deliberately kept unchanged,
   *   paired with `DEID_RESIDUAL_RETAINED`, so a kept identifier reaches the determiner's residual
   *   inventory rather than being invisible;
   * - a **party** whose role places it outside §164.514(b)(2)(i)'s scope clause, paired with
   *   `DEID_PARTY_ROLE_RETAINED` and the {@link partyRole} code that placed it there. That is not a
   *   residual of the individual's identity and does not join the residual inventory;
   * - **embedded content** the pass does not read (a FHIR `Attachment.data`, say), kept because the
   *   caller opted in for that kind of element, paired with `DEID_EMBEDDED_CONTENT_RETAINED`.
   *
   * (Clinical values kept by the over-scrub guard are **not** identifiers and are not manifest entries
   * at all.)
   */
  readonly disposition: "transformed" | "removed" | "blocked" | "retained";
  /** The stable disposition code. */
  readonly code: DeidDispositionCode;
  /**
   * `true` exactly at a locus where the pass emitted a **keyed surrogate**: the output of
   * `pseudonymize`, `hash` or `date-shift`, which is computed from the value it replaced and is
   * therefore a **re-identification code** anyone holding the key can reverse the linkage of. `false`
   * at every other locus.
   *
   * It is value-free (a boolean; never a value, a key or a shift offset) and **additive**: no other
   * field of this entry changes on account of it, so a consumer branching on `transform`,
   * `disposition` or `code` reads exactly what it read before. It is what the Expert-Determination
   * support report's **keyed-surrogate residual inventory** is built from, so an expert can reason
   * about the residual a surrogate leaves rather than discover it from the transform name.
   */
  readonly reidentificationCode: boolean;
  /**
   * The **role code** that placed a party outside §164.514(b)(2)(i)'s scope clause, present **only** on
   * a `DEID_PARTY_ROLE_RETAINED` entry. It answers, at the party's own locus, the question a silent
   * retention could not: *on what did the pass decide this party is not the individual, a relative, an
   * employer or a household member?*
   *
   * Value-free and **additive**, like {@link reidentificationCode}: it is a code from a role table this
   * library ships (an X12 element 98 entity-identifier code; the role an HL7 v2.5.1 field definition
   * types at an organisation-typed position), never a name, an identifier, an address or any other
   * value read off the document, and no other field of the entry changes on account of it.
   */
  readonly partyRole?: string;
}

/**
 * The immutable result of a de-id pass: the transformed document plus the value-free manifest.
 *
 * @example
 * ```ts
 * import { deidentify } from "@cosyte/deid";
 *
 * const result = deidentify({ loci: [] }, {});
 * result.manifest; // => [] (nothing acted on)
 * ```
 */
export interface DeidResult {
  /** The transformed document (the generic locus document from the core). */
  readonly document: DeidDocument;
  /** The value-free audit of every action, in locus order. */
  readonly manifest: readonly DeidManifestEntry[];
}

/**
 * The fields a call site supplies for count aggregation: the five identity fields plus, at a party-role
 * locus, the role code. `reidentificationCode` is **derived** here from the transform rather than passed
 * in, so no call site can forget it and no two entries can disagree about whether the same transform
 * emitted a keyed surrogate.
 */
type EntryKey = Omit<DeidManifestEntry, "count" | "reidentificationCode">;

/**
 * Accumulates manifest entries, aggregating identical (category, transform, locus, disposition, code,
 * party role) tuples into a single entry with a running `count`. Insertion order is preserved. The role
 * code is part of the key so two parties classified on different roles can never collapse into one row.
 *
 * @internal
 */
export class ManifestBuilder {
  /** Every entry, in insertion order. */
  private readonly entries: MutableEntry[] = [];
  /**
   * The entries recorded at each locus. A locus is a string the pass already holds, so a lookup
   * builds no key; the few entries one locus can carry (one per category, transform, disposition,
   * code and role) are compared field by field.
   */
  private readonly byLocus = new Map<string, MutableEntry | MutableEntry[]>();

  /** Record one acted-on value; identical loci/dispositions increment the count. */
  public add(key: EntryKey): void {
    const found = this.byLocus.get(key.locus);
    if (found !== undefined) {
      const list = Array.isArray(found) ? found : [found];
      for (let i = 0; i < list.length; i += 1) {
        const existing = list[i] as MutableEntry;
        if (sameRow(existing, key)) {
          this.increment(existing, found, i);
          return;
        }
      }
    }
    const entry: MutableEntry = {
      ...key,
      count: 1,
      // A keyed surrogate (pseudonymize / hash / date-shift) is a re-identification code.
      reidentificationCode: KEYED_TRANSFORMS.has(key.transform),
    };
    this.entries.push(entry);
    if (found === undefined) this.byLocus.set(key.locus, entry);
    else if (Array.isArray(found)) found.push(entry);
    else this.byLocus.set(key.locus, [found, entry]);
  }

  /** Freeze and return the accumulated entries in insertion order. */
  public build(): readonly DeidManifestEntry[] {
    for (const entry of this.entries) Object.freeze(entry);
    return Object.freeze(this.entries.slice());
  }

  /**
   * Count one more value on an entry. An entry a previous {@link build} froze has been handed out, so
   * it is replaced by a copy rather than changed under its holder.
   */
  private increment(
    existing: MutableEntry,
    found: MutableEntry | MutableEntry[],
    at: number,
  ): void {
    if (!Object.isFrozen(existing)) {
      existing.count += 1;
      return;
    }
    const next: MutableEntry = { ...existing, count: existing.count + 1 };
    this.entries[this.entries.indexOf(existing)] = next;
    if (Array.isArray(found)) found[at] = next;
    else this.byLocus.set(existing.locus, next);
  }
}

/** An entry while the builder still counts it: {@link ManifestBuilder.build} freezes it. */
type MutableEntry = { -readonly [K in keyof DeidManifestEntry]: DeidManifestEntry[K] };

/**
 * `true` when an entry and a key describe the same manifest row: the same category, transform,
 * disposition, code and role at the same locus. An absent role and an empty one are the same row.
 */
function sameRow(entry: DeidManifestEntry, key: EntryKey): boolean {
  return (
    entry.category === key.category &&
    entry.transform === key.transform &&
    entry.disposition === key.disposition &&
    entry.code === key.code &&
    (entry.partyRole ?? "") === (key.partyRole ?? "")
  );
}
