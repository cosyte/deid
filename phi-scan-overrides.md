# phi-scan bypass log

This file logs every `--allow-fixture <path>` bypass invocation of
`scripts/phi-scan.ts`. The scan refuses to honor a `--allow-fixture <path>` flag
UNLESS this file contains a `### <path>` subsection referencing the same path.
The committed log is intentionally annoying: it discourages bypass and creates an
audit trail.

> **🛑 A BYPASS IS RECORDED AND THEN REFUSED. IT CANNOT PRODUCE A CLEAN RUN, IN
> ANY MODE.** `--allow-fixture` withdraws a file from the read set, and the
> shared engine (`@cosyte/script-utils/phi-scan`) refuses over a target it
> enumerated and never read: a scan that did not open a file has no clean verdict
> to give about it. Reaching for this flag to get a green run is following a
> remedy to exit 2.
>
> **The remedy that reaches a clean run is `scripts/phi-allow-list.txt`**: a
> token-level, reviewed declaration that specific identifiers are synthetic. It
> is narrower than a whole-file bypass by construction, because the file still
> gets opened and every check still runs over it. Add the tokens; do not withdraw
> the file. That is this repo's primary mechanism and it carries the great
> majority of the synthetic declarations.

> **A WHOLE-FILE CARVE-OUT IS NOW A DECLARED EXCLUSION IN
> `scripts/phi-scan.ts`, NOT AN ENTRY HERE.** `EXCLUDED_PATHS` names a literal
> path no route reads. The change is visible rather than free, and it is stated
> both ways: an exclusion is reviewed in a diff and cannot go stale against a
> flag baked into a package script, but it does NOT announce itself on stderr on
> every run the way a bypass did. A reader of a CI log now learns what the gate
> did not read from the source, not from the log.

## Format

Each entry is a markdown subsection:

```
### <path>

- **Date:** <YYYY-MM-DD>
- **Reason:** <one-line justification>
- **Approved by:** <committer name>
- **Expires:** <YYYY-MM-DD or "permanent">
```

## Entries

(none)

## What used to be here, and where it went

`test/scripts/phi-scan.test.ts` was logged here from 2026-08-03 and bypassed by a
`--allow-fixture` flag baked into the `phi-scan` package script. **The carve-out
is unchanged in substance and is now `EXCLUDED_PATHS` in
`scripts/phi-scan.ts`**, which is where its reasoning lives.

Why it moved: the shared engine's completeness rule makes `--allow-fixture`
unable to reach exit 0, so the flag left in place would have refused **every**
run. Why the file is carved out at all is unchanged: it is the scanner's own test
suite, so its positive cases are necessarily real-looking violator literals that
exist to prove the detectors CATCH those shapes, and a suite that could pass its
own scan would be asserting nothing. The cost is unchanged and still stated
rather than hidden: **real PHI pasted into that file is not caught by the gate.**

Nothing else under `test/` is carved out: every other inline literal is declared
token-by-token in `scripts/phi-allow-list.txt` instead.
