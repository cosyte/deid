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

Pick the bump type from what the change does to the published package. On the `0.1.x` ladder:

- **minor** for anything a consumer gains: a newly exported symbol, a new option, a new stable
  code, or a new published artifact they can use. It takes `0.1.x` to `0.2.0`.
- **patch** for a fix, for documentation of a surface that already ships, and for contributor-only
  tooling. It takes `0.1.0` to `0.1.1`.
- **major** only when you mean to declare `1.0.0`. Before that, a breaking change is a **minor**,
  and the break has to be spelled out in the summary, because the number alone tells a consumer on
  a `0.x` release nothing.

See the cosyte version ladder in the meta-repo's `documentation/conventions.md`.
