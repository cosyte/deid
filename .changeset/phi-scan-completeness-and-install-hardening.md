---
"@cosyte/deid": patch
---

The PHI scan now refuses a run that enumerated a target and never read it, which retires the one whole-file bypass this package shipped.

It was the last way a target could leave the corpus quietly. The enumeration produced it, the
whole-file bypass flag subtracted it, and the run then reported on what was left while spending an
exit code that is a claim about the whole invocation. A corpus whose only violator was the withdrawn
file printed `OK, no hits` and exited 0, which is a clean verdict about a file nothing had opened.

The rule keeps two ledgers: the enumeration, taken before the subtraction, and the set of paths the
scan actually opened. What is in the first and not the second refuses the run with the code that
means the scan could not be performed, in every mode and on both routes of the all-mode sweep. It
runs after the hits are reported, for the same reason every other refusal here does: a refusal must
not swallow a real hit, and the run carrying a withdrawal is exactly the run most likely to have
found something elsewhere. Exit codes 0, 1 and 2 keep their existing meanings.

The flag, the audit log and the rejection gate are all kept, so an attempt is recorded and refused
rather than silently honoured. The subtraction is kept as well, and is separately asserted: the
withdrawn file must still not be scanned, because a refusal is not permission to report the values
inside the file it refuses over. A withdrawal the run never enumerated withdraws nothing and so
refuses nothing, which is the honest answer rather than a hole, and a flag that could never subtract
anything is still rejected up front.

The consequence is that there is no whole-file escape left. The scanner's own test suite was the one
file exempted, because its positive cases are necessarily real-looking violators, and it is now swept
like every other module. Its fixture documents carry a substitution site at every identifying
position, which the scanner already reads as a hole rather than a value, and the two cross-cutting
floor shapes are assembled at run time from pieces that are not themselves the shape. Every case
still hands the scanner byte-identical content; only the module on disk changed.

Nothing was weakened to achieve that, and the cross-cutting floor specifically was not. Teaching that
floor to consult declared identifier tokens was available and was refused: such a declaration is
global and route-blind, so it would stop the shape being reported in every file and on every route,
in the package whose whole job is removing identifiers. A shape declared nowhere in the allow-list is
still a hard hit, and the suite asserts both that it reds and that no declaration was added to make
the suite pass.

Also in this release: the advisory override for the YAML parser moves to the extended range the
advisory now carries, with the lockfile regenerated to agree, and a `pnpm-workspace.yaml` declares a
publication cooldown and a no-downgrade trust policy. Both settings postdate the package manager
version this repository pins, so that file decorates rather than defends until the pin moves, and it
says so in its own words. It declares the repository root as its only package because the pinned
package manager refuses a settings-only file, so the set of packages resolved is unchanged.

Nine cases added, five of them red against the previous scanner and the rest controls on the
retirement: that no shipped invocation passes the flag, that the audit log records no entry, and that
the formerly exempted suite now scans clean on its own.
