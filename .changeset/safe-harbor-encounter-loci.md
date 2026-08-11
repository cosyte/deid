---
"@cosyte/deid": patch
---

The `safe-harbor` policy now actually removes the encounter loci Safe Harbor requires it to remove. Seven identifying values previously survived a `safe-harbor` pass byte-identical, with no manifest entry at all: the visit number (PV1-19), the admit and discharge dates (PV1-44/45), the observation date (OBR-7), the diagnosis date (DG1-5), and the placer and filler order numbers (OBR-2/3, ORC-2/3). Retaining an HL7 segment retained every field inside it, and nothing carved these back out.

45 CFR 164.514(b)(2)(i)(C) requires removal of all elements of dates except year that are directly related to an individual, and names admission and discharge dates in the regulation text itself; a visit or order number is a unique identifying code the (R) catch-all reaches. A policy named `safe-harbor` that returned them was a trap for anyone who trusted the name, so this is a deliberate breaking change while the package is pre-alpha.

**What changes.** Under `SAFE_HARBOR_PROFILE` the four dates now generalize to their year and the five identifier loci are blocked as category (R). Under `LIMITED_DATA_SET_PROFILE` all seven are kept unchanged, because 164.514(e)(2)'s limited-data-set exclusion list enumerates sixteen direct identifiers, contains no date, and has no catch-all. The split is expressed by two named retention classes, `encounter-dates` and `encounter-identifiers`, on the new `retainedLoci` field of a profile.

**Anything still retained is now recorded.** A kept locus emits a manifest entry with disposition `retained`, transform `retain`, and code `DEID_RESIDUAL_RETAINED`, so it reaches the Expert-Determination support report's residual inventory rather than being invisible in both artifacts. `DeidManifestEntry["disposition"]` and `ReportDisposition` gain `"retained"`, and `DispositionSummary` gains a `retained` count.

**`defineDeidProfile()`'s widen-never-narrow contract now covers retention, and it reads the opposite way round from a transform override:** dropping a retained class removes more and is allowed; adding one keeps more and is a fatal `DEID_PROFILE_INVALID`. It is a subset test, not a rank comparison. Retention is opt-in at the call site too: only `profileOptions()` carries it, so an options bag built by hand from a profile's `policy` keeps nothing.

**Corrected claims.** The published limitations page claimed that loci absent from the parser models fail closed, which read as the opposite of the truth for a retained segment; that claim is deleted. In its place the page names what is retained, and names what is still passed through and recorded nowhere: the specimen collection date (SPM-17) and the provider names (PV1-7/8, OBR-16). Retaining a segment is not auditing every field in it.
