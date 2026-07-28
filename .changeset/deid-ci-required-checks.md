---
"@cosyte/deid": patch
---

Repository CI configuration only, with no runtime impact: the pull-request checks (including CodeQL
and actionlint) are now required to merge, and Dependabot watches dependency updates weekly.

`main` had no branch-protection rules at all, so the typecheck, lint, format, PHI-scan, test,
coverage, build, `attw` and dual ESM/CJS gates plus CodeQL could every one go red and the merge would
still land on the branch this package publishes from. A repository ruleset now requires those checks,
restricted to the GitHub Actions app so a status of the same name cannot be posted by anything else,
and blocks branch deletion and force-push. There was also no Dependabot configuration, so zero open
update PRs meant nothing was looking rather than nothing being stale; weekly version updates are now
watched, which is not the same as automatic security-fix PRs.

Stated narrowly: this makes a red check binding. It does not make a check correct, and it is not
observable from inside the package.

No library code, public export, policy, profile or transform changed. What this entry describes, the
repository's CI configuration, is not observable by someone installing this package, which is why its
opening sentence names those gates by the words the shared release-note renderer classifies as
internal-only: the entry records the patch bump and is dropped from the published release body rather
than reworded into it. It deliberately carries four of those words (`CodeQL`, `actionlint`,
`Dependabot`, "no runtime impact") because the list lives in `cosyte/.github` and nothing here can
observe it. Removing any single one of the four does not republish this entry; removing all four does.
