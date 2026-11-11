---
"@cosyte/deid": patch
---

Values in shapes a rule did not expect are now removed from HL7 v2 identifiers and dates, NCPDP Telecom kept fields, FHIR person resources and FHIR conditional request headers.

A generated leak property now runs for each of the six adapters: it writes tagged synthetic values at generated positions and in generated shapes, and each must be removed or counted on `unexaminedResiduals` at its own position. What it found, each now fixed:

- **HL7 v2 identifiers.** An identifier the map names (PID-2/3/4/18/21, NK1-12/33, GT1-2/19/29, IN1-8/10/36/49, IN2-6/7/61, and PV1-19 when it is transformed) now keeps its number as the policy transforms it, its assigning authority (CX.4), and its type code (CX.5) only when HL7 Table 0203 (v2.5.1) defines that code. Every other component is removed: the check digit and its scheme, the assigning facility, the effective and expiration dates, the jurisdiction and the agency. Before, every component after the number was kept as it arrived. A repetition with no number that holds anything else is now blocked and recorded (`DEID_LOCUS_BLOCKED`) rather than kept whole. The assigning authority is now counted as an unexamined residual at its own component.
- **HL7 v2 dates.** A date the pass reduces is now written back alone: a component after it in the same repetition (a degree of precision, or anything else) is removed. A date position whose date is empty but which holds a value in a later component or subcomponent is blocked and recorded.
- **NCPDP Telecom.** A field a Patient, Prescriber, Insurance or Coordination of Benefits segment keeps (gender, state, the qualifiers, person code, counts, amounts, the other payer id) is kept only in its own format; a value in any other shape is blocked like an unlisted field.
- **FHIR person resources.** A string at a person resource's top level is kept only when it is a `gender` in the R4 value set or a `language` shaped as a language tag. A string where R4 puts a structure (`link`, `contact`, `managingOrganization`, `patient`, `generalPractitioner`), a gender outside the value set, and an `implicitRules` URI are now removed and recorded.
- **FHIR conditional request headers.** `Bundle.entry.request.ifNoneExist`, `ifMatch` and `ifNoneMatch` are now removed whatever they hold and recorded as blocked: a search string such as `identifier=system|value` or `_id=value` carries an identifier, and an entity tag carries a version id. A conditional create becomes an unconditional one.

The property also finds values kept on purpose because they have the shape their position expects: an X12 trace number, an X12 procedure code under a qualifier with no published code shape, the name and identifier of an X12 party its role keeps, and a C-CDA header code, display name and identifier root. These are unchanged, and the limitations page names each one.

What a caller sees: HL7 v2 output bytes change only for an identifier or a date that carried those extra components (the output bytes of our committed fixtures are unchanged); the HL7 v2 residual inventory gains the assigning authority positions; a FHIR person resource loses an `implicitRules`, a `language` that is not a language tag, and any string at a structure position; a FHIR transaction entry loses its conditional headers. Nothing in the public API changes.

FHIR resource id replacement, also in this release, has no opt-out: no option keeps resource ids. It costs about 7 percent on a single Patient: FHIR R4 text in and text out for one Patient of about 1 KiB went from 40.31 to 43.31 microseconds on the GitHub runner.
