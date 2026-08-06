# Changesets

This folder is managed by [Changesets](https://github.com/changesets/changesets). Changesets drives
the **version bump**, the **publish**, and the **changelog** for `@cosyte/deid`: `config.json` names
a `changelog` generator, so a release writes its own version heading and its own entries into
`CHANGELOG.md`.

**The changeset summary you write here IS the changelog entry a reader sees.** So:

- **Do not hand-edit `CHANGELOG.md`.** Record a change by adding a changeset. Everything under
  `## Released before this file was generated` is frozen history from before generation was turned
  on, and `test/scripts/changelog-generation.test.ts` pins it byte for byte; editing it reds that
  gate. Never reintroduce an `[Unreleased]` heading: a release prepends **above** it, so shipped
  content would sit under "Unreleased" permanently, inside the tarball.
- **Never open a summary line at column 0 with a `#` heading.** Continuation lines are indented by
  two spaces, exactly a list item's content column, so the heading renders as a permanent extra
  heading inside the published release section. Use an inline code span instead.
- **The first sentence becomes the public release bullet**, so make it stand on its own, and keep
  internal identifiers out of it.

Add a changeset for every meaningful change:

```bash
pnpm changeset
```

During pre-alpha, pick **patch** — that keeps the package on the `0.0.x` ladder until its first
alpha. See the cosyte version ladder in the meta-repo's `documentation/conventions.md`.
