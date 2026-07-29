#!/usr/bin/env tsx
/**
 * scripts/check-test-selection.ts
 *
 * WHAT THIS GUARDS, AND WHY NOTHING ELSE COVERS IT.
 *
 * The required CI job runs `pnpm test` and `pnpm test:coverage`, which run vitest, which runs
 * whatever the config's `include` globs select. A required JOB gates its STEPS; it does not gate
 * what those steps SELECT. So this repo's headline leak gate hangs off one line of repo-local
 * config:
 *
 *     include: ["test/**\/*.test.ts", "src/**\/*.test.ts"]
 *
 * The shared `@cosyte/vitest-config` supplies no `include` of its own and spreads this repo's
 * `test` block last, so that line is hand-written, unguarded, and a one-line edit. Narrow it to
 * the per-format directories and `test/corpus/leak-corpus.test.ts` -- the consolidated
 * zero-leak / over-scrub corpus across all six format adapters -- stops running, with every
 * required check still green and every ruleset still exactly as configured.
 *
 * COVERAGE CANNOT BACKSTOP IT. Coverage is measured over `src/**\/*.ts`. The corpus re-exercises
 * `src/` paths the per-format suites already touch, so dropping it costs close to zero coverage
 * percent. That is what makes the failure silent rather than merely risky.
 *
 * WHAT THIS FILE DOES. It compares the set of test files that EXIST against the set of test files
 * vitest would actually RUN, checks that the package scripts CI invokes do not narrow the run
 * behind the config's back, and reds on any shortfall IN ITS SUBJECT. It then seeds, on every
 * single run, the removals it exists to catch, and requires itself to catch them.
 *
 * WHAT THE SELF-TESTS DO AND DO NOT COVER, stated here rather than left to be assumed, because two
 * successive refuter passes found the claim about them wider than the code: A covers the
 * comparison, B the invocation rule, C the observation channel end to end through real vitest, and
 * D THREE NAMED DERIVATIONS -- the PHI-enablement rule, the specifier extractor, and the COUNT of
 * exported subpaths.
 *
 * ▶ D IS NOT A GUARANTEE THAT THE SUBJECT IS DERIVED LARGE ENOUGH, and an earlier version of this
 *   paragraph said it was. **D does not check that each subpath maps to its OWN source, and D does
 *   not cover `resolveSpecifier` at all.** Both gaps are measured, not theorised: pointing every
 *   entry at `src/dicom/index.ts` collapses the subject from 31 modules to 3 while this prints OK
 *   and reports that all four self-tests reddened, because the COUNT still matches; and a two-line
 *   `if (fromFile.startsWith("test/corpus/")) return [];` inside `resolveSpecifier` reproduces the
 *   pass-1 blocker exactly, with the corpus unselected and every self-test green.
 *
 * ▶ SO THE HONEST STATEMENT IS THE NARROW ONE. A, B and C take the subject as GIVEN and cannot see
 *   a subject derived too small; D closes three specific ways of deriving one too small and leaves
 *   the rest to review. It is worth having for what it does catch: with only A, B and C, gutting
 *   the PHI-enablement rule to `return true` left this reporting OK with `run-phi-scan: false` in
 *   the workflow and all three self-tests claiming they had reddened. **A REFACTOR OF
 *   `exportedSourceEntries` OR `resolveSpecifier` IS REVIEWED BY A HUMAN OR IT IS NOT REVIEWED.**
 *   Growing a self-test E to chase the rest is the move this file has already refused twice; the
 *   spelling of a derivation is not a closed set, and the claim is what gets corrected.
 *
 * "IN ITS SUBJECT" IS LOAD-BEARING. That subject is three sets unioned: modules that import one of
 * this package's PUBLISHED ENTRY POINTS, modules referencing the PHI scanner, and files whose NAME
 * ends `.test.` / `.spec.`. Only the first two are name-independent. See the limits below.
 *
 * ---------------------------------------------------------------------------
 * FIVE DESIGN RULES, each load-bearing. Do not "simplify" past them.
 *
 * (1) DENY-LIST THE EXCLUSIONS, NEVER ALLOW-LIST THE INCLUSIONS. An allow-list silently skips
 *     everything it does not name. This repo has already paid for that lesson twice: its PHI gate
 *     allow-listed git status letters with `--diff-filter=AM` and therefore skipped renames, and
 *     the first fix to its release smoke left a hand-editable exclusion set, from which a refuter
 *     demonstrated dropping an entry with the run still green. A hand-editable list of what to
 *     check is not a gate. There is no such list in this file.
 *
 * (2) OBSERVE THE RESOLVED SELECTION, NOT THE CONFIG TEXT. This asks vitest itself, via
 *     `vitest list --filesOnly`, which files it would run. Reading the globs out of
 *     `vitest.config.ts` and reasoning about them would miss every other way to narrow a
 *     selection: `exclude`, `projects`, `dir`, a workspace. Asking the runner is the only way the
 *     answer stays true when the mechanism changes. It does NOT cover a config body that branches
 *     on its own invocation; see the limits.
 *
 * (3) THE CONFIG IS NOT THE ONLY SELECTOR. THE INVOCATION IS ONE TOO. A pristine config proves
 *     nothing if the command line narrows the run, and `vitest list` cannot see that, because it
 *     resolves the config rather than the package script. THIS RULE DOES NOT PARSE THE SCRIPT
 *     BODY, and the reason is measured next door in `ncpdp`, where three successive parsing
 *     versions each bought exactly one more spelling and never converged: keying on the literal
 *     `vitest run` missed `vitest --run <path>`; matching bare tokens missed every
 *     `--flag=value`; tokenising arguments after a whole-word `vitest` failed CLOSED on arguments
 *     but OPEN on the invocation, so `"test": "pnpm run test:unit"` contained no `vitest` token,
 *     produced no arguments, and was reported as PASSING. The rule here is total instead: the body
 *     must equal one of two exact strings. Nothing is interpreted, so there is no spelling to
 *     miss. Those two strings are ported verbatim from `ncpdp` because this repo's `test` and
 *     `test:coverage` bodies are character-identical to that repo's.
 *
 * (4) THE SUBJECTS ARE DERIVED FROM ARTIFACTS THAT EXIST FOR THEIR OWN REASONS. A list in this
 *     file saying "the leak corpus matters" would be a second, hand-editable lever on the gate's
 *     own scope, deletable in one line by the same person narrowing the glob. So the two headline
 *     subjects are read out of committed artifacts that are not ours to quietly edit.
 *
 *     ▶ THE DERIVATION SOURCE HERE IS `package.json`'s `exports` MAP, AND IT IS NOT THE ONE
 *       `ncpdp` USES. That repo derives its fuzz subject from a workflow that hands a path to
 *       `vitest run`. NO WORKFLOW IN THIS REPO HANDS A PATH TO VITEST, so that derivation has no
 *       grounding here and porting it would only make this gate refuse. The corpus is named today
 *       only by PROSE -- banners in `ci.yml`, `smoke.yml` and `CLAUDE.md` that describe the
 *       hazard. Deriving from prose would make a documentation edit the drop route, which is the
 *       same hand-editable-lever failure in a different file.
 *
 *       `exports` is the opposite of prose. npm resolves it, `attw` checks it, `tsup` builds
 *       against it, and `scripts/smoke.mjs` already reads it at run time and REFUSES when its own
 *       headline-export map disagrees with it. It cannot be quietly narrowed: removing a subpath
 *       is a breaking change to the package's public surface, visible to every consumer.
 *
 *     ▶ WHAT IT DERIVES. Each exported subpath's ESM target maps `./dist/<p>.mjs` -> `src/<p>.ts`,
 *       the source entry point. The subject is then EVERY tracked module outside `src/` that
 *       IMPORTS one of those entry points, and EVERY ONE OF THEM MUST RUN. That reaches
 *       `test/corpus/leak-corpus.test.ts`, which imports all seven, without this file naming it.
 *       `./package.json` drops out structurally, its target being a bare `.json` string rather
 *       than a conditions object -- not because a key was excluded somewhere.
 *
 * (5) THE GATE MUST DEMONSTRATE ITS OWN REDNESS, NOT ASSERT IT. A guard like this is easy to make
 *     vacuous by accident: point it at the wrong root, mis-normalise a path, let a subprocess fail
 *     open. So before it reports anything, it seeds the removals it exists to catch and requires
 *     itself to catch them: against the comparison logic (A), against the invocation rule (B), end
 *     to end through a genuinely narrowed vitest config resolved by real vitest (C), and against
 *     THREE NAMED DERIVATIONS (D). If a seeded narrowing does NOT come back red, this exits
 *     non-zero and says the detector cannot detect. A check that cannot fail is documentation.
 *
 *     ▶ AND THE COVERAGE OF (D) IS THREE NAMED THINGS, NOT "the derivations". It does not check
 *       that each subpath maps to its own source, and it does not cover `resolveSpecifier`; both
 *       gaps are measured at D's own definition below. A self-test cannot enumerate the ways a
 *       derivation can be written wrong, so what is claimed here is bounded on purpose. A diff that
 *       touches `exportedSourceEntries` or `resolveSpecifier` is reviewed by a person.
 *
 * ---------------------------------------------------------------------------
 * WHY THE IMPORT RULE IS ALLOWED TO READ TEXT WHEN THE OTHER RULES ARE NOT.
 *
 * `ncpdp` shipped two rules that matched substrings over the concatenated text of every selected
 * file, and both had to be deleted: one "checked imports" by bare substring and let a rename to
 * `_helpers.ts` through because 15 of 24 selected suites happened to contain that substring; the
 * other was satisfied by a planted comment. THE DIRECTION IS WHAT DAMNED THEM. Both used text to
 * decide that something did NOT need to run, so forged text bought an EXEMPTION.
 *
 * Here, forged text can only ADD a module to the subject, never remove one. A specifier planted in
 * a comment makes the gate STRICTER (that module must now also run); it cannot excuse anything.
 * That is why the extraction is deliberately crude -- every quoted specifier after `from`,
 * `import(` or `require(`, in any of the three quote characters, with no attempt to strip comments.
 *
 * WHAT LEAVING THE SUBJECT COSTS, STATED AS MEASURED RATHER THAN AS "IMPOSSIBLE". An earlier
 * version of this paragraph said the only way out was to delete the real import. That was false and
 * a refuter demonstrated it: the extractor took `"` and `'` only, so a backtick dynamic import left
 * the subject with the file working. Closed, and self-test D holds it closed. What is true now is
 * narrower and worth saying exactly: a module leaves this subject by deleting the import, by
 * rewriting the specifier into a form this does not resolve (a substitution, a query suffix, a
 * resolver alias -- each measured, each caught today by typecheck or lint rather than by this
 * gate), or by ceasing to reach the published surface at all. It does NOT leave by being renamed,
 * moved, or reached through a symlink.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS DOES NOT COVER, stated plainly rather than left to be discovered. A list of known
 * limits, not a proof that the list is complete.
 *
 *   * A CONFIG THAT BRANCHES ON ANYTHING THAT DIFFERS BETWEEN THE LISTING RUN AND THE TEST RUN.
 *     `resolvedSelection` runs `vitest list` while CI runs `vitest run`, in a different job, so a
 *     config whose `include` reads `process.argv` can answer the two differently: a wide selection
 *     to this gate, a narrow one to CI. Seeded here: the gate is green while 29 of 33 suites stop
 *     running. AND ARGV IS NOT THE ONLY DIFFERENCE, which an earlier version of this paragraph
 *     implied by naming only `process.argv`. Putting this check in its own workflow means
 *     `GITHUB_JOB`, `GITHUB_WORKFLOW` and `GITHUB_RUN_ID` differ too; a refuter branched on
 *     `GITHUB_JOB` and left 6 of 33 suites running with this green. The class is "the config can
 *     tell which run it is in", and none of it is closed here.
 *   * A SPECIFIER THAT REACHES AN ENTRY POINT WITHOUT BEING A LITERAL RELATIVE PATH. The import
 *     rule resolves literal relative specifiers and follows symlinks; it does not evaluate
 *     substitutions and does not apply resolver aliases. Three routes measured, and NONE of them
 *     is caught by this gate; all three are caught TODAY by a different required step, which is a
 *     different gate that can change:
 *       - `import(`../../src/${fmt}/index.js`)` (substituted template literal): gate GREEN,
 *         typecheck PASS, `pnpm lint` FAILS.
 *       - `"../../src/hl7/index.js?deid"` (query suffix): gate GREEN, typecheck FAILS, lint FAILS.
 *       - a `resolve.alias` in the vitest config plus a bare `"@alias/hl7/index.js"`: gate GREEN,
 *         typecheck FAILS, lint FAILS.
 *     The two routes a refuter DID walk end to end with every other gate green -- a backtick
 *     dynamic import, and a tracked symlink to `src/` -- are closed, and self-test D holds the
 *     first one closed.
 *
 *     ▶ ONE OF THE THREE HAS NO ALL-GATES-GREEN VARIANT, and that is a structural property worth
 *       recording rather than luck. The substituted template literal reds `pnpm lint` because the
 *       dynamic import lands as `any` (`no-unsafe-assignment` / `no-unsafe-call`). A refuter tried
 *       to type that away: a hand-written structural type reds typecheck (TS2345, TS2339), and the
 *       only correct typing is `as typeof import("../../src/hl7/index.js")` -- which is a literal
 *       specifier and PUTS THE FILE BACK IN THIS SUBJECT (verified: the gate reds naming `./hl7`).
 *       So satisfying the type checker on that route re-enters the subject. That is a property of
 *       the two gates together, not of this one, and it holds only while `lint` stays required.
 *   * `.skip` / `.only` / an early `return` INSIDE a selected suite. Selection is not execution.
 *     `ci.yml`'s banner names `.skip`-ing the corpus as a drop route alongside narrowing the glob,
 *     and only the narrowing half is answered here. A file that is selected and does nothing is a
 *     review problem and a coverage problem, not one this rule can see.
 *   * WHICH SCRIPT the shared pipeline elects to invoke. This checks `test` and `test:coverage`,
 *     the two the shared caller in `cosyte/.github` runs today. That repo is not this one's to
 *     edit and a change there is out of reach from here.
 *   * Scripts other than those two, and anything a workflow runs inline rather than through a
 *     package script.
 *   * A SUITE THAT NEITHER IMPORTS AN ENTRY POINT NOR REFERENCES THE PHI SCANNER, renamed out of
 *     the `.test.` / `.spec.` shape. For those files the filename is the only rule, which is why
 *     the OK line prints how many tracked modules under `test/` no rule watches at all. A rename
 *     that stays under `test/` moves a file INTO that count, so a reviewer watching it go 3 -> 4
 *     sees the hole being used; a rename that also leaves `test/` leaves the count too, and only
 *     the name-shaped total moves, which nothing here compares against a baseline.
 *   * DELETING a subject module is caught only when it was the LAST importer of an exported
 *     subpath. Deleting the corpus alone is green here (measured), because six per-format suites
 *     still import those entry points. Loud in a reviewed diff rather than caught here. A MOVE THAT
 *     BREAKS THE MODULE'S OWN RELATIVE SPECIFIERS is the same case: `git mv
 *     test/corpus/leak-corpus.test.ts scripts/leak-corpus.ts` leaves `../../src/index.js` pointing
 *     outside the repo, so the file stops importing any entry point and this is green (measured).
 *     The same move with its imports repaired reds (measured). This rule follows working imports,
 *     and a file whose imports no longer resolve has been deleted in every sense but the diff's.
 *   * Whether a selected test ASSERTS anything useful. Selection is necessary, not sufficient.
 *     That is the refuter's job and the coverage gate's job.
 *   * A file whose only home is an untracked working tree. Invisible here and equally invisible to
 *     CI, which is the same thing being true twice rather than a hole.
 *
 * Run it locally with `pnpm check:test-selection` (also reached by `pnpm check`, which is on the
 * meta-repo's `scripts/verify.sh deid` ladder).
 */

import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const WORKFLOW_DIR = join(ROOT, ".github", "workflows");

/** The two package scripts the shared CI pipeline invokes. Both must exist. */
const CI_TEST_SCRIPTS = ["test", "test:coverage"];

/** TypeScript/JavaScript module suffixes, used where a rule must not key on `.test.`. */
const CODE_FILE = /\.[cm]?[jt]sx?$/;

/** A path is compared and reported in POSIX form, whatever the host separator is. */
const toPosix = (p: string): string => p.split(sep).join("/");

/** Every problem found, printed together at the end. One run, all the news. */
const failures: string[] = [];
const fail = (message: string): void => {
  failures.push(message);
};

/**
 * A refusal is not a failure. A failure means the repo is wrong; a refusal means THIS FILE could
 * not do its job, and reporting either OK or a tidy list of violations from a scan that did not
 * complete is the worst of the three outcomes. Refusals exit immediately.
 */
function refuse(message: string): never {
  process.stderr.write(`check-test-selection: REFUSING TO REPORT\n  ${message}\n`);
  process.exit(1);
}

/** Run a command, refusing on any non-zero exit or spawn error. No silent fail-open. */
function run(cmd: string, args: string[], what: string): string {
  const r = spawnSync(cmd, args, { cwd: ROOT, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  if (r.error) refuse(`${what}: could not run \`${cmd}\`: ${r.error.message}`);
  if (r.status !== 0) {
    refuse(
      `${what}: \`${cmd} ${args.join(" ")}\` exited ${String(r.status)}\n  ${r.stderr.trim()}`,
    );
  }
  return r.stdout;
}

// ---------------------------------------------------------------------------
// THE TWO SETS.

/** Every tracked path in the repo. The one enumeration everything else is derived from. */
function trackedFiles(): string[] {
  const out = run("git", ["ls-files", "-z"], "listing tracked files");
  const files = out.split("\0").filter(Boolean).map(toPosix).sort();
  if (files.length === 0) {
    refuse(
      "`git ls-files` reported zero tracked files, so the enumeration is broken rather than the " +
        "repo being empty. Refusing to report anything from a listing that read nothing.",
    );
  }
  return files;
}

/**
 * The repo-wide floor: tracked files whose NAME says they are tests. This is a filename allow-list
 * and is therefore the weakest rule here on purpose. Suffixes are broad (`.test.` and `.spec.`,
 * any TS/JS extension) because the narrow version of this line is itself the escape hatch a rename
 * walks through.
 */
const nameShapedTests = (tracked: string[]): string[] =>
  tracked.filter((f) => /\.(test|spec)\.[cm]?[jt]sx?$/.test(f));

/**
 * What RUNS. Asks vitest to resolve its own selection. `configPath` is used only by the self-test
 * below, which points it at a deliberately narrowed config.
 *
 * The output filter takes whole-line, whitespace-free, code-suffixed tokens, so a banner or
 * deprecation notice that happens to name a `.ts` file cannot be mistaken for a selected file.
 * Anything that slips through anyway is additive, and an addition can only mask a real shortfall
 * by coinciding exactly with a tracked path; the OK line reports the count of selected-but-
 * untracked entries so that stays visible rather than silent.
 */
function resolvedSelection(configPath?: string): string[] {
  const args = ["list", "--filesOnly", "-r", ROOT];
  if (configPath !== undefined) args.push("-c", configPath);
  const out = run("./node_modules/.bin/vitest", args, "resolving the vitest selection");
  return out
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !/\s/.test(l) && CODE_FILE.test(l))
    .map((l) => toPosix(relative(ROOT, resolve(ROOT, l))))
    .sort();
}

// ---------------------------------------------------------------------------
// THE INVOCATION RULE (design rule 3).

/**
 * The COMPLETE, exact bodies the two CI test scripts are allowed to have. PORTED VERBATIM from
 * `ncpdp`, where this rule converged only by giving up on parsing; this repo's two script bodies
 * are character-identical to that repo's, which is what makes the port a reuse rather than a
 * re-derivation.
 *
 * A wrapper, a delegation to another script, an extra flag, an alternate config, a path filter and
 * a shard are all simply "not one of these two strings".
 *
 * THE COST, ACCEPTED DELIBERATELY: a legitimate addition such as `--reporter=github-actions` reds
 * until it is added here. That is a one-line, reviewed commit, and the diff shows the whole new
 * body rather than a flag name whose effect a reader has to know.
 */
const ALLOWED_TEST_SCRIPT_BODIES = new Set(["vitest run", "vitest run --coverage"]);

/** True when a script body is an exactly-known-good invocation. Whitespace-normalised. */
const bodyIsAllowed = (body: string): boolean =>
  ALLOWED_TEST_SCRIPT_BODIES.has(body.trim().replace(/\s+/g, " "));

// ---------------------------------------------------------------------------
// THE DERIVED SUBJECTS (design rule 4).

interface PackageJson {
  scripts?: Record<string, string>;
  exports?: Record<string, unknown>;
}

const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as PackageJson;

/**
 * The package's PUBLISHED SOURCE ENTRY POINTS, derived from `exports`.
 *
 * Each subpath's ESM target is a built path (`./dist/hl7/index.mjs`); the source that produces it
 * is the same path under `src/` with a `.ts` extension. Both halves are checked rather than
 * assumed: a target that is not under `dist/`, or whose derived source does not exist, REFUSES
 * rather than being skipped, because a subpath quietly dropping out of this derivation is exactly
 * the failure being closed.
 *
 * `./package.json` is not excluded by name. It falls out because its target is a bare `.json`
 * string rather than a conditions object, which is structural. An exclusion list here would be a
 * second lever on this gate's scope, and `scripts/smoke.mjs` makes the same choice for the same
 * reason.
 */
function exportedSourceEntries(): Map<string, string> {
  const exp = pkg.exports;
  if (exp === undefined || Object.keys(exp).length === 0) {
    refuse("package.json has no `exports` map, so this gate has no derived subject to protect");
  }

  const entries = new Map<string, string>();
  for (const [subpath, target] of Object.entries(exp)) {
    if (typeof target !== "object" || target === null) continue; // structural, not a name list
    const esm = (target as { import?: { default?: unknown } }).import?.default;
    if (typeof esm !== "string") {
      refuse(
        `exports["${subpath}"] has no string \`import.default\` target, so its source entry cannot ` +
          "be derived. Refusing rather than silently dropping a published subpath from the subject.",
      );
    }
    const m = /^\.\/dist\/(.+)\.mjs$/.exec(esm);
    if (m === null) {
      refuse(
        `exports["${subpath}"] resolves to ${esm}, which is not a \`./dist/<path>.mjs\` build ` +
          "output. The dist-to-src derivation no longer holds and must be re-grounded deliberately.",
      );
    }
    const src = `src/${m[1] as string}.ts`;
    if (!existsSync(join(ROOT, src))) {
      refuse(
        `exports["${subpath}"] derives the source entry ${src}, which does not exist. Either the ` +
          "build layout changed or a published subpath has no source; both need a deliberate look.",
      );
    }
    entries.set(subpath, src);
  }

  if (entries.size === 0) {
    refuse(
      "no exported subpath resolved to a source entry point, so this gate would pass vacuously " +
        "over a package that still publishes a surface.",
    );
  }
  return entries;
}

/**
 * Every quoted module specifier in a file: what follows `from`, `import(` or `require(`.
 *
 * DELIBERATELY CRUDE AND OVER-INCLUSIVE. It does not strip comments, does not care whether the
 * statement is real, and matches a multi-line `import { ... } from "x"` because it keys on the
 * `from` rather than on the line start. Text can only ADD a module to the subject here, so being
 * over-inclusive is being strict, and the one direction this can be wrong in is the safe one. See
 * the note above design rule 5 for why that is the opposite of the two substring rules `ncpdp` had
 * to delete.
 *
 * ALL THREE QUOTE CHARACTERS, AND THE BACKTICK IS NOT DECORATION. The first version of this line
 * took `"` and `'` only, and a refuter walked the corpus out of the subject with it: rewriting the
 * seven imports to ``const { deidentifyHl7 } = await import(\`../../src/hl7/index.js\`)`` left a
 * file that typechecks, lints and runs 30 of 30 tests, and the gate printed OK with the suite no
 * longer selected. It cost one character class to close, and it was closed rather than disclosed,
 * because the sentence it falsified ("the only way out is to delete the real import") is this
 * rule's central claim. A SUBSTITUTED template literal yields no literal path and therefore no
 * subject membership; that is a real residual and it is in the limits.
 */
function specifiersInText(text: string): string[] {
  const out: string[] = [];
  const re = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*)["'`]([^"'`\n]+)["'`]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) out.push(m[1] as string);
  return out;
}

/** The same extraction over a tracked file. Split so self-test D can seed the text directly. */
const specifiersIn = (file: string): string[] =>
  specifiersInText(readFileSync(join(ROOT, file), "utf8"));

/**
 * Resolve one relative specifier against the importing file, to a repo-relative source path.
 * Handles the ESM `.js` -> `.ts` convention this repo writes, plus extensionless and directory
 * forms. A non-relative specifier (a bare package name) resolves to nothing and is ignored.
 */
function resolveSpecifier(fromFile: string, spec: string): string[] {
  if (!spec.startsWith(".")) return [];
  const base = toPosix(relative(ROOT, resolve(join(ROOT, dirname(fromFile)), spec)));
  const swapped = base.replace(/\.([cm]?)js$/, ".$1ts");
  return [base, swapped, `${base}.ts`, `${base}/index.ts`];
}

/**
 * The export-derived subject: every tracked module OUTSIDE `src/` that imports one of the
 * package's published source entry points, and EVERY ONE OF THEM MUST RUN.
 *
 * THERE IS NO EXEMPTION, AND THE ABSENCE IS THE RULE. `ncpdp` had two exemptions and a rename
 * walked through both. The cost of having none is paid once in the repo rather than in this file:
 * a module that is not a test may not import a PUBLISHED ENTRY POINT, and this repo had exactly
 * one, the child-process probe `test/helpers/run-date-shift.ts`, which now imports the two source
 * modules it actually exercises (`src/context.ts`, `src/transforms/date-shift.ts`) instead of
 * reaching them through the root entry. Same function objects, same proof, out of the subject
 * without an exemption existing for anything else to use.
 *
 * IT IS NOT SCOPED TO `test/`, deliberately, AND THE EXACT STRENGTH OF THAT IS MEASURED RATHER THAN
 * ASSERTED, because the first draft of this comment overclaimed it. A subject module moved to
 * `scripts/` or the repo root is still in the subject and still reds -- PROVIDED its specifiers
 * still resolve to an entry point. Seeded both ways: `git mv test/corpus/leak-corpus.test.ts
 * scripts/leak-corpus.ts` alone is GREEN, because the move leaves `../../src/index.js` resolving
 * outside the repo, so the file stops importing the entry points at all; the same move with its
 * seven specifiers repaired to `../src/...` is RED. A move that breaks the file's own imports is
 * the DELETE case in the limits below wearing different clothes, not a rename this rule sees. What
 * is genuinely closed is the rename that keeps the file working AND keeps its specifiers in a form
 * this resolves: any depth under `test/`, any name, any directory, including the `test/helpers/`
 * route that is `ncpdp`'s largest documented hole, and including a symlinked path to the same file.
 * Rewriting the specifiers themselves is a different move and is in the limits.
 */
function entryImporters(tracked: string[], entries: Map<string, string>): Map<string, string[]> {
  // Compare RESOLVED REAL PATHS, not path arithmetic. A refuter reached the entry points through a
  // tracked symlink (`test/entries -> ../src`, with specifiers rewritten to
  // `../entries/hl7/index.js`) that typechecked and ran, and comparing the arithmetic result as a
  // string did not see it. Two spellings of the same file are the same file, so resolve both sides
  // and ask the filesystem rather than the string.
  // A realpath can carry MORE THAN ONE entry point, so this maps to a LIST. Keying it to a single
  // source was last-write-wins, and a refuter showed what that costs: with two subpaths resolving to
  // one file (`ln -s x12/index.ts src/x12-legacy.ts` plus an `./x12-legacy` subpath) the gate red,
  // but it named `./x12` -- which has two selected importers -- rather than the one it meant. With
  // the list, that seed goes GREEN and correctly so (measured): when one source backs two subpaths,
  // a module importing that source exercises both, and the old red was an artifact of comparing
  // strings rather than files. A subpath with a source of its own and no importer still reds.
  // Fail-closed is not the same as fail-informatively, and self-test B's own rationale is that a
  // rule which reds on correct work gets disabled.
  const realToSrcs = new Map<string, string[]>();
  for (const src of entries.values()) {
    const real = realpathSync(join(ROOT, src));
    realToSrcs.set(real, [...(realToSrcs.get(real) ?? []), src]);
  }

  const bySubpath = new Map<string, string[]>();
  for (const subpath of entries.keys()) bySubpath.set(subpath, []);

  for (const f of tracked) {
    if (f.startsWith("src/") || !CODE_FILE.test(f)) continue;
    const hits = new Set<string>();
    for (const spec of specifiersIn(f)) {
      for (const cand of resolveSpecifier(f, spec)) {
        const abs = join(ROOT, cand);
        if (!existsSync(abs)) continue;
        for (const src of realToSrcs.get(realpathSync(abs)) ?? []) hits.add(src);
      }
    }
    for (const [subpath, src] of entries) {
      if (hits.has(src)) (bySubpath.get(subpath) as string[]).push(f);
    }
  }
  return bySubpath;
}

/** Flatten the per-subpath importer map to the set of modules that must run. */
const subjectOf = (bySubpath: Map<string, string[]>): string[] =>
  [...new Set([...bySubpath.values()].flat())].sort();

/**
 * Whether the shared CI caller switches the PHI scanner on. Paired with the presence of a
 * `phi-scan` package script, this is what makes "a suite must exercise the PHI scanner" a derived
 * requirement rather than an opinion held by this file. Ported directly: this repo has both.
 */
const phiScanEnabledIn = (yaml: string): boolean => /^\s*run-phi-scan:\s*true\s*$/m.test(yaml);

function ciEnablesPhiScan(): boolean {
  const p = join(WORKFLOW_DIR, "ci.yml");
  if (!existsSync(p)) refuse(".github/workflows/ci.yml is missing; cannot derive the PHI subject");
  return phiScanEnabledIn(readFileSync(p, "utf8"));
}

/**
 * Tracked modules under `test/` whose text references the PHI scanner. Keyed on CONTENT, not on
 * the filename, so renaming the suite does not remove it from the gate's subject. EVERY ONE OF
 * THEM MUST RUN.
 *
 * THE DIRECTION OF THIS RULE IS THE POINT, and it is the same direction as the import rule above:
 * text can only ADD a module here. Inverting it to "does at least one module that ACTUALLY RUNS
 * reference the scanner" was tried next door and is backwards, because a rename plus the words
 * `scripts/phi-scan.ts` in a comment in any running file then satisfies it with the suite no
 * longer running. Under PHI, a false red is the safe way to be wrong.
 *
 * THE RESIDUAL IS NOT CLOSED. Deleting the reference from the renamed suite AND planting one in a
 * running file leaves this green. The honest narrowing is to match an IMPORT SPECIFIER, which is
 * what the export rule above does, and it does not apply here because this repo's PHI suite spawns
 * the scanner as a subprocess and never imports it.
 */
const phiScannerSuites = (tracked: string[]): string[] =>
  tracked.filter(
    (f) =>
      f.startsWith("test/") &&
      CODE_FILE.test(f) &&
      /scripts[/\\]phi-scan/.test(readFileSync(join(ROOT, f), "utf8")),
  );

// ---------------------------------------------------------------------------
// THE CHECKS.

interface Violations {
  missing: string[];
  entry: string[];
  phi: string[];
}

/**
 * Applies every selection rule to one selection and returns what it found. Taking the selection as
 * a parameter is what lets the self-tests run the REAL rules against a DELIBERATELY NARROWED
 * selection, rather than against a mock of them.
 */
function violationsFor(
  tracked: string[],
  selected: string[],
  bySubpath: Map<string, string[]>,
  phiSuites: string[],
): Violations {
  // Set arithmetic and nothing else. No rule here reads the content of a selected file, so there
  // is no text for a rename or a planted comment to talk its way past.
  const running = new Set(selected);
  const missing = nameShapedTests(tracked).filter((f) => !running.has(f));

  const entry: string[] = [];
  for (const [subpath, importers] of bySubpath) {
    if (importers.length === 0) {
      entry.push(
        `published subpath "${subpath}" is imported by no tracked module outside src/, so nothing ` +
          "exercises the surface this package ships",
      );
      continue;
    }
    const dropped = importers.filter((f) => !running.has(f));
    if (dropped.length > 0) {
      entry.push(`"${subpath}": importing module(s) not selected: ${dropped.join(", ")}`);
    }
  }

  return { missing, entry, phi: phiSuites.filter((f) => !running.has(f)) };
}

const tracked = trackedFiles();
const selected = resolvedSelection();
const entries = exportedSourceEntries();
const bySubpath = entryImporters(tracked, entries);
const phiSuites = phiScannerSuites(tracked);
const scripts = pkg.scripts ?? {};

// The PHI subject, derived in two steps so neither half can go quiet on its own.
if (scripts["phi-scan"] !== undefined && !ciEnablesPhiScan()) {
  fail(
    "package.json defines a `phi-scan` script but .github/workflows/ci.yml does not set " +
      "`run-phi-scan: true`, so the PHI scanner ships without running in CI.",
  );
}
if (scripts["phi-scan"] !== undefined && phiSuites.length === 0) {
  fail(
    "no tracked module under test/ exercises scripts/phi-scan.ts. The PHI scanner is the floor " +
      "under every fixture in this repo; it does not get to be the one thing with no suite.",
  );
}

// The invocation rule. A path filter, an alternate config, a project filter or a shard on the
// command line narrows the run just as effectively as a narrowed glob, and leaves vitest.config.ts
// looking untouched.
for (const name of CI_TEST_SCRIPTS) {
  const body = scripts[name];
  if (body === undefined) {
    fail(
      `package.json has no \`${name}\` script, but the shared CI pipeline invokes it. A missing ` +
        `script is not a passing check.`,
    );
    continue;
  }
  if (!bodyIsAllowed(body)) {
    fail(
      `package.json script \`${name}\` is not an exactly-known-good vitest invocation:\n` +
        `      ${body}\n    ` +
        `Anything other than a bare \`vitest run [--coverage]\` can change WHICH FILES run, and ` +
        `resolving\n    the config cannot see it: a path filter, an alternate --config, a ` +
        `--project, a --shard, or a\n    delegation to another script that does any of those. If ` +
        `this body genuinely cannot narrow the\n    run, add it verbatim to ` +
        `ALLOWED_TEST_SCRIPT_BODIES in scripts/check-test-selection.ts, in its own\n    reviewed ` +
        `commit, with the reason.`,
    );
  }
}

const real = violationsFor(tracked, selected, bySubpath, phiSuites);
if (real.missing.length > 0) {
  fail(
    `${String(real.missing.length)} tracked test file(s) exist but are NOT selected by ` +
      `vitest.config.ts, so CI never runs them:\n    ${real.missing.join("\n    ")}`,
  );
}
for (const f of real.entry) fail(`published entry point: ${f}`);
if (real.phi.length > 0) {
  fail(
    `tracked module(s) under test/ reference scripts/phi-scan.ts but are NOT selected, so ` +
      `nothing that runs exercises the PHI scanner: ${real.phi.join(", ")}`,
  );
}

// ---------------------------------------------------------------------------
// SELF-TESTS (design rule 5). Seed the removal; require the catch.

/** Everything the two derived rules are supposed to protect. */
function protectedFiles(): Set<string> {
  return new Set<string>([...subjectOf(bySubpath), ...phiSuites]);
}

/**
 * Self-test A, against the comparison directly: drop each protected file from the selection ONE AT
 * A TIME, leaving every other file selected, and require THE DERIVED RULE THAT OWNS IT to name it.
 *
 * ONE AT A TIME IS THE ENTIRE POINT. The version of this next door that hid EVERY protected file at
 * once exercised only the direction where nothing is left to collide with, so it passed while two
 * rules were forgeable BY collision. A seed that hides everything proves only the collision-free
 * case. Hiding one file while all the rest stay selected IS the colliding case, by construction and
 * for every file in turn: when `test/corpus/leak-corpus.test.ts` is the only one hidden, six other
 * suites still import every entry point it imports, so a rule that asked "does anything running
 * import this entry" would pass here and this one does not.
 *
 * DEMANDING THE OWNING RULE, not merely "some rule", is the second half. Every protected file here
 * is also name-shaped, so accepting any rule would let the name floor answer for both derived rules
 * and this self-test would pass with both of them gutted -- which is measured next door as exactly
 * what happened. The name floor is explicitly not accepted as the answer below.
 */
function selfTestComparison(): void {
  const subject = subjectOf(bySubpath);
  const targets = [...protectedFiles()];
  if (targets.length === 0) refuse("self-test A has nothing to hide, so it would pass vacuously");

  for (const target of targets) {
    const v = violationsFor(
      tracked,
      selected.filter((f) => f !== target),
      bySubpath,
      phiSuites,
    );
    if (subject.includes(target) && !v.entry.some((l) => l.includes(target))) {
      refuse(
        `self-test A FAILED: dropping ${target}, which imports a published entry point, was not ` +
          "reported by the export-derived rule, with every other file left selected. The detector " +
          "cannot detect.",
      );
    }
    if (phiSuites.includes(target) && !v.phi.includes(target)) {
      refuse(
        `self-test A FAILED: dropping the PHI-scanner suite ${target} was not reported by the PHI ` +
          "rule, with every other file left selected. The detector cannot detect.",
      );
    }
  }
}

/**
 * Self-test B, against the invocation rule.
 *
 * EVERY POSITIVE HERE IS A ROUTE A REFUTER ACTUALLY FOUND next door, and the list is append-only
 * for that reason. Note especially the last group: bodies containing no `vitest` token at all. The
 * rule this replaced tokenised arguments after a whole-word `vitest`, so those bodies produced no
 * arguments and were reported as PASSING. Every sample in that table contained a `vitest` token,
 * which is exactly why the self-test did not catch it: the table tested the rule's behaviour and
 * never its ENTRY CONDITION. If a future version of this rule starts interpreting the body again,
 * these are the samples that must still red.
 */
function selfTestInvocationRule(): void {
  const positives = [
    // Positional path filters, both spellings of the run flag.
    "vitest run test/hl7",
    "vitest --run test/hl7 test/x12",
    "vitest run --coverage test/hl7",
    // The one that would drop this repo's headline gate specifically.
    "vitest run --coverage --exclude test/corpus",
    // Flag-form narrowings.
    "vitest run --coverage --config=vitest.ci.config.ts",
    "vitest run --coverage -c vitest.ci.config.ts",
    "vitest run --coverage --project=unit",
    "vitest run --coverage --dir=test/hl7",
    "vitest run --coverage --shard=1/4",
    "vitest run --coverage -t somePattern",
    "vitest run --coverage --changed",
    "vitest run --coverage --flag-this-file-has-never-heard-of",
    // Chained: the narrowing lives in the SECOND invocation.
    "vitest run --coverage && vitest run test/hl7",
    // The argument value ends in the word `vitest`, which broke one tokenizer next door.
    "vitest run --dir=vitest",
    "vitest run --coverage --config=my-vitest",
    // NO `vitest` TOKEN AT ALL. These are the ones that shipped green.
    "pnpm run test:unit",
    "node node_modules/vitest/vitest.mjs run --coverage test/hl7",
    "sh -c 'vitest run --coverage test/hl7'",
    'bash -c "vitest run test/hl7"',
    "echo skipping tests",
    "",
  ];
  const negatives = ["vitest run", "vitest run --coverage", "  vitest   run  --coverage  "];

  for (const p of positives) {
    if (bodyIsAllowed(p)) {
      refuse(
        `self-test B FAILED: \`${p}\` can change which files vitest runs, or hides what does, ` +
          "and the invocation rule accepted it. The detector cannot detect.",
      );
    }
  }
  for (const n of negatives) {
    if (!bodyIsAllowed(n)) {
      refuse(
        `self-test B FAILED: \`${n}\` cannot narrow the file set, but the invocation rule ` +
          "rejected it. A rule that reds on correct work gets disabled.",
      );
    }
  }
}

/**
 * Self-test C, end to end through real vitest: resolve a genuinely narrowed config and require the
 * same rules to red on it. This proves the OBSERVATION CHANNEL works, not just the arithmetic; if
 * `vitest list` ever stops reporting what it runs, or the root resolves somewhere unexpected,
 * self-test A would still pass and this will not.
 *
 * The narrowed config keeps exactly one test file, chosen at run time, so there is no hardcoded
 * filename here to go stale. It prefers a test outside the protected subjects so that every
 * protected file is dropped and must be reported, and FALLS BACK to any tracked test when there is
 * none: 31 of this repo's 33 test files are already protected, and an earlier draft that required a
 * non-protected one REFUSED outright when the single spare (`test/docs-content.test.ts`) was
 * renamed -- a gate that stops reporting because the repo got better covered. The kept file is
 * excluded from what the drop must report, since it is the one file still running. It is written to
 * an OS temp dir,
 * never into the repo: this tree has suites that read fixture directories, and seeding files inside
 * the repo to test tooling is how a sibling change nearly hard-reddened a required check. It also
 * carries no imports, so nothing needs resolving from outside the repo.
 */
function selfTestNarrowedConfig(): void {
  const excluded = protectedFiles();
  const namedTests = nameShapedTests(tracked);
  const keep = namedTests.find((f) => !excluded.has(f)) ?? namedTests[0];
  if (keep === undefined) {
    refuse("no tracked test file exists at all, so self-test C has nothing to narrow to");
  }

  const dir = mkdtempSync(join(tmpdir(), "deid-selection-selftest-"));
  try {
    const cfg = join(dir, "narrowed.config.ts");
    writeFileSync(cfg, `export default { test: { include: ${JSON.stringify([keep])} } };\n`);
    const narrowed = resolvedSelection(cfg);
    if (narrowed.length !== 1 || narrowed[0] !== keep) {
      refuse(
        `self-test C FAILED: the narrowed config resolved to [${narrowed.join(", ")}] rather than ` +
          `[${keep}], so this gate is not observing what it thinks it is observing.`,
      );
    }
    const v = violationsFor(tracked, narrowed, bySubpath, phiSuites);
    // Each rule is required to red only over what the narrowing actually hid: the one kept file is
    // still running, so nothing owes a report about it.
    if (subjectOf(bySubpath).some((f) => f !== keep) && v.entry.length === 0) {
      refuse(
        "self-test C FAILED: a real narrowing hid every module importing a published entry point " +
          "and the export-derived rule was green.",
      );
    }
    if (phiSuites.some((f) => f !== keep) && v.phi.length === 0) {
      refuse("self-test C FAILED: a real narrowing hid the PHI suite and the PHI rule was green.");
    }
    const missed = [...excluded].filter(
      (f) => f !== keep && !v.missing.includes(f) && !v.phi.includes(f),
    );
    const stillUnreported = missed.filter((f) => !v.entry.some((line) => line.includes(f)));
    if (stillUnreported.length > 0) {
      refuse(
        "self-test C FAILED: a real, narrowed vitest config dropped these files and no rule " +
          `reported them:\n    ${stillUnreported.join("\n    ")}`,
      );
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Self-test D, against THREE NAMED DERIVATIONS. It exists because a refuter proved the other three
 * self-tests could not see any of them, and its scope is stated narrowly because a later pass
 * proved the first description of it was wider than the code.
 *
 * WHAT IT COVERS, exactly and only:
 *   1. the PHI-enablement rule, against enabled and disabled workflow text;
 *   2. the specifier extractor, against every spelling that reaches a module at run time;
 *   3. the COUNT of exported subpaths, against the number `package.json` declares.
 *
 * ▶ WHAT IT DOES NOT COVER, measured rather than reasoned about:
 *   * IT DOES NOT CHECK THAT EACH SUBPATH MAPS TO ITS OWN SOURCE. Rule 3 is a count. Setting every
 *     entry to `src/dicom/index.ts` keeps the count at 7, collapses the subject from 31 modules to
 *     3, and this file prints OK saying all four self-tests reddened.
 *   * IT DOES NOT COVER `resolveSpecifier`. An `if (fromFile.startsWith("test/corpus/")) return [];`
 *     there takes the corpus out of the subject with every self-test green -- the hand-editable
 *     exclusion design rule 1 forbids, re-added below the self-tests' notice.
 *
 * NEITHER GAP IS ANSWERED WITH MORE MACHINERY, deliberately. A derivation has no closed set of
 * spellings to enumerate, which is the same reason the invocation rule stopped parsing; a self-test
 * E would buy one more spelling and the next pass would find the next. What it buys instead is this
 * paragraph, and the OK line's numbers, which a reviewer can compare against a diff that touches
 * either function.
 */
function selfTestDerivations(): void {
  // The PHI enablement rule, both directions. A rule gutted to always answer yes fails here.
  for (const y of ["    with:\n      run-phi-scan: true\n", "run-phi-scan: true"]) {
    if (!phiScanEnabledIn(y)) {
      refuse("self-test D FAILED: the PHI-enablement rule did not recognise `run-phi-scan: true`");
    }
  }
  for (const y of [
    "    with:\n      run-phi-scan: false\n",
    "# run-phi-scan: true is what this used to say\n      run-phi-scan: false\n",
    "    with:\n      run-actionlint: true\n",
    "",
  ]) {
    if (phiScanEnabledIn(y)) {
      refuse(
        "self-test D FAILED: the PHI-enablement rule reported the scanner enabled over a workflow " +
          "that does not enable it. A derived rule that always answers yes is not a rule.",
      );
    }
  }

  // The specifier extractor, every spelling that reaches a module at run time. THE BACKTICK ROW IS
  // A ROUTE A REFUTER ACTUALLY WALKED: with `"` and `'` only, rewriting the corpus's imports to a
  // backtick dynamic import took it out of the subject while it still ran.
  const sample = [
    'import { a } from "./double.js";',
    "import { b } from './single.js';",
    "const { c } = await import(`./backtick.js`);",
    'const d = require("./required.js");',
    'export { e } from "./reexport.js";',
    'import type { F } from "./typeonly.js";',
    "import {\n  g,\n} from './multiline.js';",
  ].join("\n");
  const found = new Set(specifiersInText(sample));
  for (const want of [
    "./double.js",
    "./single.js",
    "./backtick.js",
    "./required.js",
    "./reexport.js",
    "./typeonly.js",
    "./multiline.js",
  ]) {
    if (!found.has(want)) {
      refuse(
        `self-test D FAILED: the specifier extractor missed \`${want}\`. A spelling it cannot see is ` +
          "a module that leaves the subject while still importing the published surface, which is " +
          "exactly the hole this self-test was added for.",
      );
    }
  }

  // The export derivation. Every subpath whose target is a conditions object must have produced an
  // entry; a derivation narrowed to some of them would leave this short.
  const declared = Object.entries(pkg.exports ?? {}).filter(
    ([, v]) => typeof v === "object" && v !== null,
  ).length;
  if (entries.size !== declared) {
    refuse(
      `self-test D FAILED: package.json declares ${String(declared)} subpath(s) with a conditions ` +
        `object but the derivation produced ${String(entries.size)} source entry point(s). A ` +
        "subject derived from only some of the published surface protects only some of it.",
    );
  }
}

selfTestComparison();
selfTestInvocationRule();
selfTestNarrowedConfig();
selfTestDerivations();

// ---------------------------------------------------------------------------
// REPORT.

if (failures.length > 0) {
  process.stderr.write(
    `\ncheck-test-selection: FAILED (${String(failures.length)} problem(s))\n\n` +
      failures.map((f) => `  - ${f}`).join("\n\n") +
      "\n\n" +
      "  A required job gates its steps, not what those steps select. The suites above include " +
      "the leak\n  and over-scrub corpus, which is the floor under this library's zero-leak " +
      "claim, and the coverage\n  gate measures src/ only, so dropping them costs no coverage " +
      "percent at all.\n\n" +
      "  THE FIX IS TO MAKE THEM RUN. If a module is a TEST, widen the selection. If it genuinely " +
      "is NOT\n  a test, it must stop importing a PUBLISHED ENTRY POINT and import the source " +
      "module it actually\n  needs instead, which is what test/helpers/run-date-shift.ts does. " +
      "There is deliberately no\n  exemption to qualify for and no list to add a name to: every " +
      "module that imports the package's\n  published surface runs, whatever it is called and " +
      "wherever it lives.\n\n" +
      "  MOVING THE FILE IS NOT A FIX HERE, and that is on purpose. This subject is not scoped to " +
      "test/,\n  so a working suite moved to scripts/ or the repo root is still required to run " +
      "and still cannot be,\n  which reds until it is either a real test again or genuinely stops " +
      "touching the public surface.\n  A move that also breaks its own relative imports is not a " +
      "move, it is a deletion, and this gate\n  says so in its limits rather than pretending to " +
      "catch it.\n",
  );
  process.exit(1);
}

const named = nameShapedTests(tracked);
const subject = subjectOf(bySubpath);
const extra = selected.filter((f) => !tracked.includes(f));

/**
 * THE DENOMINATOR. Tracked code modules under `test/` that NO rule here looks at: not name-shaped,
 * not importing a published entry point, not referencing the PHI scanner. An `OK` printed without
 * the number it is an `OK` over is how a narrowing goes quiet, which is this repo's own PHI gate's
 * lesson. A rename out of the `.test.` shape THAT STAYS UNDER `test/` moves a file INTO this count
 * unless a derived rule reaches it, so a reviewer watching it go 3 -> 4 sees the hole being used
 * even though no rule reds. IT IS NOT A UNIVERSAL TRIPWIRE: a rename that also leaves `test/` drops
 * out of this count, leaving only the name-shaped total moving, which nothing compares against a
 * baseline. It is deliberately a number and not a failure: genuine fixture helpers live here, and a
 * gate that reds on a helper gets disabled.
 */
const unwatched = tracked.filter(
  (f) =>
    f.startsWith("test/") &&
    CODE_FILE.test(f) &&
    !named.includes(f) &&
    !phiSuites.includes(f) &&
    !subject.includes(f),
);

process.stdout.write(
  `check-test-selection: OK (${String(named.length)} name-shaped test file(s), all selected by ` +
    `vitest.config.ts; ${String(entries.size)} published subpath(s) ` +
    `[${[...entries.keys()].join(", ")}] each imported by at least one tracked module outside ` +
    `src/, and all ${String(subject.length)} such module(s) selected; ` +
    `${String(phiSuites.length)} tracked module(s) referencing scripts/phi-scan.ts, all selected; ` +
    `${String(CI_TEST_SCRIPTS.length)} CI test script(s) have an exactly-known-good body; ` +
    `all four self-tests reddened as required. ` +
    `${String(unwatched.length)} tracked module(s) under test/ are watched by NO rule ` +
    `(not name-shaped, no published-entry import, no PHI reference): ` +
    `${unwatched.length > 0 ? unwatched.join(", ") : "none"}. A suite renamed out of the ` +
    `.test./.spec. shape that no derived rule reaches lands in that count rather than reddening ` +
    `anything; one that also leaves test/ leaves this count too, and only the name-shaped total ` +
    `above moves` +
    (extra.length > 0 ? `; note ${String(extra.length)} selected file(s) are untracked` : "") +
    `)\n`,
);
