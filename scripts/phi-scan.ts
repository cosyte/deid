#!/usr/bin/env tsx
/**
 * `@cosyte/deid` PHI scanner — the CI / pre-commit half of the PHI commit-gate.
 *
 * Pure Node. Zero runtime deps. `git` is the only subprocess, always via
 * `execFileSync` with array args (never shell-form). Walks the synthetic test
 * fixtures (and a conservative text pass over `src/`) and REFUSES anything that
 * looks like real PHI, so a developer cannot commit a real-looking fixture by
 * accident.
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
 *
 *   ⚠  Still-open gaps (do NOT treat green as "no PHI" for these): HL7 free text
 *      (OBX-5 / NTE-3 narrative), C-CDA narrative `<text>` blocks and `<id>`
 *      extensions, and the other consumer formats (FHIR / X12 / NCPDP / DICOM)
 *      have NO structured detector yet — add one with each format's phase
 *      (roadmap §7, the eventual union scanner). Add positive tests proving each
 *      new detector CATCHES real names / DOBs / ids.
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
 *                              phi-scan-overrides.md
 *   <path> [<path>...]       - scan specific paths
 *   (no args)                - scan all in-scope working-tree files
 *
 * Exit codes: 0 (clean), 1 (hits found), 2 (invocation error).
 */

import { readFileSync, statSync, existsSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, resolve, relative, sep, isAbsolute } from "node:path";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const REPO_ROOT = process.cwd();
const ALLOW_LIST_PATH = join(REPO_ROOT, "scripts", "phi-allow-list.txt");
const OVERRIDE_LOG_PATH = join(REPO_ROOT, "phi-scan-overrides.md");

// Roots walked in "all" mode. test/fixtures gets the full scan; src gets the
// same conservative shape pass because it is hand-written code, not data —
// JSDoc `@example` snippets must not carry real PHI either.
const FIXTURE_ROOT = join(REPO_ROOT, "test", "fixtures");
const SRC_ROOT = join(REPO_ROOT, "src");

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
  // scan, never a scan target on its own — so it also seeds the positional path
  // set. That makes `--allow-fixture X` mean "scan X, but allow it" (proving the
  // override gate actually subtracts a scanned target) instead of a silent no-op.
  const scanPaths = paths.length > 0 ? paths : [...allowFixtures];

  let mode: Args["mode"];
  if (staged) {
    mode = "staged";
  } else if (scanPaths.length > 0) {
    mode = "paths";
  } else {
    mode = "all";
  }
  return { mode, paths: scanPaths, allowFixtures };
}

// ---------------------------------------------------------------------------
// Allow-list + override log
// ---------------------------------------------------------------------------

function loadAllowList(): AllowList {
  if (!existsSync(ALLOW_LIST_PATH)) {
    throw new InvocationError(`allow-list not found at ${ALLOW_LIST_PATH}`);
  }
  const raw = readFileSync(ALLOW_LIST_PATH, "utf8");
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

function loadOverrideLog(): Set<string> {
  if (!existsSync(OVERRIDE_LOG_PATH)) return new Set();
  const raw = readFileSync(OVERRIDE_LOG_PATH, "utf8");
  const out = new Set<string>();
  for (const lineRaw of raw.split(/\r?\n/)) {
    const m = /^###\s+(.+?)\s*$/.exec(lineRaw);
    if (m && m[1] !== undefined) out.add(normalizePath(m[1]));
  }
  return out;
}

function validateAllowFixtures(allowFixtures: string[]): void {
  if (allowFixtures.length === 0) return;
  const overrides = loadOverrideLog();
  const missing = allowFixtures.map(normalizePath).filter((p) => !overrides.has(p));
  if (missing.length > 0) {
    const lines = missing.map((p) => `  - ${p}`).join("\n");
    throw new InvocationError(
      `--allow-fixture rejected: no matching entry in phi-scan-overrides.md for:\n${lines}\n` +
        `Add a "### <path>" subsection to phi-scan-overrides.md and commit it.`,
    );
  }
}

// ---------------------------------------------------------------------------
// Target enumeration
// ---------------------------------------------------------------------------

interface Target {
  path: string; // forward-slash repo-relative path for reporting
  read: () => Buffer;
}

function walk(dir: string, out: string[]): void {
  if (!existsSync(dir)) return;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      walk(full, out);
    } else if (e.isFile()) {
      // README/markdown docs may legitimately describe violator values; they
      // are documentation, not fixtures.
      if (e.name.toLowerCase().endsWith(".md")) continue;
      out.push(full);
    }
  }
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

function buildTargetsForAll(): Target[] {
  const files: string[] = [];
  walk(FIXTURE_ROOT, files);
  walk(SRC_ROOT, files);
  const ignored = gitIgnored(files);
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

function buildTargetsForStaged(): Target[] {
  let listBuf: Buffer;
  try {
    // SECURITY: array-form execFileSync, no shell.
    listBuf = execFileSync("git", ["diff", "--cached", "--name-only", "--diff-filter=AM", "-z"], {
      encoding: "buffer",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err) {
    throw new InvocationError(
      `git diff --cached failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const list = listBuf
    .toString("utf8")
    .split("\0")
    .filter((p) => p.length > 0)
    .filter((p) => p.startsWith("test/fixtures/") || (p.startsWith("src/") && p.endsWith(".ts")));
  return list.map((relPath) => ({
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
function scanHl7Structured(path: string, content: string, allow: AllowList, hits: Hit[]): void {
  const lines = content.split(/\r\n|\r|\n/).filter((l) => l.length > 0);
  const msh = lines.find((l) => l.startsWith("MSH"));
  if (msh === undefined) return; // not an HL7 v2 message
  const fieldSep = msh.charAt(3) || "|";
  const enc = msh.slice(4).split(fieldSep)[0] ?? "^~\\&";
  const compSep = enc.charAt(0) || "^";
  const repSep = enc.charAt(1) || "~";
  const subSep = enc.charAt(3) || "&";
  const allowed = syntheticTokens(allow);

  for (const line of lines) {
    const name = line.slice(0, 3);
    const spec = HL7_PHI_FIELDS[name];
    if (spec === undefined) continue;
    const fields = line.split(fieldSep); // fields[0] = segment name; fields[n] = SEG-n
    for (const { field, comps } of spec) {
      const raw = fields[field];
      if (raw === undefined || raw.length === 0) continue;
      for (const rep of raw.split(repSep)) {
        const components = rep.split(compSep);
        for (const c of comps) {
          const value = (components[c - 1] ?? "").split(subSep)[0] ?? "";
          if (value.length === 0) continue;
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
// Dispatch
// ---------------------------------------------------------------------------

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
  scanHl7Structured(target.path, text, allow, hits);

  // The deid-specific C-CDA gate (DEID-3): structured, header-element PHI detection. Runs on any CDA R2
  // document (HL7 v3 namespace) among src JSDoc snippets and test/fixtures — checks every header
  // person-name / address-part element and birthTime against the synthetic allow-list. A real name /
  // DOB in a C-CDA header is a hard hit. (Narrative body text and ids are the known gaps, covered by
  // the floor + synthetic discipline, per the union-scanner roadmap.)
  scanCcdaStructured(target.path, text, allow, hits);
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

function main(): number {
  let args: Args;
  try {
    args = parseArgs(process.argv.slice(2));
    validateAllowFixtures(args.allowFixtures);
  } catch (err) {
    if (err instanceof InvocationError) {
      process.stderr.write(`[phi-scan] ${err.message}\n`);
      return 2;
    }
    throw err;
  }

  const allow = loadAllowList();
  const allowed = new Set<string>(args.allowFixtures.map(normalizePath));

  let targets: Target[];
  try {
    if (args.mode === "staged") targets = buildTargetsForStaged();
    else if (args.mode === "paths") targets = buildTargetsForPaths(args.paths);
    else targets = buildTargetsForAll();
  } catch (err) {
    if (err instanceof InvocationError) {
      process.stderr.write(`[phi-scan] ${err.message}\n`);
      return 2;
    }
    throw err;
  }

  targets = targets.filter((t) => !allowed.has(t.path));

  const hits: Hit[] = [];
  for (const t of targets) {
    try {
      scanTarget(t, allow, hits);
    } catch (err) {
      if (err instanceof InvocationError) {
        process.stderr.write(`[phi-scan] ${err.message}\n`);
        return 2;
      }
      throw err;
    }
  }

  report(hits);
  return hits.length === 0 ? 0 : 1;
}

process.exit(main());
