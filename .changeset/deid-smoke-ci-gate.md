---
"@cosyte/deid": patch
---

Repository CI configuration only, with no runtime impact: the release smoke loading every published
subpath in ESM and CJS is now a required check, alongside `ci / actionlint` and CodeQL.

It had been described in `CHANGELOG.md` and in its own header as a CI gate after `build` while
running in no job at all, here or in the shared pipeline. It had only ever run on the local verify
ladder, and `CHANGELOG.md` ships inside the published tarball, so the false claim shipped with the
package. A documented gate that never executes is worse than a missing one: the description asserts
a protection nothing provides.

A repo-local workflow now runs `pnpm build` then `pnpm smoke` on the Node 22 and 24 matrix, and the
branch ruleset requires both of its contexts. This is not the same check as the shared pipeline's
root-entry dual ESM/CJS step, which loads `dist/index.*` only and cannot see a broken subpath, a
missing headline export, a regressed shared-core chunk, or an HL7 leak through the built artifact.

The smoke's scope is also derived rather than listed now. It reads the published subpaths out of
`package.json`'s `exports`, excludes only entries that are structurally data rather than any
hand-maintained key list, and refuses to run when its headline-export map disagrees with the rest.
A subpath published without coverage fails the gate rather than being skipped under a green check.

No library code, public export, policy, profile or transform changed. What this entry describes, the
wiring of an already-documented gate into a CI job, is not observable by someone installing this
package, which is why its opening sentence names those gates by the words the shared release-note
renderer classifies as internal-only: the entry records the patch bump and is dropped from the
published release body rather than reworded into it. It deliberately carries three of those words
(`actionlint`, `CodeQL`, "no runtime impact") because the list lives in `cosyte/.github` and nothing
here can observe it. Removing any single one of the three does not republish this entry; removing all
three does.
