---
"@cosyte/deid": patch
---

Bind the exported `VERSION` constant to `package.json` at release time, so it stops lying about the release it ships in.

`@cosyte/deid@0.0.6` is on the registry exporting `VERSION === "0.0.0"`, verified by unpacking the released tarball. The constant's own doc comment already claimed it was synced with the manifest at release time while no such step existed: the `version` script ran `changeset version` alone, and `changeset version` rewrites only `package.json`. `scripts/sync-version.mjs` now runs between the bump and Prettier, so the constant and the manifest always land in the same commit.

The guard is `test/sanity.test.ts`, which compares the export against `package.json` rather than a hardcoded literal. Its two pre-existing assertions checked only that `VERSION` is a non-empty semver-shaped string, and both stay green on a desynced tree, which is why the drift survived every release. Proven red before landing: with the constant reset, the suite reports `expected '0.0.0' to be '0.0.6'` at `1 failed | 2 passed`.

The declaration gains an explicit `: string` annotation, which the sync script keys on. Without it the constant widens to a string-literal type, and a sibling measured that dropping the annotation leaves every check green until release day.
