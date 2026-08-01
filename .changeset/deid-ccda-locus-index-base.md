---
"@cosyte/deid": patch
---

Two C-CDA positions that print the same manifest path used to arrive as one row with a count of two, so section narratives could not be told apart in the audit artifact.

A C-CDA locus is a `/`-joined path of element names, and the manifest aggregates entries agreeing on
all five of locus, category, transform, disposition and code — which two narratives blocked the same
way always do. The body narrative descent printed no sibling index at all, so every same-named
sibling below it printed one path. On the two-section fixture shipped with this package, both section
narratives — Results and Medications — arrived as one entry,
`component/structuredBody/component/section/text`, with `count: 2`. Both narratives were blocked, and
no dose, allergy, code system or patient identifier was mis-read; what was lost was the manifest's
ability to say _which_ narratives it had blocked. A `structuredBody` is a run of same-named
`<component>`s and a `<section>` a run of same-named `<entry>`s, so this was the ordinary shape of the
descent rather than an edge case.

The header sweep already indexed same-named siblings, which is what made this worth fixing rather
than describing: a defect sitting beside a handled neighbour reads as handled.

**One rule now, for both descents.** A path segment is the element's bounded local name, plus `[n]` —
its index among its _document_ siblings that print the same segment name — emitted when more than one
sibling prints that name, and always when the name was refused. The two descents previously used
different, undocumented bases (same-named siblings in the header, all children in the body), so a
manifest could show `<withheld>[1]` and `<withheld>[3]` with nothing between them.
`docs-content/guides-ccda.md` now states the rule and its scope.

**The index is a document position, not a row number.** A sibling that yields no locus contributes no
manifest row — an empty `<text>`, an `<entry>` whose narrative is a `<reference value="#…"/>` into the
section rather than character data, a `nullFlavor`-only `<id>` — and the surviving rows keep their
document indices, so a manifest can show `component[2]` with no `component[0]` or `component[1]`.
That means those siblings had nothing to record, not that rows are missing; it is not a counter you
can re-derive from a manifest alone, and the guide says to count the rows rather than the indices.

**A second collision, measured.** The header counter keyed its bucket on `namespaceURI|name`, a
distinction a path never prints: two refused siblings in _different_ namespaces each counted as the
only one of its kind, both printed a bare `<withheld>`, and aggregated into one row. Reproduced with a
`urn:hl7-org:v3` and a `urn:hl7-org:sdtc` sibling under one `<patient>`. The counter now keys on the
printed name. A lone refused segment also carries its index now, where it previously printed a bare
`<withheld>`: the token names nothing, so the index is the only "where" that position has left.

**What changes for a manifest you already hold.** C-CDA loci only; the other five adapters do not
share this code and are untouched. A path changes only where more than one sibling prints the same
segment name, or a name was refused — every other path is byte-identical. Measured on the shipped
fixture: the transformed document is byte-for-byte unchanged and exactly one manifest row becomes
two. Surrogates and date-shift offsets derive from the value and the key, never from a path, so no
pseudonym moved. The one place this is more than cosmetic is a consumer routing a bring-your-own
free-text redactor on an exact C-CDA narrative path, since `FreeTextRedactRequest.locus` carries the
same path.

**Nothing about what is de-identified moved.** Every scrub decision dispatches on the raw local name
and namespace, never on the printed segment, so a refused or re-indexed segment degrades an audit
label and changes no transform.

**Stated as a scope, not a guarantee that every position is now distinct.** Some segments are fixed
strings rather than element names — `structuredBody`, `nonXMLBody/text`, and an interval's `low` /
`high` / `center` bounds. CDA allows each at most once at its position; a document that repeats one
anyway still prints one path for both, exactly as before.
