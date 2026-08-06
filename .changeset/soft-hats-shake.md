---
"@cosyte/deid": patch
---

The changelog shipped inside every tarball no longer describes its own contents as unreleased.
`CHANGELOG.md` is listed in `package.json`'s `files`, and its preamble promised that a first
pre-alpha release would ship the public API surface set out beneath it, in a package that had
already shipped that surface several versions earlier.

Releases now write the changelog themselves. `.changeset/config.json` set `"changelog": false` for
the whole of this package's published history, so no release ever wrote a version heading into the
file; it was maintained by hand under a single `[Unreleased]` heading that nothing ever rolled over.
It now names the default generator, so each release writes its own version heading and its own
entries, newest first, and a changeset summary is the entry a reader sees. Correcting the sentence
by hand was declined deliberately: that leaves the mechanism which wrote it, and it drifts again at
the next release.

The hand-written history is preserved verbatim beneath a `Released before this file was generated`
divider. Only the scaffolding for the workflow that no longer runs was dropped: the `[Unreleased]`
heading, its link definition at the foot of the file, and one empty section stub. No entry was
reworded, re-sorted or removed, and no version number was written into the file by hand.

No runtime code, public export, `DEID_*` code, policy, profile, manifest disposition or transformed
value changes.

What the new configuration depends on is pinned by tests that run the real `changeset version`
inside throwaway git repositories rather than against a string fixture. Exactly one line may sit
above generated output, because Changesets prepends a release by replacing the first newline, so the
asserted rule is that nothing but the H1 precedes the first heading, checked against a released
document as well as against this one. Version headings are compared whole, because `## 0.0.1` is a
substring of `## 0.0.10` and this package has already published past that pair. The release's
Prettier pass is left on, derived from this repository having no `.prettierignore` and a format
check that covers root markdown, with both arms measured: with the pass on the archived history
comes through byte identical and the released document passes that check; with it off the
generator's raw output is not canonical here. That value is not portable between packages and was
not copied from one.
