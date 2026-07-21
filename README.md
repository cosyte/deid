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
> core** plus three format bindings — the **HL7 v2 adapter** (`@cosyte/deid/hl7`), the **C-CDA adapter**
> (`@cosyte/deid/ccda`), and the **FHIR R4 adapter** (`@cosyte/deid/fhir`). The remaining per-format
> adapters (X12, NCPDP, DICOM) land in subsequent phases.

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

## De-identify a C-CDA document

The `@cosyte/deid/ccda` adapter locates PHI **structurally** in a parsed [`@cosyte/ccda`](https://github.com/cosyte/ccda)
document — a `<name>` under `recordTarget/patientRole/patient` is the patient's name because the CDA
standard says so — and returns a transformed `CcdaDocument` plus the value-free manifest. `@cosyte/ccda`
is an **optional peer dependency**; the adapter reaches the CDA DOM only through its hardened
`parseSecureXml` and re-serializes the node it hands back, so the core stays third-party-dependency-free.

```bash
npm install @cosyte/deid @cosyte/ccda
```

```ts
import { parseCcda } from "@cosyte/ccda";
import { deidentifyCcda } from "@cosyte/deid/ccda";
import { createDeidContext } from "@cosyte/deid";

const context = createDeidContext({ key: process.env.DEID_KEY! });
const { document, manifest } = deidentifyCcda(parseCcda(xml), { context });

document.toString(); // spec-clean, de-identified C-CDA XML
// recordTarget/guardian/author/informant/custodian names, telecom, ids, addresses, birthTime, and
// participation/encounter dates → transformed; section narrative <text> and unknown elements fail
// closed. Coded clinical entries — codes, values, units, statuses, dosing periods — survive untouched.
```

**What it covers.** The structured PHI loci of the CDA **header participations** — `recordTarget`
(patient) + nested `guardian`, and `author` / `dataEnterer` / `informant` / `authenticator` /
`legalAuthenticator` / `participant` / `custodian` / `documentationOf` / `componentOf` (relatives /
providers / contacts). Person `<name>` / `<telecom>` removed; person-role `<id>` pseudonymized (SSN-rooted
id removed, assigning root retained); `<addr>` reduced to the safe 3-digit ZIP; `<birthTime>` and
participation / encounter dates generalized to year. **Fail closed** everywhere else: section narrative
`<text>` blocks and the unstructured `nonXMLBody` are blocked; a value-bearing element that is neither
mapped PHI nor recognized coded structure is blocked; foreign / `sdtc` elements are blocked. The clinical
`structuredBody` entries are **retained untouched** (the over-scrub guard) — a `<name>` there is a drug
or material name, not a person.

**Known limitations (this release).** Narrative is block-only (no scrub); within the **retained**
clinical body, entry service _dates_, entry _ids_, in-entry _performer_ names, and _family-history_
relative demographics are a deferred later phase (mirroring the HL7 adapter's boundary); the document
`id`/`code`/`title` envelope is retained (like HL7's MSH).

## De-identify a FHIR R4 resource

The `@cosyte/deid/fhir` adapter locates PHI **structurally** in a parsed [`@cosyte/fhir`](https://github.com/cosyte/fhir)
resource — a `name` under a `Patient` is the patient's name because FHIR says so — and returns a
transformed resource model plus the value-free manifest. `@cosyte/fhir` is an **optional peer
dependency**; the adapter reaches FHIR data only through its exported model and `parseResource` /
`serializeResource` codec, so the core stays third-party-dependency-free.

```bash
npm install @cosyte/deid @cosyte/fhir
```

```ts
import { parseResource, serializeResource } from "@cosyte/fhir";
import { deidentifyFhir } from "@cosyte/deid/fhir";
import { createDeidContext } from "@cosyte/deid";

const context = createDeidContext({ key: process.env.DEID_KEY! });
const { resource } = parseResource(json);
const { document, manifest } = deidentifyFhir(resource, { context });

serializeResource(document); // spec-clean, de-identified FHIR JSON
// Patient/RelatedPerson/Practitioner/Person names, telecom, photo → removed; address → safe 3-digit ZIP;
// birthDate + every date → year; identifiers pseudonymized by system (a US-SSN identifier removed).
// Narrative text.div, extension values, and Reference.display fail closed; contained resources and
// Bundle entries are walked. Clinical resources — Observation values, codes, units, statuses — survive.
```

FHIR is a **graph of typed resources**, so the map splits by role:

| Scope                                                                                                     | Loci                                                                               | Transform                                                                                                                                  |
| --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| **Person resources** (`Patient` / `RelatedPerson` / `Practitioner` / `Person` + nested `Patient.contact`) | `name`, `telecom`, `photo`, `address`, `birthDate`, dates                          | name/telecom/photo **removed**; `address` → safe **3-digit ZIP** (or `000`); dates → **year**                                              |
| **Every resource (universal PHI vectors)**                                                                | `identifier`, dates, narrative `text.div`, `extension` values, `Reference.display` | identifier → **surrogate** by `system` (US-SSN **removed**); dates → **year**; narrative / extension values / reference labels **blocked** |
| **Clinical resources** (`Observation`, `Condition`, …)                                                    | codes, values, units, statuses, reference wiring                                   | **retained untouched** (the over-scrub guard)                                                                                              |

A `Reference.display` (a person label) is blocked; a `Coding.display` (a coded term like `Sodium`) is
retained — the two are told apart structurally. Contained resources and `Bundle` entries are walked, with
each resource's role re-derived at its own `resourceType`.

**Fail closed** governs the person sweep and the frontier: a bare unrecognized string at a person
resource's top level is blocked (an allow-list can never satisfy Safe Harbor category (R)); a `display`
that is not on a `Coding` is treated as a Reference person-label and blocked — including a display-only
(`{ display }`) or type+display reference that names no target; every extension value — a complex
`valueAddress` / `valueHumanName`, a `modifierExtension`, a nested extension, or a primitive-level
`_`-sibling extension — is dropped; and free-text loci (`note` Annotations, `contentString`, an uncoded
`valueString`) are blocked (the FHIR analogue of the HL7 adapter's OBX-5-`ST` / NTE fail-closed default).

**Known limitations (this release).** Extension values are block-only (no profile-aware retention — a
`us-core-*` demographic extension is dropped, deferred to a later policy-profiles phase). Reference
_wiring_ (`Reference.reference` pointers, resource logical `id`s) is preserved structurally; coordinated
pseudonymization of resource ids across a corpus is the longitudinal phase. Free-text **prose** loci
(`note`, `contentString`, uncoded `valueString`) fail closed by default; a semantic (NLP) narrative
scrub, `contentAttachment` binary content, and person names embedded in non-person resources
(`Organization.contact.name`, `Location.address`) remain out of scope for this release.

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
