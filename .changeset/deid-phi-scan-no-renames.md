---
"@cosyte/deid": patch
---

This repo's `phi-scan` commit gate now enumerates a staged rename, closing a pre-commit hole with no runtime impact.

`scripts/phi-scan.ts`'s `--staged` route reads `git diff --cached --raw`, and `R` (rename) and `C`
(copy) are returned by none of `AM`, `AMT` or `AMTU`. With git's rename detection on (the default),
`git mv <tracked symlink> src/<name>` therefore staged as `:120000 120000 <sha> <sha> R100`, the
filter deleted the record before any mode could be read, and the route reported a clean corpus over a
mode-120000 entry sitting inside a scan root. It was never only a mode gap: a rename that also
substituted a value staged as `R052`, and its new content went unread the same way. The all-mode
sweep refuses that same worktree, so the gap was at pre-commit, where this repo's `simple-git-hooks`
`pre-commit` runs `pnpm phi-scan --staged`.

The remedy is `--no-renames` on that one invocation. With detection off git emits no `R` and no `C`
at all: a rename's destination arrives as an ordinary single-path `A` and its source as a `D` the
filter already drops, so the enumeration is a superset of the previous one (equal when git emitted
no `R` and no `C`, larger when it did) and the two-field
record stride is untouched. It also makes that stride structural rather than conditional on the
caller's configuration; measured across `diff.renames=true|copies|false|1` with `diff.renameLimit=1`,
zero `R`/`C` records survive any of them. The earlier disclosure that closing this needed a two-path
record shape and a scope decision was wrong, and is withdrawn rather than deferred again.

No library code changes and no public surface moves. Five cases are pinned in
`test/scripts/phi-scan.test.ts` (the moved symlink, the rename-plus-substitution, the configuration
sweep, a real `C100` copy under `diff.renames=copies`, and a no-regression control); four of the five
run red against the previous scanner and the fifth is green on both by design.
