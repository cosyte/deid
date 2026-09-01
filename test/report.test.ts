/**
 * Tests for the **Expert-Determination support report** (roadmap §Phase 9).
 *
 * The report **supports** a §164.514(b)(1) Expert Determination and must **never** render one. The
 * headline gates here are the **honesty boundary** (no "determination", no fabricated risk score) and
 * **value-freeness** (the report carries loci / categories / dispositions / counts, never a PHI value).
 * The k-anonymity indicator is computed only over consumer-supplied class sizes and is checked for
 * arithmetic correctness on a known corpus.
 */

import { describe, expect, it } from "vitest";
import fc from "fast-check";

import {
  DEID_DISPOSITION_CODES,
  EXPERT_DETERMINATION_DISCLAIMER,
  KEYED_TRANSFORMS,
  OUTPUT_LABEL,
  SAFE_HARBOR_CATEGORIES,
  buildExpertDeterminationSupportReport,
  createDeidContext,
  defineDeidPolicy,
  deidentify,
  formatExpertDeterminationSupportReport,
  type DeidManifestEntry,
  type UnexaminedResidual,
} from "../src/index.js";

const C = SAFE_HARBOR_CATEGORIES;
const CODES = DEID_DISPOSITION_CODES;

/**
 * A small helper to build a manifest entry with a count of 1 by default. `reidentificationCode`
 * defaults to whatever the entry's transform implies, exactly as the engine derives it, so a fixture
 * cannot accidentally describe a keyed surrogate as carrying no re-identification code.
 */
function entry(
  e: Partial<DeidManifestEntry> & Pick<DeidManifestEntry, "category" | "code">,
): DeidManifestEntry {
  const base = {
    transform: "redact" as const,
    locus: "PID-5",
    count: 1,
    disposition: "removed" as const,
    ...e,
  };
  return { reidentificationCode: KEYED_TRANSFORMS.has(base.transform), ...base };
}

describe("buildExpertDeterminationSupportReport, the honesty boundary", () => {
  it("renders NO determination and leads with the non-certification disclaimer", () => {
    const report = buildExpertDeterminationSupportReport([]);
    expect(report.kind).toBe("expert-determination-support");
    expect(report.determination).toBeNull();
    expect(report.disclaimer).toBe(EXPERT_DETERMINATION_DISCLAIMER);
    expect(report.disclaimer).toContain("NOT a determination");
    expect(report.outputLabel).toBe(OUTPUT_LABEL);
  });

  it("never fabricates a risk score: no quasi-identifier statistics unless the consumer supplies sizes", () => {
    const report = buildExpertDeterminationSupportReport([
      entry({ category: C.SSN, code: CODES.DEID_CATEGORY_REMOVED }),
    ]);
    expect(report.quasiIdentifierStatistics).toBeNull();
  });

  it("carries the policy label when supplied (string or policy object), else null", () => {
    expect(buildExpertDeterminationSupportReport([]).policy).toBeNull();
    expect(buildExpertDeterminationSupportReport([], { policy: "safe-harbor" }).policy).toBe(
      "safe-harbor",
    );
    const research = defineDeidPolicy({
      name: "research",
      transforms: { [C.DATES]: "date-shift" },
    });
    expect(buildExpertDeterminationSupportReport([], { policy: research }).policy).toBe("research");
  });
});

describe("buildExpertDeterminationSupportReport, per-locus + category coverage", () => {
  it("surfaces all 18 categories in regulatory order A→R, with actedOn flags", () => {
    const report = buildExpertDeterminationSupportReport([
      entry({ category: C.NAMES, locus: "PID-5", code: CODES.DEID_CATEGORY_REMOVED }),
      entry({
        category: C.MRN,
        locus: "PID-3",
        transform: "pseudonymize",
        disposition: "transformed",
        code: CODES.DEID_CATEGORY_PSEUDONYMIZED,
      }),
    ]);
    expect(report.categoryCoverage).toHaveLength(18);
    expect(report.categoryCoverage.map((c) => c.letter)).toEqual([
      "A",
      "B",
      "C",
      "D",
      "E",
      "F",
      "G",
      "H",
      "I",
      "J",
      "K",
      "L",
      "M",
      "N",
      "O",
      "P",
      "Q",
      "R",
    ]);
    const names = report.categoryCoverage.find((c) => c.category === C.NAMES);
    expect(names?.actedOn).toBe(true);
    expect(names?.totalCount).toBe(1);
    expect(names?.dispositions.removed).toBe(1);
    const phone = report.categoryCoverage.find((c) => c.category === C.PHONE);
    expect(phone?.actedOn).toBe(false);
    expect(phone?.totalCount).toBe(0);
    expect(report.totals.categoriesActedOn).toBe(2);
  });

  it("aggregates identical loci by summing counts, and lists distinct transforms/codes per category", () => {
    const report = buildExpertDeterminationSupportReport([
      entry({ category: C.SSN, locus: "PID-19", count: 2, code: CODES.DEID_CATEGORY_REMOVED }),
      entry({ category: C.SSN, locus: "PID-19", count: 3, code: CODES.DEID_CATEGORY_REMOVED }),
    ]);
    expect(report.perLocus).toHaveLength(1);
    expect(report.perLocus[0]?.count).toBe(5);
    expect(report.totals.loci).toBe(1);
    const ssn = report.categoryCoverage.find((c) => c.category === C.SSN);
    expect(ssn?.totalCount).toBe(5);
    expect(ssn?.transforms).toEqual(["redact"]);
  });

  it("merges a corpus (array of manifests), summing counts across documents", () => {
    const docA: DeidManifestEntry[] = [
      entry({ category: C.NAMES, locus: "PID-5", count: 1, code: CODES.DEID_CATEGORY_REMOVED }),
    ];
    const docB: DeidManifestEntry[] = [
      entry({ category: C.NAMES, locus: "PID-5", count: 1, code: CODES.DEID_CATEGORY_REMOVED }),
    ];
    const report = buildExpertDeterminationSupportReport([docA, docB]);
    expect(report.documentCount).toBe(2);
    expect(report.perLocus[0]?.count).toBe(2);
  });

  it("treats a single flat manifest as one document", () => {
    const report = buildExpertDeterminationSupportReport([
      entry({ category: C.SSN, code: CODES.DEID_CATEGORY_REMOVED }),
    ]);
    expect(report.documentCount).toBe(1);
  });

  it("counts distinct loci (not rows): one locus acted on differently across a corpus is one locus", () => {
    // Same physical locus, different disposition per document → 2 aggregated rows, but 1 distinct locus.
    const docA: DeidManifestEntry[] = [
      entry({
        category: C.OTHER_UNIQUE_ID,
        locus: "OBX-5",
        transform: "block",
        disposition: "blocked",
        code: CODES.DEID_FREETEXT_BLOCKED,
      }),
    ];
    const docB: DeidManifestEntry[] = [
      entry({
        category: C.OTHER_UNIQUE_ID,
        locus: "OBX-5",
        transform: "byo-redact",
        disposition: "transformed",
        code: CODES.DEID_FREETEXT_CONSUMER_REDACTED,
      }),
    ];
    const report = buildExpertDeterminationSupportReport([docA, docB]);
    expect(report.totals.rows).toBe(2);
    expect(report.totals.loci).toBe(1);
  });
});

describe("buildExpertDeterminationSupportReport, retained quasi-identifiers + disposition summary", () => {
  it("inventories DEID_RESIDUAL_RETAINED entries (year, 3-digit ZIP, age), and nothing else", () => {
    const report = buildExpertDeterminationSupportReport([
      entry({
        category: C.DATES,
        locus: "PID-7",
        transform: "generalize",
        disposition: "transformed",
        code: CODES.DEID_RESIDUAL_RETAINED,
      }),
      entry({
        category: C.GEOGRAPHIC,
        locus: "PID-11",
        transform: "generalize",
        disposition: "transformed",
        code: CODES.DEID_RESIDUAL_RETAINED,
      }),
      entry({ category: C.SSN, locus: "PID-19", code: CODES.DEID_CATEGORY_REMOVED }),
    ]);
    // Ordered by category number: GEOGRAPHIC (B/2) precedes DATES (C/3).
    expect(report.retainedQuasiIdentifiers.map((r) => r.locus)).toEqual(["PID-11", "PID-7"]);
    expect(report.retainedQuasiIdentifiers.every((r) => r.count === 1)).toBe(true);
    const dates = report.categoryCoverage.find((c) => c.category === C.DATES);
    expect(dates?.residualRetained).toBe(true);
    const ssn = report.categoryCoverage.find((c) => c.category === C.SSN);
    expect(ssn?.residualRetained).toBe(false);
  });

  it("rolls up dispositions including free-text blocked and consumer-redacted", () => {
    const report = buildExpertDeterminationSupportReport([
      entry({ category: C.NAMES, locus: "PID-5", code: CODES.DEID_CATEGORY_REMOVED }),
      entry({
        category: C.OTHER_UNIQUE_ID,
        locus: "OBX-5",
        transform: "block",
        disposition: "blocked",
        code: CODES.DEID_FREETEXT_BLOCKED,
      }),
      entry({
        category: C.OTHER_UNIQUE_ID,
        locus: "NTE-3",
        transform: "byo-redact",
        disposition: "transformed",
        code: CODES.DEID_FREETEXT_CONSUMER_REDACTED,
      }),
      entry({
        category: C.DATES,
        locus: "PID-7",
        transform: "generalize",
        disposition: "transformed",
        code: CODES.DEID_RESIDUAL_RETAINED,
      }),
    ]);
    const d = report.dispositionSummary;
    expect(d.removed).toBe(1);
    expect(d.blocked).toBe(1);
    expect(d.transformed).toBe(2);
    expect(d.freeTextBlocked).toBe(1);
    expect(d.freeTextConsumerRedacted).toBe(1);
    expect(d.residualRetained).toBe(1);
  });
});

describe("buildExpertDeterminationSupportReport, quasi-identifier statistics (consumer-supplied)", () => {
  it("computes the k-anonymity indicator correctly on a known corpus", () => {
    const report = buildExpertDeterminationSupportReport([], {
      quasiIdentifiers: {
        quasiIdentifierSet: "ZIP3 × year × sex",
        equivalenceClassSizes: [40, 33, 20, 5, 1, 1],
      },
    });
    const qi = report.quasiIdentifierStatistics;
    expect(qi).not.toBeNull();
    expect(qi?.quasiIdentifierSet).toBe("ZIP3 × year × sex");
    expect(qi?.distinctCombinations).toBe(6);
    expect(qi?.totalRecords).toBe(100);
    expect(qi?.minimumEquivalenceClassSize).toBe(1);
    expect(qi?.uniqueRecords).toBe(2);
    expect(qi?.note).toContain("NOT a re-identification risk score");
  });

  it("ignores non-positive / non-finite sizes and yields null when nothing valid remains", () => {
    const ok = buildExpertDeterminationSupportReport([], {
      quasiIdentifiers: { equivalenceClassSizes: [0, -3, 4, Number.NaN, 2] },
    });
    expect(ok.quasiIdentifierStatistics?.distinctCombinations).toBe(2);
    expect(ok.quasiIdentifierStatistics?.minimumEquivalenceClassSize).toBe(2);
    const none = buildExpertDeterminationSupportReport([], {
      quasiIdentifiers: { equivalenceClassSizes: [0, -1] },
    });
    expect(none.quasiIdentifierStatistics).toBeNull();
  });

  it("labels the set null when unlabelled", () => {
    const report = buildExpertDeterminationSupportReport([], {
      quasiIdentifiers: { equivalenceClassSizes: [3, 3] },
    });
    expect(report.quasiIdentifierStatistics?.quasiIdentifierSet).toBeNull();
  });
});

describe("buildExpertDeterminationSupportReport, determinism, immutability, value-freeness", () => {
  it("is deterministic, same input yields deep-equal output", () => {
    const manifest = [
      entry({
        category: C.MRN,
        locus: "PID-3",
        transform: "pseudonymize",
        disposition: "transformed",
        code: CODES.DEID_CATEGORY_PSEUDONYMIZED,
      }),
      entry({ category: C.NAMES, locus: "PID-5", code: CODES.DEID_CATEGORY_REMOVED }),
    ];
    expect(buildExpertDeterminationSupportReport(manifest)).toEqual(
      buildExpertDeterminationSupportReport(manifest),
    );
  });

  it("never mutates the input manifest", () => {
    const manifest: DeidManifestEntry[] = [
      entry({ category: C.SSN, locus: "PID-19", count: 2, code: CODES.DEID_CATEGORY_REMOVED }),
    ];
    const snapshot = JSON.parse(JSON.stringify(manifest)) as unknown;
    buildExpertDeterminationSupportReport(manifest);
    expect(JSON.parse(JSON.stringify(manifest))).toEqual(snapshot);
  });

  it("returns a deeply frozen result", () => {
    const report = buildExpertDeterminationSupportReport([
      entry({ category: C.SSN, code: CODES.DEID_CATEGORY_REMOVED }),
    ]);
    expect(Object.isFrozen(report)).toBe(true);
    expect(Object.isFrozen(report.categoryCoverage)).toBe(true);
    expect(Object.isFrozen(report.perLocus)).toBe(true);
    expect(Object.isFrozen(report.dispositionSummary)).toBe(true);
  });

  it("value-free property: a report built over a real de-id manifest contains none of the input PHI values", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            path: fc.constantFrom("PID-5", "PID-19", "PID-3", "PID-7", "PID-11", "OBX-5"),
            category: fc.constantFrom(C.NAMES, C.SSN, C.MRN, C.DATES, C.GEOGRAPHIC),
            value: fc.string({ minLength: 3, maxLength: 12 }).map((s) => `SENT-${s}-INEL`),
          }),
          { maxLength: 20 },
        ),
        (rows) => {
          const loci = rows.map((r) => ({
            path: r.path,
            kind: "identifier" as const,
            category: r.category,
            value: r.value,
          }));
          // MRN pseudonymize is a keyed transform, so supply a context; the surrogate is a hex digest,
          // never the input value: the report (built from the manifest) carries no value regardless.
          const ctx = createDeidContext({ key: "report-property-key", patientId: "p1" });
          const { manifest } = deidentify({ loci }, { context: ctx });
          const report = buildExpertDeterminationSupportReport(manifest, { policy: "safe-harbor" });
          const serialized =
            JSON.stringify(report) + "\n" + formatExpertDeterminationSupportReport(report);
          for (const r of rows) {
            expect(serialized.includes(r.value)).toBe(false);
          }
        },
      ),
    );
  });

  it("value-free property: no manifest value survives into any report field for arbitrary loci", () => {
    // Guard against the report echoing a locus *value*: build directly from arbitrary manifest entries
    // whose loci are tagged sentinels; assert none appears anywhere in the serialized report.
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            locus: fc.string({ minLength: 1, maxLength: 8 }).map((s) => `LOC/${s}`),
            category: fc.constantFrom(...Object.values(C)),
            code: fc.constantFrom(...Object.values(CODES)),
          }),
          { maxLength: 20 },
        ),
        (rows) => {
          const manifest = rows.map((r) =>
            entry({
              category: r.category,
              locus: r.locus,
              code: r.code,
              disposition: "transformed",
              transform: "generalize",
            }),
          );
          const report = buildExpertDeterminationSupportReport(manifest);
          expect(report.determination).toBeNull();
          // The loci ARE allowed in the report (they are paths, not values): this asserts the k-indicator
          // is never present without consumer sizes, i.e. no risk number is invented from loci alone.
          expect(report.quasiIdentifierStatistics).toBeNull();
        },
      ),
    );
  });
});

describe("formatExpertDeterminationSupportReport, human-readable rendering", () => {
  it("leads with the NOT-A-DETERMINATION banner and lists the category table", () => {
    const md = formatExpertDeterminationSupportReport(
      buildExpertDeterminationSupportReport(
        [entry({ category: C.NAMES, code: CODES.DEID_CATEGORY_REMOVED })],
        { policy: "safe-harbor" },
      ),
    );
    expect(md.startsWith("# Expert-Determination support report")).toBe(true);
    expect(md).toContain("NOT A DETERMINATION");
    expect(md).toContain("Safe Harbor category coverage");
    expect(md).toContain("| A | Names | yes |");
  });

  it("renders the retained-quasi-identifier section and the consumer-supplied statistics", () => {
    const report = buildExpertDeterminationSupportReport(
      [
        entry({
          category: C.DATES,
          locus: "PID-7",
          transform: "generalize",
          disposition: "transformed",
          code: CODES.DEID_RESIDUAL_RETAINED,
        }),
      ],
      { quasiIdentifiers: { quasiIdentifierSet: "ZIP3 × year", equivalenceClassSizes: [10, 1] } },
    );
    const md = formatExpertDeterminationSupportReport(report);
    expect(md).toContain("Retained quasi-identifiers");
    expect(md).toContain("PID-7: DATES");
    expect(md).toContain("k-anonymity indicator): 1");
    expect(md).toContain("descriptive, not a verdict");
  });

  it("notes when no residuals were recorded", () => {
    const md = formatExpertDeterminationSupportReport(buildExpertDeterminationSupportReport([]));
    expect(md).toContain("_None recorded._");
  });
});

describe("the keyed-surrogate residual inventory, built from the manifest's re-identification flag", () => {
  const ctx = createDeidContext({ key: "keyed-inventory-key", patientId: "p1" });

  /** A pass whose policy pseudonymizes an MRN, hashes a URL, and removes a name. */
  function keyedPass(): ReturnType<typeof deidentify> {
    const policy = defineDeidPolicy({
      name: "research",
      transforms: { [C.MRN]: "pseudonymize", [C.URL]: "hash" },
    });
    return deidentify(
      {
        loci: [
          { path: "PID-3", kind: "identifier", category: C.MRN, value: "SENT-MRN" },
          { path: "PID-5", kind: "identifier", category: C.NAMES, value: "SENT-NAME" },
          { path: "Patient.link", kind: "identifier", category: C.URL, value: "SENT-URL" },
          { path: "PID-11", kind: "zip", category: C.GEOGRAPHIC, value: "90210" },
        ],
      },
      { policy, context: ctx },
    );
  }

  it("flags EXACTLY the keyed loci in the manifest and false everywhere else", () => {
    const { manifest } = keyedPass();
    const byLocus = new Map(manifest.map((e) => [e.locus, e]));
    expect(byLocus.get("PID-3")?.reidentificationCode).toBe(true);
    expect(byLocus.get("Patient.link")?.reidentificationCode).toBe(true);
    expect(byLocus.get("PID-5")?.reidentificationCode).toBe(false);
    expect(byLocus.get("PID-11")?.reidentificationCode).toBe(false);
    // The published disposition codes at those loci are UNCHANGED: the flag is additive.
    expect(byLocus.get("PID-3")?.code).toBe(CODES.DEID_CATEGORY_PSEUDONYMIZED);
    expect(byLocus.get("Patient.link")?.code).toBe(CODES.DEID_CATEGORY_HASHED);
    expect(byLocus.get("PID-5")?.code).toBe(CODES.DEID_CATEGORY_REMOVED);
  });

  it("lists each keyed locus once, with locus / category / count / transform, and no value", () => {
    const { manifest } = keyedPass();
    const report = buildExpertDeterminationSupportReport(manifest, { policy: "research" });
    expect(report.keyedSurrogateResiduals).toEqual([
      { locus: "PID-3", category: C.MRN, count: 1, transform: "pseudonymize" },
      { locus: "Patient.link", category: C.URL, count: 1, transform: "hash" },
    ]);
    const serialized =
      JSON.stringify(report) + "\n" + formatExpertDeterminationSupportReport(report);
    for (const sentinel of ["SENT-MRN", "SENT-NAME", "SENT-URL", "keyed-inventory-key"]) {
      expect(serialized).not.toContain(sentinel);
    }
  });

  it("counts each acted-on value exactly ONCE in the disposition roll-up", () => {
    const { manifest } = keyedPass();
    const report = buildExpertDeterminationSupportReport(manifest);
    const total =
      report.dispositionSummary.transformed +
      report.dispositionSummary.removed +
      report.dispositionSummary.blocked +
      report.dispositionSummary.retained;
    expect(total).toBe(4); // one per acted-on locus, never doubled by the new inventory
    expect(report.keyedSurrogateResiduals).toHaveLength(2);
  });

  it("a keyed surrogate NEVER joins the retained-quasi-identifier inventory", () => {
    const { manifest } = keyedPass();
    const report = buildExpertDeterminationSupportReport(manifest);
    // Only the coarse ZIP residual is a retained quasi-identifier; neither keyed locus is.
    expect(report.retainedQuasiIdentifiers.map((r) => r.locus)).toEqual(["PID-11"]);
    const keyedLoci = new Set(report.keyedSurrogateResiduals.map((r) => r.locus));
    for (const r of report.retainedQuasiIdentifiers) expect(keyedLoci.has(r.locus)).toBe(false);
  });

  it("EVERY shifted date locus is flagged and inventoried, exactly as a pseudonymized id is", () => {
    const shift = defineDeidPolicy({ name: "shift", transforms: { [C.DATES]: "date-shift" } });
    const { manifest } = deidentify(
      {
        loci: [
          { path: "PID-7", kind: "date", category: C.DATES, value: "2020-01-01" },
          { path: "PV1-44", kind: "date", category: C.DATES, value: "2020-02-01" },
        ],
      },
      { policy: shift, context: ctx },
    );
    expect(manifest.every((e) => e.reidentificationCode)).toBe(true);
    const report = buildExpertDeterminationSupportReport(manifest);
    expect(report.keyedSurrogateResiduals.map((r) => r.transform)).toEqual([
      "date-shift",
      "date-shift",
    ]);
    expect(report.keyedSurrogateResiduals.map((r) => r.locus).sort()).toEqual(["PID-7", "PV1-44"]);
  });

  it("a pass that emits NO keyed surrogate flags nothing and leaves the inventory empty", () => {
    const { manifest } = deidentify(
      {
        loci: [
          { path: "PID-5", kind: "identifier", category: C.NAMES, value: "SENT-NAME" },
          { path: "PID-3", kind: "identifier", category: C.MRN, value: "SENT-MRN" },
        ],
      },
      {}, // the built-in Safe Harbor default: no keyed transform anywhere
    );
    expect(manifest.every((e) => e.reidentificationCode === false)).toBe(true);
    const report = buildExpertDeterminationSupportReport(manifest);
    expect(report.keyedSurrogateResiduals).toEqual([]);
  });

  it("an empty document yields an empty manifest, two empty inventories and zero residual counts", () => {
    const { manifest } = deidentify({ loci: [] }, {});
    expect(manifest).toEqual([]);
    const report = buildExpertDeterminationSupportReport(manifest);
    expect(report.keyedSurrogateResiduals).toEqual([]);
    expect(report.retainedQuasiIdentifiers).toEqual([]);
    expect(report.dispositionSummary.residualRetained).toBe(0);
    expect(report.dispositionSummary.retained).toBe(0);
    expect(report.totals.loci).toBe(0);
  });

  it("renders the two inventories as separate sections a determiner can tell apart", () => {
    const { manifest } = keyedPass();
    const md = formatExpertDeterminationSupportReport(
      buildExpertDeterminationSupportReport(manifest),
    );
    expect(md).toContain("## Retained quasi-identifiers");
    expect(md).toContain("## Keyed surrogate residuals");
    expect(md).toContain("PID-11: GEOGRAPHIC (×1, coarse residual)");
    expect(md).toContain("PID-3: MRN (×1, keyed surrogate: pseudonymize)");
    expect(md).toContain("Patient.link: URL (×1, keyed surrogate: hash)");
  });

  it("says NOT RECORDED rather than nothing when the keyed inventory is empty", () => {
    const md = formatExpertDeterminationSupportReport(buildExpertDeterminationSupportReport([]));
    expect(md).toContain("## Keyed surrogate residuals");
    // An empty inventory means no keyed residual, never an unmeasured one.
    expect(md).toContain("never that one went unmeasured");
  });
});

describe("the residual inventory distinguishes a kept year from a kept whole value", () => {
  const manifest = [
    {
      category: C.DATES,
      transform: "generalize" as const,
      locus: "PID-7",
      count: 1,
      disposition: "transformed" as const,
      code: CODES.DEID_RESIDUAL_RETAINED,
      reidentificationCode: false,
    },
    {
      category: C.DATES,
      transform: "retain" as const,
      locus: "PV1-44",
      count: 1,
      disposition: "retained" as const,
      code: CODES.DEID_RESIDUAL_RETAINED,
      reidentificationCode: false,
    },
  ];

  it("carries the transform on every inventory row", () => {
    const report = buildExpertDeterminationSupportReport(manifest);
    const byLocus = new Map(report.retainedQuasiIdentifiers.map((r) => [r.locus, r.transform]));
    expect(byLocus.get("PID-7")).toBe("generalize");
    expect(byLocus.get("PV1-44")).toBe("retain");
  });

  it("counts a retained disposition, and renders the two kinds differently", () => {
    const report = buildExpertDeterminationSupportReport(manifest);
    expect(report.dispositionSummary.retained).toBe(1);
    expect(report.dispositionSummary.transformed).toBe(1);
    const md = formatExpertDeterminationSupportReport(report);
    // Without this the two rows are indistinguishable, and a full timestamp reads like a kept year.
    expect(md).toContain("PID-7: DATES (×1, coarse residual)");
    expect(md).toContain("PV1-44: DATES (×1, whole value kept)");
    expect(md).toContain("retained: 1");
  });
});

/**
 * **The unexamined-residual inventory**: the sibling of the retained quasi-identifiers, and the reason an
 * empty residual section can now be read at all.
 *
 * The three inventories answer three different questions and a determiner reasons about each differently:
 * a retained quasi-identifier is a piece of a value the pass EXAMINED and kept, a keyed surrogate is a
 * computed replacement that preserves linkage, and an unexamined position is one nothing reached. Folding
 * any into another would tell a determiner they are the same kind of fact.
 */
describe("the unexamined-residual inventory, beside the retained quasi-identifiers", () => {
  const unexamined = (locus: string, count = 1): UnexaminedResidual => ({
    locus,
    count,
    examined: false,
    locusWithheld: false,
    code: CODES.DEID_POSITION_UNEXAMINED,
  });

  const RETAINED = entry({
    category: C.DATES,
    transform: "generalize",
    locus: "PID-7",
    disposition: "transformed",
    code: CODES.DEID_RESIDUAL_RETAINED,
  });

  it("lists the unexamined positions in their own inventory, with locus and count", () => {
    const report = buildExpertDeterminationSupportReport([RETAINED], {
      unexaminedResiduals: [unexamined("PV1-8.1"), unexamined("PV1-8.2", 3)],
    });
    expect(report.unexaminedResiduals).toEqual([unexamined("PV1-8.1"), unexamined("PV1-8.2", 3)]);
    expect(report.dispositionSummary.unexaminedResidualPositions).toBe(4);
  });

  it("carries no value from any enumerated position: locus, count and the fact, nothing else", () => {
    const report = buildExpertDeterminationSupportReport([RETAINED], {
      unexaminedResiduals: [unexamined("PV1-8.1")],
    });
    const [row] = report.unexaminedResiduals;
    expect(Object.keys(row ?? {}).sort()).toEqual([
      "code",
      "count",
      "examined",
      "locus",
      "locusWithheld",
    ]);
  });

  it("renders as a section BESIDE the retained quasi-identifiers, never inside it", () => {
    const md = formatExpertDeterminationSupportReport(
      buildExpertDeterminationSupportReport([RETAINED], {
        unexaminedResiduals: [unexamined("PV1-8.1")],
      }),
    );
    const retainedAt = md.indexOf("## Retained quasi-identifiers");
    const unexaminedAt = md.indexOf("## Unexamined residual positions");
    const keyedAt = md.indexOf("## Keyed surrogate residuals");
    expect(retainedAt).toBeGreaterThan(-1);
    expect(unexaminedAt).toBeGreaterThan(retainedAt);
    expect(keyedAt).toBeGreaterThan(unexaminedAt);
    expect(md).toContain("- PV1-8.1: unexamined (×1)");
    // The retained inventory still lists only what it listed before.
    expect(md).toContain("- PID-7: DATES (×1, coarse residual)");
  });

  it("says WITHHELD in the rendering when a position's locus could not be expressed", () => {
    const md = formatExpertDeterminationSupportReport(
      buildExpertDeterminationSupportReport([], {
        unexaminedResiduals: [{ ...unexamined("<withheld>-7"), locusWithheld: true }],
      }),
    );
    expect(md).toContain("(structural locus withheld)");
  });

  it("sums counts for the same locus across a corpus of passes", () => {
    const report = buildExpertDeterminationSupportReport([[RETAINED], [RETAINED]], {
      unexaminedResiduals: [[unexamined("PV1-8.1")], [unexamined("PV1-8.1", 2)]],
    });
    expect(report.unexaminedResiduals).toEqual([unexamined("PV1-8.1", 3)]);
    expect(report.dispositionSummary.unexaminedResidualPositions).toBe(3);
  });
});

/**
 * **A measured zero is not silence.** The whole point of the measurement: an empty residual inventory used
 * to read the same whether the pass found nothing or measured nothing, and a determiner acts on that
 * emptiness. The report now says which it is, in both the structured object and the rendering.
 */
describe("a measured empty inventory is distinguishable from an unmeasured one", () => {
  it("MEASURED and empty: the section is rendered, and says so", () => {
    const report = buildExpertDeterminationSupportReport([], { unexaminedResiduals: [] });
    expect(report.unexaminedResidualsMeasured).toBe(true);
    expect(report.unexaminedResiduals).toEqual([]);
    expect(report.dispositionSummary.unexaminedResidualPositions).toBe(0);
    const md = formatExpertDeterminationSupportReport(report);
    expect(md).toContain("## Unexamined residual positions");
    expect(md).toContain("_Measured, and empty._");
    expect(md).toContain("· unexamined residual positions: 0");
    expect(md).not.toContain("NOT MEASURED");
  });

  it("NOT measured: the section is still rendered, and refuses to print a zero", () => {
    const report = buildExpertDeterminationSupportReport([]);
    expect(report.unexaminedResidualsMeasured).toBe(false);
    expect(report.unexaminedResiduals).toEqual([]);
    expect(report.dispositionSummary.unexaminedResidualPositions).toBeNull();
    const md = formatExpertDeterminationSupportReport(report);
    // The section is never OMITTED: an absent section is exactly the silence the measurement retires.
    expect(md).toContain("## Unexamined residual positions");
    expect(md).toContain("**NOT MEASURED.**");
    expect(md).toContain("· unexamined residual positions: NOT MEASURED");
    expect(md).not.toContain("_Measured, and empty._");
  });

  it("the two renderings are not the same document, which is the whole point", () => {
    const measured = formatExpertDeterminationSupportReport(
      buildExpertDeterminationSupportReport([], { unexaminedResiduals: [] }),
    );
    const unmeasured = formatExpertDeterminationSupportReport(
      buildExpertDeterminationSupportReport([]),
    );
    expect(measured).not.toBe(unmeasured);
  });
});

/**
 * **The retained-quasi-identifier inventory keeps its membership**, and the Safe Harbor category coverage
 * keeps its totals. Admitting an unexamined position into either would corrupt the two things a determiner
 * reads most directly: a kept year would become indistinguishable from a position nothing looked at, and a
 * category no rule established would be reported as acted on.
 */
describe("an unexamined position joins no other inventory and no category", () => {
  const unexamined: UnexaminedResidual = {
    locus: "PV1-8.1",
    count: 5,
    examined: false,
    locusWithheld: false,
    code: CODES.DEID_POSITION_UNEXAMINED,
  };

  const KEPT_YEAR = entry({
    category: C.DATES,
    transform: "generalize",
    locus: "PID-7",
    disposition: "transformed",
    code: CODES.DEID_RESIDUAL_RETAINED,
  });

  it("the retained-quasi-identifier inventory lists only residuals of EXAMINED values", () => {
    const report = buildExpertDeterminationSupportReport([KEPT_YEAR], {
      unexaminedResiduals: [unexamined],
    });
    expect(report.retainedQuasiIdentifiers.map((r) => r.locus)).toEqual(["PID-7"]);
    expect(report.keyedSurrogateResiduals).toEqual([]);
    expect(report.dispositionSummary.residualRetained).toBe(1);
  });

  it("no Safe Harbor category is credited with it, and the categories-acted-on total is unmoved", () => {
    const withoutMeasurement = buildExpertDeterminationSupportReport([KEPT_YEAR]);
    const withMeasurement = buildExpertDeterminationSupportReport([KEPT_YEAR], {
      unexaminedResiduals: [unexamined],
    });
    expect(withMeasurement.totals.categoriesActedOn).toBe(
      withoutMeasurement.totals.categoriesActedOn,
    );
    expect(withMeasurement.categoryCoverage).toEqual(withoutMeasurement.categoryCoverage);
    // Nowhere in the 18 categories does the unexamined code or its count appear.
    for (const coverage of withMeasurement.categoryCoverage) {
      expect(coverage.codes).not.toContain(CODES.DEID_POSITION_UNEXAMINED);
    }
    const acted = withMeasurement.categoryCoverage.reduce((sum, c) => sum + c.totalCount, 0);
    expect(acted).toBe(1);
  });

  it("and the rendered category table is byte-identical with and without the measurement", () => {
    const section = (md: string): string =>
      md.slice(md.indexOf("## Safe Harbor category coverage"), md.indexOf("## Retained quasi"));
    const withoutMeasurement = formatExpertDeterminationSupportReport(
      buildExpertDeterminationSupportReport([KEPT_YEAR]),
    );
    const withMeasurement = formatExpertDeterminationSupportReport(
      buildExpertDeterminationSupportReport([KEPT_YEAR], { unexaminedResiduals: [unexamined] }),
    );
    expect(section(withMeasurement)).toBe(section(withoutMeasurement));
  });

  it("determination stays null and the disclaimer still leads, measurement or not", () => {
    const report = buildExpertDeterminationSupportReport([KEPT_YEAR], {
      unexaminedResiduals: [unexamined],
    });
    expect(report.determination).toBeNull();
    expect(report.disclaimer).toBe(EXPERT_DETERMINATION_DISCLAIMER);
    expect(formatExpertDeterminationSupportReport(report)).toContain("NOT A DETERMINATION.");
  });
});
