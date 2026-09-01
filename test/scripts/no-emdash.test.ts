/**
 * Tests for `scripts/check-no-emdash.sh`: the gate that keeps the banned dash character out of this
 * repository's tracked files and out of a pull request's title, body and commit messages.
 *
 * ▶ THE BANNED CHARACTER IS NEVER SPELLED IN THIS FILE. It is built from its code point and
 * assembled into samples at runtime. That is not a style choice: the gate's corpus is
 * `git ls-files` over the whole repository and it carves out NO exemption for its own source, its
 * own workflow or this file, so a literal glyph here would red the gate on its own test suite. An
 * exemption is exactly where a real violation would hide, so building the samples is the fix.
 *
 * ▶ AND RE-RUN THE GATE AFTER `git add`. The corpus is the INDEX, so a new file is invisible to it
 * until it is staged. A green local run over an unstaged tree proves nothing about the tree CI
 * sees. Case 10 pins that boundary rather than leaving it implicit.
 *
 * WHAT THESE PIN, AND WHY EACH ONE IS HERE:
 *
 *  1. THE PREMISE. A healthy tree is green, and the OK line reports what it actually read. Without
 *     this every red below proves only that the fixture was broken somehow, not that the gate saw
 *     the specific thing it names.
 *  2. THE POSITIVE CONTROL: a seeded occurrence reds at exit 1 and names the file AND the line.
 *  3. THE COUNT IS OF OCCURRENCES, NOT LINES. Two on one line is two violations, and a report that
 *     says "1" understates the work left to do.
 *  4. THE EN DASH IS NOT BANNED. The directive names one character. This is the assertion that
 *     makes widening the gate to the rest of the dash family a decision somebody takes on purpose
 *     rather than a side effect of editing a pattern.
 *  5. THE FIXTURE RULE, IN BOTH DIRECTIONS. The same bytes pass under the excluded prefix and red
 *     one directory away. A one-directional test would pass just as happily over a gate that had
 *     stopped scanning anything at all.
 *  6. THE VENDORED-TARBALL RULE, likewise, and it is the rule that carries a live occurrence on
 *     this repository's real tree.
 *  7. A STALE EXCLUSION REFUSES. An exclusion naming a directory that has gone is how a stated
 *     scope drifts into covering something nobody argued for.
 *  8. THE CHANGELOG REGION RULE, IN BOTH DIRECTIONS. Above the divider is scanned; the frozen
 *     archive below it, pinned by digest elsewhere in this suite and already published inside
 *     shipped tarballs, is not.
 *  9. A MISSING DIVIDER REFUSES rather than defaulting to scanning all of the file or none of it.
 * 10. THE CORPUS IS THE INDEX, stated as a limit rather than discovered later.
 * 11. THE MESSAGE SCAN reaches the title, the body and every commit message in the range, and a
 *     clean pull request is green.
 * 12. A RANGE THE CLONE CANNOT READ REFUSES. A shallow checkout hides the base commit, `git log`
 *     then reports nothing, and nothing is byte-for-byte what a clean pull request looks like.
 *     Three shapes: a shallow clone, an absent commit, and a range of zero commits.
 * 13. PULL-REQUEST TEXT IS DATA, NEVER CODE. A title full of shell metacharacters is scanned, is
 *     reported verbatim when it offends, and executes nothing.
 * 14. THE STANDARD-INPUT MODE refuses on empty input: a scan that read nothing must never print OK.
 *
 * SECURITY: every subprocess call uses `spawnSync` with array args. No exec, no shell form.
 */

import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const REPO_ROOT = process.cwd();
const GATE = join(REPO_ROOT, "scripts", "check-no-emdash.sh");
const CASE_TIMEOUT = 30_000;

/** The banned character, written as a code point so this source file stays free of it. */
const BANNED = String.fromCodePoint(0x2014);
/** U+2013 EN DASH: a different character, and deliberately not banned. */
const EN_DASH = String.fromCodePoint(0x2013);

const ARCHIVE_HEADING = "## Released before this file was generated";

interface Run {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
}

interface Fixture {
  readonly root: string;
  readonly git: (...args: string[]) => void;
  readonly write: (path: string, body: string) => void;
  readonly cleanup: () => void;
}

function runGate(root: string, args: readonly string[] = [], env: NodeJS.ProcessEnv = {}): Run {
  const res = spawnSync("bash", [GATE, ...args], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  return { status: res.status ?? -1, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

/**
 * A throwaway repository carrying everything the gate's stated scope names: a changelog with the
 * archive divider, a vendored directory, a fixture directory, and ordinary prose. Small on purpose.
 * The gate's corpus rules (git-enumerated, every path opened or refused) are what make a synthetic
 * tree a fair test of them.
 */
function makeRepo(files: Readonly<Record<string, string>>): Fixture {
  const root = mkdtempSync(join(tmpdir(), "deid-no-emdash-"));
  const git = (...args: string[]): void => {
    const res = spawnSync(
      "git",
      ["-c", "user.email=t@example.test", "-c", "user.name=T", ...args],
      {
        cwd: root,
        encoding: "utf8",
      },
    );
    if (res.status !== 0) {
      throw new Error(`git ${args.join(" ")} failed: ${res.stderr || res.stdout}`);
    }
  };
  const write = (path: string, body: string): void => {
    const abs = join(root, path);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, body);
  };
  git("init", "-q", "-b", "main");
  for (const [path, body] of Object.entries(files)) write(path, body);
  git("add", "-A");
  return { root, git, write, cleanup: (): void => rmSync(root, { recursive: true, force: true }) };
}

/** The healthy baseline, rebuilt for every case so no test can leave another one a broken tree. */
function baseFiles(): Record<string, string> {
  return {
    "README.md": "# Sample\n\nOrdinary prose with a plain hyphen - and nothing else.\n",
    "CHANGELOG.md": [
      "# Changelog",
      "",
      "## 0.0.2",
      "",
      "- A change.",
      "",
      ARCHIVE_HEADING,
      "",
      "## 0.0.1",
      "",
      "- The first release.",
      "",
    ].join("\n"),
    "vendor/upstream.tgz": "pretend tarball bytes\n",
    "test/fixtures/sample.hl7": "MSH|^~\\&|SENDING|FACILITY\n",
    "src/index.ts": "export const value = 1;\n",
  };
}

function withRepo(files: Readonly<Record<string, string>>, fn: (fx: Fixture) => void): void {
  const fx = makeRepo(files);
  try {
    fn(fx);
  } finally {
    fx.cleanup();
  }
}

// ---------------------------------------------------------------------------

describe("check-no-emdash: the tracked-file scan", () => {
  it(
    "1. is green on a healthy tree, and the OK line reports what it read",
    () => {
      withRepo(baseFiles(), (fx) => {
        const run = runGate(fx.root);
        expect(run.stderr).toBe("");
        expect(run.status).toBe(0);
        expect(run.stdout).toContain("check-no-emdash: OK");
        // Five tracked files: two scanned, two excluded by the prefix rules, and CHANGELOG.md
        // handled by the region rule and reported separately. The arithmetic is asserted rather
        // than the headline alone, because an OK line that adds up is how a shrunken scan shows.
        expect(run.stdout).toContain("2 tracked file(s) scanned");
        expect(run.stdout).toContain("2 file(s) excluded");
        expect(run.stdout).toContain("archive divider at line 7");
      });
    },
    CASE_TIMEOUT,
  );

  it(
    "2. POSITIVE CONTROL: a seeded occurrence reds at exit 1 and names the file and the line",
    () => {
      const files = baseFiles();
      files["README.md"] = `# Sample\n\nA sentence ${BANNED} interrupted.\n`;
      withRepo(files, (fx) => {
        const run = runGate(fx.root);
        expect(run.status).toBe(1);
        expect(run.stderr).toContain("./README.md:3:");
        expect(run.stderr).toContain("1 occurrence(s)");
        expect(run.stderr).toContain("U+2014 EM DASH found in");
      });
    },
    CASE_TIMEOUT,
  );

  it(
    "3. counts OCCURRENCES, not lines: two on one line is two",
    () => {
      const files = baseFiles();
      files["README.md"] = `# Sample\n\nOne ${BANNED} two ${BANNED} three.\n`;
      withRepo(files, (fx) => {
        const run = runGate(fx.root);
        expect(run.status).toBe(1);
        expect(run.stderr).toContain("2 occurrence(s)");
      });
    },
    CASE_TIMEOUT,
  );

  it(
    "4. does NOT ban the en dash: the directive names one character",
    () => {
      const files = baseFiles();
      files["README.md"] = `# Sample\n\nA range 6${EN_DASH}7 stays.\n`;
      withRepo(files, (fx) => {
        const run = runGate(fx.root);
        expect(run.stderr).toBe("");
        expect(run.status).toBe(0);
      });
    },
    CASE_TIMEOUT,
  );

  it(
    "5. the fixture rule, in BOTH directions: excluded under the prefix, caught one directory away",
    () => {
      const excluded = baseFiles();
      excluded["test/fixtures/sample.hl7"] = `MSH|^~\\&|A ${BANNED} B\n`;
      withRepo(excluded, (fx) => {
        const run = runGate(fx.root);
        expect(run.stderr).toBe("");
        expect(run.status).toBe(0);
      });

      const caught = baseFiles();
      caught["test/helpers/sample.ts"] = `export const note = "A ${BANNED} B";\n`;
      withRepo(caught, (fx) => {
        const run = runGate(fx.root);
        expect(run.status).toBe(1);
        expect(run.stderr).toContain("./test/helpers/sample.ts:1:");
      });
    },
    CASE_TIMEOUT,
  );

  it(
    "6. the vendored-tarball rule: bytes under vendor/ are out of scope",
    () => {
      const files = baseFiles();
      files["vendor/upstream.tgz"] = `compressed ${BANNED} bytes\n`;
      withRepo(files, (fx) => {
        const run = runGate(fx.root);
        expect(run.stderr).toBe("");
        expect(run.status).toBe(0);
      });
    },
    CASE_TIMEOUT,
  );

  it(
    "7. a stale exclusion REFUSES rather than silently covering nothing",
    () => {
      const files = baseFiles();
      delete files["vendor/upstream.tgz"];
      withRepo(files, (fx) => {
        const run = runGate(fx.root);
        expect(run.status).toBe(1);
        expect(run.stderr).toContain("matches no tracked file");
        expect(run.stderr).toContain("vendor/");
      });
    },
    CASE_TIMEOUT,
  );

  it(
    "8. the changelog region rule, in BOTH directions",
    () => {
      const above = baseFiles();
      above["CHANGELOG.md"] = [
        "# Changelog",
        "",
        "## 0.0.2",
        "",
        `- A change ${BANNED} here.`,
        "",
        ARCHIVE_HEADING,
        "",
        "## 0.0.1",
        "",
      ].join("\n");
      withRepo(above, (fx) => {
        const run = runGate(fx.root);
        expect(run.status).toBe(1);
        expect(run.stderr).toContain("CHANGELOG.md:5:");
      });

      const below = baseFiles();
      below["CHANGELOG.md"] = [
        "# Changelog",
        "",
        "## 0.0.2",
        "",
        "- A change.",
        "",
        ARCHIVE_HEADING,
        "",
        `- Published ${BANNED} already.`,
        "",
      ].join("\n");
      withRepo(below, (fx) => {
        const run = runGate(fx.root);
        expect(run.stderr).toBe("");
        expect(run.status).toBe(0);
      });
    },
    CASE_TIMEOUT,
  );

  it(
    "9. a missing archive divider REFUSES rather than guessing a boundary",
    () => {
      const files = baseFiles();
      files["CHANGELOG.md"] = "# Changelog\n\n## 0.0.2\n\n- A change.\n";
      withRepo(files, (fx) => {
        const run = runGate(fx.root);
        expect(run.status).toBe(1);
        expect(run.stderr).toContain("archive divider is missing");
      });
    },
    CASE_TIMEOUT,
  );

  it(
    "10. the corpus is the INDEX: an unstaged file is not scanned, and this is the stated limit",
    () => {
      withRepo(baseFiles(), (fx) => {
        fx.write("NOTES.md", `Unstaged ${BANNED} text.\n`);
        expect(runGate(fx.root).status).toBe(0);
        fx.git("add", "-A");
        const run = runGate(fx.root);
        expect(run.status).toBe(1);
        expect(run.stderr).toContain("./NOTES.md:1:");
      });
    },
    CASE_TIMEOUT,
  );
});

// ---------------------------------------------------------------------------

/** A repository with a base commit and a head commit, which is what a pull request range needs. */
function makeRangeRepo(headMessage: string): Fixture & { base: string; head: string } {
  const fx = makeRepo(baseFiles());
  fx.git("commit", "-q", "-m", "base");
  const base = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: fx.root,
    encoding: "utf8",
  }).stdout.trim();
  fx.write("README.md", "# Sample\n\nA second revision.\n");
  fx.git("add", "-A");
  fx.git("commit", "-q", "-m", headMessage);
  const head = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: fx.root,
    encoding: "utf8",
  }).stdout.trim();
  return { ...fx, base, head };
}

function messageEnv(
  fx: { base: string; head: string },
  title: string,
  body: string,
): NodeJS.ProcessEnv {
  return { PR_TITLE: title, PR_BODY: body, PR_BASE_SHA: fx.base, PR_HEAD_SHA: fx.head };
}

describe("check-no-emdash: the message scan", () => {
  it(
    "11. reaches the title, the body and every commit message, and a clean pull request is green",
    () => {
      const clean = makeRangeRepo("An ordinary commit subject");
      try {
        const ok = runGate(
          clean.root,
          ["--messages"],
          messageEnv(clean, "A clean title", "A clean body."),
        );
        expect(ok.stderr).toBe("");
        expect(ok.status).toBe(0);
        expect(ok.stdout).toContain("1 commit message(s) scanned");

        const badTitle = runGate(
          clean.root,
          ["--messages"],
          messageEnv(clean, `Bad ${BANNED} title`, "Body."),
        );
        expect(badTitle.status).toBe(1);
        expect(badTitle.stderr).toContain("pull request title:1:");

        const badBody = runGate(
          clean.root,
          ["--messages"],
          messageEnv(clean, "Title", `Bad ${BANNED} body.`),
        );
        expect(badBody.status).toBe(1);
        expect(badBody.stderr).toContain("pull request body:1:");

        const emptyBody = runGate(clean.root, ["--messages"], messageEnv(clean, "Title", ""));
        expect(emptyBody.status).toBe(0);
        expect(emptyBody.stdout).toContain("body empty");
      } finally {
        clean.cleanup();
      }

      const dirty = makeRangeRepo(`A commit ${BANNED} subject`);
      try {
        const run = runGate(dirty.root, ["--messages"], messageEnv(dirty, "Title", "Body."));
        expect(run.status).toBe(1);
        expect(run.stderr).toContain(`commit ${dirty.head}:1:`);
      } finally {
        dirty.cleanup();
      }
    },
    CASE_TIMEOUT,
  );

  it(
    "12. REFUSES a range it cannot read, in all three shapes, rather than reporting clean",
    () => {
      const fx = makeRangeRepo("An ordinary commit subject");
      try {
        const noBase = runGate(fx.root, ["--messages"], {
          ...messageEnv(fx, "T", "B"),
          PR_BASE_SHA: "",
        });
        expect(noBase.status).toBe(1);
        expect(noBase.stderr).toContain("PR_BASE_SHA is empty");

        const absent = runGate(fx.root, ["--messages"], {
          ...messageEnv(fx, "T", "B"),
          PR_BASE_SHA: "0".repeat(39) + "1",
        });
        expect(absent.status).toBe(1);
        expect(absent.stderr).toContain("is not present in this clone");
        expect(absent.stderr).toContain("fetch-depth: 0");

        const empty = runGate(fx.root, ["--messages"], {
          ...messageEnv(fx, "T", "B"),
          PR_BASE_SHA: fx.head,
        });
        expect(empty.status).toBe(1);
        expect(empty.stderr).toContain("ZERO commits");

        // A GENUINELY SHALLOW CLONE, not a simulated one. This is the shape CI actually produces:
        // `actions/checkout` is shallow by default, the base commit is simply absent, and
        // `git log base..head` over it reports nothing at all.
        const shallowRoot = mkdtempSync(join(tmpdir(), "deid-no-emdash-shallow-"));
        try {
          const cloned = spawnSync(
            "git",
            ["clone", "-q", "--depth", "1", `file://${fx.root}`, shallowRoot],
            { encoding: "utf8" },
          );
          expect(cloned.status).toBe(0);
          const run = runGate(shallowRoot, ["--messages"], messageEnv(fx, "T", "B"));
          expect(run.status).toBe(1);
          expect(run.stderr).toContain("SHALLOW");
          expect(run.stderr).toContain("must not read as an absence of findings");
        } finally {
          rmSync(shallowRoot, { recursive: true, force: true });
        }
      } finally {
        fx.cleanup();
      }
    },
    CASE_TIMEOUT,
  );

  it(
    "13. treats pull-request text as DATA: shell metacharacters are scanned, never executed",
    () => {
      const fx = makeRangeRepo("An ordinary commit subject");
      try {
        const marker = join(fx.root, "pwned.txt");
        const hostile = `$(touch ${marker}); \`touch ${marker}\`; $IFS; ' " | & ; > <`;

        const clean = runGate(fx.root, ["--messages"], messageEnv(fx, hostile, hostile));
        expect(clean.status).toBe(0);
        expect(existsSync(marker)).toBe(false);

        const offending = runGate(
          fx.root,
          ["--messages"],
          messageEnv(fx, `${hostile} ${BANNED}`, "Body."),
        );
        expect(offending.status).toBe(1);
        expect(offending.stderr).toContain("pull request title:1:");
        expect(offending.stderr).toContain("$(touch");
        expect(existsSync(marker)).toBe(false);
      } finally {
        fx.cleanup();
      }
    },
    CASE_TIMEOUT,
  );

  it(
    "14. the standard-input mode refuses empty input and reports its label",
    () => {
      withRepo(baseFiles(), (fx) => {
        const empty = spawnSync("bash", [GATE, "--stdin", "a label"], {
          cwd: fx.root,
          encoding: "utf8",
          input: "",
        });
        expect(empty.status).toBe(1);
        expect(empty.stderr).toContain("nothing arrived on standard input");

        const dirty = spawnSync("bash", [GATE, "--stdin", "a label"], {
          cwd: fx.root,
          encoding: "utf8",
          input: `first line\nsecond ${BANNED} line\n`,
        });
        expect(dirty.status).toBe(1);
        expect(dirty.stderr).toContain("a label:2:");

        const ok = spawnSync("bash", [GATE, "--stdin", "a label"], {
          cwd: fx.root,
          encoding: "utf8",
          input: "first line\nsecond line\n",
        });
        expect(ok.status).toBe(0);
        expect(ok.stdout).toContain("a label: 2 line(s) scanned");
      });
    },
    CASE_TIMEOUT,
  );
});

// ---------------------------------------------------------------------------

describe("check-no-emdash: this repository's own tree and wiring", () => {
  it(
    "15. the real tree is green, and the OK line reports a non-zero scanned count",
    () => {
      const run = runGate(REPO_ROOT);
      expect(run.stderr).toBe("");
      expect(run.status).toBe(0);
      expect(run.stdout).toMatch(/OK \((?!0 )\d+ tracked file\(s\) scanned/);
    },
    CASE_TIMEOUT,
  );

  it(
    "16. neither half of the gate can be made unfailable",
    () => {
      // THE WORKFLOW CARRIES NEITHER STRING AT ALL, banner prose included. That is deliberate and
      // it is why the banner describes the property in words instead of quoting the spellings: a
      // reviewer's `rg` over this file should come back empty, and a mention in a comment would
      // make an honest file look like a compromised one.
      const workflow = readFileSync(
        join(REPO_ROOT, ".github", "workflows", "no-emdash.yml"),
        "utf8",
      );
      expect(workflow).not.toMatch(/continue-on-error/);
      expect(workflow).not.toMatch(/\|\|\s*true/);

      // The checker absorbs grep's "no match" status in two places, because grep exits 1 on a CLEAN
      // input and `set -e` would kill the script there. Neither can turn a hit into a pass: the
      // real signal is the captured stderr and the emptiness of the hit list. Assert the PAIRING
      // with the refusal rather than the absence of the idiom, so the guard cannot be deleted while
      // the idiom stays behind.
      const checker = readFileSync(GATE, "utf8");
      expect(checker).not.toMatch(/continue-on-error/);
      const absorbed = checker.match(/\|\| true\)$/gm)?.length ?? 0;
      expect(absorbed).toBe(4);
      expect(checker.match(/^ {2}refuse_if_incomplete$/gm)?.length ?? 0).toBeGreaterThanOrEqual(
        absorbed,
      );
    },
    CASE_TIMEOUT,
  );
});
