<a href="https://cosyte.com">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://cosyte.com/tile/cosyte-lockup-tile-on-dark-1200x300.png">
    <img alt="Cosyte: a plus mark set in two overlapping rounded squares, one solid and one outlined, beside the Cosyte wordmark" src="https://cosyte.com/tile/cosyte-lockup-tile-on-light-1200x300.png">
  </picture>
</a>

# @cosyte/deid

> Healthcare **de-identification** for Node.js and TypeScript: a HIPAA-grounded policy engine that
> **fails closed** and emits a **value-free manifest**.

`@cosyte/deid` applies a de-identification **policy** (HIPAA Safe Harbor by default) to a
structurally-located model of a healthcare document and returns a transformed model plus a value-free
audit of everything it acted on. It is a **consumer** of the `@cosyte/*` parsers, not a parser sibling:
it borrows the archetype's disciplines (typed diagnostics, immutable output, a policy/profile system)
but **inverts the reflex**: where a parser is liberal on input, a de-identifier is conservative and
**fails closed**. Third-party runtime dependencies: **zero** (every primitive is `node:crypto`).

> **The honesty line.** Results are **"Safe-Harbor-transformed per the configured policy"**, never
> "de-identified" and never "HIPAA-compliant". Safe Harbor is implemented mechanically; the
> actual-knowledge condition (§164.514(b)(2)(ii)) is the consumer's; **Expert Determination
> (§164.514(b)(1)) is supported, never rendered or certified.** The certification is
> always the consumer's.

> **Status:** pre-alpha (`0.0.x`), published on npm. This release ships the **format-agnostic
> core** plus six format bindings: the **HL7 v2 adapter** (`@cosyte/deid/hl7`), the **C-CDA adapter**
> (`@cosyte/deid/ccda`), the **FHIR R4 adapter** (`@cosyte/deid/fhir`), the **X12 EDI adapter**
> (`@cosyte/deid/x12`), the **NCPDP Telecom adapter** (`@cosyte/deid/ncpdp`), and the **DICOM adapter**
> (`@cosyte/deid/dicom`), plus the **longitudinal layer**, the corpus registry (`createDeidRegistry`)
> for cross-document consistency and the formalized key contract, and the **Expert-Determination support
> report** (`buildExpertDeterminationSupportReport`) that structures the manifest for a statistician
> **without ever rendering a determination**. NCPDP SCRIPT is **not** supported, and an entry point
> handed one refuses it outright rather than returning a partial pass.

## Install

```bash
npm install @cosyte/deid
```

## De-identify

```ts
import { deidentify, SAFE_HARBOR_CATEGORIES } from "@cosyte/deid";

const { document, manifest } = deidentify(
  {
    loci: [
      { path: "PID-5", kind: "identifier", category: SAFE_HARBOR_CATEGORIES.NAMES, value: name },
      { path: "PID-7", kind: "date", category: SAFE_HARBOR_CATEGORIES.DATES, value: dob },
      { path: "OBX-5", kind: "clinical", value: "5.4 mmol/L" },
    ],
  },
  {},
);

// document.loci[0].value === null   (name removed)
// document.loci[1].value === "<year>" (date generalized)
// document.loci[2].value === "5.4 mmol/L" (clinical value retained, the over-scrub guard)
// manifest records each category + locus + disposition, never a value.
```

## Keyed transforms

This section now lives in [documentation/policy-and-reports.md](documentation/policy-and-reports.md).

## De-identify an HL7 v2 message

The `@cosyte/deid/hl7` adapter locates PHI **structurally** in the parsed [`@cosyte/hl7`](https://github.com/cosyte/hl7)
model, never by regex over the raw bytes, and returns a transformed `Hl7Message` plus the value-free
manifest. `@cosyte/hl7` is an **optional peer dependency**: install it alongside `@cosyte/deid` to use
this subpath; the core stays dependency-free.

```bash
npm install @cosyte/deid @cosyte/hl7
```

```ts
import { parseHL7 } from "@cosyte/hl7";
import { deidentifyHl7 } from "@cosyte/deid/hl7";
import { createDeidContext } from "@cosyte/deid";

const context = createDeidContext({ key: process.env.DEID_KEY! });
const { document, manifest } = deidentifyHl7(parseHL7(rawMessage), { context });

document.toString(); // spec-clean, de-identified HL7 wire
// PID-5 (name), NK1/GT1/IN1/IN2 relatives, SSN, phone, MRN and account → removed;
// DOB → year; address → safe 3-digit ZIP. OBX-5/NTE free text and Z-segments fail closed (blocked).
// Admit/discharge/observation/diagnosis dates → year; visit and order numbers blocked as (R).
// Structured clinical OBX values, units, codes, and statuses survive untouched.
```

**What it covers.** The structured PHI loci of **PID** (patient) and **NK1 / GT1 / IN1 / IN2**
(relatives / guarantor / insured), typed by the `@cosyte/hl7` model. **Fail closed** everywhere else: a
recognized segment is retained **only** if it is on an explicit clinical/administrative retain-list,
so a known patient-identity segment absent from the map (e.g. **MRG** prior name + MRN on a merge, **FAM**,
**ACC**) is blocked, never passed through, and Z-segments / structure unknown to the parser are blocked.
**OBX-5** is retained only when OBX-2 positively types it as a structured clinical value (numeric /
coded / a time of day); narrative (`TX`/`FT`), ambiguous String (`ST`), and any empty/unknown OBX-2 fail
closed, as do **NTE-3** comments, and a **date/time** value type makes OBX-5 a date the pass acts on.
Structured clinical values, units, codes, and statuses survive untouched.

**The individual's employer is a Safe Harbor subject, not an unrelated organisation.**
§164.514(b)(2)(i) removes the identifiers of the individual "or of relatives, **employers**, or
household members", so the employer positions the v2.5.1 financial segments type are acted on and
recorded like any other mapped locus: the guarantor's employer name (**GT1-16**), address
(**GT1-17**, reduced to the safe 3-digit ZIP) and phone (**GT1-18**); the guarantor employee and
employer identification numbers (**GT1-19**, **GT1-29**); the insured's group employer id and name
(**IN1-10**, **IN1-11**); the insured's employer name (**IN2-3**); the employer contact person's name
and phone (**IN2-49**, **IN2-50**); and the insured's employer phone (**IN2-64**). **IN2-70** types an
_organisation_ rather than a value, so it goes through the same party-role test the X12 adapter applies
to an `NM1` / `N1` party and **fails closed**: an employer is never outside the scope clause, so the
organisation's name and its identifier both go. The mirror control holds: the coded employment status
(**GT1-20**) and the _insurer's own_ company id, name, address and phone (**IN1-3/4/5/7**) are
untouched, because none of them is the individual's, a relative's or an employer's identity.

**Inside a retained segment**, the identifying loci are carved back out: under a Safe-Harbor-labelled
policy the admit (PV1-44), discharge (PV1-45), observation (OBR-7) and diagnosis (DG1-5) dates keep only
their **year**, and the visit number (PV1-19) with the placer and filler order numbers (OBR-2/3, ORC-2/3)
are **removed**. A profile that names their retention class, as the limited-data-set preset does, keeps
them **unchanged and recorded**. PV1-19 is a CX list routed by its CX-5 identifier-type code, like PID-3:
only a `VN`-typed or untyped visit number is the encounter identifier, while an `MR`/`AN`/`SS`-typed one
is transformed as the medical record / account / social security number it is, under **both** profiles.

**The postal-address allowance of §164.514(e)(2)(ii)** is the one place a profile can ask this adapter
to keep _more_ geography than the safe 3-digit ZIP. That clause removes "postal address information,
**other than town or city, State, and zip code**", which makes it the only **partial** exclusion in the
limited data set's list of sixteen. A profile naming the `limited-data-set-geography` retention class,
as the limited-data-set preset does, keeps the **town or city** (XAD.3), the **State** (XAD.4) and the
**whole zip code** (XAD.5) of every mapped address (**PID-11**, **NK1-4**, **NK1-32**, **GT1-5**,
**GT1-17**, **IN1-19**), each recorded as a `DEID_RESIDUAL_RETAINED` residual at its own component, and
drops the street address along with every other geographic component: the county or parish, the census
tract, the country. The county-code field (**PID-12**) and the birth place (**PID-23**) are removed
under every profile, because the clause names neither. The three-digit / `000` rule is
§164.514(b)(2)(i)(B), **Safe Harbor's**, so a restricted-prefix ZIP is kept in full under this class and
is still suppressed under Safe Harbor. **Nothing widens by omission**: without the class an address is
reduced exactly as it always was, and an address whose zip code is not a whole zip code falls back to
that generalization, which drops the whole address rather than keeping part of it. This adapter is the
**only** one that reads retention classes; under C-CDA, FHIR, X12, NCPDP and DICOM an address is reduced
exactly as Safe Harbor reduces it.

**Every other date inside a segment the pass hands through** is acted on and recorded too: every
position the HL7 **v2.5.1** segment definitions type as a date or date/time, at its own unit (a field, a
component of a composite, one repetition at a time), plus an OBX-5 the message types as a date. That
reaches ORC-9 and ORC-15, the EVN / PV2 / PR1 / RXA / RXD / FT1 / TXA / SPM timestamps, the date
components of a range or other composite, and the **OBX segment's own** reference-range, observation and
analysis timestamps (OBX-12 / OBX-14 / OBX-19), which survive the value-type branch that decides OBX-5.
The classification is structural and version-fixed: an eight-digit numeric result is not a date, and
`MSH-12` moves no position.

**Known limitations (this release).** Free text is block-by-default (no built-in scrub; opt-in BYO
redaction: see [Free text](#free-text-block-by-default--byo-redaction)); every **non-date** field of a
retained segment that the carve-outs do not name is **not** de-identified, which still includes the
_provider_ names in PV1-7/8 and OBR-16, the guarantor's employer organisation name at GT1-51, and the
date components carried inside a person-name or address composite; a position only a version other than
v2.5.1 types as a date is a stated residual; the address generalization keeps only the Safe Harbor
3-digit ZIP, unless the profile names the §164.514(e)(2)(ii) geographic retention class described
above.

**Those positions are now counted and located, which is a different thing from being cleaned.** Every
value-bearing position a pass hands through that no locus rule names is recorded as an **unexamined
residual** on `result.unexaminedResiduals`, with its structural locus, a count and the fact that nothing
examined it, and never a value. Hand that list to the support report alongside the manifest and the
report says how many there were; hand it an empty list and the report says the inventory was **measured
and empty**, which reads differently from a pass that measured nothing at all.

**Counting is not removal, and an unexamined position is not an allegation.** Nothing is scrubbed,
generalized or blocked on account of the count, and a position no rule examined has no established Safe
Harbor category, so it joins none of the 18 and moves no category total. A clinical code, a dose unit and
an order status all sit at positions like these. The two fail-safes are worth knowing: a position whose
locus cannot be expressed is still counted, under a withheld locus token, and a structure whose positions
cannot be enumerated **fails the pass** rather than contribute a zero a reader would take for a
clearance.

**What counts as a position is derived from what each parser's model can carry**, not from the places a
value usually sits, so the enumeration reaches the easily-overlooked ones: XML character data delivered
as a CDATA section rather than as text, the comments and processing instructions a document is
re-serialized with, a FHIR primitive's `_`-sibling element id, and whatever a partly rewritten structure
keeps (the state and country of a generalized address travel exactly as they arrived, with anything
riding inside them). Conversely a position the pass _removes_ is not counted: the number measures what
left the pass untouched. [Limitations](./docs-content/limitations.md) states the count's two edges.

**Employer surfaces that remain residual, in every format.** Two, named so a consumer can tell a
covered surface from an uncovered one. **An employer named only in free text** (an OBX-5 narrative, an
NTE comment, a C-CDA section `<text>`, a FHIR `note`) is reached only by an opt-in BYO redactor, never
by this library. And **an employer carried as a separate organisation resource in a FHIR graph** is not
reached either: in FHIR an employer arrives as a `Reference` (whose `display` is already blocked) to a
standalone `Organization` whose `name` the map retains as administrative data, so classifying it would
be a cross-resource role derivation rather than a typed position. The employer positions above are the
covered ones: they are typed at the position by X12 and by HL7 v2, which is what makes them decidable.

## De-identify a C-CDA document

This section now lives in [documentation/format-adapters.md](documentation/format-adapters.md).

## De-identify a FHIR R4 resource

This section now lives in [documentation/format-adapters.md](documentation/format-adapters.md).

## De-identify an X12 EDI interchange

This section now lives in [documentation/format-adapters.md](documentation/format-adapters.md).

## De-identify an NCPDP Telecom transaction

This section now lives in [documentation/format-adapters.md](documentation/format-adapters.md).

## De-identify a DICOM study

This section now lives in [documentation/format-adapters.md](documentation/format-adapters.md).

## Keep a longitudinal record linkable

This section now lives in [documentation/policy-and-reports.md](documentation/policy-and-reports.md).

## Free text: block-by-default + BYO redaction

This section now lives in [documentation/format-adapters.md](documentation/format-adapters.md).

## Expert-Determination support, never certification

This section now lives in [documentation/policy-and-reports.md](documentation/policy-and-reports.md).

## Policy profiles: reusable presets, widen-never-narrow

This section now lives in [documentation/policy-and-reports.md](documentation/policy-and-reports.md).

## Known limitations & honesty

`@cosyte/deid` **transforms per a policy and evidences what it did: it never certifies**. Read
[`docs-content/limitations.md`](docs-content/limitations.md) before relying on it for anything that
leaves your control: the fail-closed posture, structured-core-only (free text is block-by-default),
**DICOM metadata-only** (burned-in pixels flagged, not cleaned), **NCPDP SCRIPT refused**, the BYO
free-text redactor is the consumer's responsibility, and the Expert-Determination report **makes no
determination**.

## The design in five pieces

- **Policy engine**: `safe-harbor` built in; `defineDeidPolicy()` to deviate deliberately.
- **Five transforms**: redact, generalize (date→year, ZIP→3-digit/`000`, age→`90+`), keyed date-shift,
  keyed-HMAC pseudonymize, keyed hash.
- **18 Safe Harbor categories**: §164.514(b)(2)(i)(A)–(R), including the open-ended catch-all (R).
- **Fail-closed rule**: anything uncertain is blocked, never passed through; clinical values are
  retained untouched.
- **Value-free manifest**: category + transform + locus + count + disposition + code + a boolean
  `reidentificationCode` (`true` only where a keyed surrogate was emitted) + a `partyRole` code (only
  where a party was left in place because its role sits outside the scope clause), never a value, never
  the key, never the date-shift offset. The locus is the one field built out of the document: a
  per-format adapter names the position with the identifier that sits there, so each identifier is
  checked against the shape its position promises and a non-conforming one is refused as
  `WITHHELD_LOCUS_TOKEN` (`<withheld>`) rather than echoed.

## License

MIT © Cosyte
