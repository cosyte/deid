---
id: guides-ncpdp
title: De-identifying NCPDP
sidebar_position: 9
---

# De-identifying NCPDP

The `@cosyte/deid/ncpdp` adapter is the NCPDP **Telecommunication (vD.0)** binding of the
de-identification core. It locates PHI **structurally** in a parsed Telecom transaction — a value is the
patient's last name because it sits in field `311-CB`, never because a string "looked like" a name —
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

A keyed transform (patient / cardholder / group id pseudonymization) requires a `context`; calling
without one when the transaction needs it is a fatal `DEID_NO_KEY`.

## What is located, and how it is transformed

Telecom is a flat sequence of segments of `{ id, value }` fields. Field ids are globally unique in the
standard, so the map keys off the field id directly.

| Segment / locus                          | Handling                                                                                                       |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| **Patient (`01`)**                       | name (`CA`/`CB`) + phone (`CQ`) removed; street (`CM`) + city (`CN`) removed; ZIP (`CP`) → 3-digit; DOB (`C4`) → year; patient id (`CY`) **pseudonymized**; gender + state retained |
| **Insurance (`04`)**                     | cardholder id (`C2`) + group id (`C1`) **pseudonymized**; cardholder name (`CC`/`CD`) removed; person code retained |
| **Prescriber (`03`)**                    | prescriber id (`DB`) **removed** (the roadmap scopes prescriber identifiers for NCPDP)                          |
| **Coordination of Benefits (`05`)**      | other-payer cardholder (`NU`) + group (`MJ`) ids **pseudonymized**; other-payer date (`E8`) → year             |
| **Header**                               | Date of Service → year                                                                                        |
| **Free text** (`544-FY`, `504-F4`)       | **fails closed** — blocked, never scrubbed by a naive pass                                                     |
| **Clinical / financial** (`07`/`08`/`10`/`11`/`12`/`13`) | **retained untouched** — NDC drug codes, quantities, days-supply, pricing, DUR reason codes           |
| Any **unmapped / unknown** segment       | **fails closed** — every field blocked                                                                        |

The X12 adapter **retains** provider identity, while this adapter **removes** the prescriber id — a
deliberate asymmetry: the roadmap scopes prescriber identifiers for NCPDP but leaves X12 provider identity
in place.

## NCPDP SCRIPT is deferred

NCPDP **SCRIPT** (ePrescribing XML) de-identification is **not** shipped in this release. The
`@cosyte/ncpdp` SCRIPT surface cannot be de-identified faithfully through its public API:
`serializeScript` emits only the **modeled** fields (a `parse → serialize` round-trip drops any unmodeled
XML element), and the SCRIPT `Patient` model has **no address, phone, or patient-id** field. A partial
pass would silently drop content and leave unmodeled patient identifiers unhandled — a false-safety
hazard the fail-closed posture forbids. SCRIPT support waits for a parser surface that preserves the full
document.

## Known limitation

A retained clinical segment may carry a residual patient-related date the map does not surface (e.g. a
previous date of fill) — a documented limitation mirroring the HL7 and X12 adapters; forgetting one fails
**safe** (retained, not leaked).
