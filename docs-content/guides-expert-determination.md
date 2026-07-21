---
id: guides-expert-determination
title: Expert-Determination support (never certification)
sidebar_position: 10
---

# Expert-Determination support (never certification)

HIPAA gives two routes to de-identification (45 CFR §164.514(b)). `@cosyte/deid` **implements** Safe
Harbor (the mechanical 18-category method) and **supports** — but can **never render** — the other one:
**Expert Determination** (§164.514(b)(1)), a qualified statistician's judgment that the re-identification
risk for a specific dataset and recipient is "very small".

The support report structures the value-free manifest into the facts an expert reasons about — **what was
done, and what remains** — and hands them over. It is descriptive input, never a verdict.

## The hard boundary — the library makes NO determination

This is the load-bearing discipline. The report:

- **never** says the output "is de-identified" or "meets Expert Determination";
- **never** computes or fabricates a re-identification **risk score** — it reaches no conclusion;
- carries `determination: null` and leads with a prominent non-certification disclaimer.

```ts runnable
import { buildExpertDeterminationSupportReport, SAFE_HARBOR_CATEGORIES } from "@cosyte/deid";

const report = buildExpertDeterminationSupportReport(
  [
    {
      category: SAFE_HARBOR_CATEGORIES.NAMES,
      transform: "redact",
      locus: "PID-5",
      count: 1,
      disposition: "removed",
      code: "DEID_CATEGORY_REMOVED",
    },
  ],
  { policy: "safe-harbor" },
);

report.determination; // => null
report.disclaimer.includes("NOT a determination"); // => true
```

"The risk is very small" is a judgment about a dataset _and_ its recipient _and_ the other data
reasonably available to that recipient — none of which this library sees. Over-claiming here would be a
real compliance harm, so the report is deliberately descriptive.

## What the report contains

Feed it the manifest from any adapter (or an array of manifests for a corpus). You get: per-locus
dispositions, coverage across all 18 Safe Harbor categories, a disposition roll-up, and the
retained-quasi-identifier inventory.

```ts runnable
import { buildExpertDeterminationSupportReport, SAFE_HARBOR_CATEGORIES } from "@cosyte/deid";

const report = buildExpertDeterminationSupportReport([
  {
    category: SAFE_HARBOR_CATEGORIES.NAMES,
    transform: "redact",
    locus: "PID-5",
    count: 1,
    disposition: "removed",
    code: "DEID_CATEGORY_REMOVED",
  },
  {
    category: SAFE_HARBOR_CATEGORIES.DATES,
    transform: "generalize",
    locus: "PID-7",
    count: 1,
    disposition: "transformed",
    code: "DEID_RESIDUAL_RETAINED",
  },
]);

report.categoryCoverage.length; // => 18
report.totals.categoriesActedOn; // => 2
report.retainedQuasiIdentifiers[0].locus; // => "PID-7"
```

The **retained-quasi-identifier inventory** is the residual an expert cares about most: the coarse
identifying elements the pass kept for utility and **recorded** as `DEID_RESIDUAL_RETAINED` — a year-only
date, a safe 3-digit ZIP prefix, an exact age ≤ 89. These are the §164.514(b)(2)(ii) actual-knowledge
considerations. (Clinical values retained untouched by the over-scrub guard are not identifiers and are
not enumerated in the value-free manifest; consult each format's retained-segment notes for residual
dates in retained clinical segments.)

## The optional k-anonymity indicator — caller-supplied, descriptive only

An expert often documents a k-anonymity indicator (the smallest equivalence-class size over a chosen
quasi-identifier set). The library has no view of quasi-identifier **values**, so it never derives this
itself. If _you_ group your records and supply the class sizes, the report echoes the arithmetic — and
stamps it plainly as a descriptive input, **not** a risk score, **not** a determination, **not** a
threshold the library evaluates.

```ts runnable
import { buildExpertDeterminationSupportReport } from "@cosyte/deid";

const report = buildExpertDeterminationSupportReport([], {
  quasiIdentifiers: {
    quasiIdentifierSet: "3-digit ZIP × birth year × sex",
    equivalenceClassSizes: [40, 33, 20, 5, 1, 1],
  },
});

report.quasiIdentifierStatistics?.minimumEquivalenceClassSize; // => 1
report.quasiIdentifierStatistics?.uniqueRecords; // => 2
report.quasiIdentifierStatistics?.note.includes("NOT a re-identification risk score"); // => true
```

With no class sizes supplied, there is no statistic — the library never invents a risk number from the
manifest alone:

```ts runnable
import { buildExpertDeterminationSupportReport } from "@cosyte/deid";

buildExpertDeterminationSupportReport([]).quasiIdentifierStatistics; // => null
```

## Human-readable rendering

For a document to hand a statistician, `formatExpertDeterminationSupportReport` renders the same
value-free facts as Markdown, led by the non-certification banner.

```ts runnable
import {
  buildExpertDeterminationSupportReport,
  formatExpertDeterminationSupportReport,
} from "@cosyte/deid";

const md = formatExpertDeterminationSupportReport(buildExpertDeterminationSupportReport([]));
md.startsWith("# Expert-Determination support report"); // => true
md.includes("NOT A DETERMINATION"); // => true
```

The library's promise stays narrow and honest: it **transforms per a policy** and **evidences what it
did and what remains** in a value-free report — so a qualified expert can make the determination the
library cannot.
