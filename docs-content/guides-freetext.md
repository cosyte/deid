---
id: guides-freetext
title: Redact free text with your own detector
sidebar_label: Free text
description: "Free text is blocked by default; bring your own redactor to transform it, and see what the library does and does not check."
---

# Redact free text with your own detector

Structured PHI is tractable: the parser tells the engine exactly where a name, a date, or an MRN lives,
and the adapter removes or transforms it. **Free text is different.** Narrative loci (C-CDA narrative
`<text>`, HL7 `OBX-5` / `NTE`, FHIR `note` / `div`, X12 `MSG` / `NTE`, NCPDP free text) can carry any
of the 18 Safe Harbor categories in prose, and there is no structural handle on where the PHI is.

`@cosyte/deid` treats free text as an honestly-hard problem and does **two** things with it.

## 1. The default is fail-closed (block)

With no redactor supplied, every free-text locus is **blocked**: its value is withheld, never emitted.
This is the safe baseline: a de-identifier that guessed at prose would create the _impression_ of safety
while missing PHI it did not recognize.

```ts runnable
import { deidentify, DEID_DISPOSITION_CODES, SAFE_HARBOR_CATEGORIES } from "@cosyte/deid";

const result = deidentify(
  {
    loci: [
      {
        path: "OBX-5",
        kind: "freetext",
        category: SAFE_HARBOR_CATEGORIES.OTHER_UNIQUE_ID,
        value: "narrative with a name in it",
      },
    ],
  },
  {},
);

result.document.loci[0]?.value; // => null
result.manifest[0]?.code === DEID_DISPOSITION_CODES.DEID_FREETEXT_BLOCKED; // => true
```

> **The library bundles no PHI detector.** It ships **no** NLP model and **no** built-in regex scrub: a
> naive regex pass over clinical prose is a false-safety hazard. If you want free text redacted rather
> than blocked, you bring the detector (below).

## 2. Bring your own redactor (BYO)

Supply a `redactor`, a function wrapping your own regex/pattern engine or clinical-NER de-id model, and
the engine invokes it at each free-text locus, writing its output back **in place** instead of blocking.
This mirrors the parsers' BYO posture (the terminology adapter, the profile system): the library provides
the interface and the orchestration; you provide the detector.

```ts runnable
import { deidentify, DEID_DISPOSITION_CODES, type FreeTextRedactor } from "@cosyte/deid";

// Your detector. This toy example uses a pattern; a real one would be a clinical-NER pipeline.
const redactor: FreeTextRedactor = ({ text }) => ({
  text: text.replace(/\bJohn Doe\b/g, "[NAME]"),
});

const result = deidentify(
  { loci: [{ path: "NTE-3", kind: "freetext", value: "seen by John Doe today" }] },
  { redactor },
);

result.document.loci[0]?.value; // => "seen by [NAME] today"
result.manifest[0]?.code === DEID_DISPOSITION_CODES.DEID_FREETEXT_CONSUMER_REDACTED; // => true
```

The manifest records a BYO-redacted locus with the `byo-redact` transform and the
`DEID_FREETEXT_CONSUMER_REDACTED` disposition code, so the audit shows plainly that the free text was
cleared by a **consumer-supplied** redactor, not by the library.

## The fail-closed contract (what the library enforces)

Whatever redactor you plug in, the engine still fails **closed** on any failure: a redactor is never
allowed to leak free text through:

- **No redactor** → the locus is blocked.
- **The redactor throws** → the locus is blocked (the free text is not passed through).
- **The redactor returns nothing** (`null` / `undefined`, or a result without a string `text`) → blocked.
- **The redactor returns `{ text }`** → that prose is written back in place.

```ts runnable
import { deidentify, DEID_DISPOSITION_CODES, type FreeTextRedactor } from "@cosyte/deid";

const flaky: FreeTextRedactor = () => {
  throw new Error("detector unavailable");
};

const result = deidentify(
  { loci: [{ path: "OBX-5", kind: "freetext", value: "prose that must not leak" }] },
  { redactor: flaky },
);

result.document.loci[0]?.value; // => null
result.manifest[0]?.code === DEID_DISPOSITION_CODES.DEID_FREETEXT_BLOCKED; // => true
```

## The honesty boundary (what the library does not check)

When your redactor returns `{ text }`, the engine trusts it as **consumer-asserted**. It does **not**
re-scan the returned prose for residual PHI, and it does **not** treat a redactor's "no findings"
(returning the text unchanged) as an attestation. **A BYO redactor's completeness is your
responsibility**: this is Expert-Determination territory, not a mechanical Safe Harbor guarantee.

Two things are unchanged no matter what the redactor does:

- **The structural PHI removal the format adapters perform is untouched.** The redactor handles the free
  _prose_ only; a name in `PID-5`, an MRN in a FHIR `Identifier`, a DOB in `DMG` are still located and
  transformed by the adapter exactly as before.
- **The clinical over-scrub guard is untouched.** A structured clinical value (a lab result, a coded
  observation, a status) is still retained byte-identical: the redactor never sees it.

The library's promise stays narrow and honest: a **fail-closed** free-text default, an **orchestrated**
BYO redaction path whose completeness is the consumer's, and a **value-free manifest** that records which
path each locus took, never the value.

## Reference

- [`FreeTextRedactor`](./api/@cosyte/deid.md#freetextredactor),
  [`FreeTextRedactionRequest`](./api/@cosyte/deid.md#freetextredactionrequest) and
  [`FreeTextRedactionResult`](./api/@cosyte/deid.md#freetextredactionresult)
- [`deidentify`](./api/@cosyte/deid.md#deidentify) and
  [`DeidOptions`](./api/@cosyte/deid.md#deidoptions): the `redactor` option
- [`DEID_DISPOSITION_CODES`](./api/@cosyte/deid.md#deid_disposition_codes)
- [Codes and categories](./codes-and-categories.md#disposition-codes): `DEID_FREETEXT_BLOCKED` and
  `DEID_FREETEXT_CONSUMER_REDACTED`
