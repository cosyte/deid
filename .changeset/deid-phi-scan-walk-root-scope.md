---
"@cosyte/deid": patch
---

Widen the repository's PHI commit gate to sweep all of `test/` and `scripts/` — internal development
tooling, with no runtime impact on the published package.

Its exit codes are corrected in the same change. `PHI-SCAN-WALK-ROOT-SCOPE`. The walk covered `test/fixtures/` plus `src/`, and `--staged` covered
`test/fixtures/**` plus `src/**.ts`, so 38 tracked files under `test/` were enumerated by neither
route — four of them already carrying inline HL7 `PID|…` literals. Both routes now share one
`isUnderScanRoot` over `src/`, `test/` and `scripts/`. The roots were re-derived for this repo:
`mllp` excludes `.ts` from its `test/` root, which would have closed none of these files.

Enumerating them was not sufficient. This repo's HL7 and NCPDP text lives in `.ts` modules as
single-line string literals, so the structured detectors saw one undifferentiated line; each file is
now also scanned as its string literals, decoded and joined, in addition to its raw bytes. A
`${identifier.path}` substitution site is treated as a hole rather than a value, under the tightest
rule that covers it. `test/scripts/phi-scan.test.ts` is bypassed through the existing
`--allow-fixture` + `phi-scan-overrides.md` mechanism — which now applies in the CI sweep and the
pre-commit hook, not only in explicit-path mode — because its positive cases are necessarily
real-looking violator literals; a logged bypass must name an existing regular file inside a scan root
or the scan refuses, and every applied bypass is announced.

Two pre-existing contract violations are folded in: an unmerged (`U`) staged entry is now enumerated
and refused, and a failure to read the allow-list or a scan directory now exits 2 rather than
escaping as an uncaught exception and exiting 1, the code that means "hits found".

Scoped to `deid` only. Every other repo with a `phi-scan` needs its own scope re-derived; `ccda`
roots at the repo root, and `ncpdp`/`synth` already include `scripts/`.
