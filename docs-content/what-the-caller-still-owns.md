---
id: what-the-caller-still-owns
title: What the caller still owns
sidebar_label: What the caller still owns
description: "The duties a pass leaves with you before you release the output: residuals, the actual-knowledge review, key custody, logs, and what an adapter does not cover."
---

# What the caller still owns

A pass over a document does what its manifest records, and nothing else. It never certifies that the
output is de-identified: the result is "Safe-Harbor-transformed per the configured policy". What
follows stays with you, the organization that releases the data, and this page lists it in one place.
Each duty links the page that explains it.

Before you release output, check each of these:

1. [Keep the key, if your policy uses one](#keep-the-key).
2. [Give each patient their own context](#give-each-patient-their-own-context).
3. [Decide what happens to free text](#decide-what-happens-to-free-text).
4. [Read the unexamined residuals](#read-the-unexamined-residuals).
5. [Make the actual-knowledge review](#make-the-actual-knowledge-review).
6. [Hold back what the pass flags](#hold-back-what-the-pass-flags).
7. [Remove what the pass keeps on purpose, if you need it gone](#remove-what-the-pass-keeps-on-purpose).
8. [Keep the input out of logs](#keep-the-input-out-of-logs).
9. [Hold the agreements and determinations yourself](#hold-the-agreements-and-determinations-yourself).

Then read [what your adapter does not cover](#what-each-adapter-does-not-cover).

## Keep the key

The built-in Safe Harbor policy uses no key. A policy or preset that pseudonymizes, hashes or
date-shifts does, and the key is yours: we hold no key store and have no default key. Make one of 32
random bytes, keep it in your secret store, and keep it for as long as the corpus must stay linkable.
A new key severs linkage to everything made under the old one, and a leaked key or date-shift seed
re-identifies.

The registry and the context print as a fixed placeholder through `String()`, `JSON.stringify` and
`util.inspect`, so passing one to a logger does not print the key:

```ts runnable
import { randomBytes } from "node:crypto";
import { createDeidRegistry } from "@cosyte/deid";

// In your code the key comes from your secret store; it is generated here so the sample runs.
const registry = createDeidRegistry({ key: randomBytes(32) });

String(registry); // => "[DeidRegistry:redacted]"
JSON.stringify({ registry }); // => '{"registry":"[DeidRegistry:redacted]"}'
```

[Keep a patient linkable across documents](./guides-longitudinal.md#the-key-contract) states the
whole key contract, the 16-byte minimum included.

## Give each patient their own context

A call takes one context, and a `date-shift` policy derives one offset from it. The adapters refuse a
document that is several documents read as one (HL7 v2 messages written one after another, an NCPDP
Telecom message with more than one transaction or patient), but they do not refuse one document that
names more than one person: an X12 `837` names a subscriber and a dependent, and an HL7 v2
`ADT^A17` names two patients. Every date in such a document moves by the same offset. When per-patient
offsets matter, split the document per patient and give each part `registry.forPatient(...)`. See
[one context per call](./limitations.md#one-context-per-call-however-many-people-the-document-names).

## Decide what happens to free text

We ship no detector of identifiers in prose. With no redactor, every free-text position is blocked.
With your own redactor, its output is written back and recorded as `DEID_FREETEXT_CONSUMER_REDACTED`,
and the engine does not scan it again: whether it found everything is yours to establish. See
[Redact free text with your own detector](./guides-freetext.md#the-honesty-boundary-what-the-library-does-not-check).

## Read the unexamined residuals

Every adapter returns `unexaminedResiduals`: each value-bearing position the pass handed through
that no rule names, with its locus and a count, never its value. These positions are not removed.
Some hold clinical codes, and some hold names: an attending provider's name in an HL7 v2 `PV1-7`, for
one, is kept and counted.

```ts runnable
import { parseHL7 } from "@cosyte/hl7";
import { buildExpertDeterminationSupportReport } from "@cosyte/deid";
import { deidentifyHl7 } from "@cosyte/deid/hl7";

const raw = [
  "MSH|^~\\&|ADT|HOSP|EHR|HOSP|20200102080000||ADT^A01|SYNTHMSG004|P|2.5",
  "PID|1||ZZMRN004^^^HOSP^MR||ZZFAMILY^ZZGIVEN||19850302|F",
  "PV1|1|I|||||ZZDOC001^ZZDOCFAMILY^ZZDOCGIVEN",
].join("\r");

const { document, manifest, unexaminedResiduals } = deidentifyHl7(parseHL7(raw));

// The patient's name is removed. The provider's name in PV1-7 is not.
document.toString().includes("ZZFAMILY^ZZGIVEN"); // => false
document.toString().includes("ZZDOCFAMILY"); // => true

// It is counted at each component it sits in, with no value.
unexaminedResiduals.filter((r) => r.locus.startsWith("PV1-7")).map((r) => r.locus); // => ["PV1-7.1", "PV1-7.2", "PV1-7.3"]

// Hand the list to the support report, so its inventory reads as measured.
const report = buildExpertDeterminationSupportReport(manifest, { unexaminedResiduals });
report.unexaminedResidualsMeasured; // => true
```

Decide for each locus whether your recipient may see what sits there, and filter it from the output
yourself if not. The X12 adapter is the one whose list is always empty: it decides every position.
See [the unexamined-position inventory](./guides-expert-determination.md#the-unexamined-position-inventory-what-the-pass-never-looked-at)
and [what fails closed does not cover](./limitations.md#retained-loci).

## Make the actual-knowledge review

Safe Harbor also requires that the releasing organization have no actual knowledge that the
information could identify the individual, alone or with other information (45 CFR
§164.514(b)(2)(ii)). That is a judgment about the data and its recipient, and no code makes it. The
pass gives you what to apply it to: every residual it kept and recorded as `DEID_RESIDUAL_RETAINED`
(a year, a three-digit ZIP prefix, an age of 89 or under), which the support report lists:

```ts runnable
import { parseHL7 } from "@cosyte/hl7";
import { buildExpertDeterminationSupportReport } from "@cosyte/deid";
import { deidentifyHl7 } from "@cosyte/deid/hl7";

const raw = [
  "MSH|^~\\&|ADT|HOSP|EHR|HOSP|20200102080000||ADT^A01|SYNTHMSG004|P|2.5",
  "PID|1||ZZMRN004^^^HOSP^MR||ZZFAMILY^ZZGIVEN||19850302|F",
].join("\r");

const { manifest } = deidentifyHl7(parseHL7(raw));
const report = buildExpertDeterminationSupportReport(manifest);

// The message time and the date of birth each kept their year: review them for your recipient.
report.retainedQuasiIdentifiers.map((row) => row.locus); // => ["MSH-7[0]", "PID-7"]
report.determination; // => null
```

A birth year is measured against the year of the call, so a year that is 89 years back today is
removed once the calendar turns. Release output soon after the pass, or run the pass again. See
[ages over 89](./limitations.md#ages-over-89).

## Hold back what the pass flags

- **A DICOM image.** The DICOM adapter reads metadata only. When `burnedInAnnotationHazard` is
  `true`, the pixels may carry text the pass never saw: do not release the image on its metadata
  alone. See [the burned-in-pixel hazard](./guides-dicom.md#the-burned-in-pixel-hazard-flagged-never-cleaned).
- **A run with `<withheld>` loci.** A manifest locus that reads `WITHHELD_LOCUS_TOKEN` means the
  input was not what it claimed to be at that position. Find out why before you release it. See
  [the locus](./troubleshooting.md#what-the-manifest-is-safe-to-log-and-the-one-thing-to-know-about-the-locus).
- **A refusal.** `DEID_FORMAT_UNSUPPORTED`, `DEID_POSITIONS_UNENUMERABLE` and the other fatal codes
  return no output at all. Split, fix or exclude the document; never release the input in its place.
  [Codes and categories](./codes-and-categories.md#fatal-codes) lists them.

## Remove what the pass keeps on purpose

Some values that can identify a person are kept because the format needs them and the pass cannot
tell them from an identifier of the same shape: an X12 claim or authorization number, an HL7 v2
assigning authority, a C-CDA clinical record's own `<id>`. They are listed, format by format, in
[what the generated leak property still finds kept](./limitations.md#generated-leak-property). A caller
who needs any of them gone removes it after the pass.

Keyed surrogates are 64 characters, and only the X12 adapter bounds them by the field. If you check
field lengths in another format, check them after the pass; see
[a keyed surrogate in a field shorter than 64 characters](./limitations.md#a-keyed-surrogate-in-a-field-shorter-than-64-characters).

## Keep the input out of logs

The manifest, the unexamined residuals, the support report and every error message carry no value,
no key and no offset, so they are safe to log. The input model and the raw document carry protected
health information: never log them, never attach them to an error report, and never put them in a
test fixture.

```ts runnable
import { deidentify, SAFE_HARBOR_CATEGORIES } from "@cosyte/deid";

const { manifest } = deidentify(
  {
    loci: [
      {
        path: "PID-5",
        kind: "identifier",
        category: SAFE_HARBOR_CATEGORIES.NAMES,
        value: "ZZFAMILY",
      },
    ],
  },
  {},
);

// Log this line, never the input.
const line = JSON.stringify(manifest);
line.includes("ZZFAMILY"); // => false
manifest[0]?.locus; // => "PID-5"
```

## Hold the agreements and determinations yourself

- **A Limited Data Set needs a Data Use Agreement.** `LIMITED_DATA_SET_PROFILE` neither holds nor
  checks one. See [policy profiles](./limitations.md#policy-profiles).
- **An Expert Determination is a qualified expert's.** The support report is input to it, and its
  `determination` is always `null`. See
  [Build an Expert Determination support report](./guides-expert-determination.md).

## What each adapter does not cover

Each table is drawn from that adapter's guide and from [Known limitations](./limitations.md). "Counted"
means the position is on `unexaminedResiduals`.

### HL7 v2

| Not covered                                                                                                        | What the pass does                                                 | What you do                                    |
| ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------ | ---------------------------------------------- |
| Free text: `OBX-5` typed `TX`, `FT` or `ST`, `NTE-3`                                                               | Blocks it                                                          | Bring a redactor if you need the prose         |
| Non-date fields of retained segments the map does not name: provider names in `PV1-7`, `PV1-8`, `OBR-16`, and more | Keeps them, counted                                                | Filter them if your recipient may not see them |
| Dates inside a name or address composite (a provider name's effective date, a license expiry)                      | Keeps them, counted                                                | The same                                       |
| Unnamed fields of mapped segments: `NK1-26`, `NK1-38`, the guarantor's employer at `GT1-51`                        | Keeps them, counted                                                | The same                                       |
| A position only another HL7 version types as a date; the `FHS` and `BHS` timestamps                                | Keeps them, counted                                                | The same                                       |
| An identifier's assigning authority (`CX.4`)                                                                       | Keeps it, counted                                                  | Remove it after the pass if you need it gone   |
| Several messages with no batch envelope; a batch with `FHS` / `BHS`                                                | Refuses with `DEID_FORMAT_UNSUPPORTED`; `parseHL7` refuses a batch | Split with `splitBatch` from `@cosyte/hl7`     |
| Two patients in one message under a date-shift policy                                                              | Shifts both by one offset                                          | Split per patient when offsets matter          |

From [De-identify an HL7 v2 message](./guides-hl7.md#known-limitations-this-release).

### C-CDA

| Not covered                                                                                                                                    | What the pass does                      | What you do                                      |
| ---------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- | ------------------------------------------------ |
| Section narrative `<text>` and a `nonXMLBody`                                                                                                  | Blocks it                               | Bring a redactor if you need the prose           |
| In the clinical body: entry dates (`effectiveTime`), entry ids, in-entry performer names, family-history demographics other than a `birthTime` | Keeps them, counted                     | Filter them if your recipient may not see them   |
| The document `id`, `code` and `title` envelope                                                                                                 | Keeps it, counted                       | The same                                         |
| A header coded element's `@code` and `@displayName`; the root of a header `<id>` that has an extension                                         | Keeps them, not counted                 | Remove them after the pass if you need them gone |
| A replaced root that also sits in another attribute or in narrative                                                                            | Does not find it there                  | The same                                         |
| The Limited Data Set address allowance                                                                                                         | Reduces the address as Safe Harbor does | Nothing: this is the stricter direction          |

From [De-identify a C-CDA document](./guides-ccda.md#known-limitations-this-release).

### FHIR R4

| Not covered                                                                                                                                                                                                                         | What the pass does                | What you do                                                                     |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- | ------------------------------------------------------------------------------- |
| Prose: `note`, `contentString`, an uncoded `valueString`, `text.div`                                                                                                                                                                | Blocks it                         | Bring a redactor if you need the prose                                          |
| Extension values, `us-core` demographics included                                                                                                                                                                                   | Blocks them                       | Nothing: this is a loss of utility, not a leak                                  |
| A `ContactPoint` outside a person resource; an organization's own `name`; an employer as its own `Organization`                                                                                                                     | Keeps them, counted               | Filter them if your recipient may not see them                                  |
| A key R4 does not define where it sits (a vendor `Patient.alias`, a `Coding.zzNote`), or a value of a shape it does not define there (a string `subject`, a single `identifier` object), or a resource of a type it does not define | Blocks it, recorded               | Nothing: this is a loss of utility, not a leak                                  |
| An id written outside the places the pass reads (`meta.versionId`, `meta.source`, `Bundle.link.url`, `Attachment.url`)                                                                                                              | Keeps it, counted                 | The same                                                                        |
| The server base of an absolute `fullUrl`                                                                                                                                                                                            | Keeps it verbatim                 | Check the base names nothing but the server                                     |
| Resource ids across calls under Safe Harbor                                                                                                                                                                                         | Gives each call its own stand-ins | Use a keyed policy for linkage, which is not Safe Harbor                        |
| A transaction's conditional headers (`ifNoneExist` and the others)                                                                                                                                                                  | Removes them                      | Expect duplicates if you load the output into a server that holds the resources |

From [De-identify a FHIR resource](./guides-fhir.md#known-limitations-this-release).

### X12

| Not covered                                                                                             | What the pass does                                   | What you do                                      |
| ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------ |
| Provider and organization identity                                                                      | Keeps it, with a `DEID_PARTY_ROLE_RETAINED` row each | Read the rows; there is no option to remove them |
| Claim, authorization, referral and classification numbers under the administrative `REF` qualifiers     | Keeps them, not counted                              | Remove them after the pass if you need them gone |
| `TRN-03`, `TRN-04`, and a procedure code with the shape its qualifier gives                             | Keeps them, not counted                              | The same                                         |
| A real segment with no rule (`PLB`, `TS3`, `TS2`, the 837 `CUR`, `CR5` to `CR8`, the 834 member detail) | Removes it whole                                     | Nothing: this is over-removal, not a leak        |
| A field shorter than 20 characters under a keyed policy                                                 | Removes the value instead of writing a surrogate     | Do not rely on those fields for linkage          |
| A shift that leaves no required position empty and fits every shape                                     | Keeps it                                             | Validate the interchange before the pass         |
| An interchange with many patients under a date-shift policy                                             | Shifts every date by one offset                      | Split per patient when offsets matter            |

From [De-identify an X12 interchange](./guides-x12.md#known-limitations).

### NCPDP Telecom

| Not covered                                                                                        | What the pass does                                | What you do                                    |
| -------------------------------------------------------------------------------------------------- | ------------------------------------------------- | ---------------------------------------------- |
| NCPDP SCRIPT                                                                                       | Refuses with `DEID_FORMAT_UNSUPPORTED`, no output | Use another route for ePrescribing documents   |
| A message with more than one transaction, or more than one Patient or Claim segment                | Refuses with `DEID_FORMAT_UNSUPPORTED`, no output | Split it, one patient per transmission         |
| Free-text fields                                                                                   | Blocks them                                       | Bring a redactor if you need the prose         |
| Fields of retained segments and of the fixed header the map does not name (an Rx reference number) | Keeps them, counted                               | Filter them if your recipient may not see them |
| An other payer id (`340-7C`) of five or six digits                                                 | Keeps it                                          | Remove it after the pass if you need it gone   |

From [De-identify an NCPDP Telecom transaction](./guides-ncpdp.md#known-limitation).

### DICOM

| Not covered                                                    | What the pass does                                    | What you do                                            |
| -------------------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------ |
| Burned-in text and faces in the pixels                         | Flags `burnedInAnnotationHazard`; never cleans pixels | Do not release an image on its metadata alone          |
| Annex E options other than the three offered                   | Refuses them; none named is the full Basic Profile    | Nothing: this is the stricter direction                |
| A coded list nested in a kept sequence, with Clean Descriptors | Refuses with `DEID_FORMAT_UNSUPPORTED`, no output     | Run without Clean Descriptors for that file            |
| Replacement-UID consistency across calls                       | Holds within one call only                            | Pass one shared `uidMap` to every call that must agree |
| Attributes the Annex E report does not account for             | Keeps them, counted, nested sequence items included   | Filter them if your recipient may not see them         |

From [De-identify a DICOM file](./guides-dicom.md#known-limitations).

## Reference

- [`DeidManifestEntry`](./api/@cosyte/deid.md#deidmanifestentry) and
  [`UnexaminedResidual`](./api/@cosyte/deid.md#unexaminedresidual)
- [`buildExpertDeterminationSupportReport`](./api/@cosyte/deid.md#buildexpertdeterminationsupportreport)
- [`createDeidRegistry`](./api/@cosyte/deid.md#createdeidregistry) and
  [`WITHHELD_LOCUS_TOKEN`](./api/@cosyte/deid.md#withheld_locus_token)
- [`deidentifyHl7`](./api/@cosyte/deid/hl7.md#deidentifyhl7)
- [Codes and categories](./codes-and-categories.md): every disposition and fatal code
