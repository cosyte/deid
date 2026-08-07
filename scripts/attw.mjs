#!/usr/bin/env node
/**
 * scripts/attw.mjs: the `attw` publish gate, made to report its own failure.
 *
 * ▶ WHY THIS WRAPPER EXISTS: `attw` PRINTS "This package does not contain types."
 *   AND EXITS 0. That is not a bug in `attw`: an untyped package is a legitimate
 *   npm package, so the CLI treats "no types at all" as a *description*, not a
 *   problem. From `@arethetypeswrong/cli@0.18.4`,
 *   `node_modules/@arethetypeswrong/cli/dist/getExitCode.js`, first statement:
 *
 *       export function getExitCode(analysis, opts) {
 *           if (!analysis.types) {
 *               return 0;
 *           }
 *
 *   The problem list is consulted only *after* that early return, so no
 *   `--profile`, `--ignore-rules` or config setting can reach it. For a package
 *   that ships types, "does not contain types" does not mean "fine, untyped":
 *   it means THE TYPES WERE NOT IN THE TARBALL, which is a broken publish. The
 *   gate says nothing, and its caller reads the 0. A false red costs an hour;
 *   A FALSE GREEN MERGES.
 *
 * ▶ MEASURED ON THIS PACKAGE, with the real invocation (`--profile node16`),
 *   because the numbers and the outcomes do not port with the code. No version is
 *   quoted, deliberately: a quoted one drifts, and the tree is what was measured.
 *
 *     dist absent entirely              -> "does not contain types", exit 0
 *     dist built, every .d.ts/.d.cts
 *       deleted, JS left in place       -> "does not contain types", exit 0
 *     dist built, only the ENTRY
 *       declarations deleted            -> real problems reported, exit 1
 *     dist built, only index.mjs and
 *       index.cjs deleted               -> every node16 resolution still 🟢, exit 0
 *
 *   DO NOT WRITE "No problems found" INTO THAT FOURTH ROW. That sentence is what a
 *   single-entry FIXTURE prints, and a draft of this file generalised it to the
 *   package, where it is false: `render/typed.js` emits it only when the problem
 *   list is empty, and this package always carries ignored node10 `NoResolution`
 *   problems, so it is absent even from a PRISTINE run here. Measured both ways.
 *
 *   The third line is where this package differs from a single-entry one and it
 *   is why the preflight message below does not predict an exit code. `tsup`
 *   emits shared declaration chunks (`dist/manifest-*.d.ts` and friends) that
 *   `package.json` never names, so a PARTIAL loss of declarations still leaves
 *   `analysis.types` true and `attw` does its job. It is TOTAL loss that is
 *   silent, and total loss is exactly the shape of the build window below.
 *   The fourth line is why the preflight must exist at all: a missing JS entry
 *   point is invisible to a tool that analyses types.
 *
 * ▶ THE TRIGGER IS THE BUILD ORDER, NOT CONCURRENCY. `tsup` emits JS in one pass
 *   and the declaration files in a later pass, so there is a window in every
 *   build where `dist/` holds `.mjs`/`.cjs` and no declarations at all: the
 *   second line of the table above. Measured here from `dist/index.mjs`
 *   appearing to `dist/index.d.ts` appearing: 6.9 s and 10.0 s on two builds of
 *   this package. Do not read those as a constant; this box runs under a hard
 *   2.0-CPU quota and the figure moves with load. A concurrent build or a
 *   `pnpm clean` in the same working tree lands `attw` in that window, but so
 *   does anything else that removes the output, which is why this is not
 *   answered with a lock or a build queue: the gate is supposed to be able to
 *   tell you its own inputs were missing, whatever removed them.
 *
 * ▶ TWO NETS, and they catch different things, keep both:
 *
 *   1. PREFLIGHT (structural, no string matching). Every relative artifact path
 *      `package.json` promises (`main`, `module`, `types`, `typings`, and every
 *      string leaf of `exports`) must exist and be non-empty before `attw` runs.
 *      That is a per-entry-point subject here, not a root one, and it NAMES the
 *      missing paths instead of leaving the reader to infer them. No count is
 *      written down, because a count here is a function of `exports` and drifts
 *      the next time a subpath is added; `declaredArtifacts()` below derives it.
 *      It is also the only net that reaches a missing JS entry point.
 *
 *   2. POST-CHECK. If `attw` still reports an untyped package, fail. The preflight
 *      cannot see this case: the declaration files can be present on disk and
 *      still be absent from the tarball, because `files` (or `.npmignore`) left
 *      them out. No instance of that is on record in this repo: `files` is
 *      `["dist", "README.md", "LICENSE", "CHANGELOG.md"]` and there is no
 *      `.npmignore`: it is the case `attw --pack` exists to catch, and the whole
 *      point here is that it catches it silently.
 *
 *   The post-check matches `attw`'s untyped sentence, which is a plain,
 *   un-chalked string in `dist/render/untyped.js`. That makes it blindable, so the
 *   arguments and config that would blind it are REFUSED rather than tolerated:
 *   see BLINDING below. `test/scripts/attw-gate.test.ts` pins both nets against
 *   the real binary, so if an `attw` upgrade reworks the wording or fixes the exit
 *   code, the suite reds and tells you to revisit this file rather than letting
 *   the net go quietly slack.
 *
 * ▶ BLINDING. Three routes were measured against this repo's own `attw` binary to
 *   restore the exact false green, each by making the untyped sentence absent from
 *   what this script can read: `--quiet` (output goes to a sink), `--format json`
 *   (the JSON render omits the sentence), and a `.attw.json` setting either of
 *   those, which `readConfig()` applies after argv. All three exit 0 with the
 *   sentence gone, so refusing them is not a regression against the old script:
 *   it is the difference between a gate and a gate-shaped thing. The measurement
 *   is not left as a sentence here: `test/scripts/attw-gate.test.ts` re-runs each
 *   spelling (`--quiet`, `-q`, `--format json`, `-f json`, `--format=json`, the
 *   clusters `-Pf json` and `-Pq`, and the config key) through the real binary and
 *   asserts the blinding on every one of them, so a future
 *   attw that stops blinding on one reds instead of leaving a refusal standing on
 *   a claim nobody re-checked.
 *
 *   `--config-path` is refused as well, BY INFERENCE AND NOT BY MEASUREMENT: it
 *   would move the config file out of view. No run of it was taken, and the suite
 *   pins only the refusal for that one. Do not let the two grow together.
 *
 *   THE REFUSAL IS BY OPTION NAME AND NEVER BY VALUE, AND WHAT "BY NAME" MATCHES IS
 *   WORTH STATING EXACTLY, BECAUSE A LOOSER SENTENCE HERE WAS ALREADY WRONG ONCE.
 *   It matches an argv token whose part before any `=` is one of the names above,
 *   AND any COMBINED SHORT-OPTION CLUSTER containing `q` or `f`: commander accepts
 *   `-Pf json`, which is `--pack --format json`, and an earlier draft of this guard
 *   let it through: measured, `-Pf json` returned the JSON render (no sentence, and
 *   a non-empty transcript, so neither net fired) and this wrapper EXITED 0 over an
 *   untyped pack. `attw --help` at `0.18.4` lists SIX short options: `-P`, `-p`,
 *   `-q`, `-f`, `-V` and commander's `-h`, and none of the four that are not `q`
 *   or `f` gives a legitimate reason to cluster one in, so the match costs no
 *   spelling anyone would type. (Derived from `--help`, not from memory: a draft
 *   of this very sentence said "only four" and a refuter found `-V` and `-h`.)
 *   Value-blind is deliberate: `--format table-flipped` prints the sentence and
 *   blinds nothing, and is refused anyway. Value-parsing these would be a third
 *   moving part in the guard, and being over-strict about an argument nobody passes
 *   to a repo's own publish gate costs less than a route back to a false green.
 *   THIS IS NOT A CLAIM THAT NO SPELLING REMAINS. It is a claim about two matched
 *   shapes, both pinned in the suite. The empty-transcript net below exists for the
 *   route nobody enumerated, and if a new one turns up, the honest fix may be to
 *   correct this paragraph rather than to grow the guard again.
 *
 * Other arguments are forwarded, which is what keeps `--profile node16` (the
 * flag this package's `attw` script has always carried) doing exactly what it
 * did before. That is asserted, not assumed: the suite pins a fixture that exits
 * 1 without the flag and 0 with it, through this wrapper.
 */

import { spawnSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ATTW_BIN = fileURLToPath(new URL("../node_modules/.bin/attw", import.meta.url));
const UNTYPED = "This package does not contain types.";
const DECLARATION = /\.d\.[cm]?ts$/;
const args = process.argv.slice(2);

const die = (msg) => {
  process.stderr.write(`\n✗ attw gate: ${msg}\n`);
  process.exit(1);
};

// ---- Refuse what would blind the post-check --------------------------------
// SHORT_CLUSTER is the second shape, not a second guard: commander lets `-Pf json`
// mean `--pack --format json`, so `-f` never appears as a token. attw's short
// options at 0.18.4 are -P, -p, -q, -f, -V and -h (from `attw --help`, counted
// there and not from memory), so a cluster carrying q or f is always a blinding one.
const BLINDING = new Set(["-q", "--quiet", "-f", "--format", "--config-path"]);
// A single `-` followed by letters only, at least one of them q or f. `--quiet` and
// `--format` cannot match (the second `-` is not a letter); `-P` and `-p` cannot.
const SHORT_CLUSTER = /^-[A-Za-z]*[qf][A-Za-z]*$/;
const blinding = args.filter((a) => {
  const name = a.split("=")[0];
  return BLINDING.has(name) || SHORT_CLUSTER.test(name);
});
if (blinding.length > 0) {
  die(
    `${blinding.join(", ")} is refused wholesale, by option name and not by value.\n` +
      `  This gate reads attw's printed output, attw exits 0 on an untyped package,\n` +
      `  and some values of these options hide that output. Run it without them.`,
  );
}
try {
  const config = JSON.parse(readFileSync(".attw.json", "utf8"));
  const set = ["quiet", "format"].filter((k) => k in config);
  if (set.length > 0) {
    die(
      `.attw.json sets ${set.join(", ")}. These keys are refused wholesale, by name and\n` +
        `  not by value: readConfig() applies them after argv, this gate reads attw's\n` +
        `  printed output, and attw exits 0 on an untyped package.`,
    );
  }
} catch {
  // No .attw.json, or unreadable/invalid: attw itself reports the latter.
}

/** Every relative path `package.json` promises to ship, deduped. */
function declaredArtifacts(pkg) {
  const found = new Set();
  const add = (v) => {
    if (typeof v !== "string") return;
    // Skip wildcard subpath patterns (they name a set, not a file) and the
    // manifest itself, which is always in the tarball by definition.
    if (!v.startsWith(".") || v.includes("*") || v === "./package.json") return;
    found.add(v);
  };
  for (const key of ["main", "module", "types", "typings"]) add(pkg[key]);
  const walk = (node) => {
    if (typeof node === "string") add(node);
    else if (node && typeof node === "object") for (const v of Object.values(node)) walk(v);
  };
  walk(pkg.exports);
  return [...found];
}

let pkg;
try {
  pkg = JSON.parse(readFileSync("package.json", "utf8"));
} catch (err) {
  die(`cannot read ./package.json from ${process.cwd()}: ${err.message}`);
}

// ---- Net 1: preflight -------------------------------------------------------
const broken = [];
for (const rel of declaredArtifacts(pkg)) {
  let size;
  try {
    size = statSync(rel).size;
  } catch {
    broken.push({ rel, why: "missing" });
    continue;
  }
  if (size === 0) broken.push({ rel, why: "empty" });
}
if (broken.length > 0) {
  // Only talk about attw's silence when a DECLARATION file is among the
  // casualties, and even then do not predict its exit code: measured on this
  // package, NO declarations in the tarball is the silent exit 0, while SOME
  // missing still leaves attw enough to report and exit non-zero. With the
  // declarations intact and only JS missing, attw reports every node16 resolution
  // green and exits 0: a different silence, not this one, and NOT the words
  // "No problems found", which this package never prints (see the header table).
  const declarationsHit = broken.some(({ rel }) => DECLARATION.test(rel));
  die(
    `package.json promises files the build has not produced:\n` +
      broken.map(({ rel, why }) => `    ${rel} (${why})\n`).join("") +
      `\n  Run the build first. If you DID build, something removed or truncated the\n` +
      `  output underneath this run: a concurrent build or \`clean\` in the same\n` +
      `  working tree will do it, and \`tsup\` writes JS before declarations, so there\n` +
      `  is a window where the .d.ts files do not exist yet.\n` +
      (declarationsHit
        ? `  Declarations are among them, so attw cannot be relied on to say so: with NO\n` +
          `  declarations in the tarball it prints "${UNTYPED}" and EXITS 0,\n` +
          `  and with only some missing it reports real problems and exits non-zero.\n`
        : `  attw does not gate these: it analyses types, and exits 0 here.\n`),
  );
}

// ---- Run attw ---------------------------------------------------------------
const res = spawnSync(ATTW_BIN, ["--pack", ".", ...args], {
  encoding: "utf8",
  stdio: ["inherit", "pipe", "pipe"],
});
if (res.error) die(`could not run ${ATTW_BIN}: ${res.error.message}`);
const output = `${res.stdout ?? ""}${res.stderr ?? ""}`;
process.stdout.write(res.stdout ?? "");
process.stderr.write(res.stderr ?? "");

// EVERYTHING FROM HERE SETS `process.exitCode` AND FALLS OFF THE END rather than
// calling `process.exit()`. attw's transcript was just written, and on macOS a
// write to a pipe is asynchronous, so exiting here could truncate the output the
// reader needs. (The `die()`s above run before any bulk output and carry one short
// message, which is why they keep the simpler form.)
if (res.status !== 0) {
  process.exitCode = res.status ?? 1;
} else if (output.trim() === "") {
  // ---- Net 2: post-check ----------------------------------------------------
  // An empty transcript means the post-check read nothing, by some route not listed
  // under BLINDING above. Treat that as a failure rather than as a pass: this gate
  // is only as good as the output it got to see.
  process.stderr.write(
    `\n✗ attw gate: attw exited 0 but printed nothing, so nothing was checked.\n`,
  );
  process.exitCode = 1;
} else if (output.includes(UNTYPED)) {
  process.stderr.write(
    `\n✗ attw gate: attw reported "${UNTYPED}" and exited 0.\n` +
      `  This package ships types, so that means the tarball did not carry them:\n` +
      `  check the "files" field and .npmignore. Reported as a failure here because\n` +
      `  attw's own exit code cannot: getExitCode() returns 0 whenever the analysis\n` +
      `  found no types at all, before it ever looks at the problem list.\n`,
  );
  process.exitCode = 1;
}
