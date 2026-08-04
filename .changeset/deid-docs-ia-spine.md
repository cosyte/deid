---
"@cosyte/deid": patch
---

The documentation sidebar now follows the canonical navigation spine, with Known Limitations filed under Troubleshooting instead of its own top-level section.

`docs-content/sidebars.json` declared a top-level category **"Limitations & Honesty"**, which is not
on the IA spine every `@cosyte/*` package conforms to (`Overview`, `Installation`, `Quickstart`,
`Core Concepts`, `Guides`, `API Reference`, `Troubleshooting`). `docs`' IA-conformance gate grades a
non-canonical top-level label as `IA040`, promoted from warning to error under the strict default, and
that gate runs inside the deploy build for `docs.cosyte.com`. The gate reads the sidebar bytes out of
the released `docs-content.tar.gz`, and releases are immutable, so only a new release clears it.

**What this release does and does not restore.** This sidebar only entered the gate's subject set
when the docs consumer tier went live on 2026-08-03; before that this package was disabled there and
skipped outright. It is one of three strict findings across two packages' current releases, the other
two being on `@cosyte/cli`, so clearing this one is necessary and not sufficient.

**This is a relabelling, not a removal.** The `limitations` page ships unchanged and in full; it is
now the second item under **Troubleshooting**, whose own page already opens with the heading
"Troubleshooting & Known Limitations", and which the IA standard explicitly designates as the home
for _Known Limitations_ when a package surfaces them. Nothing the package says about what it does not guarantee
has been softened, shortened or dropped: `@cosyte/deid` transforms and evidences, and never certifies
HIPAA de-identification.

The top-level navigation is now `Overview` (the `intro` doc) plus `Installation`, `Quickstart`,
`Core Concepts`, `Guides` and `Troubleshooting`, in canonical order, with `API Reference` left to the
resolver as required.

Also corrects the status banner on the `Installation` and `Overview` pages, which told readers the
package was "not yet published to npm" and that `npm install @cosyte/deid` was only "the shape it will
take at first publish". It has been on the registry for several versions. No version number is written
into either page.

No runtime code, public export, `DEID_*` code, policy, profile, manifest disposition or transformed
value changes.
