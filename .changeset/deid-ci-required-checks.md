---
"@cosyte/deid": patch
---

The CI checks that run on a pull request now block the merge, and dependency updates are watched.

`main` had no branch-protection rules at all, so the typecheck, lint, format, PHI-scan, test,
coverage, build, `attw` and dual ESM/CJS gates plus CodeQL could every one go red and the merge would
still land on the branch this package publishes from. A repository ruleset now requires those checks,
restricted to the GitHub Actions app so a status of the same name cannot be posted by anything else,
and blocks branch deletion and force-push. There was also no Dependabot configuration, so zero open
update PRs meant nothing was looking rather than nothing being stale; weekly version updates are now
watched, which is not the same as automatic security-fix PRs.

Stated narrowly: this makes a red check binding. It does not make a check correct, and it is not
observable from inside the package.

No library code, public export, policy, profile or transform changed.
