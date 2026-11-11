---
"@cosyte/deid": patch
---

The DICOM adapter now refuses a dataset holding an element copied by object spread with its own typed error, instead of failing with a bare TypeError from inside the parser.

- **What changed.** From `@cosyte/dicom` 0.1.12 on, an element's `rawBytes` is read through an accessor, so a copy made with `{ ...element }` keeps the tag, the VR and the length but carries no value bytes. Handed such a copy, `deidentifyDicom` used to fail with `TypeError: Cannot read properties of undefined` from inside `@cosyte/dicom`, or, for an attribute the profile removes, act on it without reading it. It now throws a `DeidError` with the code `DEID_POSITIONS_UNENUMERABLE` before anything is delegated, naming where the element sits (its sequence path and its tag) and never its value. A sequence item holding such a copy is refused the same way.
- **What a caller changes.** Copy an element through the `Element` constructor from `@cosyte/dicom`, passing `rawBytes: element.rawBytes` with its other fields, rather than with object spread. A dataset `parseDicom` returns, and one built from such elements, de-identifies exactly as before.
- **Supported Node versions.** Unchanged: Node 22 and later. Our CI now runs the test suite on Linux, Windows and macOS on Node 22, 24 and 26, and under Bun.
