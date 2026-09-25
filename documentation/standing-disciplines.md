## Standing disciplines (every change)

Mirrors the disciplines in the meta-repo's `documentation/conventions.md`: they bind here too. Full
text and every sub-case: `documentation/agent-notes.md#standing-disciplines-every-change`.

1. **Documentation follows code**: this repo's `README.md` / `docs-content/`, the meta-repo
   `documentation/repos/deid.md` ("last verified" bumped), and the `ecosystem-map.md` status table.
2. **Version + changelog**: a Changeset (`patch` on the `0.0.x` ladder) per meaningful change. **The
   changeset summary IS the changelog entry: `.changeset/config.json` names a generator, so DO NOT
   HAND-EDIT `CHANGELOG.md` and never reintroduce an `[Unreleased]` heading** (one stood unrolled for
   this package's whole published history, which is how a shipped tarball came to call its own
   contents unreleased). **Nothing but the H1 sits above the first heading**, compare version headings
   **whole** (`## 0.0.1` is a substring of `## 0.0.10`), and **the Prettier pass stays ON here (no
   `"prettier"` key), DERIVED from this repo having no `.prettierignore` and a `format:check` that
   globs root markdown, never copied. A sibling that DOES ignore `*.md` needs it OFF: leaving it ON
   there rewrote already-published text and corrupted a shipped tarball. Never resync this value.**
   `test/scripts/changelog-generation.test.ts` pins the above, plus a digest of the frozen archive.
   **Scope, because the gap matters: the digest sees a hand-edit BELOW the divider only. A fabricated
   release section ABOVE it passes every case**, and a publish with an unchanged changelog is a
   swallowed write failure that **nothing here guards** (do not misread it as a reverted flag).
   → `documentation/agent-notes.md#the-changelog-generator-and-why-the-unreleased-heading-may-not-come-back`
   Renaming a stable warning code is a **breaking change**.
3. **Crew + knowledgebase loop**: if the public API or warning codes change, flag/update the matching
   `crew` healthcare skill + the KB product doc.
4. **No internal project bookkeeping on a public surface** (founder directive, 2026-07-27). Item ids,
   phase/roadmap language, ADR numbers and meta-repo paths belong in the changeset, `CHANGELOG.md`, the
   commit, the PR and the roadmap, never in `README.md`, `docs-content/`, the npm `description`, a
   release body, or the JSDoc that compiles into `dist/**/*.d.ts`. Gated by
   `pnpm check:no-internal-refs`. → `documentation/agent-notes.md#no-internal-project-bookkeeping-on-a-public-surface`
   - **The gate keys on KNOWN PROJECT PREFIXES, never the `WORD-N` shape: in THIS repo that is not
     stylistic.** `deid` documents the loci of all six standards (`PID-3`, `NM1-03`, `DTP-03`, `CLP-01`,
     `US-SSN`, `ICD-10-CM`, …); a shape rule deletes the coordinates a consumer needs to audit what was
     transformed. **Never resync the prefix list with a sibling copy** without re-reading why `SYNTH` is
     here and absent in `ncpdp`'s. → `documentation/agent-notes.md#the-gate-keys-on-known-project-prefixes`
   - **The bare-`§` non-catch is a DECISION pinned by `BARE_SECTION_SAMPLE`**: `§` here is
     overwhelmingly `§164.514`. Closing that gap has to be deliberate.
     → `documentation/agent-notes.md#the-section-sign-non-catch`
   - **The gate catches identifiers, not English about our process, and the residual is large. A count is
     a function of the rule set: quote the rule set with the count, or the count means nothing.**
     → `documentation/agent-notes.md#the-gate-catches-identifiers-not-english`
   - **CUT, do not rewrite.** In THIS package the risk is a safety one: every claim is deliberately
     scoped, and two sentences in one sweep would have become **guarantees the code does not provide** if
     the citation had simply been cut. Restate as a limitation instead.
     → `documentation/agent-notes.md#cut-do-not-rewrite`
   - **THE RELEASE BODY IS THE ONE PUBLIC SURFACE THIS REPO CANNOT GATE, AND `.changeset/` IS ITS
     SOURCE.** An internal-only change is dropped **by word**, not reworded: fix the changeset's wording,
     and **never widen the shared word list in `cosyte/.github` to fit one repo's prose.** The renderer
     strips phase language and cannot check the result reads: **open every changeset with a sentence that
     stands on its own once the identifier is gone.**
     → `documentation/agent-notes.md#the-release-body-is-the-one-public-surface-this-repo-cannot-gate`
   - **Stated as a limit, not chased: that fix depends on ANOTHER REPO's word list holding, and nothing
     here fails when it changes.** → `documentation/agent-notes.md#the-word-list-is-in-another-repo`
   - **The mitigation is redundancy, not coverage. Do not read the recorded figures as the measurement:
     re-run the probe against the renderer.**
     → `documentation/agent-notes.md#the-leave-one-out-measurement-and-its-probe`
   - **Do not let a changeset headline drift toward the 200-character HARD REFUSAL**: it refuses (it
     does not trim) on the version commit, after the Version PR has merged.
     → `documentation/agent-notes.md#the-200-character-headline-refusal`
