#!/usr/bin/env tsx
/**
 * `@cosyte/deid` PHI scanner — the CI / pre-commit half of the PHI commit-gate.
 *
 * Pure Node. Zero runtime deps. `git` is the only subprocess, always via
 * `execFileSync` with array args (never shell-form). Sweeps `src/`, `test/` and
 * `scripts/` and REFUSES anything that looks like real PHI, so a developer
 * cannot commit a real-looking fixture — or a real-looking inline literal in a
 * test — by accident.
 *
 * ===========================================================================
 * ██  COVERAGE — READ BEFORE YOU RELY ON THIS  ██████████████████████████████
 * ===========================================================================
 *
 *   Two layers run on every target:
 *
 *     FLOOR (any format): (1) a dashed SSN (\d{3}-\d{2}-\d{4}); (2) an email at
 *       a non-test domain.
 *     HL7 v2 STRUCTURED (`scanHl7Structured`): every PID/NK1/GT1/IN1/IN2 PHI
 *       field (names, DOB, SSN, MRN/member id, street/city, phone) is checked
 *       against the synthetic allow-list — a real value there is a HARD HIT.
 *     C-CDA STRUCTURED (`scanCcdaStructured`): every header person-name / address
 *       element (given/family/prefix/suffix/name/street/city/county) and
 *       `birthTime` is checked against the allow-list — a real value there is a
 *       HARD HIT. Scoped to the header (a body `<name>` can be a drug name).
 *     X12 STRUCTURED (`scanX12Structured`): the patient-entity NM1 name/id, DMG
 *       DOB, and PHI-qualified REF value are checked against the allow-list — a
 *       real value there is a HARD HIT. Provider-entity NM1 names are retained
 *       and NOT checked (a provider/org name is not the individual's PHI).
 *     NCPDP TELECOM STRUCTURED (`scanTelecomStructured`): each patient /
 *       cardholder / prescriber PHI field (by its globally-unique 2-char id) is
 *       checked against the allow-list — a real value there is a HARD HIT.
 *
 *   ⚠  Still-open gaps (do NOT treat green as "no PHI" for these): HL7 free text
 *      (OBX-5 / NTE-3 narrative), C-CDA narrative `<text>` blocks and `<id>`
 *      extensions, X12 free-text / retained-segment residuals, NCPDP SCRIPT (XML,
 *      de-id deferred), and FHIR / DICOM have NO structured detector yet — add one
 *      with each format's phase (roadmap §7, the eventual union scanner). Add
 *      positive tests proving each new detector CATCHES real names / DOBs / ids.
 *
 *   ⚠  AND THE GAPS THAT ARE ABOUT THE *CONTAINER*, NOT THE FORMAT. Every detector
 *      above has to RECOGNISE the document before it checks anything, and a
 *      hand-written source file is not the shape any of them was written for.
 *      Each recogniser was widened for that (an MSH found anywhere and falling
 *      back to the default delimiters, an ISA header found anywhere, indented
 *      segments, and the source-literal view in `sourceLiteralDocument`), and
 *      NONE of it is a claim that arbitrary embedded text is reached:
 *        - a C-CDA is recognised by its `urn:hl7-org:v3` namespace and an NCPDP
 *          Telecom transmission by its control-char framing, so a fragment
 *          carrying neither is covered by the FLOOR only;
 *        - a message assembled at run time from pieces no literal contains is
 *          not text this scan can see at all;
 *        - a delimiter set that differs BETWEEN two documents in one file is read
 *          with the first document's, and prose that satisfies ISA's fixed
 *          widths by accident would be preferred to the real header below it;
 *        - a segment broken across lines is read both ways (line by line and
 *          rejoined), but a segment broken across two SOURCE LITERALS is not
 *          rejoined.
 *      When you widen a recogniser, prove it with a case that is RED before and
 *      GREEN after — a recogniser that quietly matches nothing reports "no hits".
 *
 *   Worked examples of structured, format-aware detection live in the sibling
 *   parsers — read one before you start:
 *       ../hl7/scripts/phi-scan.ts     (segment → field → component aware)
 *       ../x12/scripts/phi-scan.ts     (ISA-delimited NM1 / DMG / PER aware)
 *       ../dicom/scripts/phi-scan.ts   (binary tag-aware)
 *       ../ccda/scripts/phi-scan.ts    (XML element aware)
 *       ../ncpdp/scripts/phi-scan.ts   (fixed-field aware)
 *
 *   The mechanism for declaring genuinely-synthetic identifiers is the
 *   allow-list (`scripts/phi-allow-list.txt`) — a positive declaration that a
 *   fixture's identifiers are fake. Byte-strict formats cannot carry an inline
 *   `# synthetic: true` header, so the allow-list is the proven substitute
 *   (same approach every sibling uses). A whole-file bypass needs
 *   `--allow-fixture <path>` AND a logged entry in `phi-scan-overrides.md`.
 * ===========================================================================
 *
 * Modes:
 *   --staged                 - scan only files staged in `git diff --cached`
 *   --allow-fixture <path>   - bypass one path; rejected unless logged in
 *                              phi-scan-overrides.md, and rejected unless the
 *                              path is a real regular file inside a scan root.
 *                              COMBINES WITH EVERY MODE, including `--staged`
 *                              and the all-mode sweep, and every bypass it
 *                              applies is announced on stderr.
 *   <path> [<path>...]       - scan specific paths
 *   (no args)                - scan all in-scope working-tree files
 *
 * Exit codes: 0 (clean), 1 (HITS FOUND), 2 (the scan could not be performed).
 * Exit 1 is a claim about the corpus and NOTHING but a hit may spend it — see
 * the contract note on `main`, which is where a missing allow-list and an
 * unreadable directory used to leak out as an uncaught exception (exit 1).
 *
 * ---------------------------------------------------------------------------
 * THE SCAN ROOTS ARE `src/`, `test/` AND `scripts/`, ON BOTH ROUTES, AND THAT IS
 * A WIDENING — the other half of the narrowing the non-regular-entry refusal
 * below performed. Previously the walk covered `test/fixtures/` + `src/`, and
 * `--staged` covered `test/fixtures/**` + `src/**.ts`. This repo keeps its
 * document text INLINE IN `.ts` TEST MODULES rather than in `test/fixtures/`, so
 * 38 tracked files under `test/` — four of them already carrying HL7 `PID|…`
 * literals — were enumerated by NEITHER route, and a real name or MRN pasted
 * into one committed with both gates green, in the de-identification package.
 * `SCAN_ROOT_NAMES` carries the full derivation, including what is still out of
 * scope and why a sibling's root list must not be pasted over it.
 * ---------------------------------------------------------------------------
 *
 * ---------------------------------------------------------------------------
 * AN IN-SCOPE ENTRY THAT IS NOT A REGULAR FILE REFUSES THE SCAN (exit 2). It is
 * never silently skipped, because BOTH enumerating routes are blind to it in a
 * way that reads as clean:
 *
 *   - the walk enumerates `Dirent.isFile()`, which is an lstat answer, so a
 *     symbolic link is neither a file nor a directory and used to fall out of
 *     the loop silently, whatever it pointed at. `isDirectory()` is an lstat
 *     answer too, so a linked DIRECTORY took a whole subtree with it;
 *   - `--staged` reads content with `git show :<path>`, and git stores a
 *     symbolic link as its TARGET PATH under mode 120000, so that route is
 *     handed the path text and never the target's bytes. That route is this
 *     repo's pre-commit hook (`pnpm phi-scan --staged`).
 *
 * So a link under a scan root pointing at a PHI-bearing file scanned CLEAN on
 * both, in the package whose whole job is removing PHI. Neither route is made to
 * follow it: following would read bytes the enumeration does not control
 * (outside the repo, a loop, a device, a FIFO that blocks the gate forever), and
 * git does not carry those bytes anyway, so a hit on them would be a claim about
 * something no commit contains. Refusing states the only true thing available:
 * there is an entry here the scan cannot account for, so the scan is not clean.
 *
 * THE DECISION IS STRUCTURAL, NOT A LIST OF SHAPES. The walk admits exactly
 * `isDirectory()` and `isFile()` and refuses whatever is left; `--staged` admits
 * exactly the two regular blob modes and refuses whatever is left. The kind
 * tokens below are labels ON that decision, each with a catch-all arm, so an
 * entry kind nobody enumerated is still refused — it just gets a duller name.
 *
 * "In scope" is `isUnderScanRoot` on both routes now, and the walk still
 * excludes a gitignored entry (the same rule that already excludes a gitignored
 * file, so links do not get a second, stricter boundary of their own).
 *
 * ⚠ THE SCAN ROOT ITSELF is not enumerated by `readdir` and so is not a `Dirent`
 * at all — the refusal above could not see it, and `existsSync`/`readdirSync`
 * both FOLLOW, so replacing `src`, `test` or `scripts` with a link to a
 * directory made the sweep read a tree the repository does not contain. The
 * root now gets the same lstat-based decision every entry under it gets; see
 * `enterRoot`.
 *
 * ⚠ `--staged`'s BOUNDARY IS THE `--diff-filter` AS WELL AS THE PATH SET, so the
 * mode check above reaches only the records that filter enumerates. `R`/`C` are
 * not among them (see `buildTargetsForStaged`), and that is not only a content
 * gap: RENAMING an ALREADY-TRACKED symlink is an `R` record with a `120000`
 * destination, so this route reads it clean even though its path is in scope
 * (measured on git 2.39.5: `git mv` of a tracked link yields
 * `:120000 120000 <sha> <sha> R100`, dropped by `AMTU`, and `--staged` exits 0).
 * The all-mode walk refuses that same worktree, so it is not clean everywhere;
 * this route is where it is missed. That is PRE-EXISTING and disclosed rather
 * than fixed here, because admitting `R`/`C` needs the two-path record shape
 * handled, which is a scope decision. Do not read the paragraph above as
 * covering it. `U` (UNMERGED) WAS THE SAME SHAPE OF GAP AND IS NOW CLOSED: it
 * carries a single path, so the stride is unchanged, and its all-zero
 * destination mode lands it in the refusal rather than in a read.
 *
 * A refusal names the entry's own repo-relative path and an engine-owned token
 * for its kind. IT NEVER REPORTS THE LINK TARGET, which is text off the working
 * tree and can itself carry PHI — a target path of the shape
 * `../patients/<surname>-<given>-<dob>.txt` is the whole reason. The shape is
 * written out rather than an example, because a diagnostic ABOUT a PHI leak is
 * itself a PHI surface, and that applies to the prose explaining it too.
 * ---------------------------------------------------------------------------
 */

import { readFileSync, statSync, lstatSync, existsSync, readdirSync, type Dirent } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, resolve, relative, sep, isAbsolute } from "node:path";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const REPO_ROOT = process.cwd();
const ALLOW_LIST_PATH = join(REPO_ROOT, "scripts", "phi-allow-list.txt");
const OVERRIDE_LOG_PATH = join(REPO_ROOT, "phi-scan-overrides.md");

/**
 * The scan roots — ONE list, shared by BOTH enumerating routes, so a path is in
 * scope for the pre-commit hook exactly when it is in scope for the all-mode
 * sweep. They previously disagreed (`test/fixtures` + all of `src` for the walk,
 * `test/fixtures/**` + `src/**.ts` for `--staged`) AND both stopped short of
 * `test/` itself, which is re-derived here rather than inherited from a sibling:
 *
 *   - `test/` WHOLE, not `test/fixtures/`. Every one of this repo's test modules
 *     is a hand-written `.ts` that embeds document text inline — HL7 `PID|…`
 *     segments, C-CDA headers, X12 interchanges, Telecom field tokens — as
 *     string literals rather than as files under `test/fixtures/`. A real name
 *     or MRN pasted into one of those committed with BOTH gates green, in the
 *     de-identification package. Sweeping only the data directory is therefore
 *     not this repo's corpus boundary; sweeping `test/` is.
 *   - `src/` — hand-written code, whose JSDoc `@example` snippets must not carry
 *     real PHI either.
 *   - `scripts/` — including `scripts/phi-allow-list.txt`, the file that DECLARES
 *     identifiers synthetic. A real dashed SSN or a real email typed in there was
 *     read by nothing.
 *
 * ▶ DO NOT PORT A SIBLING'S ROOTS OR ITS EXCLUSIONS INTO THIS LIST. `mllp` walks
 * `test/` too but EXCLUDES `.ts` sources from it, because there its corpus is
 * data files and the `.ts` under `test/` are tests carrying deliberate violator
 * literals. Copying that exclusion here would close none of the 38 files above —
 * they are all `.ts`. `ccda` roots at the repo root, which is `ccda`'s answer and
 * not this one: this tree carries `vendor/*.tgz` (third-party binary tarballs)
 * and a lockfile, and walking from the root also descends `node_modules/`,
 * `dist/` and `coverage/` before the gitignore filter can drop them.
 *
 * ▶ WHAT IS STILL OUT OF SCOPE, STATED RATHER THAN IMPLIED: `.github/`,
 * `docs-content/` (all `.md` bar `sidebars.json`), `vendor/`, and the root-level
 * manifests. None of them is claimed covered by this gate.
 */
const SCAN_ROOT_NAMES: readonly string[] = ["src", "test", "scripts"];

/**
 * Whether a repo-relative path is inside a scan root. This is the boundary a
 * NON-REGULAR entry is judged against on BOTH routes: the `.md` exemption is a
 * judgement about bytes the route could have read, and an entry's name is no
 * evidence at all about what is on the other side of a link.
 *
 * THE ROOT'S OWN NAME IS MATCHED AS WELL AS THE PREFIX, and that is not symmetry
 * for its own sake: a prefix test alone lets an entry named exactly `src`,
 * `test` or `scripts` through, which is the one path that REPLACES a scan root
 * rather than sitting inside it.
 */
function isUnderScanRoot(relPath: string): boolean {
  return SCAN_ROOT_NAMES.some((r) => relPath === r || relPath.startsWith(`${r}/`));
}

/** Documentation may legitimately describe violator values; it is not a fixture. */
function isDocFile(relPath: string): boolean {
  return relPath.toLowerCase().endsWith(".md");
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Hit {
  path: string;
  segment: string; // locator (e.g. "(ssn)" / "(email)" or your field id)
  value: string;
  reason: string;
}

interface AllowList {
  /**
   * Uppercase synthetic person-name tokens. UNUSED by the starter floor — the
   * structured name detector you add in the TODO section consumes these.
   */
  names: Set<string>;
  /**
   * Synthetic dates of birth (raw, format-normalized as you choose). UNUSED by
   * the starter floor — your structured DOB detector consumes these.
   */
  dobs: Set<string>;
  /**
   * Synthetic id values (SSN / MRN / member-id shapes). UNUSED by the starter
   * floor — your structured id detector consumes these.
   */
  ids: Set<string>;
  /** Allowed email domains (anything else is a hit). Used by the starter floor. */
  emailDomains: Set<string>;
}

interface Args {
  mode: "all" | "staged" | "paths";
  paths: string[];
  allowFixtures: string[];
}

class InvocationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvocationError";
  }
}

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

function parseArgs(argv: string[]): Args {
  let staged = false;
  const paths: string[] = [];
  const allowFixtures: string[] = [];
  let i = 0;
  while (i < argv.length) {
    const a = argv[i];
    if (a === "--") {
      for (let j = i + 1; j < argv.length; j += 1) {
        const v = argv[j];
        if (v !== undefined) paths.push(v);
      }
      break;
    } else if (a === "--staged") {
      staged = true;
      i += 1;
    } else if (a === "--allow-fixture") {
      const next = argv[i + 1];
      if (next === undefined) {
        throw new InvocationError("--allow-fixture requires a path argument");
      }
      allowFixtures.push(next);
      i += 2;
    } else if (a !== undefined && a.startsWith("--")) {
      throw new InvocationError(`Unknown flag: ${a}`);
    } else if (a !== undefined) {
      paths.push(a);
      i += 1;
    } else {
      i += 1;
    }
  }

  if (staged && paths.length > 0) {
    throw new InvocationError("--staged cannot be combined with positional paths");
  }

  // An `--allow-fixture` path is a *subtractive* acknowledgement on a broader
  // scan, never a scan target on its own. It used to ALSO seed the positional
  // path set, so that `--allow-fixture X` alone meant "scan X, but allow it"
  // rather than a silent no-op — necessary while the roots were narrow enough
  // that X was usually outside every one of them. It is not necessary now, and
  // it was actively in the way: it forced the flag into `paths` mode, so the two
  // modes CI and the pre-commit hook actually run (`all` and `--staged`) had no
  // whole-file bypass available at all. That is a large part of why the roots
  // were never widened. `validateAllowFixtures` below replaces the seeding with
  // a stronger guarantee: the path must exist AND be inside a scan root, so it
  // is a target of the sweep it is subtracted from, in every mode.
  let mode: Args["mode"];
  if (staged) {
    mode = "staged";
  } else if (paths.length > 0) {
    mode = "paths";
  } else {
    mode = "all";
  }
  return { mode, paths, allowFixtures };
}

// ---------------------------------------------------------------------------
// Allow-list + override log
// ---------------------------------------------------------------------------

function loadAllowList(): AllowList {
  if (!existsSync(ALLOW_LIST_PATH)) {
    throw new InvocationError(`allow-list not found at ${ALLOW_LIST_PATH}`);
  }
  let raw: string;
  try {
    raw = readFileSync(ALLOW_LIST_PATH, "utf8");
  } catch (err) {
    // Present but unreadable (permissions, a directory in its place, a vanished
    // file between the check and the read). An INVOCATION error — exit 2 — never
    // the exit 1 that means "hits found". See the exit-code note in `main`.
    throw new InvocationError(
      `could not read the allow-list at ${ALLOW_LIST_PATH}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
  const names = new Set<string>();
  const dobs = new Set<string>();
  const ids = new Set<string>();
  const emailDomains = new Set<string>();
  for (const lineRaw of raw.split(/\r?\n/)) {
    const line = lineRaw.trim();
    if (line.length === 0 || line.startsWith("#")) continue;
    const sp = line.indexOf(" ");
    if (sp < 0) continue;
    const tag = line.slice(0, sp);
    const value = line.slice(sp + 1).trim();
    if (value.length === 0) continue;
    switch (tag) {
      case "NAME":
        names.add(value.toUpperCase());
        break;
      case "DOB":
        dobs.add(value);
        break;
      case "ID":
        ids.add(value.toUpperCase());
        break;
      case "EMAILDOMAIN":
        emailDomains.add(value.toLowerCase());
        break;
      default:
        break;
    }
  }
  return { names, dobs, ids, emailDomains };
}

function normalizePath(p: string): string {
  const abs = isAbsolute(p) ? p : resolve(REPO_ROOT, p);
  const rel = relative(REPO_ROOT, abs);
  return rel.split(sep).join("/");
}

/**
 * The paths logged as bypasses in `phi-scan-overrides.md`.
 *
 * FENCED CODE BLOCKS ARE SKIPPED, and that is not tidiness: the log's own
 * "## Format" section shows the entry shape inside a fence, so a flat `^###`
 * sweep read the literal placeholder from the template as a logged path. It was
 * harmless while this set was only consulted for MEMBERSHIP; it stopped being
 * harmless the moment a stale entry had to refuse the scan.
 */
function loadOverrideLog(): Set<string> {
  if (!existsSync(OVERRIDE_LOG_PATH)) return new Set();
  let raw: string;
  try {
    raw = readFileSync(OVERRIDE_LOG_PATH, "utf8");
  } catch (err) {
    throw new InvocationError(
      `could not read ${OVERRIDE_LOG_PATH}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const out = new Set<string>();
  let fenced = false;
  for (const lineRaw of raw.split(/\r?\n/)) {
    if (/^\s*(?:```|~~~)/.test(lineRaw)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    const m = /^###\s+(.+?)\s*$/.exec(lineRaw);
    if (m && m[1] !== undefined) out.add(normalizePath(m[1]));
  }
  return out;
}

function validateAllowFixtures(allowFixtures: string[]): void {
  if (allowFixtures.length === 0) return;
  const overrides = loadOverrideLog();
  const normalized = allowFixtures.map(normalizePath);
  const missing = normalized.filter((p) => !overrides.has(p));
  if (missing.length > 0) {
    const lines = missing.map((p) => `  - ${p}`).join("\n");
    throw new InvocationError(
      `--allow-fixture rejected: no matching entry in phi-scan-overrides.md for:\n${lines}\n` +
        `Add a "### <path>" subsection to phi-scan-overrides.md and commit it.`,
    );
  }

  // The anti-rot half, and the reason the flag no longer has to seed `paths`
  // mode to avoid being a no-op: a bypass must name a real regular file inside a
  // scan root. A logged path that has been renamed, deleted, or typed with a
  // stale prefix REFUSES instead of quietly subtracting nothing — a bypass that
  // silently stops applying is indistinguishable from one that silently applies
  // to the wrong file. Directories are refused by the same rule (a directory is
  // not a regular file), so a bypass can never widen past one named file.
  // `.md` is excluded here for the same reason a missing path is: documentation
  // under a scan root is never a scan TARGET, so bypassing one subtracts nothing
  // and prints nothing. That is precisely the silent no-op this check exists to
  // refuse — a reviewer reading the log would believe a bypass was in force.
  const unusable = normalized.filter(
    (p) =>
      !isUnderScanRoot(p) || isDocFile(p) || !existsSync(join(REPO_ROOT, p)) || !isRegularFile(p),
  );
  if (unusable.length > 0) {
    const lines = unusable.map((p) => `  - ${p}`).join("\n");
    throw new InvocationError(
      `--allow-fixture rejected: each bypassed path must be an existing, non-.md regular file ` +
        `inside a scan root (${SCAN_ROOT_NAMES.join(", ")}), so that it is genuinely subtracted ` +
        `from a sweep rather than silently matching nothing:\n${lines}`,
    );
  }
}

/** Whether a repo-relative path is, right now, a regular file (an lstat answer). */
function isRegularFile(relPath: string): boolean {
  try {
    return lstatSync(join(REPO_ROOT, relPath)).isFile();
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Target enumeration
// ---------------------------------------------------------------------------

interface Target {
  path: string; // forward-slash repo-relative path for reporting
  read: () => Buffer;
}

/**
 * An entry the enumeration reached but cannot scan. Both fields are safe to
 * print: `path` is the entry's own repo-relative path (the same locus every hit
 * already carries) and `kind` is a token from the closed set below. Nothing off
 * the other side of a link is ever recorded here.
 */
interface Unscannable {
  path: string;
  kind: string;
}

/**
 * The predicates `Dirent` and `Stats` have in common. Both answer from an lstat,
 * so one closed-set describer serves an entry INSIDE a root and a root's own
 * path, which is never handed back as a `Dirent` at all.
 */
interface EntryKind {
  isSymbolicLink: () => boolean;
  isFIFO: () => boolean;
  isSocket: () => boolean;
  isBlockDevice: () => boolean;
  isCharacterDevice: () => boolean;
}

/** Closed-set, engine-owned description of a directory entry's kind. */
function direntKind(e: EntryKind): string {
  if (e.isSymbolicLink()) return "a symbolic link";
  if (e.isFIFO()) return "a FIFO";
  if (e.isSocket()) return "a socket";
  if (e.isBlockDevice()) return "a block device";
  if (e.isCharacterDevice()) return "a character device";
  return "not a regular file";
}

/**
 * Enumerate a scan root. `Dirent`'s predicates are lstat answers and are not
 * exhaustive: an entry that is neither a directory nor a regular file is
 * collected into `unscannable` rather than dropped, so the caller can refuse
 * instead of reporting clean over it.
 */
function walk(dir: string, out: string[], unscannable: Unscannable[]): void {
  if (!existsSync(dir)) return;
  let entries: Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    // A directory the walk reached and could not read (permissions, a vanished
    // directory, a non-directory in its place). It used to escape `main` as an
    // ordinary Error and exit 1 — the code that means "hits found" — reporting a
    // FAILED sweep in the vocabulary of a completed one. It is an invocation
    // error: the scan could not be performed. See the exit-code note in `main`.
    throw new InvocationError(
      `could not read the directory ${normalizePath(dir)}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      walk(full, out, unscannable);
    } else if (e.isFile()) {
      // README/markdown docs may legitimately describe violator values; they
      // are documentation, not fixtures.
      if (isDocFile(e.name)) continue;
      out.push(full);
    } else {
      // Deliberately NOT subject to the `.md` exemption above. That exemption is
      // a judgement about a file whose bytes the walk could have read; a link's
      // name is no evidence at all about what is on the other side.
      unscannable.push({ path: normalizePath(full), kind: direntKind(e) });
    }
  }
}

/**
 * Refuse (exit 2) over entries the enumeration reached and cannot scan. EVERY
 * offender is named, not just the first: a developer who has to re-run the gate
 * once per link learns to distrust it.
 */
function refuseUnscannable(entries: Unscannable[], why: string, remedy: string): void {
  if (entries.length === 0) return;
  const lines = entries.map((u) => `  - ${u.path} (${u.kind})`).join("\n");
  // "entry cannot be scanned", not "entry is not a regular file": the same
  // refusal now also covers a SCAN ROOT that is a regular file, which is a thing
  // the older sentence called the opposite of what it is. The per-entry `kind`
  // line below carries the specific answer; this line only counts them.
  const noun = entries.length === 1 ? "entry cannot be scanned" : "entries cannot be scanned";
  throw new InvocationError(
    `refusing the scan: ${String(entries.length)} ${noun}:\n${lines}\n${why} ${remedy}`,
  );
}

function gitIgnored(paths: string[]): Set<string> {
  const ignored = new Set<string>();
  if (paths.length === 0) return ignored;
  try {
    // SECURITY: array-form execFileSync, no shell. Default (Buffer) encoding —
    // `encoding: "buffer"` with `input` is rejected by Node.
    const out = execFileSync("git", ["check-ignore", "--stdin", "-z"], {
      input: paths.map(normalizePath).join("\0"),
      stdio: ["pipe", "pipe", "ignore"],
    });
    for (const p of out.toString("utf8").split("\0")) {
      if (p.length > 0) ignored.add(p);
    }
  } catch {
    // `git check-ignore` exits 1 when nothing matches — treat as none ignored.
  }
  return ignored;
}

/**
 * Enter one scan root. THE ROOT ITSELF IS NEVER A `Dirent`, so `walk`'s
 * refusal — which reads the predicates `readdir` returns for entries INSIDE a
 * directory — could not see it: `walk` opened the root with `existsSync` +
 * `readdirSync`, and BOTH FOLLOW, so replacing `src`, `test` or `scripts` with a
 * symbolic link to a directory made the sweep read straight through it and
 * report on a tree the repository does not contain. The root gets the same
 * lstat-based decision every entry under it already gets.
 *
 * A root that is simply ABSENT is not an error (this scanner is shared with
 * repos that have no `scripts/`); a root that EXISTS and is not a directory is.
 */
function enterRoot(
  name: string,
  out: string[],
  unscannable: Unscannable[],
  badRoots: Unscannable[],
): void {
  const full = join(REPO_ROOT, name);
  let st;
  try {
    st = lstatSync(full);
  } catch {
    return; // absent — nothing to walk, and nothing to refuse
  }
  if (st.isDirectory()) {
    walk(full, out, unscannable);
    return;
  }
  // `direntKind`'s catch-all arm reads "not a regular file", which is the right
  // sentence about an ENTRY and the wrong one about a ROOT — a root that IS a
  // regular file is exactly as unwalkable as one that is a FIFO.
  badRoots.push({
    path: name,
    kind: st.isFile() ? "a regular file where a scan root is expected" : direntKind(st),
  });
}

function buildTargetsForAll(): Target[] {
  const files: string[] = [];
  const unscannable: Unscannable[] = [];
  const badRoots: Unscannable[] = [];
  for (const name of SCAN_ROOT_NAMES) enterRoot(name, files, unscannable, badRoots);

  // A bad ROOT and a bad ENTRY get separate remedies. They shared one before,
  // and it told the reader of a root that is a regular file to "replace it with
  // a regular file" — which the very next run refuses.
  refuseUnscannable(
    badRoots,
    "A scan root must be a directory the walk can enumerate.",
    "Restore it as a real directory, or remove it entirely (an ABSENT root is not an error).",
  );

  // One `git check-ignore` over both lists. An ignored entry is already out of
  // scope for the file route, so applying the same rule to a link keeps a single
  // boundary rather than inventing a second, stricter one for links alone.
  const ignored = gitIgnored([...files.map(normalizePath), ...unscannable.map((u) => u.path)]);

  refuseUnscannable(
    unscannable.filter((u) => !ignored.has(u.path)),
    "The walk can neither read such an entry nor vouch for what is on the other side of it.",
    "Remove it, replace it with a regular file, or (if it is genuinely not part of the " +
      "corpus) untrack it and add it to .gitignore.",
  );

  return files
    .filter((abs) => !ignored.has(normalizePath(abs)))
    .map((abs) => ({ path: normalizePath(abs), read: () => readFileSync(abs) }));
}

function buildTargetsForPaths(paths: string[]): Target[] {
  return paths.map((p) => {
    const abs = isAbsolute(p) ? p : resolve(REPO_ROOT, p);
    if (!existsSync(abs)) throw new InvocationError(`File not found: ${p}`);
    if (!statSync(abs).isFile()) throw new InvocationError(`Not a regular file: ${p}`);
    return { path: normalizePath(abs), read: () => readFileSync(abs) };
  });
}

/** git's file modes for a regular blob. Every other mode is not a file to read. */
const REGULAR_BLOB_MODES = new Set(["100644", "100755"]);

/**
 * Closed-set, engine-owned description of a staged record. The DECISION is still
 * structural and made on the mode alone (`REGULAR_BLOB_MODES` admits, everything
 * else refuses); the status only refines the LABEL, because an unmerged record
 * carries destination mode `000000` and "a git mode-000000 entry" says nothing a
 * developer can act on.
 */
function gitModeKind(mode: string, status: string): string {
  if (status.startsWith("U")) return "an unmerged (conflicted) entry";
  if (mode === "120000") return "a symbolic link";
  if (mode === "160000") return "a gitlink (a nested repository)";
  return `a git mode-${mode} entry`;
}

/** `:<srcmode> <dstmode> <srcsha> <dstsha> <status>` — the info half of a `--raw -z` record. */
const RAW_RECORD = /^:(?:\d{6}) (\d{6}) [0-9a-f]+ [0-9a-f]+ ([A-Z]\d*)$/;

function buildTargetsForStaged(): Target[] {
  let listBuf: Buffer;
  try {
    // SECURITY: array-form execFileSync, no shell. `--raw` rather than
    // `--name-only` because the DESTINATION MODE is the only thing that
    // distinguishes a staged regular file from a staged symlink or gitlink, and
    // `git show :<path>` answers all three without complaint.
    //
    // `T` (TYPECHANGE) IS IN THE FILTER, AND LEAVING IT OUT MADE THE MODE CHECK
    // BELOW UNREACHABLE WHENEVER THE FILE WAS ALREADY TRACKED. Replacing a TRACKED
    // regular file with a link is not an add and not a modify — git raises it as
    // `T` (`:100644 120000 <sha> <sha> T`, measured on git 2.39.5), so
    // `--diff-filter=AM` deleted the record before any mode could be read and the
    // pre-commit hook passed the link green. Typechange carries a single path,
    // exactly like `A` and `M`, so admitting it costs the two-field stride below
    // nothing — and it also scans the REVERSE typechange, a link replaced by a
    // real file, as the file it became.
    //
    // `U` (UNMERGED) IS IN THE FILTER FOR THE SAME REASON `T` IS: neither `AM`
    // nor `AMT` enumerates it, so an in-scope path left conflicted by a merge was
    // seen by this route at all. git raises it as
    // `:100644 000000 <sha> 0000000 U` (measured on git 2.39.5) — a SINGLE path,
    // so the two-field stride below is unchanged — and the all-zero destination
    // mode is not a regular blob, so it lands in the refusal below rather than
    // being read. That is the honest answer: `git show :<path>` on an unmerged
    // path fails, because the content lives at stages 1/2/3 and there is no
    // stage-0 blob to hand back, so this route cannot vouch for what would be
    // committed. Refusing is also the same verdict `git commit` itself gives.
    listBuf = execFileSync("git", ["diff", "--cached", "--raw", "-z", "--diff-filter=AMTU"], {
      encoding: "buffer",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err) {
    throw new InvocationError(
      `git diff --cached failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // `--raw -z` emits `<info>\0<path>\0` per record. `R` (rename) and `C` (copy)
  // are the only statuses carrying a SECOND path, and the filter excludes both,
  // so the stride is two fields. If one ever reached here the stride would
  // desync and the next record would fail to parse, which REFUSES — the same
  // outcome as any other unparseable record, and the safe one.
  //
  // Excluding `R`/`C` also means this route does not enumerate a staged rename
  // at all — which costs it a MODE check, not only content: renaming an
  // already-tracked symlink is an `R` record with a `120000` destination, so
  // this route reads it clean while the all-mode walk refuses the same worktree.
  // That is PRE-EXISTING and is not narrowed here: admitting them needs
  // the two-path record shape handled, which is a scope decision, not this one.
  // A record that does not parse REFUSES rather than being skipped: a silently
  // shortened list is exactly the shape this scan must never report clean over.
  const fields = listBuf.toString("utf8").split("\0");
  const staged: { path: string; mode: string; status: string }[] = [];
  let i = 0;
  while (i < fields.length) {
    const info = fields[i];
    if (info === undefined || info.length === 0) {
      i += 1;
      continue;
    }
    const m = RAW_RECORD.exec(info);
    const mode = m?.[1];
    const status = m?.[2];
    const path = fields[i + 1];
    if (mode === undefined || status === undefined || path === undefined || path.length === 0) {
      throw new InvocationError(
        "could not read the output of `git diff --cached --raw -z`: unrecognized record. " +
          "Refusing rather than scanning a list that may be short.",
      );
    }
    staged.push({ path, mode, status });
    i += 2;
  }

  // The SAME boundary the walk uses — one `isUnderScanRoot`, not a second
  // hand-written prefix test. The two used to disagree: this route looked at
  // `test/fixtures/**` and `src/**.ts`, so a staged `src/**.json`, anything under
  // `test/` outside `fixtures/`, and all of `scripts/` were enumerated by
  // NEITHER route.
  const inScope = staged.filter((s) => isUnderScanRoot(s.path));

  refuseUnscannable(
    inScope
      .filter((s) => !REGULAR_BLOB_MODES.has(s.mode))
      .map((s) => ({ path: s.path, kind: gitModeKind(s.mode, s.status) })),
    "For such an entry `git show :<path>` hands back its target path, or nothing at all, rather " +
      "than the content that would be committed.",
    "Unstage it, resolve it, or replace it with a regular file.",
  );

  // The `.md` exemption applies to CONTENT, exactly as it does in `walk`, and
  // deliberately AFTER the refusal above: documentation may describe violator
  // values, but a name is no evidence about what is on the other side of a link.
  return inScope
    .filter((s) => !isDocFile(s.path))
    .map(({ path: relPath }) => ({
      path: relPath,
      // SECURITY: array-form execFileSync, no shell. `:<path>` is a git pathspec.
      read: (): Buffer =>
        execFileSync("git", ["show", `:${relPath}`], {
          encoding: "buffer",
          stdio: ["ignore", "pipe", "pipe"],
        }),
    }));
}

// ---------------------------------------------------------------------------
// Cross-cutting shape checks — the format-agnostic FLOOR
// ---------------------------------------------------------------------------

function scanCommonShapes(path: string, content: string, allow: AllowList, hits: Hit[]): void {
  // Dashed SSN anywhere (a dashed \d{3}-\d{2}-\d{4} is always a hit).
  for (const m of content.matchAll(/\b\d{3}-\d{2}-\d{4}\b/g)) {
    hits.push({ path, segment: "(ssn)", value: m[0], reason: "dashed SSN pattern" });
  }
  // Emails whose domain is not an allow-listed reserved / test domain.
  for (const m of content.matchAll(/\b[A-Za-z0-9._%+-]+@([A-Za-z0-9.-]+\.[A-Za-z]{2,})\b/g)) {
    const domain = (m[1] ?? "").toLowerCase();
    if (!allow.emailDomains.has(domain)) {
      hits.push({ path, segment: "(email)", value: m[0], reason: "email with non-test domain" });
    }
  }
}

// ---------------------------------------------------------------------------
// HL7 v2 structured, field-level PHI detection (the deid-specific gate)
// ---------------------------------------------------------------------------

// The PHI-bearing fields of the relative/guarantor/insured segments, with the
// specific components that carry a name / DOB / SSN / MRN / phone / street /
// city value. Mirrors src/hl7/locus-map.ts. Each listed component's value must
// be positively declared synthetic in the allow-list (NAME / ID / DOB), or it
// is a hit — so a real name/DOB/MRN cannot ride into a fixture unnoticed.
// (State/ZIP/type-code components are intentionally omitted: they are not the
// identifying tokens and would be noise.)
const HL7_PHI_FIELDS: Readonly<Record<string, ReadonlyArray<{ field: number; comps: number[] }>>> =
  {
    PID: [
      { field: 2, comps: [1] },
      { field: 3, comps: [1] },
      { field: 4, comps: [1] },
      { field: 5, comps: [1, 2, 3] },
      { field: 6, comps: [1, 2] },
      { field: 7, comps: [1] },
      { field: 9, comps: [1, 2] },
      { field: 11, comps: [1, 3] },
      { field: 12, comps: [1] },
      { field: 13, comps: [1, 4] },
      { field: 14, comps: [1] },
      { field: 18, comps: [1] },
      { field: 19, comps: [1] },
      { field: 20, comps: [1] },
      { field: 21, comps: [1] },
      { field: 23, comps: [1] },
      { field: 29, comps: [1] },
    ],
    NK1: [
      { field: 2, comps: [1, 2] },
      { field: 4, comps: [1, 3] },
      { field: 5, comps: [1] },
      { field: 6, comps: [1] },
      { field: 30, comps: [1, 2] },
      { field: 31, comps: [1] },
      { field: 32, comps: [1, 3] },
      { field: 33, comps: [1] },
      { field: 37, comps: [1] },
    ],
    GT1: [
      { field: 2, comps: [1] },
      { field: 3, comps: [1, 2] },
      { field: 4, comps: [1, 2] },
      { field: 5, comps: [1, 3] },
      { field: 6, comps: [1] },
      { field: 7, comps: [1] },
      { field: 8, comps: [1] },
      { field: 12, comps: [1] },
      { field: 19, comps: [1] },
    ],
    IN1: [
      { field: 8, comps: [1] },
      { field: 16, comps: [1, 2] },
      { field: 18, comps: [1] },
      { field: 19, comps: [1, 3] },
      { field: 36, comps: [1] },
      { field: 49, comps: [1] },
    ],
    IN2: [
      { field: 2, comps: [1] },
      { field: 3, comps: [1, 2] },
      { field: 6, comps: [1] },
      { field: 7, comps: [1] },
      { field: 8, comps: [1, 2] },
      { field: 61, comps: [1] },
      { field: 63, comps: [1] },
    ],
  };

/**
 * A `${identifier.path}` SOURCE SUBSTITUTION SITE, not a value.
 *
 * Widening the walk to `test/` puts hand-written TypeScript under the structured
 * detectors for the first time, and a template literal that builds a document
 * writes `<given>${t.given}</given>`. That text is a hole in the fixture where a
 * value will be interpolated at run time; the file does not contain the value,
 * and no detector reading the source can say anything about it.
 *
 * THE RULE IS DELIBERATELY THE TIGHTEST ONE THAT COVERS THAT CASE, because it is
 * a hole in a PHI gate and every character it admits is a place to hide one:
 * the WHOLE value must be a single placeholder, and inside it only a dotted
 * chain of JS identifiers is allowed. No quotes, so `${"SMITH"}` is still a hit.
 * No spaces or operators, so `${a + "SMITH"}` is still a hit. Nothing outside the
 * braces, so `${t.given} SMITH` is still a hit. A bare identifier chain cannot
 * itself be a person's name, a DOB or an MRN — it is a reference to one.
 */
const SUBSTITUTION_SITE = /^\$\{[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)*\}$/;

function isSubstitutionSite(value: string): boolean {
  return SUBSTITUTION_SITE.test(value);
}

/** Every allow-listed synthetic token, uppercased, as one set (names ∪ ids ∪ dobs). */
function syntheticTokens(allow: AllowList): Set<string> {
  const set = new Set<string>();
  for (const n of allow.names) set.add(n);
  for (const i of allow.ids) set.add(i);
  for (const d of allow.dobs) set.add(d.toUpperCase());
  return set;
}

/**
 * Structured HL7 v2 PHI scan: for every PID/NK1/GT1/IN1/IN2 PHI field, check each identifying
 * component value against the synthetic allow-list. Anything not positively declared synthetic is a
 * hit. Pure string splitting — no parser dependency (matches every sibling scanner).
 */
function scanHl7Structured(
  path: string,
  content: string,
  allow: AllowList,
  hits: Hit[],
  literalView: boolean,
): void {
  const lines = content.split(/\r\n|\r|\n/).filter((l) => l.length > 0);
  // The MSH header is found ANYWHERE on its line, not only at column 0. In a
  // `.ts` test module the message opens mid-line, inside a quote, so a column-0
  // anchor answered "not an HL7 v2 message" for every inline literal in this
  // repo — which is where this repo's HL7 text actually lives.
  //
  // THE MATCH REQUIRES A WHOLE MSH-1 + MSH-2 SHAPE, not merely the letters MSH:
  // a field separator, two to eight non-alphanumeric encoding characters, then
  // the SAME separator again. Matching only `MSH` plus one byte let an `MSH-9`
  // in prose set the field separator to `-` for the rest of the document, after
  // which nothing was detected at all. Segment lines below stay anchored at
  // column 0; `sourceLiteralDocument` is what puts each segment at one.
  let msh: string | undefined;
  let mshAt = -1;
  for (const l of lines) {
    const m = /(?:^|[^A-Za-z0-9])MSH([^A-Za-z0-9\s])[^A-Za-z0-9\s]{2,8}\1/.exec(l);
    if (m !== null) {
      msh = l;
      mshAt = l.indexOf(`MSH${m[1] ?? "|"}`, m.index);
      break;
    }
  }
  // ▶ A MISSING OR MIS-SHAPED MSH FALLS BACK TO THE HL7 DEFAULT DELIMITERS AND
  // KEEPS SCANNING. Returning here instead meant two silent zeros:
  //
  //   - a BARE `PID|…` line with no MSH above it read clean, and that is the
  //     single most likely thing to be pasted out of a ticket into a test;
  //   - the strict anchor above rejects an MSH-2 of length 0 or 1, a truncated
  //     header with no closing separator, and an MSH-2 longer than eight — all
  //     of which the older column-0 `startsWith("MSH")` accepted. Every one of
  //     those still uses `|`, so the defaults read them correctly.
  //
  // The strict anchor is still what DERIVES non-default delimiters, because
  // relaxing it is what let an `MSH-9` in prose set the field separator to `-`.
  // Residual, disclosed rather than chased: a header that uses a non-default
  // field separator AND a mis-shaped MSH-2 gets the defaults and is read as if
  // it used `|`. The segment guard below is what keeps that from inventing hits.
  const encRaw =
    msh === undefined ? "" : (msh.slice(mshAt + 4).split(msh.charAt(mshAt + 3))[0] ?? "");
  // A source literal spells HL7's own backslash doubled, so `^~\\&` arrives five
  // characters long and the sub-component separator read out of position 3 was
  // the backslash rather than `&`.
  const enc = encRaw.replace(/\\\\/g, "\\") || "^~\\&";
  const fieldSep = (msh === undefined ? "" : msh.charAt(mshAt + 3)) || "|";
  const compSep = enc.charAt(0) || "^";
  const repSep = enc.charAt(1) || "~";
  const subSep = enc.charAt(3) || "&";
  const allowed = syntheticTokens(allow);

  for (const lineRaw of lines) {
    // Leading WHITESPACE is stripped before the segment id is read, IN THE
    // SOURCE-LITERAL VIEW ONLY. A message written as an indented multi-line
    // template literal — what prettier produces inside a nested block — puts
    // every segment at column 2 or more, and a column-0 `slice(0, 3)` read those
    // files as containing no segments at all. Doing it in the RAW view as well
    // re-opened the defect that taking the literals was introduced to fix: a
    // literal whose closing backtick sits on its last segment line reported a
    // declared-synthetic DOB with the backtick and semicolon attached.
    // Quote characters are never stripped, in either view, for the same reason.
    const line = literalView ? lineRaw.replace(/^[ \t]+/, "") : lineRaw;
    const name = line.slice(0, 3);
    const spec = HL7_PHI_FIELDS[name];
    if (spec === undefined) continue;
    // The segment id must be FOLLOWED BY THE FIELD SEPARATOR. Without this the
    // fallback above would let any line whose first three characters happen to
    // spell a segment name be parsed as one.
    if (line.charAt(3) !== fieldSep) continue;
    const fields = line.split(fieldSep); // fields[0] = segment name; fields[n] = SEG-n
    for (const { field, comps } of spec) {
      const raw = fields[field];
      if (raw === undefined || raw.length === 0) continue;
      for (const rep of raw.split(repSep)) {
        const components = rep.split(compSep);
        for (const c of comps) {
          const value = (components[c - 1] ?? "").split(subSep)[0] ?? "";
          if (value.length === 0) continue;
          if (isSubstitutionSite(value)) continue; // a source hole, not a value
          if (!allowed.has(value.toUpperCase())) {
            hits.push({
              path,
              segment: `${name}-${String(field)}.${String(c)}`,
              value,
              reason: "HL7 PHI field value not declared synthetic in the allow-list",
            });
          }
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// C-CDA structured, header-element PHI detection (the deid-specific gate, DEID-3)
// ---------------------------------------------------------------------------

// C-CDA header person-PHI elements whose *text* must be a declared-synthetic token. Scoped to the
// document header (everything before the clinical body) because a `<name>` there is always a person or
// organization name — a `<name>` inside the clinical body can be a drug / material name, so scanning it
// would false-positive on legitimate clinical content. Mirrors src/ccda/locus-map.ts (the person loci).
// (Person-role `<id>` extensions are intentionally NOT checked structurally: a regex cannot tell a
// patient MRN from a `templateId` / `typeId` / document-envelope id without the parser, so ids are
// covered by the SSN floor + the synthetic-fixture discipline, like HL7 free text.)
const CCDA_HEADER_TEXT_ELEMENTS: readonly string[] = [
  "given",
  "family",
  "prefix",
  "suffix",
  "name",
  "streetAddressLine",
  "city",
  "county",
];

/**
 * Structured C-CDA PHI scan: within the document **header** (before `<structuredBody>` /
 * `<nonXMLBody>`), check each person-name / address-part element's text — and each `birthTime@value` —
 * against the synthetic allow-list. Anything not positively declared synthetic is a hit. Pure string
 * scanning — no parser dependency (matches every sibling scanner).
 */
function scanCcdaStructured(path: string, content: string, allow: AllowList, hits: Hit[]): void {
  if (!content.includes("urn:hl7-org:v3")) return; // not a C-CDA / CDA R2 document
  // Cut to the header: person `<name>`/`<addr>` before the body are unambiguously person PHI.
  const bodyAt = content.search(/<(?:\w+:)?structuredBody[\s>]/);
  const nonXmlAt = content.search(/<(?:\w+:)?nonXMLBody[\s>]/);
  let end = content.length;
  if (bodyAt >= 0) end = Math.min(end, bodyAt);
  if (nonXmlAt >= 0) end = Math.min(end, nonXmlAt);
  const header = content.slice(0, end);
  const allowed = syntheticTokens(allow);

  const check = (value: string, locator: string): void => {
    const v = value.trim();
    if (v.length === 0) return;
    if (isSubstitutionSite(v)) return; // a source hole, not a value
    if (!allowed.has(v.toUpperCase())) {
      hits.push({
        path,
        segment: locator,
        value: v,
        reason: "C-CDA header PHI element value not declared synthetic in the allow-list",
      });
    }
  };

  for (const el of CCDA_HEADER_TEXT_ELEMENTS) {
    // Only the element's DIRECT text (`[^<]*`) — an element with child elements (a `<name>` wrapping
    // `<given>`/`<family>`) yields empty/whitespace here and is checked via those children instead.
    const re = new RegExp(`<(?:\\w+:)?${el}\\b[^>]*>([^<]*)</(?:\\w+:)?${el}>`, "g");
    for (const m of header.matchAll(re)) check(m[1] ?? "", `<${el}>`);
  }
  for (const m of header.matchAll(/<(?:\w+:)?birthTime\b[^>]*\bvalue="([^"]*)"/g)) {
    check(m[1] ?? "", "birthTime@value");
  }
}

// ---------------------------------------------------------------------------
// X12 005010 structured, element-level PHI detection (the deid-specific gate, DEID-5)
// ---------------------------------------------------------------------------

// X12 NM1-01 entity codes whose NM1-03..04 name + NM1-09 id are the covered individual's PHI. Mirrors
// src/x12/locus-map.ts PATIENT_ENTITY_CODES — a provider-entity NM1 name is retained and NOT checked
// (checking it would false-positive on legitimate provider/organization names in fixtures).
const X12_PATIENT_ENTITY_CODES = new Set<string>(["IL", "QC", "03", "QD", "GD", "74", "S1", "S3"]);
// REF-01 qualifiers whose REF-02 value is a patient identifier (SSN / member / subscriber / group /
// medical record). Mirrors src/x12/locus-map.ts REF_PHI_QUALIFIERS.
const X12_REF_PHI_QUALIFIERS = new Set<string>([
  "SY",
  "1W",
  "0F",
  "1L",
  "IG",
  "EA",
  "23",
  "6P",
  "1H",
]);

/**
 * Structured X12 PHI scan: detect the ISA envelope, read its element separator (fixed byte 3) and
 * segment terminator (fixed byte 105), and check the identifying values of the patient-entity `NM1`
 * (name NM1-03/04, id NM1-09), `DMG` (DOB DMG-02), and PHI-qualified `REF` (REF-02) segments against the
 * synthetic allow-list. Anything not positively declared synthetic is a hit. Pure string splitting — no
 * parser dependency (matches every sibling scanner).
 */
function scanX12Structured(path: string, content: string, allow: AllowList, hits: Hit[]): void {
  // Inter-segment CRLF is not semantic in X12 (the parser normalizes it away) — strip it so a
  // pretty-printed fixture, and the joined source-literal view, split on the segment terminator
  // exactly as the wire form does.
  const src = content.trimStart();
  // ▶ THE 106-BYTE ISA HEADER IS FOUND ANYWHERE, NOT ONLY AT OFFSET 0, AND
  // REQUIRING OFFSET 0 GAVE THE WIDENED `test/` ROOT NOTHING FOR X12. A `.ts`
  // module never begins with `ISA`: its first bytes are an import statement, and
  // the joined source-literal view begins with the first string literal in the
  // file (an import specifier). Three files this gate newly sweeps carry inline
  // patient-entity interchanges, and all three read clean — measured, with the
  // identical bytes as a `test/fixtures/*.edi` returning five hard hits.
  //
  // The offset-0 rule was doing two jobs and only one of them is load-bearing:
  // it kept a source that merely MENTIONS "ISA" in prose from having delimiters
  // read out of it. That job is done here instead, off ISA's own FIXED WIDTHS —
  // an `ISA` on a non-alphanumeric boundary; a non-alphanumeric, non-space
  // element separator at offset 3; the SAME separator again at offset 6, because
  // ISA01 is exactly two characters wide in 005010 and no prose satisfies that;
  // 106 bytes available; and a non-alphanumeric segment terminator at offset 105.
  //
  // ▶ THE FIXED-WIDTH CHECK IS NOT COSMETIC AND "prose cannot capture the
  // delimiters" WOULD BE AN OVERCLAIM WITHOUT IT. A gate measured the case:
  // `"an ISA-IEA envelope"` earlier in the same file satisfied the boundary and
  // the terminator offset, captured `-` as the element separator, and took a
  // real inline interchange below it from four hits to one — or to ZERO with the
  // same words in a comment as well. What is left is stated rather than claimed
  // closed: prose that ALSO happens to put the same byte at offsets 3 and 6 and
  // a non-alphanumeric at 105 would still capture them.
  //
  // Only the FIRST accepted header is used, so a file carrying two interchanges
  // with DIFFERENT delimiters is read with the first one's. Every interchange in
  // this repo uses `*` and `~`; stated as a limit rather than chased.
  //
  // THE BOUNDARY IS TESTED BEFORE THE NEWLINES ARE STRIPPED, NOT AFTER, and that
  // ordering is load-bearing: `sourceLiteralDocument` joins literals with CRLF,
  // so stripping first glued the preceding literal onto the header — an import
  // specifier ending `index.js` put an alphanumeric immediately before `ISA` and
  // the boundary never matched. The newlines are then stripped from the
  // CANDIDATE, which is what makes the fixed-offset delimiter read sound.
  let header = "";
  let body = "";
  for (const m of src.matchAll(/(?:^|[^A-Za-z0-9])ISA[^A-Za-z0-9\s]/g)) {
    const at = m.index + m[0].length - 4;
    const candidate = src.slice(at).replace(/[\r\n]/g, "");
    if (candidate.length < 106) continue;
    if (candidate.charAt(6) !== candidate.charAt(3)) continue; // ISA01 is 2 wide
    if (/[A-Za-z0-9\s]/.test(candidate.charAt(105))) continue;
    header = candidate; // newline-free, for the two FIXED-OFFSET delimiter reads only
    body = src.slice(at); // newline-PRESERVING, for the segment split below
    break;
  }
  if (header.length === 0) return; // not an X12 interchange
  const elementSep = header.charAt(3);
  const segTerm = header.charAt(105);
  if (elementSep.length === 0 || segTerm.length === 0) return;
  const allowed = syntheticTokens(allow);

  // One value is reported once per locus. The segment loop below deliberately
  // offers the SAME piece to the checks twice (once split on line breaks, once
  // with them removed), so without this a pretty-printed fixture would report
  // every hit twice.
  const seen = new Set<string>();
  const check = (value: string, locator: string): void => {
    const v = value.trim();
    if (v.length === 0) return;
    if (isSubstitutionSite(v)) return; // a source hole, not a value
    const key = `${locator} ${v.toUpperCase()}`;
    if (seen.has(key)) return;
    if (!allowed.has(v.toUpperCase())) {
      seen.add(key);
      hits.push({
        path,
        segment: locator,
        value: v,
        reason: "X12 PHI element value not declared synthetic in the allow-list",
      });
    }
  };

  // ▶ EACH TERMINATOR-DELIMITED PIECE IS OFFERED TWICE, AND "IN ADDITION TO"
  // RATHER THAN "INSTEAD OF" IS THE WHOLE POINT — replacing one with the other
  // loses real hits in BOTH directions, each measured:
  //
  //   - EVERY LINE of the piece. Without this, an interchange assembled from
  //     several source literals is unreadable: the joined view glues the
  //     preceding literal onto the front of the segment, so `els[0]` reads as
  //     `…SECRETIDNM1` rather than `NM1`. Measured on this repo's own
  //     `test/x12/deidentify-x12.test.ts`, whose envelope comes from a `wrap()`
  //     template and whose segments are separate literals: five sentinels, none
  //     of them found by the glued view alone.
  //   - THE PIECE WITH ITS LINE BREAKS REMOVED. Without this, a segment broken
  //     across lines by a hard wrap loses every element after the break, and it
  //     is a REGRESSION rather than a gap: the pre-existing code removed line
  //     breaks before splitting, so it read those files. CR/LF is non-semantic
  //     filler in X12 and `@cosyte/x12` rejoins the segment, so a hard-wrapped
  //     EDI dump is a real artifact and the identifiers after the wrap are real
  //     patient loci. Measured: a wrapped `NM1*IL` went from three hits at base
  //     to zero.
  //
  // A segment id is matched EXACTLY, so an extra candidate can only be skipped,
  // and `check` de-duplicates so the overlap between the two costs no noise.
  for (const piece of body.split(segTerm)) {
    for (const seg of piece.split(/\r\n|\r|\n/)) {
      scanX12Segment(seg, elementSep, check);
    }
    const rejoined = piece.replace(/[\r\n]/g, "");
    if (rejoined !== piece) scanX12Segment(rejoined, elementSep, check);
  }
}

/** One X12 segment candidate: dispatch on its id and check the identifying elements. */
function scanX12Segment(
  seg: string,
  elementSep: string,
  check: (value: string, locator: string) => void,
): void {
  const els = seg.split(elementSep);
  const id = els[0];
  if (id === "NM1") {
    // A provider/organization entity's name is RETAINED by the de-identifier, so
    // checking it would false-positive on legitimate provider names in fixtures.
    if (!X12_PATIENT_ENTITY_CODES.has((els[1] ?? "").toUpperCase())) return;
    check(els[3] ?? "", "NM1-03"); // last / org name
    check(els[4] ?? "", "NM1-04"); // first name
    check(els[9] ?? "", "NM1-09"); // identifier
  } else if (id === "N1") {
    if (!X12_PATIENT_ENTITY_CODES.has((els[1] ?? "").toUpperCase())) return;
    check(els[2] ?? "", "N1-02"); // patient-side party name
    check(els[4] ?? "", "N1-04"); // patient-side party identifier
  } else if (id === "SBR") {
    check(els[3] ?? "", "SBR-03"); // insured group / policy number
    check(els[4] ?? "", "SBR-04"); // insured group name
  } else if (id === "DMG") {
    check(els[2] ?? "", "DMG-02"); // date of birth
  } else if (id === "REF") {
    if (X12_REF_PHI_QUALIFIERS.has((els[1] ?? "").toUpperCase())) check(els[2] ?? "", "REF-02");
  }
}

// ---------------------------------------------------------------------------
// NCPDP Telecom structured, field-level PHI detection (the deid-specific gate, DEID-5)
// ---------------------------------------------------------------------------

// NCPDP Telecom 2-character field ids that carry patient / cardholder / prescriber PHI. Field ids are
// globally unique in the standard, so keying off the id (not the segment) is correct and
// bypass-resistant. Mirrors src/ncpdp/locus-map.ts.
const TELECOM_PHI_FIELD_IDS = new Set<string>([
  "CA", // Patient First Name
  "CB", // Patient Last Name
  "CM", // Patient Street Address
  "CN", // Patient City
  "CQ", // Patient Phone
  "CY", // Patient ID
  "C4", // Date of Birth
  "C2", // Cardholder ID
  "C1", // Group ID
  "CC", // Cardholder First Name
  "CD", // Cardholder Last Name
  "DB", // Prescriber ID
]);

/**
 * Structured NCPDP Telecom PHI scan: split the transmission on the Field / Group / Segment separators
 * (0x1C / 0x1D / 0x1E), and for each `<2-char-id><value>` token whose id is a known PHI field, check the
 * value against the synthetic allow-list. Anything not positively declared synthetic is a hit.
 */
function scanTelecomStructured(path: string, content: string, allow: AllowList, hits: Hit[]): void {
  // Telecom is framed by ASCII control chars; a file without them is not a Telecom transmission.

  const allowed = syntheticTokens(allow);
  for (const token of content.split(/[\x1c\x1d\x1e]/)) {
    if (token.length < 2) continue;
    const id = token.slice(0, 2).toUpperCase();
    if (!TELECOM_PHI_FIELD_IDS.has(id)) continue;
    const value = token.slice(2).trim();
    if (value.length === 0) continue;
    if (isSubstitutionSite(value)) continue; // a source hole, not a value
    if (!allowed.has(value.toUpperCase())) {
      hits.push({
        path,
        segment: id,
        value,
        reason: "NCPDP Telecom PHI field value not declared synthetic in the allow-list",
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

/**
 * The JS string escapes a source file uses to embed WIRE TEXT, and only those.
 *
 * ▶ THIS IS WHAT MAKES THE WIDENED `test/` ROOT WORTH HAVING, AND THE ENUMERATION
 * ALONE WAS NOT. Every HL7 message and NCPDP transmission in this repo lives in a
 * `.ts` module as a single-line string literal — an MSH header, a backslash-`r`,
 * then the next segment, all inside one pair of quotes — so the bytes on disk
 * carry a BACKSLASH and an `r`, not a carriage return. (The escape is spelled out
 * in words here rather than shown: this file is itself inside a scan root now,
 * and a written-out example would decode into a segment the detector then reads
 * as a fixture. It did, on the first draft of this paragraph.)
 * `scanHl7Structured` splits on real CR/LF and
 * `scanTelecomStructured` splits on real 0x1C/0x1D/0x1E, so both saw one
 * undifferentiated line and detected nothing. Sweeping those files without this
 * decode would have added the SSN/email floor and nothing else, while the
 * changelog claimed the inline `PID|…` literals were now covered.
 *
 * The decoded text is scanned IN ADDITION to the raw bytes, never instead of
 * them, so a wrong decode can only ever ADD a hit. That is the safe direction
 * for a PHI gate: the cost of over-decoding is a false red a developer can read
 * and answer, and the cost of under-decoding is the silence this closes.
 * `\\` is deliberately NOT handled — HL7's own escape sequences are
 * backslash-delimited (`\F\`, `\S\`, `\X0D\`) and none of them collide with the
 * set below, so there is nothing to unescape and a general unescaper would have
 * mangled real fixture bytes.
 *
 * WHERE the decode is applied is `sourceLiteralDocument` below, and the two ways
 * applying it to the whole file went wrong are recorded there.
 */
const SOURCE_ESCAPE = /\\(r|n|t|x[0-9a-fA-F]{2}|u[0-9a-fA-F]{4})/g;

function decodeSourceEscapes(text: string): string {
  return text.replace(SOURCE_ESCAPE, (_match, seq: string) => {
    if (seq === "r") return "\r";
    if (seq === "n") return "\n";
    if (seq === "t") return "\t";
    return String.fromCharCode(parseInt(seq.slice(1), 16));
  });
}

/**
 * Every string / template literal in a source file, escapes decoded, joined into
 * one document.
 *
 * DECODING THE WHOLE FILE IN PLACE WAS THE FIRST DRAFT AND IT WAS WRONG TWICE,
 * both measured here before this comment was written:
 *
 *   - the closing quote and comma of the source line RODE ALONG on the last
 *     field of the last segment, so an allow-listed DOB arrived as the DOB plus
 *     two characters of TypeScript and was reported as an undeclared value — a
 *     false red on a fixture that is entirely synthetic;
 *   - the delimiters were taken from the FIRST MSH-shaped text anywhere in the
 *     file, so an `MSH-9` in a comment or a test title set the field separator
 *     to `-` for every message in that file and the detector then found nothing.
 *
 * Taking the literals instead fixes both at the source: a literal's content is
 * the wire text and nothing else, and prose in a comment is not a literal. They
 * are JOINED rather than scanned one by one, because a message here is routinely
 * built by CONCATENATING literals — the header in one, further segments in the
 * next — and a `PID` literal on its own has no MSH to take delimiters from.
 *
 * The regex is the usual approximation (a literal ends at the first unescaped
 * quote of its own kind); it does NOT parse TypeScript. That is acceptable in
 * this direction only because this view is scanned IN ADDITION to the raw bytes,
 * never instead of them.
 */
const SOURCE_LITERAL = /"((?:[^"\\\n]|\\.)*)"|'((?:[^'\\\n]|\\.)*)'|`((?:[^`\\]|\\.)*)`/g;

function sourceLiteralDocument(text: string): string {
  const parts: string[] = [];
  for (const m of text.matchAll(SOURCE_LITERAL)) {
    const raw = m[1] ?? m[2] ?? m[3];
    if (raw === undefined || raw.length === 0) continue;
    parts.push(decodeSourceEscapes(raw));
  }
  return parts.join("\r\n");
}

/** Identity of a hit within one file, for de-duplicating across the two views. */
function hitKey(h: Hit): string {
  return `${h.segment} ${h.value} ${h.reason}`;
}

function scanTarget(target: Target, allow: AllowList, hits: Hit[]): void {
  let buf: Buffer;
  try {
    buf = target.read();
  } catch (err) {
    throw new InvocationError(
      `could not read ${target.path}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const text = buf.toString("utf8");

  const raw: Hit[] = [];
  scanViews(target.path, text, allow, raw, false);
  hits.push(...raw);

  // The second view: this file's string literals, decoded and joined. Only hits
  // the raw view did not already report are added, so a value that both views
  // see is reported once and the raw view's own multiplicity is untouched.
  const literals = sourceLiteralDocument(text);
  if (literals.length > 0 && literals !== text) {
    const extra: Hit[] = [];
    scanViews(target.path, literals, allow, extra, true);
    const seen = new Set(raw.map(hitKey));
    for (const h of extra) {
      if (seen.has(hitKey(h))) continue;
      seen.add(hitKey(h));
      hits.push(h);
    }
  }
}

/**
 * Run every detector over one VIEW of a file.
 *
 * `literalView` says which view this is, and exactly one detector needs to know:
 * indented segments are a fact about text taken OUT of a source literal, and
 * stripping indentation in the RAW view re-opens the "source syntax rides along"
 * false red that taking the literals was introduced to fix — a template literal
 * whose closing backtick sits on its last segment line reported a declared DOB
 * with two characters of TypeScript attached, unanswerable except by
 * allow-listing a token containing TypeScript. Nothing is lost by the
 * restriction: an indented segment only ever occurs inside a literal, and the
 * literal view is where it is read.
 */
function scanViews(
  path: string,
  text: string,
  allow: AllowList,
  hits: Hit[],
  literalView: boolean,
): void {
  const target = { path };
  // The format-agnostic floor: dashed SSN + non-test email. This runs on every
  // target and is all the starter detects.
  scanCommonShapes(target.path, text, allow, hits);

  // The deid-specific gate: HL7 v2 structured, field-level PHI detection. Runs on any HL7 message
  // (MSH-led) among src JSDoc snippets and test/fixtures — checks every PID/NK1/GT1/IN1/IN2 PHI field
  // against the synthetic allow-list. A real name / DOB / MRN in a fixture is a hard hit.
  //
  // NOTE: free-text narrative (OBX-5 / NTE-3) is NOT structurally checkable and is covered only by the
  // floor above (SSN/email) plus the synthetic-fixture discipline; per-format C-CDA/FHIR/X12/NCPDP/DICOM
  // detectors land with their phases (roadmap §7 — the eventual union scanner).
  scanHl7Structured(target.path, text, allow, hits, literalView);

  // The deid-specific C-CDA gate (DEID-3): structured, header-element PHI detection. Runs on any CDA R2
  // document (HL7 v3 namespace) among src JSDoc snippets and test/fixtures — checks every header
  // person-name / address-part element and birthTime against the synthetic allow-list. A real name /
  // DOB in a C-CDA header is a hard hit. (Narrative body text and ids are the known gaps, covered by
  // the floor + synthetic discipline, per the union-scanner roadmap.)
  scanCcdaStructured(target.path, text, allow, hits);

  // The deid-specific X12 gate (DEID-5): structured, element-level PHI detection. Runs on any X12
  // interchange (106-byte ISA head) — checks the patient-entity NM1 name/id, DMG DOB, and PHI-qualified
  // REF value against the synthetic allow-list. Provider-entity NM1 names are retained and not checked.
  scanX12Structured(target.path, text, allow, hits);

  // The deid-specific NCPDP Telecom gate (DEID-5): structured, field-id PHI detection. Runs on any
  // control-char-framed Telecom transmission — checks each patient / cardholder / prescriber PHI field
  // value against the synthetic allow-list. (SCRIPT XML de-id is deferred — see src/ncpdp/index.ts.)
  scanTelecomStructured(target.path, text, allow, hits);
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

function report(hits: Hit[]): void {
  if (hits.length === 0) {
    process.stdout.write("[phi-scan] OK — no hits\n");
    return;
  }
  const byPath = new Map<string, Hit[]>();
  for (const h of hits) {
    const arr = byPath.get(h.path);
    if (arr) arr.push(h);
    else byPath.set(h.path, [h]);
  }
  for (const [path, group] of byPath) {
    process.stderr.write(`[phi-scan] HIT: ${path}\n`);
    for (const h of group) {
      process.stderr.write(
        `  segment=${h.segment} value=${JSON.stringify(h.value)} (${h.reason})\n`,
      );
    }
  }
  process.stderr.write(
    `[phi-scan] ${String(hits.length)} hit(s) across ${String(byPath.size)} file(s). ` +
      `If a value is genuinely synthetic, declare it in scripts/phi-allow-list.txt OR ` +
      `run with --allow-fixture <path> AND log it in phi-scan-overrides.md.\n`,
  );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function run(): number {
  const args = parseArgs(process.argv.slice(2));
  validateAllowFixtures(args.allowFixtures);

  const allow = loadAllowList();
  const allowed = new Set<string>(args.allowFixtures.map(normalizePath));

  let targets: Target[];
  if (args.mode === "staged") targets = buildTargetsForStaged();
  else if (args.mode === "paths") targets = buildTargetsForPaths(args.paths);
  else targets = buildTargetsForAll();

  const before = targets.length;
  targets = targets.filter((t) => !allowed.has(t.path));

  // A bypass is ANNOUNCED, on every route, every run. The whole-file bypass is
  // now reachable from the two modes that actually run in CI and at pre-commit,
  // so the one thing it must never be is quiet: a reader of a CI log can see
  // exactly which files this gate did not read, without opening a manifest.
  if (allowed.size > 0 && targets.length < before) {
    for (const p of [...allowed].sort()) {
      process.stderr.write(
        `[phi-scan] BYPASSED (logged in phi-scan-overrides.md): ${p} — NOT scanned\n`,
      );
    }
  }

  const hits: Hit[] = [];
  for (const t of targets) scanTarget(t, allow, hits);

  report(hits);
  return hits.length === 0 ? 0 : 1;
}

/**
 * THE EXIT-CODE CONTRACT IS THE POINT OF THIS WRAPPER: 0 clean, 1 HITS FOUND,
 * 2 the scan could not be performed. Exit 1 is a claim ABOUT THE CORPUS, and
 * nothing that is not a hit may ever spend it.
 *
 * It used to. `loadAllowList()` sat outside every handler, and `readdirSync`
 * inside the walk threw a plain `Error` that no `instanceof InvocationError` arm
 * matched — so a missing allow-list and an unreadable directory both escaped as
 * an uncaught exception, which Node exits **1** for. A gate that cannot read its
 * own allow-list reported the exit code that means "I read your corpus and found
 * PHI in it", and a caller distinguishing 1 from 2 was told the opposite of the
 * truth. Catching by TYPE was the mistake: the set of things that can fail is
 * open, so the failure path is the default and a hit is the exception.
 */
function main(): number {
  try {
    return run();
  } catch (err) {
    if (err instanceof InvocationError) {
      process.stderr.write(`[phi-scan] ${err.message}\n`);
      return 2;
    }
    // Unexpected — still exit 2, and still say so loudly. The stack is printed
    // because a silent 2 is as unhelpful as a wrong 1; it names code paths and
    // repo-relative files, never scanned content.
    process.stderr.write(
      `[phi-scan] the scan could not be completed: ${
        err instanceof Error ? (err.stack ?? err.message) : String(err)
      }\n`,
    );
    return 2;
  }
}

process.exit(main());
