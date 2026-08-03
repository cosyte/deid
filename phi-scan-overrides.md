# phi-scan bypass log

This file logs every `--allow-fixture <path>` bypass invocation of
`scripts/phi-scan.ts`. The scanner refuses to honor a `--allow-fixture <path>`
flag UNLESS this file contains a `### <path>` subsection referencing the same
path. The committed log is intentionally annoying — it discourages bypass and
creates an audit trail. Prefer extending `scripts/phi-allow-list.txt` (a
token-level, reviewed declaration) over a whole-file bypass, which silences
_every_ check for that file.

Two further conditions, neither of which this log can express on its own, so the
scanner enforces them:

- **The path must be a real regular file inside a scan root** (`src/`, `test/`,
  `scripts/`). A bypass that has been renamed away, deleted, or typed with a
  stale prefix REFUSES the whole scan (exit 2) rather than quietly subtracting
  nothing. A directory is refused by the same rule, so a bypass can never widen
  past the one file it names.
- **Every bypass that applies is announced on stderr**, on every route and every
  run, as a `BYPASSED (logged in phi-scan-overrides.md)` line naming the path.
  Read a CI log and you can see what the gate did not read.

> **The scan roots are `src/`, `test/` and `scripts/`** — the whole of `test/`,
> not `test/fixtures/`, because this repo keeps its document text inline in `.ts`
> test modules. `scripts/phi-scan.ts` carries the derivation and what is still
> outside it. Prefer a token in `scripts/phi-allow-list.txt` over an entry here.

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

### test/scripts/phi-scan.test.ts

- **Date:** 2026-08-03
- **Reason:** This is the scanner's own test suite, so its POSITIVE cases are
  necessarily real-looking violator literals — a dashed SSN, an email at a
  non-test domain, and a `John`/`Smith` C-CDA header. Every one of them exists to
  prove the detector CATCHES that shape; a suite that could pass its own scan
  would be asserting nothing. This is the one file the widened `test/` root
  cannot sweep, and the cost is stated rather than hidden: real PHI pasted into
  THIS file is not caught by the gate. Nothing else under `test/` is bypassed —
  the other inline literals are declared token-by-token in
  `scripts/phi-allow-list.txt` instead.
- **Approved by:** Noah Schatz
- **Expires:** permanent
