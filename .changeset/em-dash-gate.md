---
"@cosyte/deid": patch
---

The em dash is now gated: no tracked file, pull-request title, body or commit message here may carry
U+2014, and the text that already did has been rewritten.

The rule is a standing brand directive and it names commit messages explicitly, so a one-time sweep
would have regressed the first time somebody pasted a paragraph from somewhere else. Every sibling
package in this suite already carried the gate; this one did not, and its prose had accumulated
ninety-four occurrences across its guidance files, its narrative companion, its pointer checker and
two source doc comments. All ninety-four are gone, rewritten as plain hyphens. No exported symbol, no
signature, no policy decision and no de-identification behaviour changes: the diff is a checker, a
workflow, a test suite and prose.

TWO SCANS, KEPT SEPARATELY ADDRESSABLE ON PURPOSE. The tracked-file scan and the message scan run as
two jobs producing two check-run contexts, because they guard text with different trust profiles.
Nothing outside this repository can put a character into a tracked file, so a finding there is always
something an author here wrote and clearing it is always an edit inside this tree. A pull-request body
is different: a bot composes one by pasting upstream release notes, and no edit here prevents it. A
sibling shipped both halves as one job, found the message half noisy and exempted the whole job, which
un-protected the half that guards what a consumer reads. Splitting them at the start is what keeps any
future decision about the message half from reaching the other one.

WHAT IS OUT OF SCOPE IS OUT BY A RULE WITH ITS REASON, NEVER BY A PER-OCCURRENCE EXCEPTION. There is
no allow-list in this checker and no way to spend an exception on a single finding. Three rules, each
of which fails the run when the thing it names stops existing, so a stated scope cannot drift into a
hole: the vendored sibling tarballs, which are compressed bytes rather than text authored here and one
of which carries the banned sequence inside its compressed data by coincidence; byte-exact test
fixtures, whose contents are the subject the de-identification suites assert against, so that rewriting
one would change what a test claims to prove; and the frozen changelog archive below its divider, which
is pinned byte for byte by a digest in the test suite and has already been published inside shipped
tarballs. The narrowing there is the frozen archive and nothing else. Everything above the divider is
scanned, and so is every changeset, which is the source from which the generator writes that region, so
the character cannot enter it without this gate seeing it first in the file an author actually edits.

THE CHECKER PROVES IT CAN SEE BEFORE IT REPORTS. It self-tests on every run: that the pattern matches
the banned character as a single character, which is an encoding test as much as a pattern test, since
under a non-UTF-8 locale the same escape means something else and every tree reports clean; that it
matches no other member of the dash family, so widening the rule stays a decision somebody takes rather
than a side effect of editing a regular expression; and that the real scan path locates a seeded
occurrence at a known line of a known file and reports nothing on a clean one. A green from a detector
that was never shown able to fail is worth nothing.

The message half refuses rather than reporting clean when it cannot read the whole commit range, in
four shapes: no range given, a shallow clone, a commit absent from the clone, and a range resolving to
zero commits. That is the failure this half is most exposed to, because a shallow checkout is the
default and a shallow clone does not contain the base commit, so the enumeration returns nothing, which
is byte-for-byte what a clean pull request looks like. Pull-request text reaches the checker through the
environment and is written to a file before it is read, never interpolated into a command, so a title
full of shell metacharacters is scanned as the data it is.

Sixteen cases pin all of it, every failure preceded by an asserted pass so no red proves merely that a
fixture was broken: both directions of each exclusion rule, a missing archive divider, a stale
exclusion, the occurrence count against a line holding two, a genuinely shallow clone rather than a
simulated one, and a hostile title that is reported verbatim and executes nothing.

Two known limits, stated rather than discovered later. The corpus is the index, so a file is invisible
until it is staged and a clean local run over unstaged work proves nothing about what the build sees.
And no status is required by this change: adding one is a repository settings act with a precondition,
and requiring a context before its workflow has completed on the default branch leaves pull requests
pending rather than failing, which has cost this repository twice already.

One assertion elsewhere moved rather than disappearing. The narrative file's own top heading held one
of the occurrences, and the anchor-slug case built on it proved that a deleted glyph between two spaces
leaves both spaces behind as a double hyphen. Rewriting the heading would have retired that proof
silently, so the case was re-derived against the new heading, where a kept hyphen pair between two
spaces yields a run of four and pins the keep class as well, and the deleted-glyph shape was given a
case of its own using a marker glyph this repository actually leads its rules with.
