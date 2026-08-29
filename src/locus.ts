/**
 * The **format-agnostic locus model**: the abstraction the de-id core operates on before any parser
 * is wired. A *locus* is a structurally-located candidate value: **where** it lives (a format-neutral
 * path such as `"PID-5"`, `"recordTarget/patientRole/id"`, `"(0010,0010)"`), **what** kind of value it
 * is, and, when the caller can classify it, which Safe Harbor **category** it belongs to.
 *
 * Per-format locus maps produce these loci from a parsed model. The core is tested against this
 * generic shape directly, so the policy/transform/fail-closed core is independently shippable.
 *
 * @packageDocumentation
 */

import type { SafeHarborCategory } from "./categories.js";
import type { RetainedLocusClass } from "./retention.js";

/**
 * The kind of value at a locus: drives which generalization applies and whether the engine must
 * fail closed. `clinical` is the over-scrub guard: a clinical value (a lab result, a dose, a code, a
 * status) is **not** an identifier and must survive untouched.
 *
 * @example
 * ```ts
 * import { type LocusKind } from "@cosyte/deid";
 *
 * const kind: LocusKind = "identifier";
 * ```
 */
export type LocusKind = "identifier" | "date" | "age" | "zip" | "freetext" | "clinical" | "unknown";

/**
 * A single structurally-located candidate value. `category` is omitted when the caller cannot classify
 * the locus: an unclassified PHI-bearing locus is treated as catch-all (R) and **fails closed**.
 *
 * @example
 * ```ts
 * import { type GenericLocus, SAFE_HARBOR_CATEGORIES } from "@cosyte/deid";
 *
 * const locus: GenericLocus = {
 *   path: "PID-5",
 *   kind: "identifier",
 *   category: SAFE_HARBOR_CATEGORIES.NAMES,
 *   value: "SENTINEL_NAME_01",
 * };
 * ```
 */
export interface GenericLocus {
  /** The format-neutral path to the value. Recorded in the manifest; **never** a value. */
  readonly path: string;
  /** The kind of value at this locus. */
  readonly kind: LocusKind;
  /** The Safe Harbor category, when known. Omit to force fail-closed handling as category (R). */
  readonly category?: SafeHarborCategory;
  /**
   * The **retention class** this locus belongs to, when an adapter can name one. It is a *proposal*,
   * never a decision: the engine keeps the value only if the configured options **also** list this
   * class, **and** the resolved category is one a limited data set may carry at all. Both keys are
   * required, so an adapter cannot retain anything on its own and a stale marker cannot leak a value.
   *
   * Absent (the default) the locus takes its normal policy transform. This is **not** the over-scrub
   * guard: a `clinical` locus is not an identifier and is retained without a manifest row, whereas a
   * locus marked here **is** identifying and is always recorded when it is kept.
   */
  readonly retention?: RetainedLocusClass;
  /**
   * The **role code** an adapter classified a *party* on, present **only** at a locus that records a
   * party whose role places it **outside** §164.514(b)(2)(i)'s scope clause and whose name and
   * identifiers the pass therefore left in place. The engine records the code in the manifest at this
   * locus (`DEID_PARTY_ROLE_RETAINED`) and writes nothing back, so a retention that used to be silent
   * can be audited.
   *
   * It is a **code, never a value**: an adapter sets it from its own committed role table (see
   * `classifyPartyRole`), and a locus carrying it must carry an empty {@link value}: a party-role
   * record has no value to hand anywhere. A non-empty one **fails closed** (blocked) rather than being
   * retained, so this marker can never become a route for passing an identifier through.
   */
  readonly partyRole?: string;
  /** The value at the locus. Consumed by the engine, never copied into the manifest. */
  readonly value: string;
}

/**
 * The format-agnostic input model: a flat list of located candidate values. A per-format adapter
 * produces this from a parsed HL7 / C-CDA / FHIR / X12 / NCPDP / DICOM model.
 *
 * @example
 * ```ts
 * import { type LocusModel } from "@cosyte/deid";
 *
 * const model: LocusModel = { loci: [{ path: "PID-3", kind: "identifier", value: "X" }] };
 * ```
 */
export interface LocusModel {
  /** The located candidate values to de-identify. */
  readonly loci: readonly GenericLocus[];
}

/**
 * The transformed value of a locus after a de-id pass: the reduced/surrogate `value`, or `null` when
 * the value was removed or blocked (fail-closed). Carries no secret and no original value.
 *
 * @example
 * ```ts
 * import { type TransformedLocus } from "@cosyte/deid";
 *
 * const t: TransformedLocus = { path: "PID-3", kind: "identifier", value: null, disposition: "removed" };
 * ```
 */
export interface TransformedLocus {
  /** The format-neutral path (unchanged from input). */
  readonly path: string;
  /** The kind of value at this locus (unchanged from input). */
  readonly kind: LocusKind;
  /** The transformed value, or `null` when removed / blocked. */
  readonly value: string | null;
  /** What happened to the value. */
  readonly disposition: "transformed" | "removed" | "blocked" | "retained";
}

/**
 * The transformed document: the same loci with de-identified values. Format-specific documents
 * replace this `unknown`-shaped placeholder; the core returns this generic shape.
 *
 * @example
 * ```ts
 * import { type DeidDocument } from "@cosyte/deid";
 *
 * const doc: DeidDocument = { loci: [] };
 * ```
 */
export interface DeidDocument {
  /** The transformed loci. */
  readonly loci: readonly TransformedLocus[];
}
