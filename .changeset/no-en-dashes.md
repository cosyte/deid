---
"@cosyte/deid": patch
---

The Expert Determination support report now titles its category section "Safe Harbor category coverage (§164.514(b)(2)(i) A to R)", writing the range with "to" instead of an en dash.

Doc comments that ship in the type declarations get the same edit (for example "(A) to (R)" and "1 to 18"), and so does the documentation. No transform, manifest entry, code or option changes. The repository's dash check now refuses the en dash as it already refused the em dash.
