---
"@cosyte/deid": patch
---

The NCPDP Telecom adapter now removes every Prior Authorization field but its type code, and generalizes the response DUR segment's Previous Date Of Fill to the year.

- **What changed in output.** Before, the Prior Authorization segment (`12`) was retained whole, so a representative's name and address, the request dates and the authorization number submitted (`462-EV`) left the pass unchanged and were only counted as unexamined residuals. Now the segment is mapped: the type code (`461-EU`) is kept when it has the form of a code, and every other populated field is removed and gets a manifest row (`12/EV`, `12/PE` and so on). In a response, the DUR / PPS segment's Previous Date Of Fill (`530-FU`) is now a date locus in the Safe Harbor dates category: `20250511` becomes `2025` under Safe Harbor, it is shifted under a profile that shifts dates, and the manifest carries a `24/FU` row. Neither appears in `unexaminedResiduals` any more.
- **New export.** `TELECOM_RETAIN_SEGMENT_REASONS` from `@cosyte/deid/ncpdp` gives the reason each kept segment is kept, and `TELECOM_RETAIN_SEGMENTS` is now read off it. `TELECOM_RETAINED_SEGMENT_RULES` gains the `24` entry; `TELECOM_LOCUS_MAP` and `TELECOM_SEGMENT_RETAIN_FIELDS` gain a `12` entry.
- **What a caller changes.** A check that `TELECOM_RETAIN_SEGMENTS` has `"12"` now reads false. A reader that expected Prior Authorization values or the full previous date of fill now finds them removed or cut to the year, and a check on the manifest or the residual list sees the new rows in place of the residuals.
- **Not changed.** A Scheduled Prescription ID Number (`454-EK`) or Alternate ID (`330-CW`) in the Claim segment, and a Measurement Date (`494-ZE`) in the Clinical segment, are still kept and counted as residuals: no field table we hold places them, so the NCPDP guide names them for the caller to remove.
