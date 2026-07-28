---
"@cosyte/deid": patch
---

The release smoke that loads every published subpath in ESM and CJS now runs in CI on every pull
request, and a red one blocks the merge.

It had been described in `CHANGELOG.md` and in its own header as a CI gate after `build` while
running in no job at all, here or in the shared pipeline. It had only ever run on the local verify
ladder, and `CHANGELOG.md` ships inside the published tarball, so the false claim shipped with the
package. A documented gate that never executes is worse than a missing one: the description asserts
a protection nothing provides.

A repo-local workflow now runs `pnpm build` then `pnpm smoke` on the Node 22 and 24 matrix, and the
branch ruleset requires both of its contexts. This is not the same check as the shared pipeline's
root-entry dual ESM/CJS step, which loads `dist/index.*` only and cannot see a broken subpath, a
missing headline export, a regressed shared-core chunk, or a leak.

The smoke's scope is also derived rather than listed now: it reads the published subpaths out of
`package.json`'s `exports` and refuses to run if its headline-export map disagrees with them, so a
subpath published without coverage fails the gate rather than being skipped under a green check.

No library code, public export, policy, profile or transform changed.
