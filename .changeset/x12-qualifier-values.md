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
- a segment whose identifier the pass does not recognize, removed whole with its identifier, because
  an extra segment terminator or a missing separator after the identifier puts a value there
  (`DMG*D8~19800101*F~`, `NM1ZZMEMBER*X~`). Each value is recorded under a withheld segment id, the
  identifier at element `0`, and the transaction set's `SE-01` is reduced by one for each segment
  removed. This also applies to a real X12 segment the pass has no shape for, such as `PLB`;
- a segment the parser found outside every transaction set, removed whole with its identifier and
  recorded under `orphan/`, and bytes after the `IEA` that are not blank, recorded at `trailingBytes`.

A number shape cannot tell a shifted date or account number from an amount, so a shift into a number
is caught by the position it left empty. A position the TR3s require, or one a qualifier implies (a
date format implies its date), cannot be empty while a later one holds a value: every value after it
is removed and recorded, each at its own position. `HI*BH:11:D8::20260118` loses the date shifted into
`C022-05`, and `CLM**4455667701*150...` loses the account number in `CLM-02` and everything after it;
`CLP`, `PAT`, `STC`, `CAS` and every other segment with a number after a required position are checked
the same way. An `HI` amount or quantity is kept only under a value code (`BE`). A shift left, from
a missing separator, is caught by the first value that fails the shape of a required position or of a
code, date or composite position: every value after it is removed, and so is every value back to the
last such position that held. `PAT-07` keeps only `01`, so `PAT*19******D8*20250117` loses the date
of death shifted into `PAT-08`, and the `STC` dates are removed the same way after a shift either
way. A segment's required positions are read for its transaction set (`ST-01`): the 270 and 271 `INS`
keep `INS-17`, and a 278 service line keeps its unit and count with no line charge.

A date of the individual inside a retained segment (`PAT-06`, `INS-12`, an `HI` occurrence or
procedure date) is now generalized like `DTP-03`, at its own component. Recognized codes, valid dates
and amounts on well-formed input keep their output. Because every element is decided,
`unexaminedResiduals` is always empty for X12, and it now counts from the segment identifier.
`X12Coord` gains three optional fields, `component`, `envelope` and `segmentRemoved`, which the applier
reads to rewrite one component or an envelope segment, or to drop a segment. No option passes an
unexamined value through.

Each code position is checked against the complete 005010 code list of its data element, never a
hand-picked part of it: a real code is kept, and anything else is removed. A real code no rule routes
on keeps its place, and the value it qualifies is removed and recorded: a `REF-01` qualifier on neither
`REF` table (the 837 `XZ`, the 271 `18`), an entity code on no role table (the 837I `ZZ`), or an `HI`
qualifier with no code shape the adapter knows. Positions whose codes come from outside X12 (CARC, RARC,
claim status, NUBC, procedure and diagnosis codes, provider taxonomy) are checked against the published
shape. A well-formed control of each transaction set (837P, 837I, 837D, 835, 270, 271, 276, 277, 277CA,
278, 834, 999) keeps every code it carries. The shapes of `CL1`, `STC`, `UM`, `HCR`, `LS`, `LE`, `PRV`,
`OI`, `DN1` and `DN2` are new, and the `STC` dates are generalized like a `DTP` date.

New entity codes are classified too: the 278 utilization management organization, the 834 insurer,
administrator and broker, and the 271 payers and vendors are kept as organizations; the 834 and 271
family members and representatives are removed like the individual; the plan sponsor (`P5`) and a
dependent's school (`M8`) are removed like an employer. `GB` is the Other Insured, not a provider: the
835 Other Subscriber and the 834 responsible person had their name and member id kept, and now they are
removed and recorded. The 834 case manager and key person (`6Y`, `9K`), the drop-off location (`45`),
whose 834 name is a person's, and the 837 pick-up location (`PW`) are removed the same way. In an
`820` premium payment the premium payer (`N1*PR`) is the employer of the members it lists, so its
name and identifier are removed and recorded like the plan sponsor's; elsewhere `PR` is still a payer.
`classifyNm1Party` and `classifyNm1Entity` take the transaction set id as an optional second argument,
and `EMPLOYER_ENTITY_CODES_BY_SET` names the codes whose role changes by set. New `REF`
qualifiers route the 271, 276 / 277 and 834 member, account and case numbers to removal and keep the
payer, line and provider references.

Visible changes on well-formed input: the Other Insured's, the drop-off location's and the 820 premium
payer's names and identifiers are removed, a 999 loop id such as `2010BA` is kept, a segment the pass has no shape for
leaves the output instead of staying as an empty shell, with its manifest rows under `<withheld>`
rather than its segment id, and a patient's weight with no date of death before it
(`PAT*19******01*145`) is removed.
