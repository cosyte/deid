---
"@cosyte/deid": patch
---

The NCPDP Telecom adapter now removes the Claim segment's Scheduled Prescription ID Number and Alternate ID, and generalizes the Clinical segment's Measurement Date to the year.

- **What changed in output.** Before, `454-EK` Scheduled Prescription ID Number and `330-CW` Alternate ID in the Claim segment (`07`), and `494-ZE` Measurement Date in the Clinical segment (`13`), left the pass unchanged and were only counted as unexamined residuals. Public Medicaid payer sheets name and place all three. Now `454-EK` and `330-CW` are removed under every profile, with a manifest row each (`07/EK`, `07/CW`): no public sheet gives their length or picture, so no surrogate is kept even under a profile that keeps other identifiers as keyed surrogates. Every `494-ZE` is a date locus in the Safe Harbor dates category: `20250301` becomes `2025` under Safe Harbor, it is shifted under a profile that shifts dates, and the manifest carries a `13/ZE` row. None of the three appears in `unexaminedResiduals` any more.
- **Changed export.** `TELECOM_RETAINED_SEGMENT_RULES` from `@cosyte/deid/ncpdp` gains `EK` and `CW` (mode `block`) in its `07` entry and a new `13` entry with `ZE` (mode `date`).
- **What a caller changes.** A step that removed these fields after the pass can stay or go: they are gone or cut to the year already. A check on the manifest or the residual list sees the new rows in place of the residuals, and a reader that expected the full measurement date now gets the year or a shifted date.
- **Sources.** The NCPDP guide lists the public payer sheets read for each field and the date they were read.
