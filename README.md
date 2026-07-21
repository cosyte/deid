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
> core** plus the first format binding — the **HL7 v2 adapter** (`@cosyte/deid/hl7`). The remaining
> per-format adapters (C-CDA, FHIR, X12, NCPDP, DICOM) land in subsequent phases.

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

## De-identify an HL7 v2 message

The `@cosyte/deid/hl7` adapter locates PHI **structurally** in the parsed [`@cosyte/hl7`](https://github.com/cosyte/hl7)
model — never by regex over the raw bytes — and returns a transformed `Hl7Message` plus the value-free
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
// PID-5 (name), NK1/GT1/IN1/IN2 relatives, SSN, phone → removed; MRN/account → consistent surrogate;
// DOB → year; address → safe 3-digit ZIP. OBX-5/NTE free text and Z-segments fail closed (blocked).
// Structured clinical OBX values, units, codes, and statuses survive untouched.
```

**What it covers.** The structured PHI loci of **PID** (patient) and **NK1 / GT1 / IN1 / IN2**
(relatives / guarantor / insured), typed by the `@cosyte/hl7` model. **Fail closed** everywhere else: a
recognized segment is retained **only** if it is on an explicit clinical/administrative retain-list —
so a known patient-identity segment absent from the map (e.g. **MRG** prior name + MRN on a merge, **FAM**,
**ACC**) is blocked, never passed through — and Z-segments / structure unknown to the parser are blocked.
**OBX-5** is retained only when OBX-2 positively types it as a structured clinical value (numeric /
coded / date); narrative (`TX`/`FT`), ambiguous String (`ST`), and any empty/unknown OBX-2 fail closed,
as do **NTE-3** comments. Structured clinical values, units, codes, and statuses survive untouched.

**Known limitations (this release).** Free text is block-only (no scrub); within **retained** clinical /
visit segments, patient-related _dates_ (OBR/DG1/PV1 timestamps), _visit identifiers_ (PV1-19), and
_provider_ names (PV1-7/8, OBR-16) are a deferred later phase; the address generalization keeps only the
Safe Harbor 3-digit ZIP.

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
