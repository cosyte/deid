# @cosyte/deid

> Healthcare **de-identification** for Node.js and TypeScript — a HIPAA-grounded policy engine that
> **fails closed** and emits a **value-free manifest**.

`@cosyte/deid` applies a de-identification **policy** (HIPAA Safe Harbor by default) to a
structurally-located model of a healthcare document and returns a transformed model plus a value-free
audit of everything it acted on. It is a **consumer** of the `@cosyte/*` parsers, not a parser sibling:
it borrows the archetype's disciplines (typed diagnostics, immutable output, a policy/profile system)
but **inverts the reflex** — where a parser is liberal on input, a de-identifier is conservative and
**fails closed**. Third-party runtime dependencies: **zero** (every primitive is `node:crypto`).

> **The honesty line.** Results are **"Safe-Harbor-transformed per the configured policy"** — never
> "de-identified" and never "HIPAA-compliant". Safe Harbor is implemented mechanically; the
> actual-knowledge condition (§164.514(b)(2)(ii)) is the consumer's; **Expert Determination
> (§164.514(b)(1)) is supported by later phases, never rendered or certified.** The certification is
> always the consumer's.

> **Status:** pre-alpha (`0.0.x`), not yet published to npm. This release ships the **format-agnostic
> core** — the policy engine, the five transforms, the 18-category Safe Harbor model, the fail-closed
> rule, and the value-free manifest, tested against a generic locus model. Per-format adapters
> (HL7 v2, C-CDA, FHIR, X12, NCPDP, DICOM) land in subsequent phases.

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
// document.loci[2].value === "5.4 mmol/L" (clinical value retained — the over-scrub guard)
// manifest records each category + locus + disposition, never a value.
```

## Keyed transforms

Pseudonymization and keyed hashing use a **keyed HMAC-SHA-256**; the key is the consumer's and never
leaves the process:

```ts
import { deidentify, createDeidContext, SAFE_HARBOR_CATEGORIES } from "@cosyte/deid";

const context = createDeidContext({ key: process.env.DEID_KEY!, patientId: "patient-1" });
deidentify(
  {
    loci: [{ path: "PID-3", kind: "identifier", category: SAFE_HARBOR_CATEGORIES.MRN, value: mrn }],
  },
  { context },
);
// The MRN becomes a consistent, non-reversible surrogate; the key never appears in the output or manifest.
```

## The design in five pieces

- **Policy engine** — `safe-harbor` built in; `defineDeidPolicy()` to deviate deliberately.
- **Five transforms** — redact, generalize (date→year, ZIP→3-digit/`000`, age→`90+`), keyed date-shift,
  keyed-HMAC pseudonymize, keyed hash.
- **18 Safe Harbor categories** — §164.514(b)(2)(i)(A)–(R), including the open-ended catch-all (R).
- **Fail-closed rule** — anything uncertain is blocked, never passed through; clinical values are
  retained untouched.
- **Value-free manifest** — category + transform + locus + count + disposition + code, never a value,
  never the key, never the date-shift offset.

## License

MIT © Cosyte
