---
"@cosyte/deid": patch
---

The C-CDA adapter allocates less memory for each document it reads, and its output is unchanged.

- **What changed.** Locating PHI walks the document's tree up to three times, and each walk composed every element's path segments afresh, with two new maps for every element, leaves included. The segments of each element's children are now composed once per call and kept for the other walks, and an element with fewer than two children builds no map. The tree the pass edits is also dropped before the output is parsed, so it can be collected during that second parse.
- **What a caller changes.** Nothing. The transformed document, the manifest and the unexamined residuals are the same as before, position for position.
