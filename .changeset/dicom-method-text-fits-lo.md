---
"@cosyte/deid": patch
---

The DICOM pass now writes De-identification Method (0012,0063) as several Values of at most 64 characters each, so the output no longer carries an over-length LO Value.

The attribute is LO with value multiplicity 1-n (PS3.6), and PS3.5 Table 6.2-1 caps an LO at 64 characters per Value. The text is now four Values: `Cosyte @cosyte/deid`, `PS3.15 Basic Application Level Confidentiality Profile`, `metadata only`, and `policy "<name>"`. A policy name that would take its Value past 64 characters is cut to fit and ends in `...`, and a backslash in a policy name is written as `/`, since the backslash is the Value delimiter.
