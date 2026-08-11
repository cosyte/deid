---
"@cosyte/deid": patch
---

The PHI scan now reads the bytes git carries, as a union with its working-tree walk.

The all-mode sweep walked three declared roots off the working tree, which is a claim that depends on
the working tree being honest and on the corpus sitting where the roots point. Five states were
reproduced on the previous commit, each printing `[phi-scan] OK, no hits` at exit 0 over a synthetic
HL7 message carrying a patient name, a birthdate, an MRN and a dashed SSN: decoy content at a tracked
path, whose committed bytes carry the payload and whose working-tree bytes are clean; a tracked path
outside every root, of which 25 non-markdown ones exist here and no route had ever opened one; a root
emptied or deleted from the working tree with its files still tracked, which for this package meant
deleting all three left the sweep reporting clean over the entire corpus; a tracked symlink or
gitlink outside every root; and an empty index, against which the route has nothing to read. All five
now report or refuse.

It is a union, never a replacement. No root was narrowed, no clause dropped, and a file the walk
reads is still read off disk with exactly the two views it had, so this route only ever adds bytes. A
blob whose bytes the walk provably already scanned is skipped by byte comparison, so nothing is
reported twice. The skip is deliberately not a stat, an mtime or a hash, because those are what a
decoy defeats, and line endings are deliberately not normalized before it: that compares a derived
form, and a decoy differing only in what the normalizer erases would then be skipped.

The mechanism is written down in exactly one place, at `buildTargetsForIndex`; every other surface
states only the consumer-facing property. Every refusal runs after the walk has been scanned, because
a refusal must not swallow a real hit: refused first, the run would be strictly worse than before for
one input, exit 1 naming every locus becoming exit 2 naming nothing. The exit code is still 2, since
an incomplete sweep is not a verdict whatever it found on the way. Exit codes 0, 1 and 2 are
otherwise unchanged, and `--staged` is deliberately untouched: it is this package's pre-commit hook,
so its scope decides what a commit is blocked on, which is a hook decision and not a rider on this.

`vendor/` is excluded from the new route as a literal path rather than a predicate, honouring a scope
declaration this scanner already carried. Those six entries are third-party packed tarballs; they are
gzip, so their text is compressed and no detector here can read it without decompressing an archive.
With the exclusion removed the sweep reports 45 hits across all six and exits 1, being 44 spurious
pharmacy-claim field tokens and one spurious email address, because the detector that splits on the
0x1C/0x1D/0x1E control bytes finds them throughout compressed data. A binary-content predicate was
measured and rejected instead: two hand-written TypeScript sources here embed NUL bytes as HMAC
domain separators, so git's own heuristic calls them binary and a predicate would have dropped them
out of the very decoy defence this adds. The `.md` and `vendor/` rules are both applied last, after
the mode refusals, so naming a symlink `vendor/x.tgz` or `x.md` cannot buy it a pass: git carries a
link's target path, which is itself an identifier surface.

One floor hit surfaced, and it is not patient data: the package manifest's `author` field carries a
company mailbox at our own domain, registry metadata that already ships in every published tarball.
It is declared in the allow-list rather than narrowing the sweep back to where it could not see the
file, and the cost is stated with it, because such a declaration is global and route-blind. A
positive control puts that manifest at the same out-of-root path in a throwaway tree and strikes the
declaration, so the same corpus reds at exit 1: the green is earned by the declaration rather than by
the file never being opened. The address is deliberately not written out in the allow-list's own
comment, which sits inside a scan root; an earlier draft that spelled it out made that file red too,
and a control that reds on two files cannot tell which one it read.

20 cases added, 15 of them red against the previous scanner and the other five negative controls on
the union and exclusion boundaries. The suite's throwaway-repository helper now commits its baseline,
because an empty index refuses.
