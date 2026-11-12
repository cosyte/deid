---
"@cosyte/deid": patch
---

The NCPDP Telecom adapter now generalizes the Claim segment's Date Prescription Written and Associated Prescription/Service Date to the year, as it does the Date of Service.

- **What changed in output.** Before, the Claim segment (`07`) was retained whole, so `414-DE` Date Prescription Written and `457-EP` Associated Prescription/Service Date left the pass unchanged and were only counted as unexamined residuals. Now each is a date locus in the Safe Harbor dates category: `20250602` becomes `2025` under Safe Harbor, it is shifted under a profile that shifts dates, and the manifest carries a row for `07/DE` and `07/EP`. They no longer appear in `unexaminedResiduals`. Every other Claim field, and every Pricing field, is kept as before.
- **New export.** `TELECOM_RETAINED_SEGMENT_RULES` from `@cosyte/deid/ncpdp` names the fields a rule reaches inside a retained segment: these two Claim dates.
- **What a caller changes.** Nothing to call differently. A reader that expected the full date in `414-DE` or `457-EP` now gets the year, and a check on the manifest or the residual list sees the two new rows in place of two residuals.
