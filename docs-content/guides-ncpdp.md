---
id: guides-ncpdp
title: De-identify an NCPDP Telecom transaction
sidebar_label: NCPDP Telecom
description: "Run an NCPDP Telecom transaction through the Safe Harbor policy, read what is located, why NCPDP SCRIPT is refused, and the one-transaction limit."
---

# De-identify an NCPDP Telecom transaction

The `@cosyte/deid/ncpdp` adapter is the NCPDP **Telecommunication (vD.0)** binding of the
de-identification core. It locates PHI **structurally** in a parsed Telecom transaction (a value is the
patient's last name because it sits in field `311-CB`, never because a string "looked like" a name),
applies the configured policy, and returns the transformed Telecom byte stream plus the core's
**value-free manifest**.

> **`@cosyte/ncpdp` is an optional peer dependency.** Install it alongside `@cosyte/deid` to use this
> subpath. The adapter reaches NCPDP data only through `@cosyte/ncpdp`'s exported Telecom model
> (`TelecomTransaction` / `TelecomSegment` / `TelecomField`) and its `parseTelecom` / `serializeTelecom`
> codec.

```bash
npm install @cosyte/deid @cosyte/ncpdp
```

## De-identify a transaction

Parse the transaction with `@cosyte/ncpdp/telecom` and hand it to `deidentifyTelecom`, or pass the raw
text to `deidentifyTelecomString`, which parses and de-identifies in one call. The billing request
below is synthetic; `FS` and `RS` are the field and segment separators.

```ts runnable
import { parseTelecom } from "@cosyte/ncpdp/telecom";
import { deidentifyTelecom, deidentifyTelecomString } from "@cosyte/deid/ncpdp";

const FS = "\x1c";
const RS = "\x1e";
const raw = [
  "999999D0B1PCN01     101PHARM123       20260115          AM01",
  `${FS}CAZZPATFIRST${FS}CBZZPATLAST${FS}C419850302${FS}C5M${FS}COOH${FS}CP44101`,
  `${RS}AM04${FS}C2ZZCARDHOLDER${FS}C1ZZGROUP01${FS}C301`,
  `${RS}AM07${FS}D2RX0000001${FS}E103${FS}D700071015527${FS}E730000`,
].join("");

const { telecom, manifest } = deidentifyTelecom(parseTelecom(raw));
// or, parse + de-identify in one call:
deidentifyTelecomString(raw).telecom === telecom; // => true

telecom.includes("ZZPATLAST"); // => false
telecom.includes(`${FS}C41985${FS}`); // => true
telecom.includes(`${FS}CP441`); // => true
telecom.includes(`${FS}D700071015527${FS}`); // => true
manifest.map((entry) => entry.locus); // => ["header/dateOfService", "01/CA", "01/CB", "01/C4", "01/CP", "04/C2", "04/C1"]
```

The built-in Safe Harbor policy uses **no keyed transform**, so a Safe Harbor pass over a transaction
needs no `context` at all. Under a preset that keeps consistent keyed surrogates instead, a `context`
is required and calling without one when the transaction needs it is a fatal `DEID_NO_KEY`.
[Choose a policy](./choose-a-policy.md#use-a-profile) shows how to pass one.

## What is located, and how it is transformed

Telecom is a flat sequence of segments of `{ id, value }` fields. Field ids are globally unique in the
standard, so the map keys off the field id directly.

| Segment / locus                                                                  | Handling                                                                                                                                                                                                                                    |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Patient (`01`)**                                                               | name (`CA`/`CB`) + phone (`CQ`) removed; street (`CM`) + city (`CN`) removed; ZIP (`CP`) → 3-digit; DOB (`C4`) → year (removed when it shows an age over 89); patient id (`CY`) **removed** under Safe Harbor; gender + state retained      |
| **Insurance (`04`)**                                                             | cardholder id (`C2`) + group id (`C1`) **removed** under Safe Harbor; cardholder name (`CC`/`CD`) removed; person code retained                                                                                                             |
| **Prescriber (`03`)**                                                            | prescriber id (`DB`) **removed**                                                                                                                                                                                                            |
| **Coordination of Benefits (`05`)**                                              | other-payer cardholder (`NU`) + group (`MJ`) ids **removed** under Safe Harbor; other-payer date (`E8`) → year                                                                                                                              |
| **Claim (`07`)**                                                                 | Date Prescription Written (`DE`) + Associated Prescription/Service Date (`EP`) → year; Scheduled Prescription ID Number (`EK`) + Alternate ID (`CW`) **removed**; every other Claim field retained |
| **Clinical (`13`)**                                                              | Measurement Date (`ZE`) → year, every occurrence; the diagnosis codes and measurements retained |
| **Prior Authorization (`12`)**                                                   | type code (`EU`) kept in the form of a code; the number submitted (`EV`) and every other field (a representative's name or address, a request date) **removed**                                                                             |
| **Response DUR / PPS (`24`)**                                                    | Previous Date Of Fill (`FU`) → year; the alert codes and the quantity of the previous fill retained                                                                                                                                         |
| **Header**                                                                       | Date of Service → year                                                                                                                                                                                                                      |
| **Free text** (`544-FY`, `504-F4`, `526-FQ`)                                     | **fails closed**: blocked, never scrubbed by a naive pass                                                                                                                                                                                   |
| **Clinical / financial / response** (`02`/`07`/`08`/`10`/`11`/`13`/`20` to `24`) | **retained untouched** but for the fields above, each segment for the reason `TELECOM_RETAIN_SEGMENT_REASONS` lists: NDC drug codes, quantities, days-supply, pricing, DUR reason codes; every other field counted as an unexamined residual |
| Any **unmapped / unknown** segment                                               | **fails closed**: every field blocked                                                                                                                                                                                                       |

The X12 adapter **retains** provider identity, while this adapter **removes** the prescriber id: a
deliberate asymmetry.

A field a Patient, Prescriber, Insurance or Coordination of Benefits segment retains (gender, state,
relationship, place of service, the id qualifiers, person code, pregnancy indicator, residence, the
coordination of benefits counts, coverage type, qualifiers and amounts, and the other payer id) is
kept **only in its own format**: a one- or two-character code, a count,
a two-letter state, an amount, or for the other payer id (`340-7C`) five or six digits, the form of a
BIN or an NAIC company code. A value in any other shape is blocked and recorded like an unlisted
field, which removes an other payer id in another form (a Health Industry Number, say). The other
payer processor control number (`MH`) is not kept at all: it has no format that tells a plan's
routing code from a short name, so it is blocked and recorded whatever it holds.

The Claim segment is retained for its NDC, quantity and days supply, but two of its fields are dates
of the individual's care: the Date Prescription Written (`414-DE`) and the Associated
Prescription/Service Date (`457-EP`). Safe Harbor removes every element of such a date but the year,
so each is handled the way the header Date of Service and the other payer date are: generalized to
its year, recorded in the manifest as `07/DE` or `07/EP`, and shifted instead under a profile that
shifts dates. `TELECOM_RETAINED_SEGMENT_RULES` lists them. The Pricing segment (`11`) carries amounts
and codes and no date. The Prescriber segment (`03`) carries no date either, and removes every field
but its id qualifier.

The Claim segment also carries two identifiers, and the Clinical segment a date, that the field
tables we hold do not name. Public Medicaid payer sheets place and name them, so each is handled by
what those sheets say it holds:

- **`454-EK` Scheduled Prescription ID Number**, Claim segment. It names one scheduled (controlled)
  drug prescription, so with the pharmacy and the date it points to one patient's fill. It is
  **removed** and recorded as `07/EK`, under every profile.
- **`330-CW` Alternate ID**, Claim segment. It is an alternate reference for the claim or member; one
  sheet says it carries Medicare's reference number on a crossover claim. It is **removed** and
  recorded as `07/CW`, under every profile.
- **`494-ZE` Measurement Date**, Clinical segment, `CCYYMMDD`, once per measurement. It is the day a
  measurement of the patient was taken, so each occurrence is handled like the other dates of care:
  cut to its year under Safe Harbor, shifted under a profile that shifts dates, recorded as `13/ZE`.

No public sheet we read gives the length or picture of `454-EK` or `330-CW`, so a surrogate in their
form cannot be built: that is why both are removed rather than replaced, even under a profile that
keeps other identifiers as keyed surrogates. The sheets we read for these three fields, each read on
2026-11-12:

- Washington State Health Care Authority, Apple Health pharmacy payer sheet, effective June 8, 2024
  (`454-EK` and `330-CW` in the Claim segment):
  <https://www.hca.wa.gov/assets/billers-and-providers/do_payer_sheet.pdf>
- Nevada Medicaid NCPDP payer sheet, effective December 2, 2011 (`454-EK` and `330-CW` in the Claim
  segment): <https://medicaid.nv.gov/Downloads/provider/SR-91_20111121.pdf>
- Express Scripts NCPDP vD.0 Medicaid payer sheet, effective January 1, 2018 (`454-EK` in the Claim
  segment): <https://www.express-scripts.com/art/prc/NCPDP_vD0_MEDICAID_Payer_Sheet.pdf>
- Utah Medicaid NCPDP version 5 payer sheet, 2007 (`330-CW` carries Medicare's reference number on a
  crossover claim): <https://medicaid-documents.dhhs.utah.gov/Documents/pdfs/NCPDPbilling.pdf>
- Kansas Medical Assistance Program NCPDP vD.0 payer sheets, version 6.0, May 4, 2021 (`494-ZE` in
  the Clinical segment, `9(8)`, `CCYYMMDD`):
  <https://www.kmap-state-ks.us/Documents/EDI/NCPDP%20D%200%20Payer_Sheets%20v6.pdf>

The response DUR / PPS segment (`24`) is kept for its alert codes, but its Previous Date Of Fill
(`530-FU`) is the day the patient's earlier prescription was filled: it goes to the year as `24/FU`,
like the Claim dates.

The Prior Authorization segment (`12`) is no longer kept whole. Besides the authorization's type and
number it may carry the name and address of a person acting for the patient, and the field tables we
hold name only the type code (`461-EU`) and the number submitted (`462-EV`). So the segment keeps the
type code in the form of a code, removes the number submitted (an authorization number issued for
this patient), and removes and records every other populated field, whatever its id.

Every segment kept whole has a reason in `TELECOM_RETAIN_SEGMENT_REASONS`, and
`TELECOM_RETAIN_SEGMENTS` is read off that table, so a segment is never kept without one.

## NCPDP SCRIPT is refused

NCPDP **SCRIPT** (ePrescribing XML) de-identification is **not** shipped in this release. The
`@cosyte/ncpdp` SCRIPT surface cannot be transformed faithfully through its public API:
`serializeScript` emits only the **modeled** fields (a `parse → serialize` round-trip drops any unmodeled
XML element), and the SCRIPT `Patient` model has **no address, phone, or patient-id** field. A partial
pass would silently drop content and leave unmodeled patient identifiers unhandled: a false-safety
hazard the fail-closed posture forbids. SCRIPT support waits for a parser surface that preserves the full
document.

**That is a behavior, not a note.** Hand a SCRIPT document to either entry point and it is **refused**,
before anything is parsed:

```ts runnable
import { deidentifyTelecomString } from "@cosyte/deid/ncpdp";
import { DeidError, FATAL_CODES } from "@cosyte/deid";

let refusal: unknown;
try {
  // An XML document on an NCPDP surface is SCRIPT, and it is declined outright.
  deidentifyTelecomString('<?xml version="1.0"?><Message><Body><NewRx/></Body></Message>');
} catch (err) {
  refusal = err;
}

refusal instanceof DeidError && refusal.code === FATAL_CODES.DEID_FORMAT_UNSUPPORTED; // => true
// The message names SCRIPT and the parser-surface reason, and carries no document content.
refusal instanceof DeidError && refusal.message.includes("SCRIPT"); // => true
refusal instanceof DeidError && refusal.message.includes("NewRx"); // => false
```

The error is a typed `DeidError` carrying `DEID_FORMAT_UNSUPPORTED`, and its message names the format
and states the parser-surface reason. It carries no byte of the document, and the call returns **no**
transformed document, **no** manifest, and no partial output of any kind. A **Telecom** caller sees no
change: a parsed Telecom transaction is never a candidate for the refusal.

## Known limitation

A retained clinical or response segment may carry a field the field tables we hold do not place, or a
per-prescription reference such as the Rx reference number (`402-D2`): a documented limitation
mirroring the HL7 and X12 adapters. Each is kept and counted as an unexamined residual, never passed
through unrecorded.

The Scheduled Prescription ID Number (`454-EK`) and the Alternate ID (`330-CW`) are removed whole,
because no public payer sheet we read gives their length or picture: a profile that keeps other
identifiers as keyed surrogates cannot keep a surrogate of these. The Measurement Date (`494-ZE`)
rests on a single public payer sheet; we found no second one that lists it.

A Telecom message that carries more than one transaction is **refused** with a typed `DeidError`
carrying `DEID_FORMAT_UNSUPPORTED`, with no partial output. Split it and de-identify each transaction on
its own.

So is a transaction that carries more than one Patient (`01`) or Claim (`07`) segment. With no Group
Separator in front of it, a second patient's Patient and Claim segments decode as part of the one
transaction, and de-identifying them under the caller's one patient context would give two people one
date-shift offset. Send each patient's claim in its own transmission, with its own context.

[What the caller still owns](./what-the-caller-still-owns.md) lists the duties that stay with you
before you release the output, with a table of what this adapter does not cover.

## Reference

- [`deidentifyTelecom`](./api/@cosyte/deid/ncpdp.md#deidentifytelecom),
  [`deidentifyTelecomString`](./api/@cosyte/deid/ncpdp.md#deidentifytelecomstring) and
  [`TelecomDeidResult`](./api/@cosyte/deid/ncpdp.md#telecomdeidresult)
- [`TELECOM_LOCUS_MAP`](./api/@cosyte/deid/ncpdp.md#telecom_locus_map),
  [`TELECOM_FREE_TEXT_FIELDS`](./api/@cosyte/deid/ncpdp.md#telecom_free_text_fields) and
  [`TELECOM_RETAIN_SEGMENTS`](./api/@cosyte/deid/ncpdp.md#telecom_retain_segments),
  [`TELECOM_RETAIN_SEGMENT_REASONS`](./api/@cosyte/deid/ncpdp.md#telecom_retain_segment_reasons) and
  [`TELECOM_RETAINED_SEGMENT_RULES`](./api/@cosyte/deid/ncpdp.md#telecom_retained_segment_rules): the
  map this page describes
- [`NCPDP_SCRIPT_REFUSAL_MESSAGE`](./api/@cosyte/deid/ncpdp.md#ncpdp_script_refusal_message) and
  [`NCPDP_MULTI_TRANSACTION_REFUSAL_MESSAGE`](./api/@cosyte/deid/ncpdp.md#ncpdp_multi_transaction_refusal_message)
- [`DeidError`](./api/@cosyte/deid.md#deiderror) and
  [`FATAL_CODES`](./api/@cosyte/deid.md#fatal_codes)
