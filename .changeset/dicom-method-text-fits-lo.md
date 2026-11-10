---
"@cosyte/deid": patch
---

The DICOM pass now writes De-identification Method (0012,0063) as several Values of at most 64 characters each, so the output no longer carries an over-length LO Value.

The attribute is LO with value multiplicity 1-n (PS3.6), and PS3.5 Table 6.2-1 caps an LO at 64 characters per Value. The text is now four Values: `Cosyte @cosyte/deid`, `PS3.15 Basic Application Level Confidentiality Profile`, `metadata only`, and `policy "<name>"`. In the policy name, a backslash is written as `/`, since the backslash is the Value delimiter, and every other character outside printable ASCII (U+0020 to U+007E) is written as `?`: the text is written one byte per character, so a control character or a character above U+00FF would otherwise land as a control byte or as the delimiter, and a byte from A0H to FFH is valid only under a declared Specific Character Set, which the pass does not set. A policy name that would take its Value past 64 characters after that mapping is cut to fit and ends in `...`.
