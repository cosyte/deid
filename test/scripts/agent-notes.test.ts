/**
 * Tests for `scripts/check-agent-notes.ts`: the gate that keeps `CLAUDE.md`'s pointers into
 * `documentation/agent-notes.md` resolving.
 *
 * ▶ EVERY POINTER AND EVERY BARE SPAN IN THIS FILE IS ASSEMBLED FROM PARTS AT RUNTIME, NEVER
 * WRITTEN OUT, AND THAT IS NOT A STYLE CHOICE. The gate's corpus is `git ls-files` over the whole
 * repository and it carves out no exemption for its own source or its own tests, deliberately: an
 * exemption for the gate's own files is exactly where a genuinely broken pointer would hide. So a
 * pointer spelled literally in this file is a pointer into this repo's narrative file and is checked
 * as one, and a bare span spelled literally here REFUSES the run at exit 2 on the real tree. `astm`
 * shipped this gate with its fixtures spelled out, its local verify was green because the new files
 * were still UNTRACKED, and CI went red on both Node versions the moment they were staged. Exempting
 * them was rejected; building the strings was the fix. Do the same here.
 *
 * ▶ AND RE-RUN THE GATE AFTER `git add`. The corpus is the INDEX, so a new file is invisible to it
 * until it is staged. A green local run over an unstaged tree proves nothing about the tree CI sees.
 *
 * WHAT THESE PIN, AND WHY EACH ONE IS HERE:
 *
 *  1. THE PREMISE. A healthy fixture is green. Without this every red below proves only that the
 *     fixture was broken in some way, not that the gate detected the specific thing it names. This
 *     repository has already paid for a vacuous assertion twice in another suite.
 *  2. THE POSITIVE CONTROL THE ITEM ASKS FOR: a deliberately broken pointer reds at exit 1, and the
 *     message names the file, the line and the anchor. Built by editing ONE anchor of the same
 *     fixture that case 1 proved green, so the difference is the break and nothing else.
 *  3. AN EMPTIED SECTION reds, and it reds NON-VACUOUSLY. `astm` shipped a positive control that
 *     printed OK over an emptied section because anchors and headings were bound separately: the
 *     anchor looked empty, the heading looked unreferenced, and both passes skipped it. Here the
 *     same fixture is asserted green first, the pointer at the section is asserted to still be
 *     present after the edit, and the failure text is asserted to name that section.
 *  4. A CONTAINER IS NOT AN EMPTIED SECTION. The false-red direction of case 3.
 *  5. THE NARRATIVE FILE GOING UNTRACKED reds.
 *  6. THE BARE CENSUS REFUSES at exit 2 on a bare-shaped span that is not a digits-only reference,
 *     and PASSES a digits-only one. This is what keeps "the qualified form is the only live spelling
 *     here" a measurement rather than an assumption, and both directions matter: a census that
 *     refuses on pull-request numbers would be deleted within a week.
 *  7. ZERO QUALIFIED POINTERS REFUSES rather than reporting a clean tree. A matcher that stopped
 *     matching otherwise reports "all resolving" over nothing at all, which is the exact false green
 *     a ported matcher produces.
 *  8. AN EXPLICIT ANCHOR TAG IN THE NARRATIVE FILE REFUSES. The anchor space here is heading slugs
 *     and that was measured; `astm`'s is 37 explicit tags, where a slug-only check reports every
 *     pointer in the repo as dangling. Refusing is what stops this gate quietly becoming that.
 *  9. THE CORPUS PARTITION, IN BOTH DIRECTIONS, AND IT IS THE ANTI-PORT CONTROL. A tracked file that
 *     carries a NUL byte but decodes as UTF-8 IS READ, so a dangling pointer inside one still reds.
 *     A NUL partition is the obvious shape to reach for and this repository tracks hand-written
 *     TypeScript sources that embed NUL bytes, so adopting it would drop authored source out of the
 *     sweep in silence. A file that is genuinely not UTF-8 is skipped AND COUNTED. (What any other
 *     repository partitions on is not asserted here: it is not checkable from inside this one.)
 * 10. AN UNTERMINATED HTML COMMENT REFUSES, and a heading inside a terminated one mints NO anchor,
 *     so a pointer at it reds. A commented-out heading renders no anchor on GitHub; several sibling
 *     copies count it anyway and merely disclose the phantom.
 * 11. A SYMLINK IS REFUSED, NOT FOLLOWED, matching this repository's PHI scanner rather than a
 *     sibling's gate.
 * 12. THE REAL TREE IS GREEN, and its OK line is asserted to report a non-zero pointer count and a
 *     slug anchor space. This is the case that puts the gate on `ci / verify` and inside
 *     `prepublishOnly` without a new required check-run context having to be created.
 *
 * TIMEOUTS ARE PER TEST, NEVER GLOBAL. Every case spawns `tsx` cold, which is seconds under
 * contention against this suite's 10s default. Raising the global default would trade this false red
 * for a false green across every other suite in the repo.
 *
 * SECURITY: every subprocess call uses `spawnSync` with array args. No exec, no shell form.
 */

import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const REPO_ROOT = process.cwd();
const GATE = join(REPO_ROOT, "scripts", "check-agent-notes.ts");
const CASE_TIMEOUT = 30_000;

// ---------------------------------------------------------------------------
// Sample construction. Assembled, never spelled: see the banner.
// ---------------------------------------------------------------------------

const HASH = "#";
/** A real NUL byte, written as a code point so this source file stays plain text. */
const NUL = String.fromCharCode(0);
const BASENAME = `agent-notes${"."}md`;
const NOTES_PATH = `documentation/${BASENAME}`;

/** A qualified pointer at `anchor`, path-qualified exactly as this repo spells them. */
const pointer = (anchor: string): string => `${NOTES_PATH}${HASH}${anchor}`;

/** A bare span: an inline code span holding nothing but a hash and an anchor run. */
const bareSpan = (anchor: string): string => `\`${HASH}${anchor}\``;

/** An ATX heading of the given depth. */
const heading = (depth: number, text: string): string => `${HASH.repeat(depth)} ${text}`;

interface Fixture {
  readonly root: string;
  readonly cleanup: () => void;
}

/**
 * A throwaway repository shaped like this one's pair: a cursor file whose rules cite a narrative
 * file by anchor. Small on purpose. The gate's own corpus rules (git-enumerated, every path opened
 * or skipped) are what make a synthetic tree a fair test of them.
 */
function makeRepo(files: Readonly<Record<string, string>>): Fixture {
  const root = mkdtempSync(join(tmpdir(), "deid-agent-notes-"));
  const git = (...args: string[]): void => {
    const res = spawnSync("git", args, { cwd: root, encoding: "utf8" });
    if (res.status !== 0) {
      throw new Error(`git ${args.join(" ")} failed: ${res.stderr || res.stdout}`);
    }
  };
  git("init", "-q");
  for (const [path, body] of Object.entries(files)) {
    const abs = join(root, path);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, body);
  }
  git("add", "-A");
  return { root, cleanup: (): void => rmSync(root, { recursive: true, force: true }) };
}

interface Run {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * THE LOCAL `tsx` BINARY, NOT `npx`. `npx` writes its own warnings to stderr on this toolchain, and
 * several cases below assert that a green run produces an EMPTY stderr. Going through `npx` would
 * make that assertion pass or fail on the package manager's mood rather than on the gate.
 */
const TSX = join(REPO_ROOT, "node_modules", ".bin", "tsx");

function runGate(root?: string): Run {
  const args = [GATE, ...(root === undefined ? [] : ["--root", root])];
  const res = spawnSync(TSX, args, { cwd: REPO_ROOT, encoding: "utf8" });
  return { status: res.status ?? -1, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

/**
 * The healthy baseline, built fresh for every case so no test can leave another one a broken tree.
 * `overrides` replaces a whole file; that is the only mutation shape used here, because restoring a
 * base tree by rewriting the file is honest in a way a partial patch is not.
 */
function baseFiles(): Record<string, string> {
  const notes = [
    heading(1, "Sample notes"),
    "",
    heading(2, "Group"),
    "",
    heading(3, "The first rule"),
    "",
    "Why the first rule exists.",
    "",
    heading(3, "The second rule"),
    "",
    "Why the second rule exists.",
    "",
  ].join("\n");
  const cursor = [
    heading(1, "Sample cursor"),
    "",
    `- Never do the first thing. Why: ${pointer("the-first-rule")}`,
    `- Never do the second thing. Why: ${pointer("the-second-rule")}`,
    `- The group as a whole: ${pointer("group")}`,
    "",
  ].join("\n");
  return { "CLAUDE.md": cursor, [NOTES_PATH]: notes };
}

function withFixture(files: Readonly<Record<string, string>>, fn: (run: Run) => void): void {
  const fx = makeRepo(files);
  try {
    fn(runGate(fx.root));
  } finally {
    fx.cleanup();
  }
}

// ---------------------------------------------------------------------------

describe("check-agent-notes", () => {
  it(
    "1. is green on a healthy pair, which is the premise every red below depends on",
    () => {
      withFixture(baseFiles(), (run) => {
        expect(run.stderr).toBe("");
        expect(run.status).toBe(0);
        expect(run.stdout).toContain("3 qualified pointer(s)");
        expect(run.stdout).toContain("all resolving");
      });
    },
    CASE_TIMEOUT,
  );

  it(
    "2. POSITIVE CONTROL: a deliberately broken pointer reds at exit 1 and is named",
    () => {
      const files = baseFiles();
      // ONE anchor changed against the fixture case 1 proved green. Nothing else moves.
      files["CLAUDE.md"] = (files["CLAUDE.md"] ?? "").replace(
        pointer("the-second-rule"),
        pointer("the-secnod-rule"),
      );
      withFixture(files, (run) => {
        expect(run.status).toBe(1);
        expect(run.stderr).toContain("the-secnod-rule");
        expect(run.stderr).toContain("CLAUDE.md:");
        expect(run.stderr).toContain("does not resolve");
        // The surviving pointers are still reported as fine: a gate that reds everything on one
        // break tells a reader nothing about where to look.
        expect(run.stderr).not.toContain("the-first-rule");
        // And it says out loud that it speaks for this repo only.
        expect(run.stderr).toContain("says nothing about any sibling");
      });
    },
    CASE_TIMEOUT,
  );

  it(
    "3. POSITIVE CONTROL: an emptied section reds, non-vacuously",
    () => {
      const files = baseFiles();
      // The heading STAYS and the pointer at it STAYS. Only the body goes. That is the shape that
      // fooled a sibling's control: with anchors and headings bound separately the anchor looked
      // empty, the heading looked unreferenced, and both passes skipped it.
      files[NOTES_PATH] = (files[NOTES_PATH] ?? "").replace("Why the second rule exists.\n", "");
      expect(files[NOTES_PATH]).toContain(heading(3, "The second rule"));
      expect(files["CLAUDE.md"]).toContain(pointer("the-second-rule"));
      withFixture(files, (run) => {
        expect(run.status).toBe(1);
        expect(run.stderr).toContain("The second rule");
        expect(run.stderr).toContain("has no body");
        expect(run.stderr).toContain("do not delete the heading to clear this");
      });
    },
    CASE_TIMEOUT,
  );

  it(
    "4. a container whose body is its subsections is NOT reported as emptied",
    () => {
      // The false-red direction of case 3, and the shape is live in this repo's narrative file.
      withFixture(baseFiles(), (run) => {
        expect(run.status).toBe(0);
        expect(run.stdout).toContain("container(s)");
        expect(run.stdout).not.toContain("Group");
      });
    },
    CASE_TIMEOUT,
  );

  it(
    "5. the narrative file going untracked reds",
    () => {
      const files = baseFiles();
      delete files[NOTES_PATH];
      withFixture(files, (run) => {
        expect(run.status).toBe(1);
        expect(run.stderr).toContain("is not tracked");
        expect(run.stderr).toContain("do not delete the pointers");
      });
    },
    CASE_TIMEOUT,
  );

  it(
    "6. the bare census refuses a suspected bare pointer and passes a digits-only reference",
    () => {
      const refuses = baseFiles();
      // In a THIRD file, not the pair: a bare pointer written anywhere would be covered by neither
      // the matcher nor a pair-scoped census, which is the corner the tree-wide census removes.
      refuses["CHANGELOG.md"] = `See ${bareSpan("the-first-rule")} for the reasoning.\n`;
      withFixture(refuses, (run) => {
        expect(run.status).toBe(2);
        expect(run.stderr).toContain("suspected BARE pointer");
        expect(run.stderr).toContain("RE-DERIVE THE MATCHER");
        expect(run.stderr).toContain("CHANGELOG.md:1");
      });

      const passes = baseFiles();
      passes["CHANGELOG.md"] = `Fixed in ${bareSpan("47")} and ${bareSpan("12")}.\n`;
      withFixture(passes, (run) => {
        expect(run.status).toBe(0);
        expect(run.stdout).toContain("2 bare-shaped span(s)");
        expect(run.stdout).toContain("each a digits-only reference and none a pointer");
      });
    },
    CASE_TIMEOUT,
  );

  it(
    "7. zero qualified pointers REFUSES rather than reporting a clean tree",
    () => {
      const files = baseFiles();
      files["CLAUDE.md"] = `${heading(1, "Sample cursor")}\n\nNo pointers at all.\n`;
      withFixture(files, (run) => {
        expect(run.status).toBe(2);
        expect(run.stderr).toContain("ZERO qualified pointers");
        expect(run.stderr).toContain("EXISTENCE IS NOT OBSERVATION");
      });
    },
    CASE_TIMEOUT,
  );

  it(
    "8. an explicit anchor tag in the narrative file REFUSES: the anchor space was measured",
    () => {
      const files = baseFiles();
      const tag = `<a ${"id"}="the-second-rule"></a>`;
      files[NOTES_PATH] = `${files[NOTES_PATH] ?? ""}\n${tag}\n`;
      withFixture(files, (run) => {
        expect(run.status).toBe(2);
        expect(run.stderr).toContain("explicit anchor tag");
        expect(run.stderr).toContain("RE-DERIVE the anchor space");
      });
    },
    CASE_TIMEOUT,
  );

  it(
    "9. THE ANTI-PORT CONTROL: a NUL-bearing UTF-8 file is READ, and a non-UTF-8 file is skipped",
    () => {
      // A sibling's NUL partition drops this file, and with it a real dangling pointer. This repo
      // tracks hand-written TypeScript sources that embed NUL bytes in string literals, so that is
      // not a hypothetical shape here.
      const nulFile = baseFiles();
      nulFile["src/embeds-nul.ts"] =
        `export const SENTINEL = "${NUL}";\n// ${pointer("no-such-section")}\n`;
      withFixture(nulFile, (run) => {
        expect(run.status).toBe(1);
        expect(run.stderr).toContain("no-such-section");
        expect(run.stderr).toContain("src/embeds-nul.ts");
      });

      // And the partition that IS applied is counted out loud rather than left silent.
      const binary = baseFiles();
      binary["vendor/blob.tgz"] = "";
      const fx = makeRepo(binary);
      try {
        writeFileSync(
          join(fx.root, "vendor/blob.tgz"),
          Buffer.from([0x1f, 0x8b, 0x08, 0xff, 0xfe]),
        );
        spawnSync("git", ["add", "-A"], { cwd: fx.root, encoding: "utf8" });
        const run = runGate(fx.root);
        expect(run.status).toBe(0);
        expect(run.stdout).toContain("1 skipped as non-UTF-8");
      } finally {
        fx.cleanup();
      }
    },
    CASE_TIMEOUT,
  );

  it(
    "10. a commented-out heading mints no anchor, and an unterminated comment REFUSES",
    () => {
      const commented = baseFiles();
      commented[NOTES_PATH] = (commented[NOTES_PATH] ?? "").replace(
        heading(3, "The second rule"),
        `<!--\n${heading(3, "The second rule")}\n-->`,
      );
      withFixture(commented, (run) => {
        // GitHub renders no anchor for it, so the pointer at it must red rather than pass.
        expect(run.status).toBe(1);
        expect(run.stderr).toContain("the-second-rule");
        expect(run.stderr).toContain("does not resolve");
      });

      const unterminated = baseFiles();
      unterminated[NOTES_PATH] =
        `${unterminated[NOTES_PATH] ?? ""}\n<!-- opened and never closed\n`;
      withFixture(unterminated, (run) => {
        expect(run.status).toBe(2);
        expect(run.stderr).toContain("never closed");
      });
    },
    CASE_TIMEOUT,
  );

  it(
    "11. a tracked symlink is REFUSED, not followed, and the target is never printed",
    () => {
      const fx = makeRepo(baseFiles());
      try {
        symlinkSync("/etc/hostname", join(fx.root, "linked.md"));
        spawnSync("git", ["add", "-A"], { cwd: fx.root, encoding: "utf8" });
        const run = runGate(fx.root);
        expect(run.status).toBe(2);
        expect(run.stderr).toContain("symbolic link");
        expect(run.stderr).toContain("linked.md");
        expect(run.stderr).not.toContain("/etc/hostname");
      } finally {
        fx.cleanup();
      }
    },
    CASE_TIMEOUT,
  );

  it(
    "13. a pointer split across a line wrap is REPORTED, never rejoined into a pass",
    () => {
      // THE REFUTED SHAPE, PINNED SO IT CANNOT COME BACK. A sibling rejoined a failed anchor with
      // the next line's leading run, and that printed "all resolving" at exit 0 over a link GitHub
      // resolves to nothing: the anchor is truncated one character early and the continuation opens
      // with the missing character followed by prose. A false RED here is the safe direction and is
      // fixed by unwrapping the pointer, never by re-adding the join.
      const files = baseFiles();
      files["CLAUDE.md"] =
        `${heading(1, "Sample cursor")}\n\n` +
        `- Never do the second thing. Why: ${pointer("the-second-rul")}\n` +
        `  e. Everything after this is ordinary prose.\n` +
        `- Never do the first thing. Why: ${pointer("the-first-rule")}\n`;
      withFixture(files, (run) => {
        expect(run.status).toBe(1);
        expect(run.stderr).toContain("the-second-rul");
        expect(run.stderr).toContain("does not resolve");
      });
    },
    CASE_TIMEOUT,
  );

  it(
    "14. a heading inside a NESTED fenced sample mints no anchor",
    () => {
      // A markdown document that quotes markdown opens a fence inside a fence. A closer test that
      // accepts any run of the same character closes the outer block on the inner OPENER, after
      // which every hash line in the rest of the sample is read as a heading and mints an anchor
      // GitHub never renders. That is the false-green direction, so the pointer at such a heading
      // must red rather than resolve.
      //
      // ▶ IT POINTS AT THE SECOND HEADING, AND THAT IS THE WHOLE CASE. An earlier draft pointed at
      // the FIRST, which sits inside the sample under the loose rule AND the correct one, so all
      // three assertions passed verbatim against the pre-fix gate: VACUOUS, and caught in review.
      // Only the heading AFTER the inner opener discriminates, because only it changes side.
      const files = baseFiles();
      files[NOTES_PATH] =
        `${files[NOTES_PATH] ?? ""}\n` +
        "```md\n" +
        `${heading(3, "Quoted in a sample")}\n` +
        "```js\n" +
        `${heading(3, "Also quoted")}\n` +
        "```\n" +
        "\nReal prose after the sample.\n";
      files["CLAUDE.md"] = `${files["CLAUDE.md"] ?? ""}- And: ${pointer("also-quoted")}\n`;
      withFixture(files, (run) => {
        expect(run.status).toBe(1);
        expect(run.stderr).toContain("also-quoted");
        expect(run.stderr).toContain("does not resolve");
      });
    },
    CASE_TIMEOUT,
  );

  it(
    "15. an untracked cursor half is a FINDING naming it, not a misdiagnosed refusal",
    () => {
      // The zero-pointer refusal must not be reached here. Every pointer lives in the cursor file,
      // so an untracked cursor gives zero pointers as a CONSEQUENCE, and refusing would answer a
      // modelled contract break with "the matcher stopped matching" and send a reader to the wrong
      // file. Reverting the guard turns this case's exit 1 into exit 2, which is what makes it a
      // test of the ordering rather than of the message.
      const files = baseFiles();
      delete files["CLAUDE.md"];
      withFixture(files, (run) => {
        expect(run.status).toBe(1);
        expect(run.stderr).toContain("CLAUDE.md");
        expect(run.stderr).toContain("the cursor half of the pair is not tracked");
        expect(run.stderr).not.toContain("ZERO qualified pointers");
      });
    },
    CASE_TIMEOUT,
  );

  it(
    "12. THIS repository's own pair is green, and the OK line is not vacuous",
    () => {
      const run = runGate();
      expect(run.stderr).toBe("");
      expect(run.status).toBe(0);
      expect(run.stdout).toContain("check-agent-notes: OK");
      expect(run.stdout).toContain("anchor space is heading slugs");
      // Not a fixed figure: a count written into an assertion goes stale on the next commit that
      // adds a rule. What is asserted is that the pointer half OBSERVED something, which is the
      // property a ported matcher silently loses.
      const pointers = /(\d+) qualified pointer\(s\) from (\d+) file\(s\), all resolving/.exec(
        run.stdout,
      );
      expect(pointers).not.toBeNull();
      expect(Number(pointers?.[1] ?? 0)).toBeGreaterThan(0);
      expect(Number(pointers?.[2] ?? 0)).toBeGreaterThan(0);
      // And that the corpus reconciled over every tracked path rather than a declared subset.
      expect(run.stdout).toMatch(/\d+ tracked path\(s\) reconciled = \d+ opened \+ \d+ skipped/);
    },
    CASE_TIMEOUT,
  );
});
