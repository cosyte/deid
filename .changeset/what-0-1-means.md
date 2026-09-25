---
"@cosyte/deid": minor
---

`0.1.0` is the first release of `@cosyte/deid` whose public API we ask you to build on.

**What is covered, and what you can depend on.** Applying a de-identification policy to a structurally located model of a healthcare document and getting back the transformed model plus a value-free manifest. That means the built-in HIPAA Safe Harbor policy across all 18 identifier categories, `defineDeidPolicy`, the two named profiles and `defineDeidProfile` (which can only tighten a profile), the five transforms (redact, generalize, keyed date-shift, keyed pseudonymize, keyed hash), the adapters for HL7 v2, C-CDA, FHIR R4, X12, NCPDP Telecom and DICOM metadata at their own subpaths, the corpus registry for consistent keyed surrogates and date shifts across documents, the free-text redactor interface, and the Expert Determination support report. Failing closed is part of the contract: an uncertain value is blocked, free text is blocked unless your redactor handles it, and a keyed transform with no key is a fatal `DEID_NO_KEY`. The stable `DEID_*` codes are public API, so renaming or removing one is a breaking change. Node.js 22 and 24, ESM and CommonJS, with type declarations for both, and no third-party runtime dependency.

**What the version promises.** Until 1.0, a breaking change raises the minor version (0.1 to 0.2), and the changelog entry says what broke and what to change. A patch release (0.1.x) does not break you, so a `^0.1.0` range takes the patches and stops before 0.2.0.

**What it is not, and what is not covered yet.** A result is "Safe-Harbor-transformed per the configured policy". It is not a certification that data is de-identified and not a compliance claim: the actual-knowledge condition of Safe Harbor stays with you, and an Expert Determination is supported, never rendered. Not covered yet: NCPDP SCRIPT, which is refused with `DEID_FORMAT_UNSUPPORTED`; DICOM pixel data, where burned-in text is flagged and never cleaned; a built-in free-text scrubber; and value-bearing positions no rule names, which are counted as unexamined residuals rather than cleaned. The documentation at https://docs.cosyte.com/deid lists the known limitations in full.

The repository now carries runnable examples under `examples/`, including the fail-closed cases, run against the built package on every change.
