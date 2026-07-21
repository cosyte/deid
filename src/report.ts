/**
 * The **Expert-Determination support report** (roadmap §Phase 9) — a structured, value-free account of
 * *what a de-identification pass did and what it left in place*, built from the value-free
 * {@link DeidManifestEntry} manifest every adapter emits. It exists to **support** a qualified
 * statistician's HIPAA **Expert Determination** (45 CFR §164.514(b)(1)) with the residual-risk-relevant
 * facts they reason about — it does **not**, and **cannot**, render or certify one.
 *
 * **The hard boundary (the whole point of this module).** `@cosyte/deid` makes **no determination**. This
 * report:
 * - **never** asserts the output "is de-identified" or "meets Expert Determination";
 * - **never** computes or fabricates a re-identification **risk score** — it reaches no conclusion;
 * - carries `determination: null` and leads with {@link EXPERT_DETERMINATION_DISCLAIMER}.
 *
 * "The risk is very small" is a contextual judgment about a specific dataset, its recipient, and the
 * other data reasonably available to that recipient — none of which this library sees. Over-claiming here
 * would be a real compliance harm, so the report is deliberately **descriptive, never prescriptive**: it
 * says *"here is what was done and what remains,"* and hands that to the expert.
 *
 * **Value-free, still.** Like the manifest it summarizes, the report carries **loci / categories /
 * dispositions / counts** — **never a PHI value**. The one optional quasi-identifier statistic it can
 * surface (a k-anonymity **indicator**) is computed **only** over equivalence-class sizes the *consumer*
 * supplies (they hold the values; the library counts what it is given), and is labelled a descriptive
 * input, never a risk verdict.
 *
 * @packageDocumentation
 */

import { SAFE_HARBOR_CATEGORY_META, type SafeHarborCategory } from "./categories.js";
import { DEID_DISPOSITION_CODES, type DeidDispositionCode } from "./codes.js";
import { OUTPUT_LABEL } from "./labels.js";
import type { DeidManifestEntry } from "./manifest.js";
import type { DeidPolicy, TransformName } from "./policy.js";

/**
 * The prominent non-certification statement. It is the first field a reader sees and is repeated at the
 * head of the human-readable rendering. Its job is to make over-claiming impossible to do by accident:
 * the report supports a determination, it is never the determination.
 *
 * @example
 * ```ts
 * import { EXPERT_DETERMINATION_DISCLAIMER } from "@cosyte/deid";
 *
 * EXPERT_DETERMINATION_DISCLAIMER.includes("NOT a determination"); // => true
 * ```
 */
export const EXPERT_DETERMINATION_DISCLAIMER =
  "This report describes what a de-identification pass did and what it left in place. It is NOT a " +
  "determination that the data is de-identified. @cosyte/deid does not — and cannot — render or " +
  "certify HIPAA Expert Determination (45 CFR §164.514(b)(1)): that is a qualified statistician's " +
  "contextual judgment about a specific dataset, its anticipated recipient, and the other information " +
  "reasonably available to that recipient — none of which this library sees. This report emits no " +
  "re-identification risk score and reaches no conclusion. It is descriptive input a determiner " +
  "consumes and documents, never the determination itself.";

/** A manifest disposition — the three outcomes a locus can have. */
export type ReportDisposition = "transformed" | "removed" | "blocked";

/**
 * Per-category coverage — for one of the 18 Safe Harbor categories (45 CFR §164.514(b)(2)(i)(A)–(R)),
 * whether the pass acted on it and how. Present for **all 18** categories in the report (in regulatory
 * order A→R), so a reader sees the categories **not** acted on as plainly as those that were.
 *
 * @example
 * ```ts
 * import { buildExpertDeterminationSupportReport, SAFE_HARBOR_CATEGORIES } from "@cosyte/deid";
 *
 * const report = buildExpertDeterminationSupportReport([
 *   { category: SAFE_HARBOR_CATEGORIES.SSN, transform: "redact", locus: "PID-19", count: 1,
 *     disposition: "removed", code: "DEID_CATEGORY_REMOVED" },
 * ]);
 * const ssn = report.categoryCoverage.find((c) => c.category === SAFE_HARBOR_CATEGORIES.SSN);
 * ssn?.actedOn; // => true
 * ```
 */
export interface CategoryCoverage {
  /** The Safe Harbor category. */
  readonly category: SafeHarborCategory;
  /** The §164.514(b)(2)(i) sub-paragraph letter (A–R). */
  readonly letter: string;
  /** The category ordinal (1–18). */
  readonly number: number;
  /** A short human title (no PHI). */
  readonly title: string;
  /** `true` when at least one manifest entry acted on this category. */
  readonly actedOn: boolean;
  /** Total count of values acted on across every locus of this category. */
  readonly totalCount: number;
  /** Count of acted-on values by disposition. */
  readonly dispositions: Readonly<Record<ReportDisposition, number>>;
  /** The distinct transforms applied to this category, sorted. */
  readonly transforms: readonly TransformName[];
  /** The distinct disposition codes recorded for this category, sorted. */
  readonly codes: readonly DeidDispositionCode[];
  /** `true` when a coarse identifying **residual** was retained for this category (see §residual). */
  readonly residualRetained: boolean;
}

/**
 * One entry in the **retained-quasi-identifier residual inventory** — a coarse identifying element the
 * pass **deliberately kept** for analytic utility and **recorded** as `DEID_RESIDUAL_RETAINED`: a
 * year-only date, a retained safe 3-digit ZIP prefix, an exact age ≤ 89. These are exactly the residuals
 * an expert reasons about under the §164.514(b)(2)(ii) actual-knowledge test.
 *
 * @example
 * ```ts
 * import { buildExpertDeterminationSupportReport, SAFE_HARBOR_CATEGORIES } from "@cosyte/deid";
 *
 * const report = buildExpertDeterminationSupportReport([
 *   { category: SAFE_HARBOR_CATEGORIES.DATES, transform: "generalize", locus: "PID-7", count: 1,
 *     disposition: "transformed", code: "DEID_RESIDUAL_RETAINED" },
 * ]);
 * report.retainedQuasiIdentifiers[0]?.locus; // => "PID-7"
 * ```
 */
export interface RetainedQuasiIdentifier {
  /** The format-neutral locus (segment/field index · path · tag) — **never** a value. */
  readonly locus: string;
  /** The Safe Harbor category of the retained residual. */
  readonly category: SafeHarborCategory;
  /** How many values at this locus retained a residual. */
  readonly count: number;
}

/**
 * A roll-up of how many values landed in each disposition across the whole report — the one-glance
 * posture of the pass. Every field is a count; none is a value.
 *
 * @example
 * ```ts
 * import { buildExpertDeterminationSupportReport, SAFE_HARBOR_CATEGORIES } from "@cosyte/deid";
 *
 * const report = buildExpertDeterminationSupportReport([
 *   { category: SAFE_HARBOR_CATEGORIES.SSN, transform: "redact", locus: "PID-19", count: 2,
 *     disposition: "removed", code: "DEID_CATEGORY_REMOVED" },
 * ]);
 * report.dispositionSummary.removed; // => 2
 * ```
 */
export interface DispositionSummary {
  /** Values replaced with a surrogate / generalized / shifted / hashed / BYO-redacted. */
  readonly transformed: number;
  /** Values removed outright. */
  readonly removed: number;
  /** Loci failed closed (blocked; value withheld). */
  readonly blocked: number;
  /** Of the transformed values, how many retained a coarse residual (`DEID_RESIDUAL_RETAINED`). */
  readonly residualRetained: number;
  /** Free-text loci blocked by default (`DEID_FREETEXT_BLOCKED`). */
  readonly freeTextBlocked: number;
  /** Free-text loci redacted by a **consumer-supplied** BYO redactor (`DEID_FREETEXT_CONSUMER_REDACTED`). */
  readonly freeTextConsumerRedacted: number;
}

/**
 * **Consumer-supplied** quasi-identifier equivalence-class data. The library never derives this — it has
 * no view of the quasi-identifier **values**. The consumer, who holds the values, groups their records by
 * the chosen quasi-identifier set (e.g. 3-digit ZIP × birth year × sex) and supplies the size of each
 * distinct group; the report echoes descriptive counts over those sizes (see {@link QuasiIdentifierStatistics}).
 *
 * @example
 * ```ts
 * import { type QuasiIdentifierClassInput } from "@cosyte/deid";
 *
 * // Consumer grouped 100 records into classes of these sizes over their chosen quasi-identifier set:
 * const qi: QuasiIdentifierClassInput = {
 *   quasiIdentifierSet: "3-digit ZIP × birth year × sex",
 *   equivalenceClassSizes: [40, 33, 20, 5, 1, 1],
 * };
 * ```
 */
export interface QuasiIdentifierClassInput {
  /** A human label for the quasi-identifier set the sizes were computed over. No PHI. */
  readonly quasiIdentifierSet?: string;
  /** One size per distinct quasi-identifier combination — the record count in that equivalence class. */
  readonly equivalenceClassSizes: readonly number[];
}

/**
 * Descriptive statistics over **consumer-supplied** equivalence-class sizes — including the smallest
 * class size, the widely-used **k-anonymity indicator**.
 *
 * **This is not a risk score and not a determination.** It is arithmetic over sizes the consumer
 * supplied: the library counts what it is given, applies no threshold, draws no `k ≥ n ⇒ safe`
 * conclusion, and emits no verdict. A statistician documents an indicator like this *as one input* to a
 * §164.514(b)(1) determination — the determination remains theirs. See {@link note}.
 *
 * @example
 * ```ts
 * import { buildExpertDeterminationSupportReport } from "@cosyte/deid";
 *
 * const report = buildExpertDeterminationSupportReport([], {
 *   quasiIdentifiers: { equivalenceClassSizes: [40, 20, 5, 1, 1] },
 * });
 * report.quasiIdentifierStatistics?.minimumEquivalenceClassSize; // => 1
 * report.quasiIdentifierStatistics?.uniqueRecords;               // => 2
 * ```
 */
export interface QuasiIdentifierStatistics {
  /** The label the consumer gave the quasi-identifier set, or `null` if unlabelled. */
  readonly quasiIdentifierSet: string | null;
  /** Number of distinct quasi-identifier combinations = the number of equivalence classes supplied. */
  readonly distinctCombinations: number;
  /** Total records across all classes = the sum of the supplied sizes. */
  readonly totalRecords: number;
  /** The smallest equivalence-class size — the **k-anonymity indicator**. Descriptive only. */
  readonly minimumEquivalenceClassSize: number;
  /** How many records fall in a class of size 1 (sample-uniques on the chosen set). Descriptive only. */
  readonly uniqueRecords: number;
  /** The honesty note: this is a descriptive input, never a risk score or determination. */
  readonly note: string;
}

/** Options for {@link buildExpertDeterminationSupportReport}. */
export interface ExpertDeterminationReportOptions {
  /** The policy applied (or its name) — surfaced as the report's policy label. */
  readonly policy?: DeidPolicy | string;
  /** Consumer-supplied quasi-identifier equivalence-class sizes for the descriptive k-indicator. */
  readonly quasiIdentifiers?: QuasiIdentifierClassInput;
}

/**
 * The structured, value-free Expert-Determination **support** report. Machine-readable (this object) and
 * human-readable (via {@link formatExpertDeterminationSupportReport}). It **supports** a determination
 * and is **never** one: `determination` is always `null` and {@link disclaimer} leads.
 *
 * @example
 * ```ts
 * import { buildExpertDeterminationSupportReport, SAFE_HARBOR_CATEGORIES } from "@cosyte/deid";
 *
 * const report = buildExpertDeterminationSupportReport([
 *   { category: SAFE_HARBOR_CATEGORIES.NAMES, transform: "redact", locus: "PID-5", count: 1,
 *     disposition: "removed", code: "DEID_CATEGORY_REMOVED" },
 * ]);
 * report.determination; // => null (the library never renders one)
 * report.totals.categoriesActedOn; // => 1
 * ```
 */
export interface ExpertDeterminationSupportReport {
  /** A stable discriminant for the report shape. */
  readonly kind: "expert-determination-support";
  /** Always `null`: the library renders **no** determination. */
  readonly determination: null;
  /** The prominent non-certification statement ({@link EXPERT_DETERMINATION_DISCLAIMER}). */
  readonly disclaimer: string;
  /** The output label the pass applied — "Safe-Harbor-transformed per the configured policy". */
  readonly outputLabel: string;
  /** The policy name applied, or `null` if not supplied. */
  readonly policy: string | null;
  /** How many documents' manifests this report summarizes (1 for a single manifest). */
  readonly documentCount: number;
  /** Headline totals. */
  readonly totals: {
    /** Count of **distinct acted-on loci** (distinct locus paths across the whole report). */
    readonly loci: number;
    /** Count of aggregated `perLocus` rows (distinct category·transform·locus·disposition·code tuples). */
    readonly rows: number;
    /** How many of the 18 Safe Harbor categories were acted on. */
    readonly categoriesActedOn: number;
  };
  /** The disposition roll-up. */
  readonly dispositionSummary: DispositionSummary;
  /** Every acted-on locus, aggregated and in a deterministic order — the value-free manifest, structured. */
  readonly perLocus: readonly DeidManifestEntry[];
  /** Coverage for all 18 Safe Harbor categories, in regulatory order (A→R). */
  readonly categoryCoverage: readonly CategoryCoverage[];
  /** The retained-quasi-identifier residual inventory (coarse residuals the pass recorded as retained). */
  readonly retainedQuasiIdentifiers: readonly RetainedQuasiIdentifier[];
  /** Descriptive quasi-identifier statistics, **only** when the consumer supplied class sizes; else `null`. */
  readonly quasiIdentifierStatistics: QuasiIdentifierStatistics | null;
}

/** The honesty note stamped onto every {@link QuasiIdentifierStatistics}. */
const QI_STAT_NOTE =
  "Descriptive count over caller-supplied equivalence-class sizes. It is an input a statistician may " +
  "document under 45 CFR §164.514(b)(1); it is NOT a re-identification risk score, NOT a determination, " +
  "and NOT a threshold this library evaluates. No conclusion is drawn from it here.";

/** Type guard: is this a single manifest (array of entries) rather than a corpus (array of manifests)? */
function isSingleManifest(
  input: readonly DeidManifestEntry[] | readonly (readonly DeidManifestEntry[])[],
): input is readonly DeidManifestEntry[] {
  const first: unknown = input[0];
  // A manifest entry is a non-array object; a corpus element is an array. An empty top-level array is
  // treated as a single (empty) manifest.
  return first === undefined || !Array.isArray(first);
}

/** Normalize the flexible input into an explicit list of per-document manifests. */
function toManifests(
  input: readonly DeidManifestEntry[] | readonly (readonly DeidManifestEntry[])[],
): readonly (readonly DeidManifestEntry[])[] {
  if (isSingleManifest(input)) {
    return [input];
  }
  return input;
}

/** A stable aggregation key over the five identity fields of a manifest entry (all count, no value). */
function entryKey(e: DeidManifestEntry): string {
  return `${e.category} ${e.transform} ${e.locus} ${e.disposition} ${e.code}`;
}

/** Merge every document's entries, summing counts for identical (category,transform,locus,disp,code). */
function aggregate(manifests: readonly (readonly DeidManifestEntry[])[]): DeidManifestEntry[] {
  const merged = new Map<string, DeidManifestEntry>();
  for (const manifest of manifests) {
    for (const e of manifest) {
      const key = entryKey(e);
      const existing = merged.get(key);
      merged.set(
        key,
        existing === undefined ? { ...e } : { ...existing, count: existing.count + e.count },
      );
    }
  }
  const meta = SAFE_HARBOR_CATEGORY_META;
  return [...merged.values()].sort(
    (a, b) =>
      meta[a.category].number - meta[b.category].number ||
      a.locus.localeCompare(b.locus) ||
      a.transform.localeCompare(b.transform) ||
      a.disposition.localeCompare(b.disposition) ||
      a.code.localeCompare(b.code),
  );
}

/** Build the per-category coverage for a single category from its (already aggregated) entries. */
function coverageFor(
  category: SafeHarborCategory,
  entries: readonly DeidManifestEntry[],
): CategoryCoverage {
  const meta = SAFE_HARBOR_CATEGORY_META[category];
  const dispositions: Record<ReportDisposition, number> = {
    transformed: 0,
    removed: 0,
    blocked: 0,
  };
  const transforms = new Set<TransformName>();
  const codes = new Set<DeidDispositionCode>();
  let totalCount = 0;
  let residualRetained = false;
  for (const e of entries) {
    totalCount += e.count;
    dispositions[e.disposition] += e.count;
    transforms.add(e.transform);
    codes.add(e.code);
    if (e.code === DEID_DISPOSITION_CODES.DEID_RESIDUAL_RETAINED) {
      residualRetained = true;
    }
  }
  return Object.freeze({
    category,
    letter: meta.letter,
    number: meta.number,
    title: meta.title,
    actedOn: entries.length > 0,
    totalCount,
    dispositions: Object.freeze(dispositions),
    transforms: Object.freeze([...transforms].sort()),
    codes: Object.freeze([...codes].sort()),
    residualRetained,
  });
}

/** Roll up the disposition counts across all aggregated entries. */
function summarize(entries: readonly DeidManifestEntry[]): DispositionSummary {
  const s = {
    transformed: 0,
    removed: 0,
    blocked: 0,
    residualRetained: 0,
    freeTextBlocked: 0,
    freeTextConsumerRedacted: 0,
  };
  for (const e of entries) {
    s[e.disposition] += e.count;
    if (e.code === DEID_DISPOSITION_CODES.DEID_RESIDUAL_RETAINED) s.residualRetained += e.count;
    if (e.code === DEID_DISPOSITION_CODES.DEID_FREETEXT_BLOCKED) s.freeTextBlocked += e.count;
    if (e.code === DEID_DISPOSITION_CODES.DEID_FREETEXT_CONSUMER_REDACTED)
      s.freeTextConsumerRedacted += e.count;
  }
  return Object.freeze(s);
}

/** Compute the descriptive quasi-identifier statistics over consumer-supplied class sizes, or `null`. */
function quasiIdentifierStats(
  input: QuasiIdentifierClassInput | undefined,
): QuasiIdentifierStatistics | null {
  if (input === undefined) {
    return null;
  }
  // Count only over well-formed sizes (finite, ≥ 1). Non-positive / non-finite sizes are not a valid
  // equivalence-class size and are ignored rather than silently corrupting the counts.
  const sizes = input.equivalenceClassSizes
    .filter((n) => Number.isFinite(n) && n >= 1)
    .map(Math.floor);
  if (sizes.length === 0) {
    return null;
  }
  const totalRecords = sizes.reduce((a, n) => a + n, 0);
  return Object.freeze({
    quasiIdentifierSet: input.quasiIdentifierSet ?? null,
    distinctCombinations: sizes.length,
    totalRecords,
    minimumEquivalenceClassSize: Math.min(...sizes),
    uniqueRecords: sizes.filter((n) => n === 1).length,
    note: QI_STAT_NOTE,
  });
}

/**
 * Build the {@link ExpertDeterminationSupportReport} from the value-free manifest(s) of one or more
 * de-identification passes. Deterministic; the input is never mutated; the result is deeply frozen.
 *
 * Accepts either a **single** manifest (`readonly DeidManifestEntry[]`) or a **corpus** (an array of
 * manifests). Counts for identical loci are summed across the corpus. The report is **value-free** — it
 * carries categories, dispositions, loci, and counts, **never a PHI value** — and it renders **no
 * determination**: `determination` is `null` and the disclaimer leads.
 *
 * @param manifests - A single manifest, or an array of manifests (a corpus).
 * @param options - The policy label and optional consumer-supplied quasi-identifier class sizes.
 * @returns The frozen, value-free support report.
 * @example
 * ```ts
 * import { deidentify, buildExpertDeterminationSupportReport, SAFE_HARBOR_CATEGORIES } from "@cosyte/deid";
 *
 * const { manifest } = deidentify(
 *   { loci: [{ path: "PID-5", kind: "name", category: SAFE_HARBOR_CATEGORIES.NAMES, value: "X" }] },
 *   {},
 * );
 * const report = buildExpertDeterminationSupportReport(manifest, { policy: "safe-harbor" });
 * report.determination;   // => null
 * report.policy;          // => "safe-harbor"
 * ```
 */
export function buildExpertDeterminationSupportReport(
  manifests: readonly DeidManifestEntry[] | readonly (readonly DeidManifestEntry[])[],
  options: ExpertDeterminationReportOptions = {},
): ExpertDeterminationSupportReport {
  const perDocument = toManifests(manifests);
  const entries = aggregate(perDocument);

  const categoryCoverage = (Object.keys(SAFE_HARBOR_CATEGORY_META) as SafeHarborCategory[])
    .sort((a, b) => SAFE_HARBOR_CATEGORY_META[a].number - SAFE_HARBOR_CATEGORY_META[b].number)
    .map((category) =>
      coverageFor(
        category,
        entries.filter((e) => e.category === category),
      ),
    );

  const retainedQuasiIdentifiers = entries
    .filter((e) => e.code === DEID_DISPOSITION_CODES.DEID_RESIDUAL_RETAINED)
    .map((e) => Object.freeze({ locus: e.locus, category: e.category, count: e.count }));

  const policyName =
    options.policy === undefined
      ? null
      : typeof options.policy === "string"
        ? options.policy
        : options.policy.name;

  return Object.freeze({
    kind: "expert-determination-support",
    determination: null,
    disclaimer: EXPERT_DETERMINATION_DISCLAIMER,
    outputLabel: OUTPUT_LABEL,
    policy: policyName,
    documentCount: perDocument.length,
    totals: Object.freeze({
      // Distinct acted-on loci (paths), not disposition-tuples: in a corpus one locus may be acted on
      // differently across documents, so count the distinct locus strings, never the aggregated rows.
      loci: new Set(entries.map((e) => e.locus)).size,
      rows: entries.length,
      categoriesActedOn: categoryCoverage.filter((c) => c.actedOn).length,
    }),
    dispositionSummary: summarize(entries),
    perLocus: Object.freeze(entries.map((e) => Object.freeze(e))),
    categoryCoverage: Object.freeze(categoryCoverage),
    retainedQuasiIdentifiers: Object.freeze(retainedQuasiIdentifiers),
    quasiIdentifierStatistics: quasiIdentifierStats(options.quasiIdentifiers),
  });
}

/**
 * Render an {@link ExpertDeterminationSupportReport} as a human-readable Markdown document — the same
 * value-free facts as the structured object, led by the non-certification disclaimer. Suitable to hand
 * to a statistician alongside the machine-readable report.
 *
 * @param report - A report from {@link buildExpertDeterminationSupportReport}.
 * @returns A Markdown string (value-free: categories, dispositions, loci, counts — never a value).
 * @example
 * ```ts
 * import { buildExpertDeterminationSupportReport, formatExpertDeterminationSupportReport } from "@cosyte/deid";
 *
 * const md = formatExpertDeterminationSupportReport(buildExpertDeterminationSupportReport([]));
 * md.startsWith("# Expert-Determination support report"); // => true
 * ```
 */
export function formatExpertDeterminationSupportReport(
  report: ExpertDeterminationSupportReport,
): string {
  const lines: string[] = [];
  lines.push("# Expert-Determination support report");
  lines.push("");
  lines.push(`> **NOT A DETERMINATION.** ${report.disclaimer}`);
  lines.push("");
  lines.push(`- Output label: ${report.outputLabel}`);
  lines.push(`- Policy: ${report.policy ?? "(unspecified)"}`);
  lines.push(`- Documents summarized: ${String(report.documentCount)}`);
  lines.push(
    `- Loci acted on: ${String(report.totals.loci)} · categories acted on: ${String(report.totals.categoriesActedOn)}/18`,
  );
  const d = report.dispositionSummary;
  lines.push(
    `- Dispositions — transformed: ${String(d.transformed)}, removed: ${String(d.removed)}, blocked: ${String(d.blocked)}` +
      ` (free-text blocked: ${String(d.freeTextBlocked)}, consumer-redacted: ${String(d.freeTextConsumerRedacted)})`,
  );
  lines.push("");
  lines.push("## Safe Harbor category coverage (§164.514(b)(2)(i) A–R)");
  lines.push("");
  lines.push("| # | Category | Acted on | Count | Transforms |");
  lines.push("|---|---|---|---|---|");
  for (const c of report.categoryCoverage) {
    lines.push(
      `| ${c.letter} | ${c.title} | ${c.actedOn ? "yes" : "no"} | ${String(c.totalCount)} | ${
        c.transforms.length > 0 ? c.transforms.join(", ") : "—"
      } |`,
    );
  }
  lines.push("");
  lines.push("## Retained quasi-identifiers (coarse residuals recorded as retained)");
  lines.push("");
  if (report.retainedQuasiIdentifiers.length === 0) {
    lines.push(
      "_None recorded._ Coarse residuals (year-only dates, safe 3-digit ZIP prefixes, exact",
    );
    lines.push(
      "ages ≤ 89) would appear here when a generalization keeps one. Clinical values retained",
    );
    lines.push(
      "untouched by the over-scrub guard are not identifiers and are not enumerated in the",
    );
    lines.push(
      "value-free manifest; see each format's retained-segment limitations for residual dates.",
    );
  } else {
    lines.push(
      "These are residual identifying elements the pass kept for utility — an actual-knowledge",
    );
    lines.push("(§164.514(b)(2)(ii)) consideration for the determiner:");
    lines.push("");
    for (const r of report.retainedQuasiIdentifiers) {
      lines.push(`- ${r.locus} — ${r.category} (×${String(r.count)})`);
    }
  }
  const qi = report.quasiIdentifierStatistics;
  if (qi !== null) {
    lines.push("");
    lines.push("## Quasi-identifier statistics (caller-supplied — descriptive, not a verdict)");
    lines.push("");
    lines.push(`- Quasi-identifier set: ${qi.quasiIdentifierSet ?? "(unlabelled)"}`);
    lines.push(
      `- Distinct combinations: ${String(qi.distinctCombinations)} over ${String(qi.totalRecords)} records`,
    );
    lines.push(
      `- Smallest equivalence class (k-anonymity indicator): ${String(qi.minimumEquivalenceClassSize)}` +
        ` · sample-uniques: ${String(qi.uniqueRecords)}`,
    );
    lines.push(`- ${qi.note}`);
  }
  return lines.join("\n");
}
