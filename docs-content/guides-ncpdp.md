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
applies the configured policy, and returns the de-identified Telecom byte stream plus the core's
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

| Segment / locus                          | Handling                                                                                                       |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| **Patient (`01`)**                       | name (`CA`/`CB`) + phone (`CQ`) removed; street (`CM`) + city (`CN`) removed; ZIP (`CP`) → 3-digit; DOB (`C4`) → year; patient id (`CY`) **removed** under Safe Harbor; gender + state retained |
| **Insurance (`04`)**                     | cardholder id (`C2`) + group id (`C1`) **removed** under Safe Harbor; cardholder name (`CC`/`CD`) removed; person code retained |
| **Prescriber (`03`)**                    | prescriber id (`DB`) **removed**                                                                              |
| **Coordination of Benefits (`05`)**      | other-payer cardholder (`NU`) + group (`MJ`) ids **removed** under Safe Harbor; other-payer date (`E8`) → year |
| **Header**                               | Date of Service → year                                                                                        |
| **Free text** (`544-FY`, `504-F4`, `526-FQ`) | **fails closed**: blocked, never scrubbed by a naive pass                                                 |
| **Clinical / financial** (`07`/`08`/`10`/`11`/`12`/`13`) | **retained untouched**: NDC drug codes, quantities, days-supply, pricing, DUR reason codes           |
| Any **unmapped / unknown** segment       | **fails closed**: every field blocked                                                                        |

The X12 adapter **retains** provider identity, while this adapter **removes** the prescriber id: a
deliberate asymmetry.

## NCPDP SCRIPT is refused

NCPDP **SCRIPT** (ePrescribing XML) de-identification is **not** shipped in this release. The
`@cosyte/ncpdp` SCRIPT surface cannot be de-identified faithfully through its public API:
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

A retained clinical segment may carry a residual patient-related date the map does not surface (e.g. a
previous date of fill): a documented limitation mirroring the HL7 and X12 adapters; forgetting one fails
**safe** (retained, not leaked).

A Telecom message that carries more than one transaction is **refused** with a typed `DeidError`
carrying `DEID_FORMAT_UNSUPPORTED`, with no partial output. Split it and de-identify each transaction on
its own.

So is a transaction that carries more than one Patient (`01`) or Claim (`07`) segment. With no Group
Separator in front of it, a second patient's Patient and Claim segments decode as part of the one
transaction, and de-identifying them under the caller's one patient context would give two people one
date-shift offset. Send each patient's claim in its own transmission, with its own context.

## Reference

- [`deidentifyTelecom`](./api/@cosyte/deid/ncpdp.md#deidentifytelecom),
  [`deidentifyTelecomString`](./api/@cosyte/deid/ncpdp.md#deidentifytelecomstring) and
  [`TelecomDeidResult`](./api/@cosyte/deid/ncpdp.md#telecomdeidresult)
- [`TELECOM_LOCUS_MAP`](./api/@cosyte/deid/ncpdp.md#telecom_locus_map),
  [`TELECOM_FREE_TEXT_FIELDS`](./api/@cosyte/deid/ncpdp.md#telecom_free_text_fields) and
  [`TELECOM_RETAIN_SEGMENTS`](./api/@cosyte/deid/ncpdp.md#telecom_retain_segments): the map this page
  describes
- [`NCPDP_SCRIPT_REFUSAL_MESSAGE`](./api/@cosyte/deid/ncpdp.md#ncpdp_script_refusal_message) and
  [`NCPDP_MULTI_TRANSACTION_REFUSAL_MESSAGE`](./api/@cosyte/deid/ncpdp.md#ncpdp_multi_transaction_refusal_message)
- [`DeidError`](./api/@cosyte/deid.md#deiderror) and
  [`FATAL_CODES`](./api/@cosyte/deid.md#fatal_codes)
