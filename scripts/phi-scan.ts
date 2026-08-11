#!/usr/bin/env tsx
/**
 * `@cosyte/deid` PHI scanner: the CI / pre-commit half of the PHI commit-gate.
 *
 * ===========================================================================
 * WHAT IS IN THIS FILE, AND WHAT IS NOT.
 *
 * THE MACHINERY IS `@cosyte/script-utils/phi-scan`, A devDependency: argument
 * parsing, the allow-list and the override log, target enumeration on all three
 * routes, the union of the working-tree walk with the bytes git carries, content
 * deduplication, THE COMPLETENESS RULE, every refusal, the report, and the
 * cross-cutting SSN/email FLOOR. Read that module's docblock for what each rule
 * closes and what it costs. NOTHING OF IT IS RESTATED HERE, because a claim
 * written down twice is a claim that drifts, and this repo has paid for that
 * twice already.
 *
 * IT IS A DEPENDENCY AND NOT A COPY, AND THAT IS THE POINT. This file used to
 * carry the whole engine. A newly-found escape therefore cost one pull request
 * and one adversarial review PER REPO, thirteen times over, and three escape
 * classes have been paid for that way. Now it costs one pull request in
 * `cosyte/config` and a version bump here. IT IS A devDependency, NEVER A
 * RUNTIME ONE: the zero-dep rule governs what ships, and a dev-time gate does
 * not ship.
 *
 * 🛑 SO THE REMEDY FOR A GAP IS TO CHANGE THE ENGINE, NEVER TO GROW A LOCAL
 * WORKAROUND HERE. A shim written in this file is the thing this adoption
 * exists to delete: it makes the next escape cost thirteen pull requests again.
 *
 * WHAT STAYS LOCAL IS WHAT GENUINELY DIFFERS: THE FIVE PER-REPO AXES below, and
 * the STANDARD-SPECIFIC FIELD DETECTION in `detect` at the bottom of this file.
 * ===========================================================================
 *
 * ===========================================================================
 * COVERAGE: READ BEFORE YOU RELY ON THIS.
 *
 *   FLOOR (any format, and the engine's, not this file's): a dashed SSN shape
 *     and an email at a domain the allow-list does not declare.
 *   HL7 v2 STRUCTURED (`scanHl7Structured`): every PID/NK1/GT1/IN1/IN2 PHI
 *     field (names, DOB, SSN, MRN/member id, street/city, phone) is checked
 *     against the synthetic allow-list: a real value there is a HARD HIT.
 *   C-CDA STRUCTURED (`scanCcdaStructured`): every header person-name / address
 *     element (given/family/prefix/suffix/name/street/city/county) and
 *     `birthTime` is checked against the allow-list. Scoped to the header (a
 *     body `<name>` can be a drug name).
 *   X12 STRUCTURED (`scanX12Structured`): the patient-entity NM1 name/id, DMG
 *     DOB, and PHI-qualified REF value are checked against the allow-list.
 *     Provider-entity NM1 names are retained and NOT checked (a provider/org
 *     name is not the individual's PHI).
 *   NCPDP TELECOM STRUCTURED (`scanTelecomStructured`): each patient /
 *     cardholder / prescriber PHI field (by its globally-unique 2-char id) is
 *     checked against the allow-list.
 *
 *   ⚠ Still-open gaps (do NOT treat green as "no PHI" for these): HL7 free text
 *     (OBX-5 / NTE-3 narrative), C-CDA narrative `<text>` blocks and `<id>`
 *     extensions, X12 free-text / retained-segment residuals, NCPDP SCRIPT (XML,
 *     de-id deferred), and FHIR / DICOM have NO structured detector yet. Add one
 *     with each format's phase. Add positive tests proving each new detector
 *     CATCHES real names / DOBs / ids.
 *
 *   ⚠ AND THE GAPS THAT ARE ABOUT THE *CONTAINER*, NOT THE FORMAT. Every
 *     detector above has to RECOGNISE the document before it checks anything,
 *     and a hand-written source file is not the shape any of them was written
 *     for. Each recogniser was widened for that (an MSH found anywhere and
 *     falling back to the default delimiters, an ISA header found anywhere,
 *     indented segments, and the source-literal view in `sourceLiteralDocument`),
 *     and NONE of it is a claim that arbitrary embedded text is reached:
 *       - a C-CDA is recognised by its `urn:hl7-org:v3` namespace and an NCPDP
 *         Telecom transmission by its control-char framing, so a fragment
 *         carrying neither is covered by the FLOOR only;
 *       - a message assembled at run time from pieces no literal contains is not
 *         text this scan can see at all;
 *       - a delimiter set that differs BETWEEN two documents in one file is read
 *         with the first document's, and prose that satisfies ISA's fixed widths
 *         by accident would be preferred to the real header below it;
 *       - a segment broken across lines is read both ways (line by line and
 *         rejoined), but a segment broken across two SOURCE LITERALS is not
 *         rejoined.
 *     When you widen a recogniser, prove it with a case that is RED before and
 *     GREEN after: a recogniser that quietly matches nothing reports "no hits".
 *
 *   🛑 THE ENGINE'S FLOOR RUNS OVER `ctx.text` — THE TARGET'S OWN BYTES — AND
 *   NOT OVER THE SECOND VIEW THIS FILE BUILDS. On the copied scanner the floor
 *   ran over both views. The engine exposes no way for a caller to put an
 *   additional view through the shared floor, and writing the floor's shapes out
 *   again here would be exactly the local machinery this adoption deletes, so
 *   the narrowing is NAMED rather than worked around. MEASURED, so it is a
 *   residual and not a guess: across all 121 tracked non-markdown, non-`vendor/`
 *   files, ZERO floor shapes appear in the source-literal view that are not
 *   already present verbatim in the raw bytes. What it would take to reach one:
 *   an SSN or email whose separator or character is spelled as a JS escape, or a
 *   shape split across two literals. The four STRUCTURED detectors below still
 *   read both views, which is what the second view was built for.
 *
 *   The mechanism for declaring genuinely-synthetic identifiers is the
 *   allow-list (`scripts/phi-allow-list.txt`): a positive declaration that a
 *   fixture's identifiers are fake. Byte-strict formats cannot carry an inline
 *   `# synthetic: true` header, so the allow-list is the proven substitute.
 *   EVERY DETECTOR BELOW CONSULTS IT. A whole-file `--allow-fixture` bypass is
 *   RECORDED AND THEN REFUSED by the engine's completeness rule: it cannot reach
 *   a clean run in any mode, so it is not a remedy for anything.
 * ===========================================================================
 *
 * ===========================================================================
 * EXIT CONTRACT, DEFINED HERE AND NOT INHERITED:
 *
 *   0  the scan ran, READ EVERY TARGET IT ENUMERATED, and found nothing.
 *   1  HITS. Reserved for "this corpus contains something that looks like PHI".
 *      It is NOT exclusive: an allow-list, or an override log, that EXISTS but
 *      cannot be READ throws a plain `Error` and takes node's own exit 1, which
 *      a caller reads as "hits found". The engine names that escape rather than
 *      claiming to have closed it.
 *   2  EVERY STATE THE ENGINE RAISES IN WHICH THE SCAN CANNOT ACCOUNT FOR
 *      SOMETHING. The full list is in the engine's `run()` docblock.
 *
 * 1 IS RESERVED BECAUSE CI AND THE PRE-COMMIT HOOK BRANCH ON THE CODE, and
 * nothing that is not a hit may ever spend it.
 *
 * 🛑 DO NOT PORT THESE NUMBERS INTO, OR OUT OF, A SIBLING PARSER. The
 * `@cosyte/*` scanners do not agree on them and are not required to. That is why
 * the engine has no default for them.
 * ===========================================================================
 */

import {
  exemptsMarkdown,
  runPhiScan,
  type DetectContext,
  type Hit,
} from "@cosyte/script-utils/phi-scan";

// ===========================================================================
// ██  THE FIVE PER-REPO AXES  ███████████████████████████████████████████████
// ===========================================================================
//
// A PORT IS NOT A COPY. Five things genuinely differ between the sibling
// `@cosyte/*` scanners, and every one of them is a PARAMETER of the shared
// engine rather than a fork of it. Each is re-derived HERE, for this repo:
//
//   1. EXIT CODES        `EXIT_CODES`. No default exists, deliberately.
//   2. ROOTS+EXCLUSIONS  `SCAN_ROOTS`, `EXCLUDED_PATHS`, `isWalkReadable`.
//   3. `--staged` SCOPE  `isStagedReadable`.
//   4. GITLINKS          `regularBlobModes`, defaulted by the engine to git's
//                        two regular-blob modes. Nothing to set here.
//   5. EOL NORMALIZATION No parameter: the engine's walk/index deduplication is
//                        BY CONTENT, so a repo whose index carries LF and whose
//                        working tree carries CRLF scans BOTH forms. CHECKED
//                        rather than skipped: this repo has no `.gitattributes`
//                        at all, `core.autocrlf` and `core.eol` are both unset,
//                        and CI is Linux, so neither copy diverges here.
// ===========================================================================

/** AXIS 1: this repo's exit contract, stated in the header block above. */
const EXIT_CODES = { clean: 0, hits: 1, refuse: 2 } as const;

/**
 * AXIS 2: the roots `all` mode walks.
 *
 * 🛑 THIS IS A WIDENING FROM `["src", "test", "scripts"]`, AND IT IS FORCED BY
 * THE ENGINE'S DESIGN RATHER THAN CHOSEN AS A PREFERENCE. The copied scanner ran
 * two differently-scoped sweeps: the WALK covered three declared directories,
 * while the INDEX ROUTE read every tracked path in the repository (minus `.md`
 * and `vendor/`), wherever it sat. The engine has ONE root half of scope and
 * applies it to BOTH: `unionCandidatePaths` filters the index by
 * `isUnderScanRoot`. So keeping three roots would have SILENTLY DROPPED the 19
 * tracked non-markdown paths outside them that `main` reads today, which is a
 * coverage regression rather than a port.
 *
 * NAMED RATHER THAN COUNTED, because a bare number is the trap this lineage
 * keeps paying for — and the list falsifies the count: `.changeset/config.json`,
 * `.github/dependabot.yml`, the six `.github/workflows/*.yml`, `.gitignore`,
 * `.npmrc`, `LICENSE`, `docs-content/sidebars.json`, `eslint.config.js`,
 * `package.json`, `pnpm-lock.yaml`, `tsconfig.json`, `tsup.config.ts` and
 * `vitest.config.ts`.
 *
 * ⚖️ `package.json` IS THE ONE THAT MAKES THIS LOAD-BEARING RATHER THAN TIDY.
 * Its `author` field carries this package's published contact address, which is
 * why `scripts/phi-allow-list.txt` declares `EMAILDOMAIN cosyte.com` at all, and
 * striking that declaration is this scanner's own POSITIVE CONTROL. Under three
 * roots the control would have gone vacuous with nothing to notice.
 *
 * WHAT THE WIDENING ADDS ON TOP, stated so it is not read as free: the WALK now
 * reads those same paths off disk as well, plus any UNTRACKED file outside the
 * old three roots. The engine prunes gitignored directories DURING descent and
 * skips `.git` by name, so `node_modules/`, `dist/`, `coverage/` and
 * `dist-artifacts/` are never descended. `vendor/` is handled by the read filter
 * below, not by the roots.
 *
 * ⚠ AND ONE THING IT WIDENS THAT IS NOT ABOUT READING: every non-regular and
 * non-blob REFUSAL keys on the root half of scope, so a staged symbolic link or
 * gitlink ANYWHERE in this repository now refuses the pre-commit run, where
 * before only one under the three directories did. The direction is fail-safe
 * (it refuses more, never reads more blindly) and it is recorded rather than
 * discovered.
 */
const SCAN_ROOTS: readonly string[] = ["."];

/**
 * AXIS 2 (the subtractive half): repo-relative paths NO route reads: not the
 * walk, not the index union, not `--staged`.
 *
 * 🛑 EXCLUDE A LITERAL PATH, NEVER A CLASS. A "binary blob" predicate was
 * measured and REJECTED here: `src/context.ts` and `src/manifest.ts` embed NUL
 * bytes as HMAC domain separators, so git's own heuristic calls them binary and
 * the predicate would have dropped two hand-written sources out of the corpus in
 * silence. A literal path is reviewable in a diff; a class quietly grows new
 * members.
 *
 * AN ENTRY HERE IS A FILE THE SCAN HAS NO VERDICT ABOUT, so it carries a comment
 * saying why.
 */
const EXCLUDED_PATHS: ReadonlySet<string> = new Set<string>([
  // The scanner's OWN test suite, and THE ONE FILE THIS REPO EXCLUDES.
  //
  // 🛑 THIS IS THE SAME CARVE-OUT `main` HELD, MOVED TO THE MECHANISM THAT STILL
  // WORKS. It used to be a `--allow-fixture test/scripts/phi-scan.test.ts` flag
  // baked into the `phi-scan` package script plus a logged entry in
  // `phi-scan-overrides.md`. The engine's COMPLETENESS RULE refuses over a
  // target a run enumerated and never read, so that flag can no longer reach
  // exit 0 in any mode: left as it was, `pnpm phi-scan` would refuse on every
  // run. The exclusion is preserved, deliberately and visibly, HERE.
  //
  // WHY THE FILE IS EXCLUDED AT ALL: it must carry violator-shaped values to
  // prove the detectors CATCH them — a dashed SSN, an email at a non-test
  // domain, a `John`/`Smith` C-CDA header, an undeclared DOB. A suite that could
  // pass its own scan would be asserting nothing.
  //
  // ⚖️ THE COST IS STATED RATHER THAN HIDDEN, AND IT IS NOT THE SAME COST AS
  // BEFORE. Real PHI pasted into this file is still not caught. What changed is
  // WHERE a reader learns that: a bypass announced itself on stderr on every
  // run, and an exclusion does not. It is a declaration in reviewed source
  // instead, which is the trade the engine's shared boundary makes.
  "test/scripts/phi-scan.test.ts",
]);

/**
 * AXIS 2, the READ half of scope for the two SWEEPING routes.
 *
 * TWO NAME RULES, AND BOTH ARE READ FILTERS RATHER THAN SCOPE. The engine keeps
 * the two predicates apart on purpose: every non-regular and non-blob refusal
 * keys on the ROOT half, so a `vendor/`-named or `.md`-named symbolic link is
 * still refused on every route. A name is no evidence at all about what is on
 * the other side of a link.
 *
 *   `.md`  — the shared Markdown exemption, `exemptsMarkdown`, unchanged.
 *            Documentation may legitimately describe a violator value.
 *            ⚠ THE CONSEQUENCE, ROUTE-DEPENDENT RATHER THAN FILE-DEPENDENT: a
 *            tracked `.md` is read by NEITHER sweeping route, so `docs-content/`
 *            (16 of its 17 tracked files are `.md`) REMAINS A PUBLISHED CONSUMER
 *            SURFACE THIS GATE DOES NOT SCAN FOR PHI. A `.md` named explicitly
 *            on argv IS scanned, because that is the caller's own argument. That
 *            boundary is the engine's default and moving it is a decision taken
 *            there, for every repo at once.
 *   `vendor/` — the six third-party `pnpm pack` tarballs of the sibling parsers.
 *            NOT this package's corpus, and already declared out of scope before
 *            this file depended on anything.
 *
 * ▶ THE `vendor/` COST IS MEASURED, NOT ASSUMED. They are gzip, so their text is
 * compressed and no detector here can read it without decompressing an archive,
 * which this scanner does not do. With the exclusion removed, `all` mode over
 * this repo reported 45 hits across all six tarballs and exited 1: 44 spurious
 * NCPDP Telecom field tokens and one spurious email address. The Telecom
 * detector splits on 0x1C/0x1D/0x1E and reads the next two bytes as a field id,
 * and those bytes occur throughout compressed data, so it fires on mojibake
 * indefinitely. A gate that red-locks the repo on mojibake teaches developers to
 * bypass it. RE-DERIVE THAT FIGURE rather than trusting it: it is a function of
 * what is vendored and of the detector set, and both move.
 *
 * ▶ IT IS THE DIRECTORY, NOT THE FILE NAMES, AND THAT IS DELIBERATE. Writing the
 * six tarballs into `EXCLUDED_PATHS` instead would have been literal to the
 * point of breaking: each name carries the vendored parser's VERSION, so
 * re-packing one at a new version renames it out of the exclusion and red-locks
 * the repo on mojibake. `vendor/` is a committed directory this repo declares,
 * not a content class inferred from bytes.
 */
function isWalkReadable(relPath: string): boolean {
  return exemptsMarkdown(relPath) && !relPath.startsWith("vendor/");
}

/**
 * AXIS 3: the READ half of scope for `--staged`, i.e. which regular blobs a
 * COMMIT is blocked on.
 *
 * 🛑 IT KEEPS THE THREE-DIRECTORY BOUNDARY THE HOOK ALREADY HAD, EVEN THOUGH
 * `SCAN_ROOTS` WIDENED. Widening `--staged` changes what a COMMIT is blocked on,
 * which is a HOOK decision taken on its own evidence; this repo has declined it
 * three times, and an adoption is not the slice that reverses it. The engine
 * permits a filter NARROWER than the roots and refuses only one WIDER than them.
 *
 * THE THREE DIRECTORIES ARE RE-DERIVED HERE RATHER THAN INHERITED:
 *   - `test/` WHOLE, not `test/fixtures/`. Every one of this repo's test modules
 *     is a hand-written `.ts` that embeds document text inline (HL7 `PID|…`
 *     segments, C-CDA headers, X12 interchanges, Telecom field tokens) as string
 *     literals rather than as files under `test/fixtures/`. The older scopes
 *     missed 38 tracked files, four of them already carrying `PID|…` literals,
 *     and a real name or MRN pasted into one committed with both gates green, in
 *     the de-identification package.
 *   - `src/`: hand-written code, whose JSDoc `@example` snippets must not carry
 *     real PHI either.
 *   - `scripts/`, including `scripts/phi-allow-list.txt`, the file that DECLARES
 *     identifiers synthetic. A real dashed SSN typed in there was read by
 *     nothing.
 *
 * ▶ DO NOT PORT A SIBLING'S LIST OVER THIS ONE. `mllp` walks `test/` but
 * EXCLUDES `.ts` sources from it, because there the corpus is data files.
 * Copying that here would close none of the 38 files above: they are all `.ts`.
 *
 * 🛑 IT IS NOT `isUnderScanRoot`, AND THE ENGINE'S REFUSALS DO NOT KEY ON IT.
 * The read filter is applied on top of the same two name rules the sweep uses,
 * so the two routes cannot disagree about a `.md`- or `vendor/`-named entry.
 */
const STAGED_ROOTS: readonly string[] = ["src", "test", "scripts"];

function isStagedReadable(relPath: string): boolean {
  const underHookRoot = STAGED_ROOTS.some((r) => relPath === r || relPath.startsWith(`${r}/`));
  return underHookRoot && isWalkReadable(relPath);
}

// ===========================================================================
// ██  THE STANDARD-SPECIFIC FIELD DETECTION  ████████████████████████████████
// ===========================================================================
//
// The half the shared engine deliberately does not own, because it differs per
// healthcare standard. The engine has already run the cross-cutting floor over
// `ctx.text` and reported any hits against the correct locus; everything below
// is this repo's.
// ===========================================================================

/** A finding before the engine fills in the locus. */
type LocalHit = Omit<Hit, "path">;

/** Raise a finding. Every detector below reaches the report through one of these. */
type Emit = (h: LocalHit) => void;

// ---------------------------------------------------------------------------
// Shared detector helpers
// ---------------------------------------------------------------------------

/**
 * A `${identifier.path}` SOURCE SUBSTITUTION SITE, not a value.
 *
 * Sweeping `test/` puts hand-written TypeScript under the structured detectors,
 * and a template literal that builds a document writes `<given>${t.given}</given>`.
 * That text is a hole in the fixture where a value will be interpolated at run
 * time; the file does not contain the value, and no detector reading the source
 * can say anything about it.
 *
 * THE RULE IS DELIBERATELY THE TIGHTEST ONE THAT COVERS THAT CASE, because it is
 * a hole in a PHI gate and every character it admits is a place to hide one: the
 * WHOLE value must be a single placeholder, and inside it only a dotted chain of
 * JS identifiers is allowed. No quotes, so `${"SMITH"}` is still a hit. No spaces
 * or operators, so `${a + "SMITH"}` is still a hit. Nothing outside the braces,
 * so `${t.given} SMITH` is still a hit. A bare identifier chain cannot itself be
 * a person's name, a DOB or an MRN: it is a reference to one.
 */
const SUBSTITUTION_SITE = /^\$\{[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)*\}$/;

function isSubstitutionSite(value: string): boolean {
  return SUBSTITUTION_SITE.test(value);
}

/** Every allow-listed synthetic token, uppercased, as one set (names ∪ ids ∪ dobs). */
function syntheticTokens(allow: DetectContext["allow"]): Set<string> {
  const set = new Set<string>();
  for (const n of allow.names) set.add(n);
  for (const i of allow.ids) set.add(i);
  for (const d of allow.dobs) set.add(d.toUpperCase());
  return set;
}

// ---------------------------------------------------------------------------
// HL7 v2 structured, field-level PHI detection
// ---------------------------------------------------------------------------

/**
 * The PHI-bearing fields of the patient / relative / guarantor / insured
 * segments, with the specific components that carry a name / DOB / SSN / MRN /
 * phone / street / city value. Mirrors `src/hl7/locus-map.ts`. Each listed
 * component's value must be positively declared synthetic in the allow-list
 * (NAME / ID / DOB), or it is a hit, so a real name/DOB/MRN cannot ride into a
 * fixture unnoticed. (State/ZIP/type-code components are intentionally omitted:
 * they are not the identifying tokens and would be noise.)
 */
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
 * Structured HL7 v2 PHI scan: for every PID/NK1/GT1/IN1/IN2 PHI field, check
 * each identifying component value against the synthetic allow-list. Anything
 * not positively declared synthetic is a hit. Pure string splitting, no parser
 * dependency (matches every sibling scanner).
 */
function scanHl7Structured(
  content: string,
  allow: DetectContext["allow"],
  emit: Emit,
  literalView: boolean,
): void {
  const lines = content.split(/\r\n|\r|\n/).filter((l) => l.length > 0);
  // The MSH header is found ANYWHERE on its line, not only at column 0. In a
  // `.ts` test module the message opens mid-line, inside a quote, so a column-0
  // anchor answered "not an HL7 v2 message" for every inline literal in this
  // repo, which is where this repo's HL7 text actually lives.
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
  //     header with no closing separator, and an MSH-2 longer than eight: all of
  //     which the older column-0 `startsWith("MSH")` accepted. Every one of those
  //     still uses `|`, so the defaults read them correctly.
  //
  // The strict anchor is still what DERIVES non-default delimiters, because
  // relaxing it is what let an `MSH-9` in prose set the field separator to `-`.
  // Residual, disclosed rather than chased: a header that uses a non-default
  // field separator AND a mis-shaped MSH-2 gets the defaults and is read as if it
  // used `|`. The segment guard below is what keeps that from inventing hits.
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
    // template literal, what prettier produces inside a nested block, puts every
    // segment at column 2 or more, and a column-0 `slice(0, 3)` read those files
    // as containing no segments at all. Doing it in the RAW view as well
    // re-opened the defect that taking the literals was introduced to fix: a
    // literal whose closing backtick sits on its last segment line reported a
    // declared-synthetic DOB with the backtick and semicolon attached. Quote
    // characters are never stripped, in either view, for the same reason.
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
            emit({
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
// C-CDA structured, header-element PHI detection
// ---------------------------------------------------------------------------

/**
 * C-CDA header person-PHI elements whose *text* must be a declared-synthetic
 * token. Scoped to the document header (everything before the clinical body)
 * because a `<name>` there is always a person or organization name: a `<name>`
 * inside the clinical body can be a drug / material name, so scanning it would
 * false-positive on legitimate clinical content. Mirrors `src/ccda/locus-map.ts`
 * (the person loci). Person-role `<id>` extensions are intentionally NOT checked
 * structurally: a regex cannot tell a patient MRN from a `templateId` / `typeId`
 * / document-envelope id without the parser, so ids are covered by the SSN floor
 * plus the synthetic-fixture discipline, like HL7 free text.
 */
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
 * Structured C-CDA PHI scan: within the document **header** (before
 * `<structuredBody>` / `<nonXMLBody>`), check each person-name / address-part
 * element's text, and each `birthTime@value`, against the synthetic allow-list.
 * Anything not positively declared synthetic is a hit. Pure string scanning, no
 * parser dependency (matches every sibling scanner).
 */
function scanCcdaStructured(content: string, allow: DetectContext["allow"], emit: Emit): void {
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
      emit({
        segment: locator,
        value: v,
        reason: "C-CDA header PHI element value not declared synthetic in the allow-list",
      });
    }
  };

  for (const el of CCDA_HEADER_TEXT_ELEMENTS) {
    // Only the element's DIRECT text (`[^<]*`): an element with child elements (a
    // `<name>` wrapping `<given>`/`<family>`) yields empty/whitespace here and is
    // checked via those children instead.
    const re = new RegExp(`<(?:\\w+:)?${el}\\b[^>]*>([^<]*)</(?:\\w+:)?${el}>`, "g");
    for (const m of header.matchAll(re)) check(m[1] ?? "", `<${el}>`);
  }
  for (const m of header.matchAll(/<(?:\w+:)?birthTime\b[^>]*\bvalue="([^"]*)"/g)) {
    check(m[1] ?? "", "birthTime@value");
  }
}

// ---------------------------------------------------------------------------
// X12 005010 structured, element-level PHI detection
// ---------------------------------------------------------------------------

/**
 * X12 NM1-01 entity codes whose NM1-03..04 name + NM1-09 id are the covered
 * individual's PHI. Mirrors `src/x12/locus-map.ts` PATIENT_ENTITY_CODES: a
 * provider-entity NM1 name is retained and NOT checked (checking it would
 * false-positive on legitimate provider/organization names in fixtures).
 */
const X12_PATIENT_ENTITY_CODES = new Set<string>(["IL", "QC", "03", "QD", "GD", "74", "S1", "S3"]);

/**
 * REF-01 qualifiers whose REF-02 value is a patient identifier (SSN / member /
 * subscriber / group / medical record). Mirrors `src/x12/locus-map.ts`
 * REF_PHI_QUALIFIERS.
 */
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
 * Structured X12 PHI scan: detect the ISA envelope, read its element separator
 * (fixed byte 3) and segment terminator (fixed byte 105), and check the
 * identifying values of the patient-entity `NM1`, `DMG` (DOB DMG-02), and
 * PHI-qualified `REF` (REF-02) segments against the synthetic allow-list.
 * Anything not positively declared synthetic is a hit.
 */
function scanX12Structured(content: string, allow: DetectContext["allow"], emit: Emit): void {
  const src = content.trimStart();
  // ▶ THE 106-BYTE ISA HEADER IS FOUND ANYWHERE, NOT ONLY AT OFFSET 0, AND
  // REQUIRING OFFSET 0 GAVE THE WIDENED `test/` ROOT NOTHING FOR X12. A `.ts`
  // module never begins with `ISA`: its first bytes are an import statement, and
  // the joined source-literal view begins with the first string literal in the
  // file (an import specifier). Three files this gate sweeps carry inline
  // patient-entity interchanges, and all three read clean: measured, with the
  // identical bytes as a `test/fixtures/*.edi` returning five hard hits.
  //
  // The offset-0 rule was doing two jobs and only one of them is load-bearing:
  // it kept a source that merely MENTIONS "ISA" in prose from having delimiters
  // read out of it. That job is done here instead, off ISA's own FIXED WIDTHS:
  // an `ISA` on a non-alphanumeric boundary; a non-alphanumeric, non-space
  // element separator at offset 3; the SAME separator again at offset 6, because
  // ISA01 is exactly two characters wide in 005010 and no prose satisfies that;
  // 106 bytes available; and a non-alphanumeric segment terminator at offset 105.
  //
  // ▶ THE FIXED-WIDTH CHECK IS NOT COSMETIC AND "prose cannot capture the
  // delimiters" WOULD BE AN OVERCLAIM WITHOUT IT. A gate measured the case:
  // `"an ISA-IEA envelope"` earlier in the same file satisfied the boundary and
  // the terminator offset, captured `-` as the element separator, and took a real
  // inline interchange below it from four hits to one, or to ZERO with the same
  // words in a comment as well. What is left is stated rather than claimed
  // closed: prose that ALSO happens to put the same byte at offsets 3 and 6 and a
  // non-alphanumeric at 105 would still capture them.
  //
  // Only the FIRST accepted header is used, so a file carrying two interchanges
  // with DIFFERENT delimiters is read with the first one's. Every interchange in
  // this repo uses `*` and `~`; stated as a limit rather than chased.
  //
  // THE BOUNDARY IS TESTED BEFORE THE NEWLINES ARE STRIPPED, NOT AFTER, and that
  // ordering is load-bearing: `sourceLiteralDocument` joins literals with CRLF,
  // so stripping first glued the preceding literal onto the header: an import
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
      emit({
        segment: locator,
        value: v,
        reason: "X12 PHI element value not declared synthetic in the allow-list",
      });
    }
  };

  // ▶ EACH TERMINATOR-DELIMITED PIECE IS OFFERED TWICE, AND "IN ADDITION TO"
  // RATHER THAN "INSTEAD OF" IS THE WHOLE POINT: replacing one with the other
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
// NCPDP Telecom structured, field-level PHI detection
// ---------------------------------------------------------------------------

/**
 * NCPDP Telecom 2-character field ids that carry patient / cardholder /
 * prescriber PHI. Field ids are globally unique in the standard, so keying off
 * the id (not the segment) is correct and bypass-resistant. Mirrors
 * `src/ncpdp/locus-map.ts`.
 */
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
 * Structured NCPDP Telecom PHI scan: split the transmission on the Field / Group
 * / Segment separators (0x1C / 0x1D / 0x1E), and for each `<2-char-id><value>`
 * token whose id is a known PHI field, check the value against the synthetic
 * allow-list. Anything not positively declared synthetic is a hit.
 */
function scanTelecomStructured(content: string, allow: DetectContext["allow"], emit: Emit): void {
  const allowed = syntheticTokens(allow);
  for (const token of content.split(/[\x1c\x1d\x1e]/)) {
    if (token.length < 2) continue;
    const id = token.slice(0, 2).toUpperCase();
    if (!TELECOM_PHI_FIELD_IDS.has(id)) continue;
    const value = token.slice(2).trim();
    if (value.length === 0) continue;
    if (isSubstitutionSite(value)) continue; // a source hole, not a value
    if (!allowed.has(value.toUpperCase())) {
      emit({
        segment: id,
        value,
        reason: "NCPDP Telecom PHI field value not declared synthetic in the allow-list",
      });
    }
  }
}

// ---------------------------------------------------------------------------
// The two views
// ---------------------------------------------------------------------------

/**
 * The JS string escapes a source file uses to embed WIRE TEXT, and only those.
 *
 * ▶ THIS IS WHAT MAKES SWEEPING `test/` WORTH HAVING, AND THE ENUMERATION ALONE
 * WAS NOT. Every HL7 message and NCPDP transmission in this repo lives in a `.ts`
 * module as a single-line string literal: an MSH header, a backslash-`r`, then
 * the next segment, all inside one pair of quotes, so the bytes on disk carry a
 * BACKSLASH and an `r`, not a carriage return. (The escape is spelled out in
 * words here rather than shown: this file is itself inside the scan scope, and a
 * written-out example would decode into a segment the detector then reads as a
 * fixture. It did, on the first draft of this paragraph.) `scanHl7Structured`
 * splits on real CR/LF and `scanTelecomStructured` splits on real 0x1C/0x1D/0x1E,
 * so both saw one undifferentiated line and detected nothing. Sweeping those
 * files without this decode would have added the floor and nothing else, while
 * the changelog claimed the inline `PID|…` literals were now covered.
 *
 * The decoded text is scanned IN ADDITION to the raw bytes, never instead of
 * them, so a wrong decode can only ever ADD a hit. That is the safe direction for
 * a PHI gate: the cost of over-decoding is a false red a developer can read and
 * answer, and the cost of under-decoding is the silence this closes.
 * `\\` is deliberately NOT handled: HL7's own escape sequences are
 * backslash-delimited (`\F\`, `\S\`, `\X0D\`) and none of them collide with the
 * set below, so there is nothing to unescape and a general unescaper would have
 * mangled real fixture bytes.
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
 *   - the closing quote and comma of the source line RODE ALONG on the last field
 *     of the last segment, so an allow-listed DOB arrived as the DOB plus two
 *     characters of TypeScript and was reported as an undeclared value: a false
 *     red on a fixture that is entirely synthetic;
 *   - the delimiters were taken from the FIRST MSH-shaped text anywhere in the
 *     file, so an `MSH-9` in a comment or a test title set the field separator to
 *     `-` for every message in that file and the detector then found nothing.
 *
 * Taking the literals instead fixes both at the source: a literal's content is
 * the wire text and nothing else, and prose in a comment is not a literal. They
 * are JOINED rather than scanned one by one, because a message here is routinely
 * built by CONCATENATING literals: the header in one, further segments in the
 * next, and a `PID` literal on its own has no MSH to take delimiters from.
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

/** Identity of a finding within one target, for de-duplicating across the two views. */
function hitKey(h: LocalHit): string {
  return `${h.segment} ${h.value} ${h.reason}`;
}

/**
 * Run every structured detector over ONE VIEW of a target.
 *
 * `literalView` says which view this is, and exactly one detector needs to know:
 * indented segments are a fact about text taken OUT of a source literal, and
 * stripping indentation in the RAW view re-opens the "source syntax rides along"
 * false red that taking the literals was introduced to fix. Nothing is lost by
 * the restriction: an indented segment only ever occurs inside a literal, and the
 * literal view is where it is read.
 */
function scanViews(
  text: string,
  allow: DetectContext["allow"],
  emit: Emit,
  literalView: boolean,
): void {
  scanHl7Structured(text, allow, emit, literalView);
  scanCcdaStructured(text, allow, emit);
  scanX12Structured(text, allow, emit);
  scanTelecomStructured(text, allow, emit);
}

/**
 * THE STANDARD-SPECIFIC FIELD DETECTION: the half the shared engine deliberately
 * does not own, because it differs per healthcare standard.
 *
 * TWO VIEWS, AND "IN ADDITION TO" RATHER THAN "INSTEAD OF" IS THE WHOLE POINT.
 * The raw bytes are scanned, and then this file's string literals decoded and
 * joined, because this repo keeps its document text INLINE IN `.ts` MODULES
 * rather than in `test/fixtures/`. Only findings the raw view did not already
 * report are added, so a value both views see is reported once.
 *
 * @param ctx The target's text and bytes, the parsed allow-list, and `hit`.
 */
function detect(ctx: DetectContext): void {
  const raw: LocalHit[] = [];
  scanViews(ctx.text, ctx.allow, (h) => raw.push(h), false);
  for (const h of raw) ctx.hit(h);

  const literals = sourceLiteralDocument(ctx.text);
  if (literals.length === 0 || literals === ctx.text) return;
  const seen = new Set(raw.map(hitKey));
  scanViews(
    literals,
    ctx.allow,
    (h) => {
      const key = hitKey(h);
      if (seen.has(key)) return;
      seen.add(key);
      ctx.hit(h);
    },
    true,
  );
}

process.exit(
  runPhiScan({
    exitCodes: EXIT_CODES,
    scanRoots: SCAN_ROOTS,
    excludedPaths: EXCLUDED_PATHS,
    isWalkReadable,
    isStagedReadable,
    detect,
  }),
);
