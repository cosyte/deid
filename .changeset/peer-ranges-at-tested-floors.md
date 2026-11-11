---
"@cosyte/deid": patch
---

The six parser peer ranges now start at the lowest release our CI runs the whole test suite on, instead of admitting every 0.1 release.

- **Narrowed peer ranges.** `@cosyte/hl7` moves from `^0.1.0` to `^0.1.8`, `@cosyte/ccda` to `^0.1.6`, `@cosyte/fhir` to `^0.1.8`, `@cosyte/x12` to `^0.1.10`, `@cosyte/ncpdp` to `^0.1.6` and `@cosyte/dicom` to `^0.1.11`. Each is still optional, and each still admits every later 0.1 release. The NCPDP floor is the release whose decode the transaction count refusal reads.
- **Upgrading from an older parser.** A project that pins a parser below its new floor gets a peer conflict from npm (ERESOLVE) or a peer warning from pnpm and yarn when it installs this version. Move that parser to a release in its range, for example `npm install @cosyte/hl7@^0.1.8`; no code change is needed. Narrowing a range can stop an install that resolved before, which we release as a patch while the package is below 1.0.
- **Both ends tested.** A new workflow installs all six parsers at the lowest release each range admits, then at the highest published one, and runs the whole suite on each, on every pull request and nightly.
- **Tested parser releases.** The tests and benchmarks now run on `@cosyte/hl7` 0.1.12, `@cosyte/ccda` 0.1.11, `@cosyte/fhir` 0.1.13, `@cosyte/x12` 0.1.13, `@cosyte/ncpdp` 0.1.7 and `@cosyte/dicom` 0.1.13. The output-equivalence digests are unchanged on these releases, so no de-identified output, manifest row or unexamined residual moves.
