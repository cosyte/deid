---
"@cosyte/deid": patch
---

DEID-3 — the C-CDA de-identification adapter (`@cosyte/deid/ccda`): the C-CDA binding of the core. It
locates PHI structurally in a parsed `@cosyte/ccda` document (never by regex over the XML) and returns a
transformed `CcdaDocument` plus the value-free manifest. Structured locus map over the CDA header
participations — `recordTarget/patientRole` (+ nested `guardian`), `author`/`dataEnterer`/`informant`/
`authenticator`/`legalAuthenticator`/`participant`/`custodian`/`documentationOf`/`componentOf` (relatives
/ providers / contacts): person names/telecom removed, person-role ids pseudonymized (SSN-rooted id
removed, assigning root retained), addresses reduced to the safe 3-digit ZIP, birthTime and
participation/encounter dates generalized to year (dosing-period `PIVL_TS`/`EIVL_TS` never treated as a
date). Section narrative `<text>`, the unstructured `nonXMLBody`, unmapped value-bearing elements, and
foreign/`sdtc` elements fail closed; the clinical `structuredBody` entries (codes, values, units,
statuses, dosing periods) survive untouched. `@cosyte/ccda` is an optional peer dependency consumed only
from the `/ccda` subpath; the adapter reaches the CDA DOM only through the parser's XXE-hardened
`parseSecureXml` and never imports the XML substrate directly, so third-party runtime deps stay zero.
Leak-test and over-scrub-test gates ship as tests, and `phi-scan` gains C-CDA structured header-element
detection.
