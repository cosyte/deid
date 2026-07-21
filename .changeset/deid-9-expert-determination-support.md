---
"@cosyte/deid": patch
---

DEID-9 — Expert-Determination **support** report, never certification (roadmap §Phase 9). A new
value-free reporting layer over the manifest every adapter emits: `buildExpertDeterminationSupportReport`
structures one manifest (or a corpus of manifests) into the facts a statistician reasons about for a HIPAA
Expert Determination (45 CFR §164.514(b)(1)) — per-locus dispositions, coverage across all 18 Safe Harbor
categories (A→R), a disposition roll-up, and the **retained-quasi-identifier inventory** (the coarse
residuals recorded as `DEID_RESIDUAL_RETAINED`: year-only dates, safe 3-digit ZIP prefixes, exact ages ≤
89 — the §164.514(b)(2)(ii) actual-knowledge considerations). **The library renders NO determination:**
`determination` is always `null`, `EXPERT_DETERMINATION_DISCLAIMER` leads, and the report never asserts the
output "is de-identified" and never computes or fabricates a re-identification risk score. An optional
k-anonymity **indicator** (smallest equivalence-class size) is computed only over equivalence-class sizes
the consumer supplies — the library has no view of quasi-identifier values — and is stamped a descriptive
input, never a verdict; absent when not supplied. Value-free (loci / categories / dispositions / counts,
never a value), deterministic, input never mutated; `formatExpertDeterminationSupportReport` renders the
same facts as Markdown. New public surface: `buildExpertDeterminationSupportReport`,
`formatExpertDeterminationSupportReport`, `EXPERT_DETERMINATION_DISCLAIMER`, and the types
`ExpertDeterminationSupportReport`, `ExpertDeterminationReportOptions`, `CategoryCoverage`,
`DispositionSummary`, `RetainedQuasiIdentifier`, `QuasiIdentifierClassInput`, `QuasiIdentifierStatistics`,
`ReportDisposition`. `OUTPUT_LABEL` / `VERSION` moved to an internal `labels` module and re-exported
unchanged.
