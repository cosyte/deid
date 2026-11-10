---
"@cosyte/deid": minor
---

The X12 adapter now decides every element it outputs, so a value shifted by a missing or extra separator, or left where no rule looks, is removed and recorded instead of passed through.
This changes the default X12 output. A value is kept only when it has the shape its position expects:
a code the position knows, exactly as written; a valid date in the format the segment declares; a
number; or, at a trace or control number, a bounded reference. Everything else is removed and recorded
as a blocked manifest row at its own position:

- a value that is not a recognized code at `NM1-01`, `N1-01`, `NM1-08`, `N1-03`, `REF-01`, `N4-02` or
  `N4-04`. Such a code also routes nothing: `NM1*pr*...` no longer keeps the party's name and
  identifier, and `REF*f8*...` no longer keeps `REF-02`;
- a value of the wrong shape at a code, qualifier, date, amount or count position the rules keep, in
  `DMG`, `PER`, `DTP`, `DTM`, `SBR`, `CLM`, `CLP`, `HI`, the retained clinical and financial segments,
  `ST` / `SE`, and the `ISA` / `GS` / `GE` / `TA1` / `IEA` envelope (an `ISA` element becomes blanks of
  its own width). A `DTP-03` that is no valid date in the `DTP-02` format is removed rather than cut to
  its front, a `TM` time of day included;
- a value at a position no rule names: `NM1-10` onward, `N1-05` onward, `REF-03` onward, and any
  element past the last one a retained segment uses;
- a free-text component: a procedure description inside a procedure composite, a 999 copy of a bad
  data element (`IK4-04`), the business unit value of a 999 context (`CTX-01-2`);
- a segment the parser found outside every transaction set, removed whole and recorded under
  `orphan/`, and bytes after the `IEA` that are not blank, recorded at `trailingBytes`.

A date of the individual inside a retained segment (`PAT-06`, `INS-12`, an `HI` occurrence or
procedure date) is now generalized like `DTP-03`, at its own component. Recognized codes, valid dates
and amounts on well-formed input keep their output. Because every element is decided,
`unexaminedResiduals` is always empty for X12. `X12Coord` gains two optional fields, `component` and
`envelope`, which the applier reads to rewrite one component or an envelope segment. One visible change
on well-formed input: a `REF-01` code on neither `REF` table, such as `ZZ`, is removed along with the
value it routes. No option passes an unexamined value through.
