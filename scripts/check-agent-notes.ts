#!/usr/bin/env tsx
/**
 * `@cosyte/deid` narrative-pointer gate.
 *
 * WHAT THIS REPO PROMISES, WHICH IS THE ONLY THING THIS GATE ASSERTS. On 2026-08-04 this repo's
 * guidance was split in two: `CLAUDE.md` became a cursor plus rules plus traps, and
 * `documentation/agent-notes.md` took the narrative verbatim, with `CLAUDE.md` citing it by anchor.
 * Nothing was deleted; the reasoning moved behind a link, which made the link load-bearing in a way
 * it had not been. A rule in `CLAUDE.md` now reads as a bare imperative followed by an anchor, and if
 * that anchor does not exist the reader is left with an order and no grounding. In THIS package that
 * is a clinical-safety surface rather than a tidiness one: the rules those anchors ground are the
 * fail-closed reflex, the scoped safety claims, the PHI-scan roots and the allow-list traps, and each
 * one of them was learned by shipping a defect. Three things could break silently and none had a
 * check:
 *
 *   1. the narrative file stops being tracked at all (a bad merge, a `git rm`);
 *   2. a section is emptied down to its heading, so a pointer resolves to nothing; and
 *   3. an anchor is edited on one side of the pair and not the other, so a pointer dangles.
 *
 * This gate checks those three, on this tree, and nothing else.
 *
 * ---------------------------------------------------------------------------
 * IT IS NAMED FOR WHAT IT CHECKS AND IT ASSERTS NO UNIVERSAL ABOUT ANY SIBLING REPOSITORY. THAT IS
 * THE MOST IMPORTANT LINE IN THIS FILE.
 *
 * The two-file split was applied across much of the cosyte tree, so the tempting framing is "every
 * repo has this pair, and this gate enforces the contract". IT IS NOT, and the umbrella's own
 * checkout disproves it: a whole group of cosyte repos carry no narrative file at all. For those the
 * honest outcome is a WRITTEN EXEMPTION, not an invented file. A gate written as though the contract
 * were universal would assert something those repos falsify, and an overclaiming guard is worse than
 * a narrow one: it invites a reader to trust a promise the tree does not keep, and the first repo it
 * trips deletes the gate instead of fixing anything.
 *
 * So: this gate asserts `@cosyte/deid`'s contract. This repo HAS the narrative file, its `CLAUDE.md`
 * cites it by anchor throughout, and its `CLAUDE.md` sits AT its byte budget with the narrative
 * already relocated, so here the pointer relationship is real and already paid for. Whether any
 * OTHER repo owes the same thing is a question for whoever owns the convention, and it cannot be
 * answered by a script inside one package. A CLAIM ABOUT ANOTHER REPOSITORY IS NOT CHECKABLE FROM
 * INSIDE THIS ONE. DO NOT WIDEN THIS FILE TO MAKE ONE.
 *
 * ---------------------------------------------------------------------------
 * THE MATCHER IS THE PART THAT DOES NOT PORT, AND COUNTING FIRST WAS THE WHOLE JOB.
 *
 * Two spellings of a pointer are live across this ecosystem, and which one dominates is a property
 * of the TREE, not of the convention:
 *
 *   * QUALIFIED: the narrative file's basename, a hash, and an anchor run, optionally path-prefixed.
 *   * BARE: an inline code span holding nothing but a hash and an anchor run.
 *
 * Porting a sibling's matcher without re-counting has produced a false green three times over in
 * this ecosystem. A qualified-only matcher dropped into `ncpdp` would have printed "all resolving"
 * while covering 3 of that tree's 38 pointers, because its dominant spelling is the bare one. In
 * `terminology` the split measured 42 bare against ZERO qualified, so the same matcher would have
 * found NOTHING AT ALL and still exited 0. In `astm` a THIRD arrangement appeared: the bare spelling
 * dominated AND the anchor space was explicit `<a id>` tags rather than heading slugs, so a
 * slug-only check would have reported every pointer in that repo as dangling.
 *
 * MEASURED HERE, ON THIS TREE, BEFORE THIS MATCHER WAS WRITTEN, with two independent tools because a
 * premise check is a matcher too and `grep -c` in one of this ecosystem's containers has been
 * observed reporting no match on a file another tool finds dozens of hits in:
 *
 *   * the QUALIFIED form is the only live one, and every instance sits in `CLAUDE.md`;
 *   * the BARE form is absent from every tracked file this gate can read as text;
 *   * the ANCHOR SPACE is GitHub heading slugs. The narrative file carries no explicit `<a id>` tag
 *     at all, and no heading inside an HTML comment.
 *
 * DO NOT TRUST THE PARAGRAPH ABOVE FOR THE TOTALS. A figure written into a comment goes stale on the
 * next commit with nobody touching it, and this ecosystem has burned several slices on exactly that.
 * THE OK LINE PRINTS EVERY COUNT ON EVERY RUN, because it measures rather than remembers.
 *
 * ---------------------------------------------------------------------------
 * THE BARE CENSUS, WHICH IS HOW "THE BARE FORM IS DEAD HERE" STAYS A MEASUREMENT.
 *
 * Matching one form only is safe exactly as long as the other stays absent, and an assumption
 * nothing re-checks is how a matcher silently stops covering its corpus. A per-form REFUSAL keyed on
 * a bare count of zero would refuse forever on a healthy tree, so the absence is OBSERVED instead,
 * on every run, over every file this gate opens rather than over the pair alone (a bare pointer in a
 * third file would otherwise be seen by neither the matcher nor the census):
 *
 *   * a span whose anchor is ALL DECIMAL DIGITS is a pull-request or issue reference, not a pointer.
 *     It is COUNTED AND REPORTED on the OK line rather than dropped in silence.
 *   * ANY OTHER bare span REFUSES THE RUN at exit 2. A refusal and not a violation, deliberately:
 *     the tree has not necessarily broken, but the measurement this matcher's scope was derived from
 *     has, so "all resolving" would be a claim about a corpus this gate no longer covers. The fix is
 *     to RE-DERIVE THE MATCHER against the new spelling, never to delete the span.
 *
 * SHAPE IS NOT A POINTER, so the census counts what RESOLVES rather than what matches, and the
 * digits-only arm is the whole of that concession here. The disclosed cost is that a heading whose
 * text is only digits would be unreachable through the bare form; the qualified form still reaches
 * it, and no such heading exists here.
 *
 * ---------------------------------------------------------------------------
 * THE CORPUS PARTITION IS THE OTHER THING THAT DID NOT PORT, AND GETTING IT WRONG COSTS THREE
 * HAND-WRITTEN SOURCE FILES IN SILENCE.
 *
 * The obvious partition is a NUL byte, on the reasoning that a NUL means a compressed vendored
 * tarball nobody can edit to clear a red. THAT REASONING IS FALSE HERE AND WAS MEASURED FALSE BEFORE
 * THIS FILE WAS WRITTEN: this repository tracks HAND-WRITTEN TypeScript sources under `src/` that
 * embed NUL bytes in string literals, and a NUL partition drops every one of them out of both the
 * matcher and the census with nothing to notice. This repository already has that measurement
 * written down, because a "binary blob" predicate was proposed for its PHI scanner and REJECTED for
 * the same reason.
 *
 * ▶ AND SAY NOTHING ABOUT WHAT ANY OTHER REPOSITORY DOES. A draft of this paragraph opened "every
 * sibling copy of this gate skips on NUL", which is a universal about repositories this script
 * cannot read, is the exact shape this file's second section refuses, and was refuted in review. The
 * partition is a per-repo decision every time; what is written here is only what was measured here.
 *
 * GIT'S OWN CLASSIFICATION IS A THIRD, DIFFERENT SET AND IS ALSO WRONG FOR THIS PURPOSE. Measured
 * here: `git grep -I` calls some of those hand-written sources binary and others not, because its
 * heuristic reads only the head of a file. So neither `grep -I` nor `git ls-files --eol` may be
 * substituted in as a "simplification": either drops authored source from the sweep with no tell.
 *
 * THE PARTITION USED HERE IS UTF-8 DECODABILITY, and it is derived rather than assumed. A pointer is
 * prose; prose in this repository is UTF-8. Measured on this tree, the set of tracked files that do
 * not decode as UTF-8 is exactly the vendored `@cosyte/*` tarballs, which are DEFLATE streams, and
 * every NUL-bearing hand-written source decodes cleanly and STAYS IN THE SWEEP. Both directions are
 * asserted in `test/scripts/agent-notes.test.ts`, and the count of files opened DESPITE a NUL byte
 * is printed on the OK line so that a regression to the sibling partition is visible as a number
 * rather than as silence.
 *
 * ---------------------------------------------------------------------------
 * EXISTENCE IS NOT OBSERVATION, WHICH IS WHY THE OK LINE RECONCILES AND WHY REFUSALS EXIST.
 *
 * The failure this gate is most likely to have is not a wrong answer, it is a right-looking answer
 * over a corpus it never opened. That is not hypothetical in this repository: its own PHI scanner
 * shipped a declared scan root the walk never observed and printed a clean line at exit 0 over it. A
 * DENOMINATOR DOES NOT DETECT THAT, because a count counts the roots that DID exist. The property
 * that prevents it here is STRUCTURAL: there is no declared root to be wrong about. The corpus is
 * whatever `git ls-files` returns, and every path in it is opened or skipped for a named reason.
 *
 * The refusals, each a case where "no violations" would be a lie rather than a result:
 *   * zero tracked paths, or `git ls-files` failing;
 *   * an unmerged path, which has no single decided content;
 *   * a tracked path that is missing, unreadable, a symlink, or not a regular file;
 *   * two tracked files carrying the narrative basename, which makes every pointer ambiguous;
 *   * a suspected bare pointer, per the census above;
 *   * AN EXPLICIT `<a id>` TAG IN THE NARRATIVE FILE. The anchor space here is heading slugs, and
 *     that was measured, not assumed. A tag means a SECOND anchor space this gate does not model,
 *     and `astm` is the proof that this is the live failure and not a theoretical one: its anchor
 *     space is 37 such tags, and a slug-only check there reports every pointer in the repo as
 *     dangling. Refusing is what keeps "the anchor space is slugs" a measurement;
 *   * AN UNTERMINATED HTML COMMENT in the narrative file, see the heading extractor; and
 *   * ZERO QUALIFIED POINTERS FOUND ANYWHERE. In THIS repo that cannot be a clean tree: `CLAUDE.md`
 *     opens by naming the narrative file and cites it by anchor throughout, and its byte budget is
 *     the reason it does. Zero means the matcher stopped matching, so the pointer half of this gate
 *     observed nothing and proved nothing. This refusal is grounded in what THIS repo contains and
 *     is one of the things a port must re-derive.
 *
 * ---------------------------------------------------------------------------
 * EXIT CODES. RE-DERIVED FROM THIS REPOSITORY'S OWN `scripts/phi-scan.ts`, NOT PORTED. That
 * scanner's contract is the one a reader of this repo already knows, and it was itself paid for.
 *   0  the contract holds.
 *   1  the contract is broken: a missing file, an empty section, or a dangling pointer.
 *   2  REFUSAL, or a bad invocation. The gate could not observe what it claims to check, or could
 *      not honestly report on what it did observe. Never reported as clean.
 *
 * EXIT 1 MEANS FINDINGS AND NOTHING ELSE MAY SPEND IT, which is the same rule the PHI scanner in
 * this repo runs under: collapsing 1 and 2 turns a broken gate into a list of false findings, which
 * reads as actionable and is worse than a crash.
 *
 * ---------------------------------------------------------------------------
 * DISCLOSED MISSES. Stated here rather than discovered later. [PINNED] means a case in
 * `test/scripts/agent-notes.test.ts` exercises it IN THE DIRECTION IT FAILS; [SCOPE] means it is a
 * boundary of what this gate is for, with nothing to execute.
 *
 *  (i)   [PINNED] ONLY THE BASENAME OF THE NARRATIVE FILE IS COMPARED, NEVER ITS DIRECTORY. Moving
 *        the file to another directory while the pointers keep their old path prefix exits 0 with
 *        every rendered link broken on GitHub. The basename match is deliberate, because it is what
 *        lets a path-qualified and a relative pointer reach the same target; the cost is disclosed
 *        rather than closed, and it is asserted green so that closing it later is a deliberate act.
 *  (ii)  [PINNED] A TRACKED FILE THAT IS NOT VALID UTF-8 IS SKIPPED WHOLE, so a pointer inside one
 *        is never read. THE TELL IS THE SKIPPED COUNT ON THE OK LINE. See the partition section
 *        above for why this is the chosen boundary and why NUL is not.
 *  (iii) [PINNED] A POINTER AT ANY OTHER FILE'S ANCHOR IS OUT OF SCOPE, `CLAUDE.md`'s own included.
 *        A general markdown link checker is a different tool with a different failure surface, and
 *        writing half of one here would be the overclaim this file's second section refuses.
 *  (iv)  [PINNED] A POINTER INSIDE A FENCED CODE BLOCK IS TREATED EXACTLY LIKE PROSE, because a
 *        reader follows it either way. Headings are the opposite, see (vi).
 *  (v)   [PINNED] A PERCENT-ENCODED OR HTML-ENTITY ANCHOR IS NOT DECODED, so it is checked up to
 *        the escape and reds. None exists here.
 *  (vi)  [PINNED] AN ATX HEADING INSIDE A FENCED CODE BLOCK IS NOT AN ANCHOR. Without the fence
 *        tracker a hash comment in a shell sample mints a PHANTOM ANCHOR and masks the dangling
 *        pointer this gate exists to catch, which is the one direction it must never fail in.
 *  (vii) [PINNED] AN ATX HEADING INSIDE AN HTML COMMENT IS NOT AN ANCHOR HERE EITHER, AND THAT IS A
 *        DELIBERATE DEPARTURE FROM SEVERAL SIBLING COPIES, WHICH COUNT IT. GitHub renders no anchor
 *        for a commented-out heading, so counting it mints a phantom anchor in the same false-green
 *        direction as (vi). The narrative file carries no HTML comment today, so the tracker is inert
 *        on this corpus and is kept as a guard for the next one; suppressed headings are COUNTED and
 *        printed rather than dropped in silence, and an UNTERMINATED comment REFUSES, because
 *        swallowing the rest of the file would delete every anchor after it. ONLY THE BLOCK FORM IS
 *        TRACKED, and that is sufficient rather than lazy: a heading commented out on ONE line is
 *        not an ATX heading at all, since the line then begins with the comment marker.
 *  (viii)[SCOPE] A SECTION WITH A BODY IS NOT A SECTION WITH THE RIGHT BODY. This gate proves a
 *        pointer lands somewhere non-empty. It cannot prove the prose there grounds the rule that
 *        cited it. That half stays human, and saying so is the point of writing it down.
 *  (ix)  [SCOPE] IT DOES NOT CHECK ANY BYTE BUDGET. `CLAUDE.md`'s ceiling is enforced by the
 *        meta-repo's doc-budget hook, which holds the budget table; a script inside this package
 *        cannot see it and must not keep a second copy of a number.
 *  (x)   [SCOPE] IT DOES NOT NOTICE A TRAP THAT REACHED THE NARRATIVE FILE WITH NO IMPERATIVE
 *        FOLLOWING IT INTO `CLAUDE.md`. Heading, anchor and body checks all verify prose MOVED.
 *        Enumerate the reverse direction by hand.
 *  (xi)  [PINNED] THE CENSUS REFUSES ON AN ANCHOR-SHAPED BACKTICKED SPAN THAT WAS NEVER A POINTER,
 *        AND THAT IS THE PRICE OF ITS WIDTH. A CSS id or a hex colour carrying a letter, written
 *        inside an inline code span with a leading hash, refuses the run in any opened file, and the
 *        refusal text says to re-derive the matcher, which is the wrong advice for a colour. The
 *        boundary is exactly the digits-only rule: an all-decimal anchor is a reference and passes,
 *        one carrying a letter, an underscore or a hyphen refuses. Every wrong version of that
 *        boundary is still fail-closed, so none is a false green. Disclosed rather than narrowed:
 *        the alternative, scoping the census to the pair, carries the much worse cost that a bare
 *        pointer in a third file is seen by nothing.
 *  (xiii)[PINNED] A POINTER BROKEN ACROSS A LINE WRAP IS REPORTED AS DANGLING, NOT REJOINED. A
 *        sibling rejoins the fragment with the next line's leading anchor run; that was REMOVED here
 *        after it was shown to print "all resolving" at exit 0 over a genuinely dangling pointer.
 *        See the note at the violation push for the reproduction. The cost is a false RED on a
 *        pointer an editor wrapped, which is the safe direction and is fixed by unwrapping it.
 *  (xii) [PINNED] A POINTER IS MATCHED IFF IT IS SPELLED IN ASCII BYTES. The filed limit on this
 *        was WRONG and is corrected here: UTF-7 DOES match, because RFC 2152 permits a bare hash, so
 *        a UTF-7 document spells the pointer in ASCII bytes and is read exactly like any other. A
 *        UTF-16 document does not, and is skipped by (ii) with the skip counted.
 *
 * Run it locally with `pnpm check:agent-notes`, also reached by `pnpm check`, which is on the
 * meta-repo's `scripts/verify.sh deid` ladder. `pnpm test` runs it against this tree too
 * (`test/scripts/agent-notes.test.ts`), which is what puts it inside the required `ci / verify`
 * context and inside `prepublishOnly` without a new required check-run context having to be
 * created: adding one of those before its workflow has run on `main` leaves every PR PENDING rather
 * than red, and this repository has already paid that cost twice.
 */

import { execFileSync } from "node:child_process";
import { closeSync, constants, fstatSync, openSync, readFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Heading {
  /** 1-based line number of the heading text (the underline line, for setext). */
  readonly line: number;
  readonly text: string;
  readonly slug: string;
  /** 1-based line the section body may start on. */
  readonly bodyFrom: number;
  /**
   * Depth: 1 to 6 for `#` through `######`, and for setext 1 for `===` and 2 for `---`. Carried
   * ONLY so the empty-section pass can tell a CONTAINER from an emptied leaf.
   */
  readonly level: number;
}

interface Violation {
  readonly where: string;
  readonly what: string;
}

/** A refusal: the gate could not observe what it claims to check. Always exit 2. */
class RefusalError extends Error {}

/** A bad invocation. Also exit 2: the run proves nothing. */
class InvocationError extends Error {}

// ---------------------------------------------------------------------------
// The two halves of the pair, named once
// ---------------------------------------------------------------------------

/**
 * The narrative file's basename. Matched on BASENAME rather than on the full path, so a pointer
 * qualified with a directory, one prefixed with a relative marker, and a bare-path one all reach the
 * same target. Exactly one tracked file may carry this name: two would make every pointer
 * ambiguous, and the gate refuses rather than guessing.
 *
 * NOTE FOR ANYONE EDITING THE PROSE IN THIS FILE OR IN `test/scripts/agent-notes.test.ts`: this gate
 * scans EVERY tracked text file and carves out no exemption for its own source or its own tests, so
 * a literally-written pointer here is a pointer into this repo's narrative file and is checked as
 * one, and a literally-written bare span here REFUSES the run. That is deliberate. An exemption for
 * the gate's own files is precisely where a genuinely broken pointer would hide, this is the
 * exclusion list this gate refuses to have, and `astm` went red on both Node versions for exactly
 * this reason after its own test fixtures spelled pointers out. Sample pointers and sample bare
 * spans are therefore ASSEMBLED FROM PARTS at runtime in both files, never written out.
 */
const CONTRACT_BASENAME = "agent-notes.md";

/** The cursor half of the pair. Its absence is a contract violation, not a refusal. */
const CURSOR_PATH = "CLAUDE.md";

// ---------------------------------------------------------------------------
// Slugging: a transcription of github-slugger, pinned by SLUG_CASES below
// ---------------------------------------------------------------------------

/**
 * Strip the one inline construct that changes a slug: a markdown link, whose URL must not reach the
 * slug while its text must. This is the RENDERING STEP, and it is why the module cannot be fed raw
 * heading source. Nothing else needs stripping, and that is measured rather than a shortcut:
 * backticks, asterisks and underscores-as-emphasis are removed (or kept) by the punctuation filter
 * below in exactly the way github-slugger removes (or keeps) them. `_` in particular is KEPT, which
 * is what makes an anchor minted from a heading naming a `DEID_*` diagnostic code resolve.
 */
function stripInline(text: string): string {
  return text.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");
}

/**
 * github-slugger's transformation: lowercase, drop everything that is not a letter, a number, an
 * ASCII space, a hyphen or an underscore, then replace each remaining space with a hyphen.
 *
 * THREE THINGS HERE ARE NOT COSMETIC, and all three are reachable on THIS tree.
 *
 * PER-SPACE, NOT PER-RUN: two spaces become two hyphens. Live here rather than hypothetical: the
 * narrative file's own H1 puts a KEPT hyphen pair between two spaces, so its real anchor carries a
 * run of four hyphens, and a per-run collapse reds the pointer at it. The other half of the same
 * rule, a DELETED glyph between two spaces, is pinned by its own row in `SLUG_CASES` because this
 * repository leads load-bearing rules with marker glyphs and a heading of that shape is one edit
 * away.
 *
 * NO `.trim()`. github-slugger does not trim: it deletes the disallowed character and leaves the
 * space behind, so a heading led by a marker glyph slugs with a LEADING HYPHEN. A trim makes a
 * pointer written without that hyphen pass this gate and resolve to nothing on GitHub, which is the
 * exact shape this file exists to catch. Both halves of this repository's pair lead load-bearing
 * rules with marker glyphs throughout, so a glyph-led heading is the likeliest next one anybody
 * writes here.
 *
 * THE KEPT SPACE IS THE ASCII SPACE ALONE, NOT `\p{Zs}`. A disallowed character is DELETED, and
 * every space separator other than U+0020 is disallowed, so a heading holding a non-breaking space
 * between two letters slugs them together upstream. A `\p{Zs}` keep-class leaves the separator in
 * the slug and reds a pointer that works.
 *
 * A SOFTBREAK IS DELETED, NOT HYPHENATED, WHICH IS WHY THE SETEXT JOIN BELOW USES `\n`.
 *
 * VERIFIED AGAINST github-slugger@2.0.0 ITSELF, by running the real module over every one of this
 * tree's real narrative headings plus the shapes in `SLUG_CASES`, not by reading a sibling's table.
 * It is a transcription rather than a dependency because this package's runtime dependency count is
 * capped at zero and its dev surface is kept small.
 */
function slugify(text: string): string {
  return stripInline(text)
    .toLowerCase()
    .replace(/[^\p{L}\p{N} \-_]/gu, "")
    .replace(/ /g, "-");
}

/**
 * github-slugger's DEDUPLICATION, transcribed as the loop it actually is rather than as the counter
 * it looks like.
 *
 * The obvious implementation (count occurrences of the base slug, suffix `-N`) is wrong on one input
 * and the difference is a false red: headings `Same`, `Same`, `Same-1` yield `same`, `same-1`,
 * `same-1-1` upstream, because the third heading's OWN slug collides with the second heading's
 * GENERATED one and the suffix is applied again. Measured against github-slugger@2.0.0 and pinned by
 * a self-test.
 */
function makeSlugger(): (text: string) => string {
  const occurrences = new Map<string, number>();
  return (text: string): string => {
    const original = slugify(text);
    let result = original;
    while (occurrences.has(result)) {
      occurrences.set(original, (occurrences.get(original) ?? 0) + 1);
      result = `${original}-${String(occurrences.get(original))}`;
    }
    occurrences.set(result, 0);
    return result;
  };
}

/**
 * The anchor character class, kept in lockstep with what `slugify` can EMIT. If this were the ASCII
 * `[A-Za-z0-9_-]` the obvious way, a pointer at a heading containing an accented letter would be
 * truncated mid-anchor by the matcher and reported as dangling, a false red against a link that
 * works. Aligning the two is what makes the matcher's silence meaningful.
 */
const ANCHOR_CHARS = "[\\p{L}\\p{N}_-]";

/** The qualified form, the only live spelling here. Matched in every opened file. */
function pointerPattern(): RegExp {
  return new RegExp(`${CONTRACT_BASENAME.replace(/\./g, "\\.")}#(${ANCHOR_CHARS}+)`, "gu");
}

/**
 * The bare shape: an inline code span holding nothing but a hash and an anchor run. This is NOT a
 * matcher for a form this gate checks. It is the CENSUS that keeps "the bare form is absent here" a
 * measurement instead of an assumption, and it runs over every opened file.
 */
function barePattern(): RegExp {
  return new RegExp("`#(" + ANCHOR_CHARS + "+)`", "gu");
}

/** A bare span whose anchor is all decimal digits is a pull-request reference, not a pointer. */
const DIGITS_ONLY = /^\p{Nd}+$/u;

/**
 * An explicit anchor tag in the narrative file. Not supported, REFUSED: see the refusal list in the
 * header. `astm` is the repo where this is the whole anchor space, and a gate that silently ignored
 * these would report every pointer in such a tree as dangling.
 */
const EXPLICIT_ANCHOR_RE = /<a\s+[^>]*\bid\s*=/i;

// ---------------------------------------------------------------------------
// Heading extraction
// ---------------------------------------------------------------------------

const FENCE_RE = /^ {0,3}(`{3,}|~{3,})/;
/**
 * ATX. Up to three leading spaces (CommonMark), one to six hashes, and then EITHER whitespace or end
 * of line: a hash run with no space after it is not a heading. Trailing hashes are stripped.
 *
 * A NAIVE `/^#{1,6} /` HAS TWO MEASURED BYPASSES, both handled here and both asserted in the test
 * file: a single leading space, and a setext underline. A missed heading is a missing anchor and a
 * missing anchor is a FALSE RED on a pointer that works.
 */
const ATX_RE = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?[ \t]*$/;
/** Setext: a `=` or `-` run under a non-blank paragraph line. `=` is h1, `-` is h2. */
const SETEXT_RE = /^ {0,3}(=+|-+)[ \t]*$/;

function stripTrailingHashes(text: string): string {
  return text.replace(/[ \t]+#+[ \t]*$/, "");
}

interface Extraction {
  readonly headings: readonly Heading[];
  /** Headings suppressed because they sat inside an HTML comment. Counted, never silent. */
  readonly commented: number;
}

/**
 * Extract every heading GitHub would give an anchor, in document order, deduplicated by
 * `makeSlugger`.
 *
 * FOUR BLOCK CONSTRUCTS ARE TRACKED, each because leaving it out is a measured divergence:
 *
 *   * FENCED CODE. An ATX line inside a fence is a comment in a sample, not a heading. Without this
 *     a shell snippet mints a phantom anchor and a dangling pointer passes.
 *   * HTML COMMENTS. A commented-out heading renders NO anchor on GitHub, so counting it mints a
 *     phantom anchor in the same false-green direction. Several sibling copies of this gate count it
 *     and merely disclose the miss; this one suppresses it, counts the suppressions, and REFUSES an
 *     unterminated comment rather than swallowing the rest of the file.
 *   * YAML FRONT MATTER. A `---` fence at the very start of the file is front matter, and its
 *     CLOSING `---` sits directly under a non-blank line, so a setext reader mints an anchor from a
 *     metadata key.
 *   * THE SETEXT PARAGRAPH. An underline belongs to the WHOLE paragraph above it, not to its last
 *     line. The lines are joined with `\n`, NOT a space, because a softbreak is DELETED by the slug
 *     rule rather than hyphenated.
 *
 * THE ANCHOR AND THE BODY COME OUT OF ONE RECORD, WHICH IS NOT AN IMPLEMENTATION DETAIL. `astm`
 * shipped a positive control that printed OK over an emptied section because its anchors and its
 * headings were bound separately: the anchor looked empty, the heading looked unreferenced, and both
 * passes skipped it. Here a `Heading` carries its slug AND its body range, so the two cannot
 * disagree and neither pass can skip what the other is looking at.
 */
function extractHeadings(lines: readonly string[]): Extraction {
  const headings: Heading[] = [];
  const slugger = makeSlugger();
  let inFence = false;
  let fenceMarker = "";
  let fenceLength = 0;
  let inComment = false;
  let commentOpenedAt = 0;
  let commented = 0;

  const push = (line: number, rawText: string, bodyFrom: number, level: number): void => {
    const text = rawText.trim();
    headings.push({ line, text, slug: slugger(text), bodyFrom, level });
  };

  // Front matter, if any: a `---` on the very first line opens it and the next `---` or `...`
  // closes it. Everything between is metadata, never a heading and never a pointer surface.
  let start = 0;
  if ((lines[0] ?? "").trimEnd() === "---") {
    for (let i = 1; i < lines.length; i += 1) {
      const t = (lines[i] ?? "").trimEnd();
      if (t === "---" || t === "...") {
        start = i + 1;
        break;
      }
    }
  }

  for (let i = start; i < lines.length; i += 1) {
    const line = lines[i] ?? "";

    // A FENCE CLOSES ONLY ON COMMONMARK'S TERMS, AND A LOOSER TEST MINTS PHANTOM ANCHORS. The
    // closing fence must use the SAME marker character, be AT LEAST AS LONG as the opener, and
    // carry NO info string. A test that accepts any run of the same character closes an opened
    // block on a NESTED opener (a fenced sample that itself contains a fence, which is exactly how
    // markdown documentation quotes markdown), after which every hash line in the remainder of the
    // sample is read as a heading and mints an anchor GitHub does not render. That is the
    // false-green direction this gate must never fail in, so the rule is the real one. Verified
    // against a CommonMark/GFM parser. THE FENCE RULE HAS FOUR CONDITIONS IN ALL -- the three on
    // the CLOSER above, plus the backtick-info restriction on the OPENER below -- AND EACH HAS ITS OWN
    // SELF-TEST CASE, verified by deleting that conjunct ALONE and confirming this gate refuses at
    // exit 2 on the real tree. That sentence is written this way because TWO EARLIER VERSIONS OF IT
    // WERE FALSE: a review deleted the length condition with everything else green, and a later
    // review deleted the MARKER condition with the self-test, the real tree and all fifteen suite
    // cases still green while three documents claimed otherwise. **Delete one conjunct and re-run
    // before you believe this sentence again** -- a mutation matrix that removes conditions in pairs
    // proves nothing about either one, which is exactly how the marker case was missed.
    //
    // A BACKTICK FENCE'S INFO STRING MAY NOT CONTAIN A BACKTICK (CommonMark 4.5), so such a line
    // opens NO fence at all. Without that clause a line of prose carrying a run of backticks and
    // then more backticks opens a phantom block here, and every heading until the next fence-shaped
    // line vanishes: a heading that vanishes is a MISSING anchor and a false RED, and the inverse
    // (an unmatched opener swallowing the rest of the file) is the same defect at scale.
    const fence = FENCE_RE.exec(line);
    const run = fence?.[1] ?? "";
    const marker = run[0] ?? "";
    const info = fence === null ? "" : line.slice(line.indexOf(run) + run.length).trim();
    const isFenceLine = fence !== null && !(marker === "`" && info.includes("`"));
    if (isFenceLine && !inComment) {
      if (!inFence) {
        inFence = true;
        fenceMarker = marker;
        fenceLength = run.length;
      } else if (marker === fenceMarker && run.length >= fenceLength && info === "") {
        inFence = false;
        fenceMarker = "";
        fenceLength = 0;
      }
      continue;
    }
    if (inFence) continue;

    // HTML comment tracking, evaluated BEFORE the state is advanced, so a heading is judged
    // against whether it was ALREADY inside a comment when the line began.
    //
    // ONLY THE BLOCK FORM IS TRACKED, AND THAT IS SUFFICIENT RATHER THAN LAZY: a heading commented
    // out on ONE line is not an ATX heading in the first place, because the line then begins with
    // the comment marker and `ATX_RE` anchors the hash run at the start. The phantom-anchor shape
    // that IS reachable is a hash line sitting between an opening marker and a closing one on
    // surrounding lines, and that is what this tracks.
    const wasInComment = inComment;
    const opensHere = line.includes("<!--");
    const closesHere = line.includes("-->");
    if (opensHere && !closesHere) {
      inComment = true;
      commentOpenedAt = i + 1;
    } else if (closesHere && !opensHere) {
      inComment = false;
    }

    const atx = ATX_RE.exec(line);
    if (atx) {
      if (wasInComment) commented += 1;
      else push(i + 1, stripTrailingHashes(atx[2] ?? ""), i + 2, (atx[1] ?? "#").length);
      continue;
    }
    if (wasInComment) continue;

    // Setext. The underline is only a heading when it sits under a non-blank paragraph that is not
    // itself a heading and not a list item. A `---` after a blank line is a thematic break.
    const setext = SETEXT_RE.exec(line);
    if (setext && i > start) {
      const prev = lines[i - 1] ?? "";
      const prevIsText = prev.trim() !== "" && !ATX_RE.test(prev) && !/^ {0,3}[-*+>] /.test(prev);
      if (prevIsText) {
        // THE UNDERLINE BELONGS TO THE WHOLE PARAGRAPH, so walk back to its first line and join.
        // Reading only the line above slugs a wrapped heading from its last line alone, which is a
        // false red on the pointer GitHub resolves.
        let first = i - 1;
        while (first > start) {
          const above = lines[first - 1] ?? "";
          if (above.trim() === "" || ATX_RE.test(above) || /^ {0,3}[-*+>] /.test(above)) break;
          first -= 1;
        }
        const paragraph = lines
          .slice(first, i)
          .map((l) => l.trim())
          .join("\n");
        push(first + 1, paragraph, i + 2, (setext[1] ?? "-").startsWith("=") ? 1 : 2);
      }
    }
  }

  if (inComment) {
    throw new RefusalError(
      `an HTML comment opened at line ${String(commentOpenedAt)} and was never closed, so every ` +
        `heading after it would be suppressed and every anchor after it would vanish. Refusing ` +
        `rather than reporting a tree in which most pointers dangle for a reason that is not the ` +
        `one this gate exists to report.`,
    );
  }

  return { headings, commented };
}

/**
 * A section is EMPTY when nothing but blank lines separates its heading from the next heading or
 * from the end of the file. That is the check the item asks for and it is deliberately the weak
 * form: see disclosed miss (viii). A heading whose only body is a fence or a single word counts as
 * non-empty, because judging sufficiency is not something a script can do honestly.
 *
 * A CONTAINER IS NOT AN EMPTIED SECTION, AND CONFLATING THEM IS A FALSE RED. A heading immediately
 * followed by a DEEPER one is a container whose body IS its subsections; a pointer at it resolves on
 * GitHub and the reader lands on real content. That shape is live in this repository's narrative
 * file, where a top-level heading is followed straight away by its first subsection.
 *
 * IT OPENS NO FALSE-GREEN HOLE, which is the only direction that would matter. The exemption moves
 * the obligation DOWN rather than removing it: the deeper heading is still checked, so an emptied
 * leaf still reds, and a container can only be exempt when something deeper exists to carry the
 * body. A trailing heading has no next heading at all and is therefore never a container. Both
 * directions are pinned in the test file.
 */
function emptySections(
  lines: readonly string[],
  headings: readonly Heading[],
): { readonly empty: Heading[]; readonly containers: number } {
  const empty: Heading[] = [];
  let containers = 0;
  for (let h = 0; h < headings.length; h += 1) {
    const here = headings[h];
    if (!here) continue;
    const next = headings[h + 1];
    // A container: its body is the subsections beneath it, and the obligation moves to them.
    // COUNTED, NOT SILENTLY SKIPPED, because the OK line must not claim every section has a body
    // when a container was never asked.
    if (next && next.level > here.level) {
      containers += 1;
      continue;
    }
    const end = next ? next.line - 1 : lines.length;
    let hasBody = false;
    for (let i = here.bodyFrom; i <= end; i += 1) {
      if ((lines[i - 1] ?? "").trim() !== "") {
        hasBody = true;
        break;
      }
    }
    if (!hasBody) empty.push(here);
  }
  return { empty, containers };
}

// ---------------------------------------------------------------------------
// Self-tests. A gate is believed only after it has shown it can still see.
// ---------------------------------------------------------------------------

/**
 * Slug transcription cases. Every row is either a REAL heading from this repository's narrative file
 * or a shape a future one is likely to take here, and every row was produced by RUNNING
 * github-slugger@2.0.0 rather than copied from a sibling's table. If someone "simplifies" `slugify`,
 * this table reds here rather than turning every working pointer on the tree into a false red.
 *
 * DO NOT DESCRIBE THIS TABLE BY POSITION. A positional reference is a claim that goes stale on the
 * next append. Each row carries its own reason where it needs one.
 */
const SLUG_CASES: ReadonlyArray<readonly [string, string]> = [
  // The narrative file's own H1, and the PER-SPACE rule in its live form on this tree: the package
  // scope's `@` and `/` are deleted with no separator left behind, while the ASCII hyphen is KEPT
  // and both surrounding spaces survive, giving a run of FOUR hyphens. A per-run collapse reds it,
  // and so does dropping `-` from the keep class.
  ["@cosyte/deid -- agent notes", "cosytedeid----agent-notes"],
  // THE DELETED-GLYPH SHAPE, KEPT AS ITS OWN ROW rather than lost with the H1 it used to ride on.
  // A glyph outside the keep class sitting between two spaces is deleted while BOTH spaces survive,
  // so the slug carries a DOUBLE hyphen. The marker glyphs this repository leads its load-bearing
  // rules with are exactly that shape, so a heading of this form is one edit away at any time.
  ["The rule ▶ and its reason", "the-rule--and-its-reason"],
  // Real, and the live target of a pointer in `CLAUDE.md`. Backticks, `@`, `/` and `*` all delete.
  ["Tech Stack (the shared `@cosyte/*` standard)", "tech-stack-the-shared-cosyte-standard"],
  // Real. Square brackets delete with no separator, so the bracketed word runs into its neighbours.
  [
    "The changelog generator, and why the `[Unreleased]` heading may not come back",
    "the-changelog-generator-and-why-the-unreleased-heading-may-not-come-back",
  ],
  // Real. A comma deletes and leaves its space behind, which is a single hyphen, not two.
  ["The one-letter trap, T in the diff filter", "the-one-letter-trap-t-in-the-diff-filter"],
  ["Job names, and what a ruleset cannot see", "job-names-and-what-a-ruleset-cannot-see"],
  // Real. Digits and hyphens survive, so an item identifier slugs readably.
  ["Shipped phases DEID-1 through DEID-10", "shipped-phases-deid-1-through-deid-10"],
  [
    "The undeclared DOB must stay out of the allow-list",
    "the-undeclared-dob-must-stay-out-of-the-allow-list",
  ],
  ["attw exits 0 on an untyped package", "attw-exits-0-on-an-untyped-package"],
  ["The 200-character headline refusal", "the-200-character-headline-refusal"],
  ["CUT, do not rewrite", "cut-do-not-rewrite"],
  // NO TRIM, with a leading marker. Both spellings this repository actually uses, and this pair is
  // the likeliest next heading here: every load-bearing rule in the pair is led by one of them.
  ["▶ The section", "-the-section"],
  ["🛑 THE STOP", "-the-stop"],
  // An underscore is KEPT, which is what lets a heading naming a diagnostic code resolve. This
  // package's codes are the reason the rule matters here.
  ["DEID_POLICY_INVALID and the label guard", "deid_policy_invalid-and-the-label-guard"],
  ["A `code` heading with **bold**", "a-code-heading-with-bold"],
  // The rendering step: the URL must not reach the slug while the link text must.
  ["A [linked](https://example.test/x) heading", "a-linked-heading"],
  ["A  double  space", "a--double--space"],
  // A SOFTBREAK IS DELETED, NOT HYPHENATED. The two halves run together. This is the wrapped setext
  // heading, and getting it wrong is a false green on a link that resolves to nothing.
  ["The long\nsection name", "the-longsection-name"],
  // Every space separator other than U+0020 is deleted too, for the same reason. Written as
  // ESCAPES, not literals: a bare U+00A0 in a table is invisible to a reader and to a diff.
  ["a\u00a0b", "ab"],
  ["a\u2009b", "ab"],
];

function selfTest(): void {
  for (const [text, want] of SLUG_CASES) {
    const got = slugify(text);
    if (got !== want) {
      throw new RefusalError(
        `SELF-TEST FAILED: slugify(${JSON.stringify(text)}) produced ${JSON.stringify(got)}, ` +
          `expected ${JSON.stringify(want)}. The slug transcription no longer matches ` +
          `github-slugger, so every anchor this gate computes is suspect and no result from it ` +
          `can be believed.`,
      );
    }
  }

  // The heading detector must see every shape that mints an anchor and NONE of the shapes that do
  // not. The second half matters most: a phantom anchor lets a dangling pointer pass, which is the
  // single outcome this gate exists to prevent. Blank lines separate the blocks, because that is
  // what makes each shape unambiguous markdown. Keep them.
  const hash = "#";
  const sample = [
    "---",
    "title: front matter",
    "---",
    "",
    `${hash} Top`,
    "body",
    "",
    `  ${hash}${hash} Indented by two`,
    "body",
    "",
    `    ${hash}${hash}${hash} Indented by four`,
    "",
    "Setext one",
    "==========",
    "body",
    "",
    "A wrapped setext",
    "heading over two lines",
    "----------------------",
    "body",
    "",
    `${hash}hashtag`,
    "",
    "```sh",
    `${hash} not a heading`,
    "```",
    "body",
    "",
    // THE NESTED FENCE, which is how a markdown document quotes markdown. The inner opener carries
    // an info string, so CommonMark does NOT treat it as the closer; a looser test would close here
    // and read every hash line in the rest of the sample as a heading.
    "```md",
    `${hash} heading inside a fenced sample`,
    "```js",
    `${hash} still inside: the info string means that line was not a closer`,
    "```",
    "body",
    "",
    // A CLOSER MAY BE LONGER THAN ITS OPENER, and must not be mistaken for a fresh opener.
    "~~~",
    `${hash} inside a tilde fence`,
    "~~~~",
    "body",
    "",
    // THE MARKER CONDITION, PINNED ON ITS OWN, and it was the LAST of the four to get a case: a
    // review deleted `marker === fenceMarker` and found the self-test, the real tree and all
    // fifteen suite cases still green, while three documents claimed the opposite. A backtick run
    // cannot close a TILDE fence, so without it the line below closes here, the heading after it
    // mints a phantom anchor and the closing tilde run opens a block that swallows what follows:
    // a false green and a false red out of one input.
    "~~~",
    `${hash}${hash} inside a tilde fence, again`,
    "```",
    `${hash}${hash} still inside: a backtick run cannot close a tilde fence`,
    "~~~",
    "body",
    "",
    // THE LENGTH CONDITION, PINNED ON ITS OWN. A review deleted `run.length >= fenceLength` and
    // found every other case still green, because the nested sample above is carried by the info
    // string alone. A SHORTER run of the same marker cannot close a longer opener, so without the
    // length rule the line below closes here and the heading after it mints a phantom anchor.
    "````",
    `${hash}${hash} inside a four-tick fence`,
    "```",
    `${hash}${hash} still inside: a shorter run cannot close a longer opener`,
    "````",
    "body",
    "",
    // A BACKTICK FENCE'S INFO STRING MAY NOT CONTAIN A BACKTICK, so the line below opens NO fence
    // and the heading after it is a REAL heading. This is the false-RED direction: treated as an
    // opener, it swallows every heading until the next fence-shaped line.
    "``` an info `string` with backticks",
    `${hash}${hash} a real heading after a line that is not a fence`,
    "body",
    "",
    "<!--",
    `${hash}${hash} inside a block comment`,
    "-->",
    "body",
  ];
  const extraction = extractHeadings(sample);
  const got = extraction.headings.map((h) => h.slug);
  const want = [
    "top",
    "indented-by-two",
    "setext-one",
    "a-wrapped-setextheading-over-two-lines",
    "a-real-heading-after-a-line-that-is-not-a-fence",
  ];
  if (got.length !== want.length || got.some((s, i) => s !== want[i])) {
    throw new RefusalError(
      `SELF-TEST FAILED: the heading detector produced [${got.join(", ")}], expected ` +
        `[${want.join(", ")}]. A missed heading is a false red on a working pointer; a phantom ` +
        `one lets a dangling pointer through. Refusing to report on the tree.`,
    );
  }
  if (extraction.commented !== 1) {
    throw new RefusalError(
      `SELF-TEST FAILED: the HTML-comment tracker suppressed ${String(extraction.commented)} ` +
        `heading(s) in a sample holding exactly one. A commented-out heading renders no anchor on ` +
        `GitHub, so counting it as one mints a phantom anchor and a dangling pointer at it passes ` +
        `green.`,
    );
  }

  // Deduplication is a LOOP, not a counter: the third heading's own slug collides with the second
  // heading's GENERATED one, so the suffix applies again.
  const dedup = extractHeadings([
    `${hash}${hash} Same`,
    "a",
    `${hash}${hash} Same`,
    "b",
    `${hash}${hash} Same-1`,
    "c",
  ]).headings.map((h) => h.slug);
  const wantDedup = ["same", "same-1", "same-1-1"];
  if (dedup.length !== wantDedup.length || dedup.some((s, i) => s !== wantDedup[i])) {
    throw new RefusalError(
      `SELF-TEST FAILED: duplicate headings slugged as [${dedup.join(", ")}], expected ` +
        `[${wantDedup.join(", ")}]. GitHub disambiguates by re-suffixing until the slug is free, ` +
        `and a pointer at a repeated heading depends on it.`,
    );
  }

  const flat = [`${hash}${hash} A`, `${hash}${hash} B`, "body"];
  const { empty } = emptySections(flat, extractHeadings(flat).headings);
  if (empty.length !== 1 || empty[0]?.slug !== "a") {
    throw new RefusalError(
      `SELF-TEST FAILED: the empty-section detector found ${String(empty.length)} empty ` +
        `section(s) in a sample with exactly one. Refusing to report on the tree.`,
    );
  }

  // THE CONTAINER EXEMPTION, SELF-TESTED IN BOTH DIRECTIONS, because it is the one rule here that
  // makes the gate report LESS.
  const nested = [`${hash}${hash} A`, `${hash}${hash}${hash} B`];
  const nestedResult = emptySections(nested, extractHeadings(nested).headings);
  if (
    nestedResult.containers !== 1 ||
    nestedResult.empty.length !== 1 ||
    nestedResult.empty[0]?.slug !== "b"
  ) {
    throw new RefusalError(
      `SELF-TEST FAILED: the container exemption found ${String(nestedResult.containers)} ` +
        `container(s) and ${String(nestedResult.empty.length)} empty section(s) in a sample ` +
        `holding exactly one of each. Either a container is being reported as emptied, which is a ` +
        `false red, or an emptied leaf beneath one is being skipped, which is a false green.`,
    );
  }

  // ASSEMBLED FROM PARTS, because this gate scans its own source with no exemption.
  const re = pointerPattern();
  const hits = [
    ...`see documentation/${CONTRACT_BASENAME}${hash}a-b, ./${CONTRACT_BASENAME}${hash}c_d.`.matchAll(
      re,
    ),
  ].map((m) => m[1]);
  if (hits.length !== 2 || hits[0] !== "a-b" || hits[1] !== "c_d") {
    throw new RefusalError(
      `SELF-TEST FAILED: the qualified pointer matcher found [${hits.join(", ")}] in a sample ` +
        `holding exactly two pointers, one path-qualified and one relative. A matcher that ` +
        `stopped matching reports a clean tree it never read.`,
    );
  }

  // THE CENSUS MUST SEPARATE A REFERENCE FROM A SUSPECTED POINTER, or it either refuses on every
  // pull-request number in the tree or never fires at all. Assembled from parts for the same reason
  // as the sample above: a literal bare span here would refuse every run on this repo's own source,
  // which is exactly what happened to a sibling that wrote one out.
  const span = (anchor: string): string => `\`${hash}${anchor}\``;
  const bare = [...`${span("36")} and ${span("a-real-anchor")}`.matchAll(barePattern())].map(
    (m) => m[1] ?? "",
  );
  if (bare.length !== 2 || !DIGITS_ONLY.test(bare[0] ?? "") || DIGITS_ONLY.test(bare[1] ?? "")) {
    throw new RefusalError(
      `SELF-TEST FAILED: the bare census classified [${bare.join(", ")}] wrongly in a sample ` +
        `holding one reference and one suspected pointer. The census is the only thing keeping ` +
        `this gate's single-form scope a measurement rather than an assumption.`,
    );
  }

  // THE EXPLICIT-ANCHOR DETECTOR, because a silent failure here is the `astm` shape: an anchor
  // space this gate does not model, reported as every pointer dangling.
  const tag = `<a ${"id"}="x"></a>`;
  if (!EXPLICIT_ANCHOR_RE.test(tag) || EXPLICIT_ANCHOR_RE.test("<article>")) {
    throw new RefusalError(
      `SELF-TEST FAILED: the explicit-anchor detector no longer separates an id-bearing anchor ` +
        `tag from ordinary markup. It is what keeps "the anchor space here is heading slugs" a ` +
        `measurement rather than an assumption.`,
    );
  }
}

// ---------------------------------------------------------------------------
// The corpus: enumerate with git, account for every path
// ---------------------------------------------------------------------------

interface Corpus {
  readonly tracked: readonly string[];
  readonly gitlinks: readonly string[];
}

function gitCorpus(root: string): Corpus {
  let raw: string;
  try {
    raw = execFileSync("git", ["ls-files", "-s", "-z"], {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (err) {
    throw new RefusalError(
      `could not enumerate tracked files under ${root} with \`git ls-files\`: ` +
        `${err instanceof Error ? err.message : String(err)}. A gate that cannot list its corpus ` +
        `has not observed it.`,
    );
  }

  const tracked: string[] = [];
  const gitlinks: string[] = [];
  for (const record of raw.split("\0")) {
    if (record === "") continue;
    // `<mode> <sha> <stage>\t<path>`
    const tab = record.indexOf("\t");
    if (tab < 0) {
      throw new RefusalError(
        `unparseable \`git ls-files -s\` record: ${JSON.stringify(record)}. Refusing rather than ` +
          `dropping a path from the corpus silently.`,
      );
    }
    const mode = record.slice(0, 6);
    const path = record.slice(tab + 1);
    // AN UNMERGED PATH IS REFUSED, NOT COUNTED. `git ls-files -s` emits stages 1, 2 and 3 for a
    // conflicted path, so the same path arrives three times, and its working-tree copy is conflict
    // markers nobody has decided the contents of.
    //
    // RE-DERIVED FOR THIS GATE RATHER THAN INHERITED FROM `scripts/phi-scan.ts`. That scanner
    // refuses `U` on its staged route because `git commit` rejects an unmerged index outright, so
    // nothing unmerged reaches a commit. THAT REASONING DOES NOT TRANSFER: this gate has no staged
    // route. It runs from the test suite and from CI over whatever tree it is handed, and a
    // half-merged one is exactly where a working-tree copy is markers rather than prose.
    const stage = record.slice(tab - 1, tab);
    if (stage !== "0") {
      throw new RefusalError(
        `tracked path is unmerged (stage ${stage}): ${path}. Resolve the conflict before running ` +
          `this gate; a scan of a half-merged tree reports on nothing anyone has decided yet.`,
      );
    }
    // A gitlink (mode 160000) is a submodule pointer with no bytes here to read. Counted and
    // reported, never silently skipped: the OK line's arithmetic has to account for it.
    if (mode === "160000") gitlinks.push(path);
    else tracked.push(path);
  }

  if (tracked.length === 0) {
    throw new RefusalError(
      `\`git ls-files\` under ${root} listed no readable tracked file. There is nothing here to ` +
        `observe, so "the contract holds" would be a statement about an empty set. This is the ` +
        `control case: a gate pointed at nothing must refuse, never report OK.`,
    );
  }

  return { tracked, gitlinks };
}

// ---------------------------------------------------------------------------
// Reading a tracked path
// ---------------------------------------------------------------------------

/**
 * ONE OPEN, THEN `fstat` AND READ THROUGH THAT SAME DESCRIPTOR, NOT `lstat`-then-read-by-path.
 *
 * The obvious shape is a TIME-OF-CHECK / TIME-OF-USE RACE, and this repository runs a `codeql`
 * analysis that flags it. The two calls resolve the path INDEPENDENTLY, so what was checked and what
 * was read need not be the same object: anything that can replace the path between them gets its
 * bytes read under a path this gate already decided was a safe regular file. The symlink refusal is
 * the one that matters, because defeating it is how bytes from OUTSIDE the tree get scanned and
 * reported on as though they were tracked content. This repository's own PHI scanner refuses a
 * non-regular entry for exactly that reason and NEVER FOLLOWS IT; the same rule is kept here so the
 * two gates can be reasoned about together.
 *
 * The path is resolved EXACTLY ONCE, by `openSync`, and every question after that is asked of the
 * resulting descriptor: `O_NOFOLLOW` makes the symlink refusal part of the open, `O_NONBLOCK` stops
 * a tracked FIFO from hanging the gate forever, and `fstatSync(fd)` asks about the OPENED OBJECT.
 *
 * A REFUSAL NAMES THE ENTRY'S OWN PATH AND NEVER A LINK TARGET, because a target path is itself a
 * surface that can carry PHI. That is this repository's standing rule, not a preference.
 *
 * STATED LIMIT: `O_NOFOLLOW` only refuses a symlink as the FINAL path component. A symlinked PARENT
 * DIRECTORY is still traversed. This repository's PHI scanner has the same boundary and discloses it
 * the same way; do not restate either as closed.
 */
function readTracked(root: string, path: string): Buffer {
  const abs = join(root, path);

  if (typeof constants.O_NOFOLLOW !== "number") {
    throw new RefusalError(
      `this platform does not provide O_NOFOLLOW, so a tracked path cannot be opened with the ` +
        `symlink refusal applied atomically. Refusing rather than scanning with the guarantee ` +
        `silently dropped.`,
    );
  }

  let fd: number;
  try {
    fd = openSync(abs, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    // ELOOP is Linux's answer to O_NOFOLLOW on a symlink; some BSDs answer EMLINK.
    if (code === "ELOOP" || code === "EMLINK") {
      throw new RefusalError(
        `tracked path is a symbolic link: ${path}. Reading through it would scan bytes from ` +
          `somewhere else under this path's name. Refused by name rather than skipped, so the ` +
          `reconciliation stays honest. The link target is deliberately not printed.`,
      );
    }
    if (code === "ENOENT" || code === "ENOTDIR") {
      throw new RefusalError(
        `tracked path is missing from the working tree: ${path} ` +
          `(${err instanceof Error ? err.message : String(err)}). A scan that could not open one ` +
          `of its inputs has not observed the corpus it is about to report on.`,
      );
    }
    throw new RefusalError(
      `tracked path is not readable: ${path} ` +
        `(${err instanceof Error ? err.message : String(err)}).`,
    );
  }

  try {
    if (!fstatSync(fd).isFile()) {
      throw new RefusalError(
        `tracked path is not a regular file: ${path}. Refusing to report green from a scan that ` +
          `skipped one of its inputs.`,
      );
    }
    return readFileSync(fd);
  } catch (err) {
    if (err instanceof RefusalError) throw err;
    throw new RefusalError(
      `tracked path is not readable: ${path} ` +
        `(${err instanceof Error ? err.message : String(err)}).`,
    );
  } finally {
    closeSync(fd);
  }
}

/**
 * THE CORPUS PARTITION. Returns the decoded text, or `null` for a file that is not valid UTF-8 and
 * is therefore skipped and counted.
 *
 * NOT A NUL TEST, AND THAT IS THE POINT: see the partition section in the header. A NUL partition
 * drops this repository's NUL-bearing hand-written sources out of the sweep in silence, and git's
 * own binary heuristic drops a different, overlapping subset of them. Do not "simplify" this to
 * either one.
 */
function decodeUtf8(buf: Buffer): string | null {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

interface Args {
  readonly root: string;
}

function parseArgs(argv: readonly string[]): Args {
  let root = process.cwd();
  let i = 0;
  while (i < argv.length) {
    const a = argv[i];
    if (a === "--root") {
      const next = argv[i + 1];
      if (next === undefined) throw new InvocationError("--root requires a directory argument");
      root = isAbsolute(next) ? next : resolve(process.cwd(), next);
      i += 2;
    } else if (a !== undefined && a.startsWith("--")) {
      throw new InvocationError(`Unknown flag: ${a}`);
    } else if (a !== undefined) {
      throw new InvocationError(`Unexpected positional argument: ${a}`);
    } else {
      i += 1;
    }
  }
  return { root };
}

function main(argv: readonly string[]): number {
  selfTest();

  const { root } = parseArgs(argv);
  const { tracked, gitlinks } = gitCorpus(root);

  const violations: Violation[] = [];

  // ---- 1. The pair exists ------------------------------------------------
  const contractPaths = tracked.filter(
    (p) => p === CONTRACT_BASENAME || p.endsWith(`/${CONTRACT_BASENAME}`),
  );
  if (contractPaths.length > 1) {
    throw new RefusalError(
      `${String(contractPaths.length)} tracked files are named ${CONTRACT_BASENAME} ` +
        `(${contractPaths.join(", ")}). Every pointer would be ambiguous, so no verdict on them ` +
        `is meaningful. Refusing rather than guessing which one a pointer meant.`,
    );
  }

  const cursorTracked = tracked.includes(CURSOR_PATH);
  if (!cursorTracked) {
    violations.push({
      where: CURSOR_PATH,
      what: `the cursor half of the pair is not tracked. The contract is two files; one is gone.`,
    });
  }

  const contractPath = contractPaths[0];
  if (contractPath === undefined) {
    violations.push({
      where: `documentation/${CONTRACT_BASENAME}`,
      what:
        `the narrative half of the pair is not tracked. Every rule in ${CURSOR_PATH} that cites ` +
        `it is now an imperative with no grounding. Restore the file or move the narrative back; ` +
        `do not delete the pointers.`,
    });
  }

  // ---- 2. Anchors and sections ------------------------------------------
  let anchors = new Set<string>();
  let sectionCount = 0;
  let containerCount = 0;
  let commentedHeadings = 0;
  if (contractPath !== undefined) {
    const text = decodeUtf8(readTracked(root, contractPath));
    if (text === null) {
      throw new RefusalError(
        `${contractPath} is not valid UTF-8, so it is not the markdown this gate parses. ` +
          `Refusing rather than reporting on bytes it cannot read as text.`,
      );
    }
    if (EXPLICIT_ANCHOR_RE.test(text)) {
      throw new RefusalError(
        `${contractPath} carries an explicit anchor tag. The anchor space this gate resolves ` +
          `against is GitHub HEADING SLUGS, and that was MEASURED on this tree rather than ` +
          `assumed. A tag means a second anchor space this gate does not model, and a sibling ` +
          `repo whose whole anchor space is such tags would have every pointer reported as ` +
          `dangling by a slug-only check. RE-DERIVE the anchor space before believing any verdict ` +
          `here; do not delete the tag to clear this.`,
      );
    }
    if (text.trim() === "") {
      violations.push({
        where: contractPath,
        what: `the narrative file is empty. Its existence is not the contract; its content is.`,
      });
    }
    const lines = text.split("\n");
    const extraction = extractHeadings(lines);
    const headings = extraction.headings;
    commentedHeadings = extraction.commented;
    sectionCount = headings.length;
    anchors = new Set(headings.map((h) => h.slug));

    if (headings.length === 0 && text.trim() !== "") {
      throw new RefusalError(
        `extracted no headings from ${contractPath}, which is ${String(lines.length)} line(s) ` +
          `long and not empty. Every anchor this gate resolves comes from that extraction, so an ` +
          `empty one means the extractor broke, not that the file has no sections.`,
      );
    }

    const sections = emptySections(lines, headings);
    containerCount = sections.containers;
    for (const h of sections.empty) {
      violations.push({
        where: `${contractPath}:${String(h.line)}`,
        what:
          `section "${h.text}" (slug ${h.slug}) has no body. A pointer at it resolves to nothing, ` +
          `which is the same defect as a dangling anchor with a friendlier error message. ` +
          `Restore the narrative; do not delete the heading to clear this.`,
      });
    }
  }

  // ---- 3. Every qualified pointer resolves, and the bare form stays absent -----------------
  // THE TWO SETS BELOW ARE SETS, NOT COUNTERS, AND THAT IS THE WHOLE POINT OF THE RECONCILIATION. A
  // pair of counters incremented one per loop iteration can only ever sum to the number of
  // iterations, so comparing that sum against the corpus size is a tautology dressed as a check.
  // Sets of PATHS cannot: they catch a path enumerated twice, a path visited twice, and a path in
  // the corpus that no branch ever reached.
  const openedPaths = new Set<string>();
  const skippedPaths = new Set<string>();
  let pointerCount = 0;
  const pointerFiles = new Set<string>();
  let bareReferences = 0;
  let nulBearingOpened = 0;

  for (const path of tracked) {
    const buf = readTracked(root, path);
    const text = decodeUtf8(buf);
    if (text === null) {
      // DISCLOSED MISS (ii), NOT A PASS: a pointer inside such a file is never read. The tell is
      // the skipped count on the OK line.
      skippedPaths.add(path);
      continue;
    }
    openedPaths.add(path);
    // THE ANTI-PORT TELL. A sibling's NUL partition would have dropped this file; this one keeps
    // it, and the count says so out loud on every run.
    if (buf.includes(0)) nulBearingOpened += 1;
    const lines = text.split("\n");

    // THE BARE CENSUS, OVER EVERY OPENED FILE, and BEFORE the early return below: a bare span is
    // not accompanied by the qualified basename and would otherwise never be seen.
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i] ?? "";
      const re = barePattern();
      let bm: RegExpExecArray | null;
      while ((bm = re.exec(line)) !== null) {
        const anchor = bm[1] ?? "";
        if (DIGITS_ONLY.test(anchor)) {
          bareReferences += 1;
          continue;
        }
        throw new RefusalError(
          `suspected BARE pointer (anchor ${anchor}) at ${path}:${String(i + 1)}. This gate ` +
            `matches the QUALIFIED spelling only, and that scope was derived from a measurement ` +
            `of THIS tree in which no bare pointer existed. A bare-shaped span that is not a ` +
            `digits-only pull-request reference means that measurement is now stale, so "all ` +
            `resolving" would be a claim about a corpus this gate no longer covers. RE-DERIVE THE ` +
            `MATCHER against the new spelling, or write the pointer in the qualified form. Do not ` +
            `delete the span to clear this.`,
        );
      }
    }

    if (!text.includes(`${CONTRACT_BASENAME}#`)) continue;

    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i] ?? "";
      const re = pointerPattern();
      let m: RegExpExecArray | null;
      while ((m = re.exec(line)) !== null) {
        const anchor = m[1] ?? "";
        pointerCount += 1;
        pointerFiles.add(path);
        if (anchors.has(anchor)) continue;

        // ▶ THERE IS DELIBERATELY NO WRAP JOIN HERE, AND A SIBLING'S EXISTED AND WAS DELETED IN
        // REVIEW. The shape is: an anchor that failed to resolve and ran to the end of its line is
        // re-tried joined to the next line's leading anchor run, on the theory that it rescues a
        // false red on a pointer a text editor wrapped. Its comment claimed it "cannot manufacture
        // a pass for a pointer the line pass already resolved", which is a TAUTOLOGY dressed as a
        // safety property: the direction that matters is a pointer the line pass did NOT resolve,
        // and the join manufactures exactly that pass. Reproduced on this tree before it was
        // removed, with a real cursor line whose anchor was truncated one character early and whose
        // continuation began with the missing character plus prose: the gate printed "all resolving"
        // at exit 0 over a link GitHub resolves to nothing. It also rescued ZERO of this tree's real
        // pointers, so it bought nothing while opening the one direction this gate must never fail
        // in. If a wrapped pointer ever becomes a real false red here, the fix is to unwrap the
        // pointer, not to re-add the join.
        violations.push({
          where: `${path}:${String(i + 1)}`,
          what:
            `pointer at anchor ${anchor} does not resolve to a heading in ` +
            `${contractPath ?? `documentation/${CONTRACT_BASENAME}`}. Fix the anchor or restore ` +
            `the section. Deleting the pointer to clear this deletes the grounding for the rule ` +
            `that cited it.`,
        });
      }
    }
  }

  // ---- 4. Reconcile, then report ----------------------------------------
  const opened = openedPaths.size;
  const skipped = skippedPaths.size;
  const unaccounted = tracked.filter((p) => !openedPaths.has(p) && !skippedPaths.has(p));
  if (opened + skipped !== tracked.length || unaccounted.length > 0) {
    throw new RefusalError(
      `reconciliation failed: ${String(tracked.length)} tracked non-gitlink path(s) enumerated, ` +
        `${String(opened)} opened and ${String(skipped)} skipped as non-UTF-8, ` +
        `${String(unaccounted.length)} reached by no branch` +
        `${unaccounted.length > 0 ? ` (first: ${String(unaccounted[0])})` : ""}. Every path must ` +
        `be opened or skipped for a named reason, and no path twice. A corpus that does not ` +
        `reconcile means the scan is reporting on something it did not read.`,
    );
  }

  // ORDERED AFTER THE CURSOR CHECK, AND THAT ORDER IS THE FIX FOR A MISDIAGNOSIS. A tree whose
  // cursor half is untracked has zero pointers as a CONSEQUENCE, and refusing here would answer a
  // modelled contract break ("one half of the pair is gone") with "the matcher stopped matching",
  // which sends a reader to the wrong file. Both outcomes are fail-closed; only one is legible. The
  // refusal still fires whenever the cursor IS tracked and the matcher found nothing in it, which
  // is the case it exists for.
  if (pointerCount === 0 && cursorTracked) {
    throw new RefusalError(
      `found ZERO qualified pointers at ${CONTRACT_BASENAME} across ${String(opened)} opened ` +
        `file(s). In this repo that is not a clean tree: ${CURSOR_PATH} names the narrative file ` +
        `in its opening block and cites it by anchor throughout, which is what its byte budget ` +
        `forces. Zero means the matcher stopped matching, so the pointer half of this gate ` +
        `observed nothing and proved nothing. EXISTENCE IS NOT OBSERVATION, and a denominator ` +
        `would not have caught this either.`,
    );
  }

  if (violations.length > 0) {
    process.stderr.write(
      `ERROR: check-agent-notes - this repo's narrative-pointer contract is broken ` +
        `(${String(violations.length)} finding(s)).\n\n`,
    );
    for (const v of violations) {
      process.stderr.write(`  ${v.where}\n      ${v.what}\n\n`);
    }
    process.stderr.write(
      `  This gate asserts THIS repo's contract only and says nothing about any sibling: ` +
        `several cosyte repos carry no ${CONTRACT_BASENAME} at all, and for those the honest ` +
        `outcome is a written exemption rather than an invented file.\n`,
    );
    return 1;
  }

  process.stdout.write(
    // NOT "all with a body". A container is exempt and is never asked, so that phrasing became
    // false the moment the exemption landed.
    `check-agent-notes: OK (${contractPath ?? "?"}: ${String(sectionCount)} section(s), ` +
      `${String(containerCount)} of them container(s) whose body is their subsections and the ` +
      `rest with a body of their own; anchor space is heading slugs, no explicit anchor tag, ` +
      `${String(commentedHeadings)} heading(s) suppressed as commented out; ` +
      `${String(pointerCount)} qualified pointer(s) from ${String(pointerFiles.size)} file(s), ` +
      `all resolving; ${String(bareReferences)} bare-shaped span(s) across every opened file, ` +
      `each a digits-only reference and none a pointer; ${String(tracked.length)} tracked path(s) ` +
      `reconciled = ${String(opened)} opened + ${String(skipped)} skipped as non-UTF-8, of which ` +
      `${String(nulBearingOpened)} opened despite carrying a NUL byte, plus ` +
      `${String(gitlinks.length)} gitlink(s) with no bytes here)\n`,
  );
  return 0;
}

function run(): number {
  try {
    return main(process.argv.slice(2));
  } catch (err) {
    if (err instanceof RefusalError) {
      process.stderr.write(`[check-agent-notes] refusing: ${err.message}\n`);
      return 2;
    }
    if (err instanceof InvocationError) {
      process.stderr.write(`[check-agent-notes] bad invocation: ${err.message}\n`);
      return 2;
    }
    process.stderr.write(
      `[check-agent-notes] refusing: the check failed before it could finish: ` +
        `${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`,
    );
    return 2;
  }
}

process.exit(run());
