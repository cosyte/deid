---
"@cosyte/deid": patch
---

The six parser peers are now bounded to their 0.1 releases, and an NCPDP Telecom message carrying more than one transaction is refused with a typed error.

What changes for a consumer:

- **Peer ranges.** `@cosyte/hl7`, `@cosyte/ccda`, `@cosyte/fhir`, `@cosyte/x12`, `@cosyte/ncpdp` and `@cosyte/dicom` were declared as `>=0.0.0` and are now `^0.1.0`, the releases this package is tested against. A project that pins one of them to a 0.0.x release has to move it to 0.1 to install this version.
- **NCPDP Telecom.** A transmission that decodes more than one transaction is refused before anything is extracted: a `DeidError` carrying `DEID_FORMAT_UNSUPPORTED` with the new exported message `NCPDP_MULTI_TRANSACTION_REFUSAL_MESSAGE`, and no transformed message, no manifest and no partial output. Before, `@cosyte/ncpdp` 0.1 threw its own `NCPDP_TELECOM_BUILD_MULTI_TRANSACTION_EMIT` from inside the pass, and a 0.0.x parser returned the first transaction alone with the rest dropped. A one-transaction message is de-identified exactly as before.
- **DICOM output, from `@cosyte/dicom` 0.1.** `@cosyte/deid/dicom` delegates to that package's Annex E pass, which in 0.1 drops the Source Application Entity Title `(0002,0016)` and any File Meta element its typed view does not model, adds Longitudinal Temporal Information Modified `(0028,0303)` = `REMOVED`, and writes its own implementation class UID and version name `(0002,0012)` and `(0002,0013)` in place of the sender's. The unexamined-residual inventory follows the output: it lists `(0002,0012)` and `(0002,0013)` and no longer lists the two dropped positions. The HL7 v2, C-CDA, FHIR, X12 and NCPDP output is unchanged.
