---
"@cosyte/deid": patch
---

Two lines of the Expert-Determination support report render differently. A Safe Harbor category the
pass did not act on now prints `none` in the report's Transforms column, and each retained
quasi-identifier now prints its locus and its category separated by a colon. Both positions
previously carried a bare punctuation mark, which a reader could take either as "no transform was
applied here" or as a rendering artefact; a value-free audit report is the last place that ambiguity
belongs. The report's structured fields, its counts and its disclaimer text are otherwise unchanged.

Three further strings a running program can observe move with them: the de-identification method
text written into DICOM `(0012,0063)`, the description carried on the limited data set profile, and
the message on the error raised when a profile override would weaken a category. The tag written
to, that profile's transform set and the `DEID_PROFILE_INVALID` code accompanying the error are all
unchanged; only the wording differs.

Editorial punctuation is brought into line with the house style across every published surface: the
npm description, `README.md`, the guides, and the JSDoc that compiles into the shipped declaration
files.

No public export, no policy, no profile transform set, no warning or disposition code, no locus
string and no transformed value changes. Every adapter removes, generalizes, pseudonymizes, shifts
and blocks exactly what it did before, at the same loci, recording the same codes.
