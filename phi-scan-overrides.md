# phi-scan bypass log

This file logs every `--allow-fixture <path>` bypass invocation of
`scripts/phi-scan.ts`. The scanner refuses to honor a `--allow-fixture <path>`
flag UNLESS this file contains a `### <path>` subsection referencing the same
path. The committed log is intentionally annoying: it discourages bypass and
creates an audit trail.

> **▶ A LOGGED BYPASS NO LONGER BUYS A CLEAN RUN, SO AN ENTRY HERE IS NOT A
> ROUTE TO GREEN.** `scripts/phi-scan.ts` refuses (exit 2) over a target it
> enumerated and never read, in every mode, and a withdrawn path is exactly
> that. The flag, this log and the rejection gate below are all KEPT, so an
> attempt is RECORDED AND REFUSED rather than silently honoured. Declare a
> fixture's identifiers TOKEN BY TOKEN in `scripts/phi-allow-list.txt`, or
> assemble the shape at run time so the source never carries one.

Two further conditions, neither of which this log can express on its own, so the
scanner enforces them:

- **The path must be a real regular file inside a scan root** (`src/`, `test/`,
  `scripts/`). A bypass that has been renamed away, deleted, or typed with a
  stale prefix REFUSES the whole scan (exit 2) rather than quietly subtracting
  nothing. A directory is refused by the same rule, so a bypass can never widen
  past the one file it names.
- **Every bypass that applies is announced on stderr**, on every route and every
  run, as a `BYPASSED (logged in phi-scan-overrides.md)` line naming the path.
  Read a CI log and you can see what the gate did not read. The run then refuses
  and names the same path again as an enumerated-but-unread target.

> **The scan roots are `src/`, `test/` and `scripts/`**: the whole of `test/`,
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

_None._ This repository bypasses no file, and no shipped invocation passes
`--allow-fixture`: not `package.json`'s `phi-scan` script, not the `pre-commit`
hook that calls it, and not any workflow under `.github/`.

The one entry this log ever carried was `test/scripts/phi-scan.test.ts`, the
scanner's own test suite, whose positive cases are necessarily real-looking
violators. It was retired rather than re-justified: the suite now assembles
those shapes at run time and puts a `${...}` substitution site at every PHI
position of its fixture documents, so the scanner is still handed real-looking
bytes while the module on disk carries none. **No detector was weakened to
achieve that, and the floor specifically was not**: an SSN shape declared
nowhere in `scripts/phi-allow-list.txt` is still a hard hit, which
`test/scripts/phi-scan.test.ts` pins directly. The cost the old entry stated in
its own words -- real PHI pasted into that file is not caught -- is paid off
rather than carried.
