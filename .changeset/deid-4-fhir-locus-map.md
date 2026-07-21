---
"@cosyte/deid": patch
---

DEID-4 — the FHIR R4 de-identification adapter (`@cosyte/deid/fhir`): the FHIR binding of the core. It
locates PHI structurally in a parsed `@cosyte/fhir` resource, reaching data only through the parser's
exported generic model (`FhirComplex`/`FhirList`/`FhirPrimitive`, `getProperty`, `resourceType`, the node
constructors) and its `parseResource`/`serializeResource` codec — never a direct third-party import, so
third-party runtime deps stay zero. The immutable model is rebuilt into a fresh tree; the input is never
mutated. The locus map splits by resource role: person resources (`Patient`/`RelatedPerson`/`Practitioner`
/`Person` + nested `Patient.contact`) have `name`/`telecom`/`photo` removed, `address` reduced to the safe
3-digit ZIP, and dates generalized to year; the universal PHI vectors on every resource — `identifier`
(pseudonymized by `system`, a US-SSN system removed), PHI-bearing dates (year), the narrative `text.div`,
`extension`/`modifierExtension` values, and `Reference.display` — are handled regardless of resource type;
contained resources and `Bundle` entries are walked, re-deriving each resource's role at its own
`resourceType`. Fail closed on the frontier: a bare unrecognized string at a person resource top level is
blocked; a `display` that is not on a `Coding` is a Reference person-label and is blocked (including a
display-only or type+display reference that names no target), while a `Coding.display` coded term is
retained; every extension value (including a complex `valueAddress`/`valueHumanName`, a nested extension,
and a primitive-level `_`-sibling extension) is dropped; and free-text prose (`note` Annotations,
`contentString`, an uncoded `valueString`) is blocked, the FHIR analogue of the HL7 adapter's OBX-5-`ST`
default. Clinical resources (`Observation` values, codes, units,
statuses, reference ranges) are retained untouched — the over-scrub guard — and reference wiring
(`Reference.reference` pointers) is preserved. `@cosyte/fhir` is an optional peer dependency consumed only
from the `/fhir` subpath (vendored as a packed tarball for dev/test, the `mllp`→`hl7` pattern). Leak-test
and over-scrub-test gates ship as tests, plus a fail-safe property that arbitrary tokens never leak into
the output or the manifest.
