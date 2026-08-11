---
"@cosyte/deid": patch
---

The guidance pair is now gated: every anchor link from the project guide into its narrative companion
is checked, and a broken one fails the build.

This repository's guidance was split in two, a cursor file of rules and traps and a narrative file
holding the case behind each one, with the first citing the second by anchor throughout. That split
made the links load-bearing and nothing checked them. Three failures were silent: the narrative file
ceasing to be tracked, a section emptied down to its heading so a link resolves to nothing, and an
anchor edited on one side of the pair and not the other. The new check covers those three, on this
tree, and states in its own header that it covers nothing else.

It is named for what it checks and asserts no universal. The two-file split was applied widely, so
the tempting framing is that every repository owes this contract, and that framing is false: several
carry no narrative file at all, and for those the honest outcome is a written exemption rather than
an invented file. An overclaiming guard is worse than a narrow one, because it invites a reader to
trust a promise the tree does not keep. A claim about another repository is not checkable from inside
this one, and the check does not make one.

The matcher, the anchor space and the corpus partition were each derived by measuring this tree, and
none of the three was carried over from a sibling. Two link spellings are live across these packages,
a path-qualified one and a bare inline-code one, and which dominates is a property of the tree rather
than of the convention: elsewhere a qualified-only matcher would have reported everything resolving
while covering three links of thirty-eight, and in another it would have matched nothing at all and
still exited zero. Measured here with two independent tools before the matcher was written: the
qualified spelling is the only live one, the anchor space is heading slugs with no explicit anchor
tags and no headings inside comments, and every link resolved. None of those figures is written into
a comment, because a figure in prose goes stale unread. The check prints every count on every run.

Deciding to match one spelling only is safe exactly as long as the other stays absent, so the absence
is observed rather than assumed. Every file the check opens is censused for the bare shape on every
run, not just the pair, because a bare link in a third file would otherwise be seen by neither the
matcher nor the census. A span whose anchor is all decimal digits is a pull-request reference and is
counted and reported; anything else refuses the run outright and says to re-derive the matcher. The
same reasoning covers the anchor space: an explicit anchor tag in the narrative file refuses rather
than being ignored, because a package whose anchors are tags would have every link reported as
broken by a slug-only reading. Both convert a scoping decision into a measurement that can invalidate
itself.

The partition of readable files is UTF-8 decodability, not the presence of a NUL byte, and that is
the part a copied implementation gets wrong in silence. Three hand-written TypeScript sources here
embed NUL bytes as domain separators, so a NUL rule drops authored source out of both the matcher and
the census with nothing to notice; this package had already measured and rejected a binary-content
predicate elsewhere for the same reason. Git's own classification is a third, different set, calling
two of those three binary because its heuristic reads only the head of a file, so neither it nor an
end-of-line listing may be substituted in as a simplification. The count of files read despite
carrying a NUL byte is printed on the OK line, so a regression to the narrower rule appears as a
number rather than as silence.

Failure to observe is separated from failure to comply. Exit 1 means a finding a person acts on: a
missing file, an emptied section, a broken link. Exit 2 means the check could not honestly report,
and it is spent on an unreadable or non-regular path, a symlink, an unmerged path, an empty corpus,
an ambiguous narrative filename, a suspected bare link, an explicit anchor tag, an unterminated
comment, and on finding no qualified links at all, which on this tree cannot be a clean result. Every
tracked path is opened or skipped for a named reason and the two sets are reconciled before anything
is reported, because the likeliest failure of a checker is not a wrong answer but a right-looking one
over a corpus it never read.

Twelve cases pin it, each red preceded by an asserted green so that no failure proves merely that a
fixture was broken. Beyond those, it was run against a file copy of this tree with one real anchor
mutated: clean, then a failure naming the file, the line and the anchor, then clean again once the
file was restored. The heading record carries its anchor and its body range together, because a
control that binds those separately can print OK over an emptied section, having judged the anchor
unreferenced and the heading empty in two passes that each skipped it. The check reads every tracked
file with no exemption for its own source or its own tests, since an exemption there is exactly where
a broken link would hide, so every sample link and sample span in both files is assembled at runtime
rather than written out.

A heading inside an HTML comment renders no anchor, so it is suppressed rather than counted, the
suppressions are reported, and an unterminated comment refuses instead of swallowing the rest of the
file. Links are matched when spelled in ASCII bytes, which includes a UTF-7 document, since that
encoding permits a bare hash unescaped.

It runs from its own script, is reached by the aggregate check and by the test suite, and therefore
rides the existing required build context and the pre-publish ladder. No new workflow and no new
required status were added, because requiring a status before its workflow has run on the default
branch leaves pull requests pending rather than failing, which has cost this repository twice. The
project guide gained its entry within its existing byte budget, by relocating a duplicated toolchain
summary into the narrative file where the full version already lived.

Scope, stated rather than discovered: only the narrative file's basename is compared, so relocating
it to another directory while the links keep their old prefix passes while every rendered link
breaks; a file that is not valid UTF-8 is skipped whole and the skip is counted; a link at any other
file's anchor is out of scope; and a section with a body is not a section with the right body, which
stays a human judgement.
