---
id: guides-ncpdp
title: De-identifying NCPDP
sidebar_position: 9
---

# De-identifying NCPDP

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

## Quickstart

```ts
import { parseTelecom } from "@cosyte/ncpdp/telecom";
import { deidentifyTelecom, deidentifyTelecomString } from "@cosyte/deid/ncpdp";
import { createDeidContext } from "@cosyte/deid";

const context = createDeidContext({ key: process.env.DEID_KEY! });

const { telecom, manifest } = deidentifyTelecom(parseTelecom(raw), { context });
// or, parse + de-identify in one call:
const out = deidentifyTelecomString(raw, { context });

telecom; // the de-identified Telecom transaction
manifest; // value-free audit: category + locus + disposition, never a value
```

The built-in Safe Harbor policy uses **no keyed transform**, so a Safe Harbor pass over a transaction
needs no `context` at all. Under a preset that keeps consistent keyed surrogates instead, a `context`
is required and calling without one when the transaction needs it is a fatal `DEID_NO_KEY`.

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

**That is a behaviour, not a note.** Hand a SCRIPT document to either entry point and it is **refused**,
before anything is parsed:

```ts
import { deidentifyTelecomString } from "@cosyte/deid/ncpdp";
import { DeidError, FATAL_CODES } from "@cosyte/deid";

try {
  // An XML document on an NCPDP surface is SCRIPT, and it is declined outright.
  deidentifyTelecomString('<?xml version="1.0"?><Message><Body><NewRx/></Body></Message>');
} catch (err) {
  if (err instanceof DeidError && err.code === FATAL_CODES.DEID_FORMAT_UNSUPPORTED) {
    // err.message names SCRIPT and the parser-surface reason, and carries no document content.
  }
}
```

The error is a typed `DeidError` carrying `DEID_FORMAT_UNSUPPORTED`, and its message names the format
and states the parser-surface reason. It carries no byte of the document, and the call returns **no**
transformed document, **no** manifest and no partial output of any kind. A **Telecom** caller sees no
change: a parsed Telecom transaction is never a candidate for the refusal.

## Known limitation

A retained clinical segment may carry a residual patient-related date the map does not surface (e.g. a
previous date of fill): a documented limitation mirroring the HL7 and X12 adapters; forgetting one fails
**safe** (retained, not leaked).
