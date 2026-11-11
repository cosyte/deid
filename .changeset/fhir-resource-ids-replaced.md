---
"@cosyte/deid": patch
---

FHIR resource ids, and the ids in fullUrls and references, are now replaced rather than passed through, with every reference still resolving inside the document.

This changes output bytes for every FHIR document that carries a resource `id`, a `Bundle.entry.fullUrl`, a `Reference.reference`, a `Bundle.entry.request.url` or a `Bundle.entry.response.location`. Before, each passed through verbatim and was counted only as an unexamined position; a server's id for a `Patient` is often the medical record number itself. Now the id is replaced and recorded at its own position under the medical record number category, and the same id gets the same replacement throughout one call:

- Under a policy that withholds that category (`redact` or `block`, the Safe Harbor default), the replacement is a stand-in: the id's sequence number among the distinct ids met in the call, counted from 1 in document order, never computed from the id. A UUID becomes `00000000-0000-4000-8000-` and the number in twelve hex digits, and an OID becomes `2.25.` and the number. The manifest records it with the new disposition code `DEID_IDENTIFIER_SUBSTITUTED`, not flagged as a re-identification code, and no key is needed.
- Under `pseudonymize` or `hash` (the limited data set preset pseudonymizes), the replacement is the keyed surrogate: for an id that is neither a UUID nor an OID, exactly what `registry.pseudonym(id)` returns under `pseudonymize`; for a UUID or an OID, the first 128 bits of that digest as a version 8 UUID or as a decimal under `2.25`. The same key gives the same surrogate in every call, so a corpus links. Each is flagged `reidentificationCode`, as a pseudonym is.
- Under any other transform the id is removed, with every literal that carries it.

The structure around an id is kept: the `#` of a contained reference, the resource type, the `urn:uuid:` or `urn:oid:` scheme, and the server base of an absolute URL whose base is the base of a `fullUrl` in the same input. A `/_history/vid` suffix is dropped. `#` alone and a resource type alone in a request url are kept. Removed and recorded as blocked: a literal whose type is not an R4 resource type, a search or conditional url, a relative, absolute or `#` id outside the R4 `id` alphabet (a `urn:uuid:` or `urn:oid:` tail is replaced whatever it holds), any other scheme, an empty or non-string value, an absolute reference to a server no `fullUrl` in the input names (every absolute reference in a single resource included), and a resource `id` held as an object or a list.

Not covered, and stated on the limitations page: the server base of a `fullUrl` is kept verbatim, and an id written in `meta.versionId`, `meta.source`, `Bundle.link.url`, an `Attachment.url`, any other uri, or an element's own `id` is still passed through and counted as unexamined.

`GenericLocus` gains an optional `referencedId`, which a caller building loci by hand can set to get the same replacement; `FhirEditKind` gains `"reference"`; `DEID_DISPOSITION_CODES` gains `DEID_IDENTIFIER_SUBSTITUTED`. A caller with an exhaustive switch over `FhirEditKind` or `DeidDispositionCode` adds the new case. A caller that joined a de-identified FHIR document back to its source by resource id, or that read the residual inventory for `fullUrl`, `id` or `reference` positions, now reads the manifest rows at those positions instead.
