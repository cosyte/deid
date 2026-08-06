---
"@cosyte/deid": patch
---

The Expert-Determination support report reads more plainly, and one of its statements is now harder
to misread. `EXPERT_DETERMINATION_DISCLAIMER` is the prominent non-certification text: it is a
public export, the report's `disclaimer` field, and the first line of the rendered document. Its
wording changed, and the sentence disclaiming what this library can see now names its own scope
outright rather than leaning on a dash to carry it, so the clause cannot be read as covering only
the last item of the list it follows. It still emits no risk score and still reaches no conclusion.

Five further rendered positions changed wording. A Safe Harbor category the pass did not act on
prints `none` in the Transforms column; each retained quasi-identifier prints its locus and its
category separated by a colon; and the disposition line, the residual-elements sentence and the
quasi-identifier statistics heading are reworded. The first two previously carried a bare
punctuation mark, which a reader could take either as "no transform was applied here" or as a
rendering artefact, and a value-free audit report is the last place that ambiguity belongs.

Two other strings a running program can observe move with them: the de-identification method text
written into DICOM `(0012,0063)`, and the description carried on the limited data set profile,
alongside the message on the error raised when a profile override would weaken a category. The tag
written to, that profile's transform set and the `DEID_PROFILE_INVALID` code accompanying the error
are all unchanged.

Editorial punctuation is brought into line with the house style across every published surface: the
npm description, `README.md`, the guides, and the JSDoc that compiles into the shipped declaration
files. Where a heading was reworded its anchor moves with it, so a link saved into one of these
documents from outside the package may need updating; every link within the package was recomputed.
Two rows of the HL7 v2 and C-CDA locus tables that record a retained, never-swept region now read
`n/a` in the Loci column, which is what the mark they replaced meant. Those regions are documented
in the same guides as still carrying dates, identifiers and provider names that the pass does not
touch.

No public export is added, renamed or removed, and no policy, no profile transform set, no warning
or disposition code, no locus string and no transformed value changes. Every adapter removes,
generalizes, pseudonymizes, shifts and blocks exactly what it did before, at the same loci,
recording the same codes.
