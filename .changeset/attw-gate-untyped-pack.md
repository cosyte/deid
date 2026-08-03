---
"@cosyte/deid": patch
---

The publish gate that checks this package's type declarations could pass a tarball that carried no declarations at all.

`attw` is what stands between a broken `dist/` and a published package whose types nobody can
resolve. Its CLI exits **0** when the analysed package contains no types — reasonably, because an
untyped npm package is a legitimate one, so `getExitCode()` returns before the problem list is ever
read. No `--profile`, `--ignore-rules` or config value reaches that early return. For a package that
ships declarations for seven entry points, "does not contain types" does not mean "fine, untyped": it
means the declarations were not in the tarball. The gate said so in prose and reported success.

**Measured on this package with the invocation it actually runs (`--profile node16`).** With `dist/`
absent, and with `dist/` built but every `.d.ts`/`.d.cts` deleted, `attw` printed "This package does
not contain types." and exited 0. Deleting only the **entry** declarations exits non-zero instead —
the build emits shared declaration chunks the manifest never names, so a partial loss still leaves
`attw` something to analyse. It is total loss that is silent. Deleting only `dist/index.mjs` and
`dist/index.cjs` still reports every `node16` resolution green and exits 0, because a missing
JavaScript entry point is invisible to a tool that analyses types.

**Total loss is not exotic — it is a window in every build.** The bundler writes JavaScript in one
pass and declarations in a later one, so `dist/` holds `.mjs`/`.cjs` and no declarations for a few
seconds of each build: 6.9 s and 10.0 s on two builds measured here, on a CPU-constrained machine
where that figure moves with load. Anything that runs the gate inside that window — a second build, a
`clean`, a stale checkout — saw a pass. This is deliberately **not** answered with a lock or a build
queue, because the gate should be able to say its own inputs were missing whatever removed them.

**The `attw` script is now a wrapper with two nets.** A preflight asserts that every relative path
`package.json` promises — `main`, `module`, `types`, `typings`, and every string leaf of `exports` —
exists and is non-empty before `attw` runs, and names the ones that do not. That reaches the build
window and the missing-JavaScript case, neither of which the string check can see. A post-check then
promotes an untyped report to a failure, which reaches what the preflight structurally cannot:
declarations present on disk but excluded from the tarball by `files` or `.npmignore`. No instance of
that has occurred in this package.

**The post-check reads printed output, so what would hide that output is refused rather than
tolerated.** `--quiet`, `--format json`, and an `.attw.json` setting either of those were each
measured to hand back exit 0 with the untyped sentence unreadable; `--config-path` is refused as
well, by inference rather than measurement, since it moves the config file out of view.

The refusal is by option name and never by value, and "by name" covers two shapes: an argv token, and
a combined short-option cluster containing `q` or `f`. The second is there because `-Pf json` means
`--pack --format json`, so `-f` is never a token — a whole-token-only draft of this guard returned
exit 0 on an untyped pack through that spelling. Both are asserted against the real tool. That is a
statement about two shapes rather than a guarantee that none remains; the empty-transcript check
covers the case where the gate reads nothing at all.

**`--profile node16` is unchanged**, and that is asserted rather than assumed: the suite pins a
fixture shaped like this package — subpath exports pointing into a directory — that fails without the
flag and passes with it, through the wrapper, plus the manifest line that supplies it.

**Nothing a consumer calls has moved.** No API, `DEID_*` code, policy, profile, manifest disposition,
locus or transformed value changes; no de-identification behaviour is touched. What changes is that a
release cannot be cut from a `dist/` that failed to produce its declarations.
