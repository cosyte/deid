---
"@cosyte/deid": patch
---

An X12 value in a qualifier or code position is now kept only when it is a recognized code, so an identifier shifted there by a missing separator is removed.
The X12 adapter reads a code at `NM1-01` and `N1-01` (entity identifier), `NM1-08` and `N1-03`
(identification code qualifier), `REF-01` (reference qualifier), and `N4-02` and `N4-04` (state and
country), and it used to keep whatever those positions held. When a sender drops one element
separator, the identifier after it moves left into that position: `NM1*QC*1*****MI*<member id>` put
the member id in `NM1-08`, and it left in the output with no manifest row and no unexamined residual.
A value at one of these positions that is not on the position's code list, exactly as written, is
now removed and recorded as a blocked row at its own position, the same as an unrecognized
structure. A recognized code is kept as before. One visible change on well-formed input: a `REF-01`
code on neither `REF` table, such as `ZZ`, is now removed along with the value it routes.
