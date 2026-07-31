---
"@cosyte/deid": patch
---

The README now opens with the Cosyte brand lockup, which follows the reader's light or dark theme.

The image is served as a `<picture>` with a light and a dark source, and carries alt text describing
the mark so it still reads for anyone with images off or a screen reader on.

The opening summary also no longer claims the package is absent from npm. It said "not yet published
to npm" on the page npm itself renders, directly under the version in npm's own header, so the page
contradicted itself and a reader had no way to tell which half was true. It now says the package is
published and names no version, leaving the registry as the one source of that fact.

Nothing else on the page moved: the title, the honesty line and every code sample are unchanged, and
no API, `DEID_*` code, policy, manifest disposition or transformed value differs.
