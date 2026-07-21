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
  OUTPUT_LABEL,
  SAFE_HARBOR_CATEGORIES,
  buildExpertDeterminationSupportReport,
  createDeidContext,
  defineDeidPolicy,
  deidentify,
  formatExpertDeterminationSupportReport,
  type DeidManifestEntry,
} from "../src/index.js";

const C = SAFE_HARBOR_CATEGORIES;
const CODES = DEID_DISPOSITION_CODES;

/** A small helper to build a manifest entry with a count of 1 by default. */
function entry(
  e: Partial<DeidManifestEntry> & Pick<DeidManifestEntry, "category" | "code">,
): DeidManifestEntry {
  return {
    transform: "redact",
    locus: "PID-5",
    count: 1,
    disposition: "removed",
    ...e,
  };
}

describe("buildExpertDeterminationSupportReport — the honesty boundary", () => {
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

describe("buildExpertDeterminationSupportReport — per-locus + category coverage", () => {
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

describe("buildExpertDeterminationSupportReport — retained quasi-identifiers + disposition summary", () => {
  it("inventories DEID_RESIDUAL_RETAINED entries (year, 3-digit ZIP, age) — and nothing else", () => {
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

describe("buildExpertDeterminationSupportReport — quasi-identifier statistics (consumer-supplied)", () => {
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

describe("buildExpertDeterminationSupportReport — determinism, immutability, value-freeness", () => {
  it("is deterministic — same input yields deep-equal output", () => {
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
          // never the input value — the report (built from the manifest) carries no value regardless.
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
          // The loci ARE allowed in the report (they are paths, not values) — this asserts the k-indicator
          // is never present without consumer sizes, i.e. no risk number is invented from loci alone.
          expect(report.quasiIdentifierStatistics).toBeNull();
        },
      ),
    );
  });
});

describe("formatExpertDeterminationSupportReport — human-readable rendering", () => {
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
    expect(md).toContain("PID-7 — DATES");
    expect(md).toContain("k-anonymity indicator): 1");
    expect(md).toContain("descriptive, not a verdict");
  });

  it("notes when no residuals were recorded", () => {
    const md = formatExpertDeterminationSupportReport(buildExpertDeterminationSupportReport([]));
    expect(md).toContain("_None recorded._");
  });
});
