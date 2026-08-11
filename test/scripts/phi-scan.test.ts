/**
 * Unit tests for scripts/phi-scan.ts: the STARTER PHI commit-gate.
 *
 * These exercise the SHARED MACHINERY, the cross-cutting SSN/email FLOOR, and the
 * four structured detectors this repo added on top of it (HL7 v2, C-CDA, X12,
 * NCPDP Telecom), each with a positive case proving it CATCHES a real-looking
 * name / DOB / id, and a negative one proving it does not scrub legitimate
 * clinical content. A weak scanner is worse than none, so a new detector without
 * a positive case here is not finished. (This header used to say the opposite,
 * having been left behind by the detectors that landed under it.)
 *
 * ▶ THIS FILE IS THE ONE PATH `pnpm phi-scan` DOES NOT READ, and it has to be:
 * its positive cases ARE real-looking violator literals, so a suite that could
 * pass its own scan would be asserting nothing. The bypass needs BOTH the
 * `--allow-fixture` in package.json's `phi-scan` script and the entry in
 * phi-scan-overrides.md; the last describe block pins both.
 *
 * The scanner is invoked via spawnSync (array args, no shell) so the full CLI
 * path (argv parse, exit code, stderr) is exercised. Violator/clean files are
 * written to a throwaway temp dir so they never pollute the committed corpus.
 *
 * SECURITY: every subprocess call here uses spawnSync with array args. No exec,
 * no shell-form.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import {
  readFileSync,
  writeFileSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
  copyFileSync,
  symlinkSync,
  realpathSync,
  chmodSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const REPO_ROOT = process.cwd();
const SCANNER_PATH = join(REPO_ROOT, "scripts", "phi-scan.ts");
const TSX_BIN = join(REPO_ROOT, "node_modules", ".bin", "tsx");

let dir: string;

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

function runScanner(args: string[]): RunResult {
  const r = spawnSync(TSX_BIN, [SCANNER_PATH, ...args], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    shell: false,
  });
  return { code: r.status ?? -1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

/** Write a file to the temp dir and scan it by path (paths mode, no git needed). */
function scan(name: string, content: string): RunResult {
  const path = join(dir, name);
  writeFileSync(path, content);
  return runScanner([path]);
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "phi-scan-"));
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("phi-scan starter: the cross-cutting floor catches SSN + email", () => {
  it("catches a dashed SSN (exit 1)", () => {
    const r = scan("ssn.txt", "patient ssn 123-45-6789 on file\n");
    expect(r.code, `stderr: ${r.stderr}`).toBe(1);
    expect(r.stderr).toMatch(/123-45-6789/);
    expect(r.stderr).toMatch(/dashed SSN/);
  });

  it("catches an email at a non-test domain (exit 1)", () => {
    const r = scan("email.txt", "contact jane.doe@hospital.org for records\n");
    expect(r.code, `stderr: ${r.stderr}`).toBe(1);
    expect(r.stderr).toMatch(/jane\.doe@hospital\.org/);
    expect(r.stderr).toMatch(/non-test domain/);
  });
});

describe("phi-scan starter: clean + allow-listed content passes", () => {
  it("a clean file with no PHI shapes exits 0", () => {
    const r = scan("clean.txt", "just some ordinary text, no identifiers here\n");
    expect(r.code, `stderr: ${r.stderr}`).toBe(0);
    expect(r.stdout).toMatch(/OK, no hits/);
  });

  it("honors the allow-list: an email at a reserved test domain passes (exit 0)", () => {
    const r = scan("allowed-email.txt", "reach the team at hello@example.com anytime\n");
    expect(r.code, `stderr: ${r.stderr}`).toBe(0);
  });
});

describe("phi-scan deid gate: HL7 v2 structured field-level detection", () => {
  it("catches a real-looking name / DOB / MRN in PID fields not declared synthetic (exit 1)", () => {
    const r = scan(
      "real.hl7",
      "MSH|^~\\&|A|B|C|D|20200101||ADT^A01|M1|P|2.5\nPID|1||REALMRN99^^^H^MR||SMITH^JOHN||19800101\n",
    );
    expect(r.code, `stderr: ${r.stderr}`).toBe(1);
    expect(r.stderr).toMatch(/PID-5\.1 value="SMITH"/);
    expect(r.stderr).toMatch(/PID-7\.1 value="19800101"/);
    expect(r.stderr).toMatch(/PID-3\.1 value="REALMRN99"/);
    expect(r.stderr).toMatch(/not declared synthetic/);
  });

  it("catches a relative's name in an NK1 field (relatives are in scope)", () => {
    const r = scan(
      "nk1.hl7",
      "MSH|^~\\&|A|B|C|D|20200101||ADT^A01|M1|P|2.5\rNK1|1|JONES^MARY|SPO\r",
    );
    expect(r.code, `stderr: ${r.stderr}`).toBe(1);
    expect(r.stderr).toMatch(/NK1-2\.1 value="JONES"/);
  });

  it("passes an all-synthetic HL7 message whose tokens are allow-listed (exit 0)", () => {
    const r = scan(
      "synthetic.hl7",
      "MSH|^~\\&|A|B|C|D|20200101||ADT^A01|M1|P|2.5\rPID|1||ZZMRN001^^^H^MR||ZZFAMILY^ZZGIVEN||19900215\r",
    );
    expect(r.code, `stderr: ${r.stderr}`).toBe(0);
  });
});

describe("phi-scan deid gate: C-CDA structured header detection", () => {
  it("catches a real-looking name / DOB in a C-CDA header not declared synthetic (exit 1)", () => {
    const r = scan(
      "real.xml",
      '<ClinicalDocument xmlns="urn:hl7-org:v3"><recordTarget><patientRole><patient>' +
        '<name><given>John</given><family>Smith</family></name><birthTime value="19800101"/>' +
        "</patient></patientRole></recordTarget></ClinicalDocument>\n",
    );
    expect(r.code, `stderr: ${r.stderr}`).toBe(1);
    expect(r.stderr).toMatch(/<given> value="John"/);
    expect(r.stderr).toMatch(/<family> value="Smith"/);
    expect(r.stderr).toMatch(/birthTime@value value="19800101"/);
  });

  it("does not flag a clinical-body <name> (a drug/material name, not a person)", () => {
    const r = scan(
      "drug.xml",
      '<ClinicalDocument xmlns="urn:hl7-org:v3"><component><structuredBody><section>' +
        "<manufacturedMaterial><name>Lisinopril</name></manufacturedMaterial>" +
        "</section></structuredBody></component></ClinicalDocument>\n",
    );
    expect(r.code, `stderr: ${r.stderr}`).toBe(0);
  });

  it("passes an all-synthetic C-CDA header whose tokens are allow-listed (exit 0)", () => {
    const r = scan(
      "synthetic.xml",
      '<ClinicalDocument xmlns="urn:hl7-org:v3"><recordTarget><patientRole><patient>' +
        '<name><given>ZZPATGIVEN</given><family>ZZPATFAMILY</family></name><birthTime value="19900215"/>' +
        "</patient></patientRole></recordTarget></ClinicalDocument>\n",
    );
    expect(r.code, `stderr: ${r.stderr}`).toBe(0);
  });
});

// A valid 106-byte ISA header (element sep `*`, component `:`, segment terminator `~`) for X12 tests.
const ISA =
  "ISA*00*          *00*          *ZZ*A              *ZZ*B              *260615*0930*^*00501*000000002*0*P*:~";
// NCPDP Telecom control-char framing.
const FS = "\x1c";
const RS = "\x1e";

describe("phi-scan deid gate: X12 structured element-level detection", () => {
  it("catches a real-looking patient NM1 name / id, DMG DOB, and REF SSN (exit 1)", () => {
    const body =
      "GS*HC*A*B*20260615*0930*2*X*005010X222A2~ST*837*0002~" +
      "NM1*IL*1*SMITH*JOHN****MI*REALMEMBER9~DMG*D8*19800101*M~REF*SY*123456789~" +
      "SE*4*0002~GE*1*2~IEA*1*000000002~";
    const r = scan("real.edi", ISA + body);
    expect(r.code, `stderr: ${r.stderr}`).toBe(1);
    expect(r.stderr).toMatch(/NM1-03 value="SMITH"/);
    expect(r.stderr).toMatch(/NM1-09 value="REALMEMBER9"/);
    expect(r.stderr).toMatch(/DMG-02 value="19800101"/);
    expect(r.stderr).toMatch(/REF-02 value="123456789"/);
  });

  it("does NOT flag a provider-entity NM1 name (retained, not the individual's PHI)", () => {
    const body =
      "GS*HC*A*B*20260615*0930*2*X*005010X222A2~ST*837*0002~" +
      "NM1*85*2*BILLING PROVIDER LLC*****XX*1999999999~SE*3*0002~GE*1*2~IEA*1*000000002~";
    const r = scan("provider.edi", ISA + body);
    expect(r.code, `stderr: ${r.stderr}`).toBe(0);
  });

  it("passes an all-synthetic X12 interchange whose tokens are allow-listed (exit 0)", () => {
    const body =
      "GS*HC*A*B*20260615*0930*2*X*005010X222A2~ST*837*0002~" +
      "NM1*IL*1*ZZSUBLAST*ZZSUBFIRST****MI*ZZMEMBERX12~DMG*D8*19850302*M~REF*SY*900000201~" +
      "SE*4*0002~GE*1*2~IEA*1*000000002~";
    const r = scan("synthetic.edi", ISA + body);
    expect(r.code, `stderr: ${r.stderr}`).toBe(0);
  });
});

describe("phi-scan deid gate: NCPDP Telecom structured field-id detection", () => {
  it("catches a real-looking patient name / DOB / id in Telecom PHI fields (exit 1)", () => {
    const header = "999999D0B1".padEnd(56, " ");
    const body = `AM01${FS}CBSMITH${FS}CAJOHN${FS}C419800101${FS}CYREALPTID9`;
    const r = scan("real.ncpdp", header + RS + body);
    expect(r.code, `stderr: ${r.stderr}`).toBe(1);
    expect(r.stderr).toMatch(/segment=CB value="SMITH"/);
    expect(r.stderr).toMatch(/segment=C4 value="19800101"/);
  });

  it("does NOT flag a clinical NDC / quantity field (over-scrub guard)", () => {
    const header = "999999D0B1".padEnd(56, " ");
    const body = `AM07${FS}D700071015527${FS}E730000`;
    const r = scan("clinical.ncpdp", header + RS + body);
    expect(r.code, `stderr: ${r.stderr}`).toBe(0);
  });
});

describe("phi-scan starter: the override-log gate", () => {
  it("rejects --allow-fixture without a matching override entry (exit 2)", () => {
    const clean = join(dir, "override-me.txt");
    writeFileSync(clean, "nothing to see\n");
    const r = runScanner(["--allow-fixture", clean]);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/phi-scan-overrides\.md/);
  });
});

// ---------------------------------------------------------------------------
// Entries that are not regular files, on BOTH enumerating routes
// ---------------------------------------------------------------------------
//
// The walk enumerates `Dirent.isFile()`, an lstat answer, so a symbolic link is
// neither a file nor a directory; `--staged` reads content with
// `git show :<path>`, and git stores a link as its TARGET PATH under mode
// 120000. A link under a scan root pointing at a PHI-bearing file therefore used
// to scan CLEAN on both: in the package whose whole job is removing PHI. These
// cases pin the refusal on each route, the negative controls that keep ordinary
// files scanned on each route, and the rule that a refusal never echoes what is
// on the other side of the link.
//
// Every case runs against a THROWAWAY GIT REPOSITORY, never against this one:
// the scanner roots everything at `process.cwd()`, so a synthetic tree is enough
// and no link or violator is ever written into the committed corpus.

/**
 * Synthetic, name-bearing payload. A payload with no name proves nothing about a
 * claim that names do not leak, so this one carries a person name, a DOB, an MRN,
 * an SSN shape and an email, in a shape this repo's own structured HL7 detector
 * reads. Every value is invented.
 */
const SYNTHETIC_PHI =
  [
    "MSH|^~\\&|A|B|C|D|20200101||ADT^A01|M1|P|2.5",
    "PID|1||REALMRN99^^^H^MR||RIVERA^JUANITA^Q||19780314|F|||||||||||123-45-6789",
    "NTE|1||contact juanita.rivera@example-hospital.org",
  ].join("\n") + "\n";

/** The link target's own name carries a synthetic name, so an echo of it is visible. */
const TARGET_NAME = "RIVERA-JUANITA-1978-03-14.txt";

/** Tokens that must never appear in a refusal message. */
const PHI_TOKENS = [
  "RIVERA",
  "JUANITA",
  "19780314",
  "1978-03-14",
  "REALMRN99",
  "123-45-6789",
  "juanita.rivera@example-hospital.org",
  TARGET_NAME,
];

function expectNoPhi(stderr: string): void {
  for (const t of PHI_TOKENS) expect(stderr).not.toContain(t);
}

function git(cwd: string, args: string[]): void {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", shell: false });
  if ((r.status ?? -1) !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
}

function gitOut(cwd: string, args: string[]): string {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", shell: false });
  return r.stdout ?? "";
}

function runIn(cwd: string, args: string[]): RunResult {
  const r = spawnSync(TSX_BIN, [SCANNER_PATH, ...args], { cwd, encoding: "utf8", shell: false });
  return { code: r.status ?? -1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

const repos: string[] = [];

/** Stage everything and commit it, so the repo has a populated index. */
function commitAll(root: string, message: string): void {
  git(root, ["add", "-A"]);
  git(root, ["commit", "-q", "-m", message]);
}

/**
 * A throwaway git repo laid out the way the scanner expects: an allow-list under
 * `scripts/`, every scan root, and one ordinary source file so the walk has
 * something legitimate to find.
 *
 * ▶ THE BASELINE IS COMMITTED, AND THAT IS A PRECONDITION RATHER THAN TIDINESS.
 * All mode now reads the bytes git carries as well as the working tree, and it
 * REFUSES an empty index (exit 2) because zero tracked entries is not a clean
 * corpus, it is no corpus. This helper used to `git init` and stop, so every
 * all-mode case below ran against an index holding nothing. Committing here
 * also means each case exercises BOTH routes rather than the walk alone: a file
 * a case then writes without staging is untracked and read by the walk, exactly
 * as before, while the baseline is read by both and skipped by byte comparison.
 */
function makeRepo(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "phi-scan-repo-")));
  repos.push(root);
  mkdirSync(join(root, "scripts"));
  mkdirSync(join(root, "src"));
  mkdirSync(join(root, "test", "fixtures"), { recursive: true });
  copyFileSync(
    join(REPO_ROOT, "scripts", "phi-allow-list.txt"),
    join(root, "scripts", "phi-allow-list.txt"),
  );
  writeFileSync(join(root, "src", "ordinary.ts"), "export const answer = 42;\n");
  git(root, ["init", "-q", "."]);
  // Set locally rather than relying on the ambient config, which CI may not have,
  // and disable signing so a developer's global `commit.gpgsign` cannot fail the
  // suite on a machine with no key loaded.
  git(root, ["config", "user.email", "phi-scan-test@example.com"]);
  git(root, ["config", "user.name", "phi-scan test"]);
  git(root, ["config", "commit.gpgsign", "false"]);
  commitAll(root, "baseline");
  return root;
}

afterAll(() => {
  for (const r of repos) rmSync(r, { recursive: true, force: true });
});

describe("phi-scan: the scanner under test, and the payload, are what this file claims", () => {
  it("is THIS package's scanner, not a sibling's", () => {
    // A negative control on the fixture wiring itself: every case below asserts
    // behaviour of `scripts/phi-scan.ts` as resolved from `process.cwd()`, so if
    // the suite were ever pointed at another repo's tree the assertions would
    // still be about a real scanner and would still pass.
    const manifest: unknown = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8"));
    const name =
      typeof manifest === "object" && manifest !== null && "name" in manifest
        ? manifest.name
        : undefined;
    expect(name).toBe("@cosyte/deid");
    expect(name).not.toBe("@cosyte/terminology");
    expect(readFileSync(SCANNER_PATH, "utf8")).toContain("`@cosyte/deid` PHI scanner");
  });

  it("as a plain regular file the payload is a hit, on the floor AND the structured detector", () => {
    // Guards against proving nothing by fixture: every refusal case below rests
    // on this payload being something the scan would otherwise catch.
    const root = makeRepo();
    writeFileSync(join(root, "src", "violator.ts"), SYNTHETIC_PHI);
    const r = runIn(root, []);
    expect(r.code, `stderr: ${r.stderr}`).toBe(1);
    expect(r.stderr).toContain("123-45-6789");
    expect(r.stderr).toContain("juanita.rivera@example-hospital.org");
    expect(r.stderr).toMatch(/PID-5\.1 value="RIVERA"/);
    expect(r.stderr).toMatch(/PID-7\.1 value="19780314"/);
  });

  it("a repo with no link and no violator scans clean (exit 0)", () => {
    const root = makeRepo();
    const r = runIn(root, []);
    expect(r.code, `stderr: ${r.stderr}`).toBe(0);
    expect(r.stdout).toMatch(/OK, no hits/);
  });
});

describe("phi-scan: the all-mode walk refuses a non-regular entry", () => {
  it("refuses a symlink under a walk root pointing at PHI (exit 2), and reports no PHI", () => {
    const root = makeRepo();
    writeFileSync(join(root, TARGET_NAME), SYNTHETIC_PHI);
    symlinkSync(join("..", TARGET_NAME), join(root, "src", "leak.ts"));

    const r = runIn(root, []);
    expect(r.code, `stderr: ${r.stderr}`).toBe(2);
    expect(r.stderr).toContain("src/leak.ts");
    expect(r.stderr).toContain("a symbolic link");
    expectNoPhi(r.stderr);
    expect(r.stdout).not.toMatch(/OK/);
  });

  it("refuses one under the OTHER walk root, test/fixtures, too", () => {
    const root = makeRepo();
    writeFileSync(join(root, TARGET_NAME), SYNTHETIC_PHI);
    symlinkSync(join("..", "..", TARGET_NAME), join(root, "test", "fixtures", "leak.hl7"));

    const r = runIn(root, []);
    expect(r.code, `stderr: ${r.stderr}`).toBe(2);
    expect(r.stderr).toContain("test/fixtures/leak.hl7");
    expectNoPhi(r.stderr);
  });

  it("refuses a symlinked DIRECTORY too, which isDirectory() also answers false for", () => {
    const root = makeRepo();
    mkdirSync(join(root, "elsewhere"));
    writeFileSync(join(root, "elsewhere", TARGET_NAME), SYNTHETIC_PHI);
    symlinkSync(join("..", "elsewhere"), join(root, "src", "linked-dir"));

    const r = runIn(root, []);
    expect(r.code, `stderr: ${r.stderr}`).toBe(2);
    expect(r.stderr).toContain("src/linked-dir");
    expectNoPhi(r.stderr);
  });

  it("names EVERY offender, not just the first", () => {
    const root = makeRepo();
    writeFileSync(join(root, TARGET_NAME), SYNTHETIC_PHI);
    symlinkSync(join("..", TARGET_NAME), join(root, "src", "one.ts"));
    symlinkSync(join("..", TARGET_NAME), join(root, "src", "two.ts"));

    const r = runIn(root, []);
    expect(r.code, `stderr: ${r.stderr}`).toBe(2);
    expect(r.stderr).toContain("src/one.ts");
    expect(r.stderr).toContain("src/two.ts");
    expect(r.stderr).toContain("2 entries");
    expectNoPhi(r.stderr);
  });

  it("an ignored link is out of scope, by the same rule that already excludes an ignored file", () => {
    const root = makeRepo();
    writeFileSync(join(root, TARGET_NAME), SYNTHETIC_PHI);
    symlinkSync(join("..", TARGET_NAME), join(root, "src", "leak.ts"));
    writeFileSync(join(root, ".gitignore"), "src/leak.ts\n");

    const r = runIn(root, []);
    expect(r.code, `stderr: ${r.stderr}`).toBe(0);
  });

  it("but an entry already in the index cannot be excused that way", () => {
    const root = makeRepo();
    writeFileSync(join(root, TARGET_NAME), SYNTHETIC_PHI);
    symlinkSync(join("..", TARGET_NAME), join(root, "src", "leak.ts"));
    writeFileSync(join(root, ".gitignore"), "src/leak.ts\n");
    git(root, ["add", "-f", "src/leak.ts"]);

    const r = runIn(root, []);
    expect(r.code, `stderr: ${r.stderr}`).toBe(2);
    expect(r.stderr).toContain("src/leak.ts");
  });
});

describe("phi-scan: the --staged route refuses a staged non-regular entry", () => {
  it("git really does store the link as its target path, not the target's bytes", () => {
    // The measurement the refusal rests on. If git ever changed this, the
    // refusal below would be arguing from a premise that no longer holds.
    const root = makeRepo();
    writeFileSync(join(root, TARGET_NAME), SYNTHETIC_PHI);
    symlinkSync(join("..", TARGET_NAME), join(root, "src", "leak.ts"));
    git(root, ["add", "src/leak.ts"]);

    expect(gitOut(root, ["ls-files", "--stage", "src/leak.ts"])).toMatch(/^120000 /);
    const shown = gitOut(root, ["show", ":src/leak.ts"]);
    expect(shown.trim()).toBe(`../${TARGET_NAME}`);
    expect(shown).not.toContain("123-45-6789");
  });

  it("refuses a staged symlink (exit 2), and reports no PHI", () => {
    const root = makeRepo();
    writeFileSync(join(root, TARGET_NAME), SYNTHETIC_PHI);
    symlinkSync(join("..", TARGET_NAME), join(root, "src", "leak.ts"));
    git(root, ["add", "src/leak.ts"]);

    const r = runIn(root, ["--staged"]);
    expect(r.code, `stderr: ${r.stderr}`).toBe(2);
    expect(r.stderr).toContain("src/leak.ts");
    expect(r.stderr).toContain("a symbolic link");
    expectNoPhi(r.stderr);
  });

  it("refuses a TYPECHANGE, a tracked regular file replaced by a link (exit 2)", () => {
    // The shape `--diff-filter=AM` used to delete before any mode could be read.
    // Replacing a TRACKED file with a link is neither an add nor a modify: git
    // raises `:100644 120000 <sha> <sha> T`, and without `T` in the filter the
    // record never existed, so the pre-commit hook passed the link green.
    // `src/ordinary.ts` is already TRACKED: `makeRepo` commits its baseline, which
    // is what makes the replacement below a typechange rather than an add.
    const root = makeRepo();

    writeFileSync(join(root, TARGET_NAME), SYNTHETIC_PHI);
    rmSync(join(root, "src", "ordinary.ts"));
    symlinkSync(join("..", TARGET_NAME), join(root, "src", "ordinary.ts"));
    git(root, ["add", "src/ordinary.ts"]);

    // The premise: git really does raise this as a typechange, not A or M.
    expect(gitOut(root, ["diff", "--cached", "--raw", "--diff-filter=AM"]).trim()).toBe("");
    expect(gitOut(root, ["diff", "--cached", "--raw"])).toContain(" 120000 ");

    const r = runIn(root, ["--staged"]);
    expect(r.code, `stderr: ${r.stderr}`).toBe(2);
    expect(r.stderr).toContain("src/ordinary.ts");
    expect(r.stderr).toContain("a symbolic link");
    expectNoPhi(r.stderr);
  });

  it("scans the other direction of a typechange, a link replaced by a real file (exit 1)", () => {
    const root = makeRepo();
    symlinkSync("ordinary.ts", join(root, "src", "link.ts"));
    git(root, ["add", "src/link.ts"]);
    git(root, ["-c", "user.email=t@example.com", "-c", "user.name=t", "commit", "-qm", "base"]);

    rmSync(join(root, "src", "link.ts"));
    writeFileSync(join(root, "src", "link.ts"), SYNTHETIC_PHI);
    git(root, ["add", "src/link.ts"]);

    const r = runIn(root, ["--staged"]);
    expect(r.code, `stderr: ${r.stderr}`).toBe(1);
    expect(r.stderr).toContain("123-45-6789");
  });

  it("refuses a staged gitlink under a scanned prefix (exit 2)", () => {
    const root = makeRepo();
    const nested = join(root, "test", "fixtures", "nested");
    mkdirSync(nested);
    git(nested, ["init", "-q", "."]);
    writeFileSync(join(nested, "payload.txt"), SYNTHETIC_PHI);
    git(nested, ["add", "payload.txt"]);
    git(nested, ["-c", "user.email=t@example.com", "-c", "user.name=t", "commit", "-qm", "n"]);
    git(root, ["add", "test/fixtures/nested"]);

    const r = runIn(root, ["--staged"]);
    expect(r.code, `stderr: ${r.stderr}`).toBe(2);
    expect(r.stderr).toContain("test/fixtures/nested");
    expect(r.stderr).toContain("a gitlink");
    expectNoPhi(r.stderr);
  });

  it("still catches a staged ORDINARY file carrying the same payload (exit 1)", () => {
    // The regression control on the `--raw -z` reparse: reading the mode must not
    // cost the route the ordinary files it was already enumerating.
    const root = makeRepo();
    writeFileSync(join(root, "src", "violator.ts"), SYNTHETIC_PHI);
    git(root, ["add", "src/violator.ts"]);

    const r = runIn(root, ["--staged"]);
    expect(r.code, `stderr: ${r.stderr}`).toBe(1);
    expect(r.stderr).toContain("src/violator.ts");
    expect(r.stderr).toContain("123-45-6789");
  });

  it("passes a staged ordinary clean file (exit 0)", () => {
    const root = makeRepo();
    git(root, ["add", "src/ordinary.ts"]);
    const r = runIn(root, ["--staged"]);
    expect(r.code, `stderr: ${r.stderr}`).toBe(0);
    expect(r.stdout).toMatch(/OK, no hits/);
  });

  it("a staged link OUTSIDE the route's scope is left alone (the scope is unchanged)", () => {
    // `--staged` only ever covered `test/fixtures/**` and `src/**.ts`. The mode
    // check narrows what that scope admits; it does not widen the scope, and
    // saying otherwise would overstate what this closes.
    const root = makeRepo();
    writeFileSync(join(root, TARGET_NAME), SYNTHETIC_PHI);
    symlinkSync(TARGET_NAME, join(root, "docs-link.txt"));
    git(root, ["add", "docs-link.txt"]);

    const r = runIn(root, ["--staged"]);
    expect(r.code, `stderr: ${r.stderr}`).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// The SCAN ROOTS, on both enumerating routes
// ---------------------------------------------------------------------------
//
// The refusal cases above NARROWED what the existing roots admit. These cover
// the other half: what the roots ARE. Both routes used to stop short of `test/`
// itself (the walk covered `test/fixtures/` + `src/`, `--staged` covered
// `test/fixtures/**` + `src/**.ts`), and this repo keeps its document text
// INLINE IN `.ts` TEST MODULES, so 38 tracked files under `test/` were
// enumerated by neither. Every case here is red on that enumeration.

/** The escaped, single-line shape a `.ts` module actually embeds HL7 in. */
const INLINE_HL7 =
  'export const message =\n  "MSH|^~\\\\&|A|B|C|D|20200101||ADT^A01|M1|P|2.5' +
  '\\rPID|1||REALMRN99^^^H^MR||RIVERA^JUANITA||19780314";\n';

describe("phi-scan: the all-mode walk covers src/, test/ and scripts/", () => {
  it("catches a violator in a test MODULE, not just under test/fixtures/", () => {
    const root = makeRepo();
    mkdirSync(join(root, "test", "hl7"), { recursive: true });
    writeFileSync(join(root, "test", "hl7", "deidentify.test.ts"), SYNTHETIC_PHI);

    const r = runIn(root, []);
    expect(r.code, `stderr: ${r.stderr}`).toBe(1);
    expect(r.stderr).toContain("test/hl7/deidentify.test.ts");
    expect(r.stderr).toContain("123-45-6789");
  });

  it("catches a violator under scripts/, which neither route reached", () => {
    const root = makeRepo();
    writeFileSync(join(root, "scripts", "seed.txt"), SYNTHETIC_PHI);

    const r = runIn(root, []);
    expect(r.code, `stderr: ${r.stderr}`).toBe(1);
    expect(r.stderr).toContain("scripts/seed.txt");
  });

  it("still covers src/ and test/fixtures/, the two roots it started from", () => {
    for (const rel of [
      ["src", "leak.ts"],
      ["test", "fixtures", "leak.hl7"],
    ]) {
      const root = makeRepo();
      writeFileSync(join(root, ...rel), SYNTHETIC_PHI);
      const r = runIn(root, []);
      expect(r.code, `stderr: ${r.stderr}`).toBe(1);
      expect(r.stderr).toContain(rel.join("/"));
    }
  });

  it("does NOT reach outside those roots, the residual, pinned rather than implied", () => {
    // `.github/`, `docs-content/`, `vendor/` and the root-level manifests are not
    // claimed covered. If a later change widens to the repo root, this is the
    // case that should be REWRITTEN, not deleted quietly.
    const root = makeRepo();
    mkdirSync(join(root, "docs-content"));
    writeFileSync(join(root, "docs-content", "sidebars.json"), SYNTHETIC_PHI);

    const r = runIn(root, []);
    expect(r.code, `stderr: ${r.stderr}`).toBe(0);
  });

  it("skips .md under a root, documentation may describe violator values", () => {
    const root = makeRepo();
    writeFileSync(join(root, "test", "NOTES.md"), SYNTHETIC_PHI);

    const r = runIn(root, []);
    expect(r.code, `stderr: ${r.stderr}`).toBe(0);
  });
});

describe("phi-scan: --staged is judged against the SAME roots as the walk", () => {
  it("catches a staged test MODULE carrying the payload (exit 1)", () => {
    const root = makeRepo();
    mkdirSync(join(root, "test", "hl7"), { recursive: true });
    writeFileSync(join(root, "test", "hl7", "deidentify.test.ts"), SYNTHETIC_PHI);
    git(root, ["add", "test/hl7/deidentify.test.ts"]);

    const r = runIn(root, ["--staged"]);
    expect(r.code, `stderr: ${r.stderr}`).toBe(1);
    expect(r.stderr).toContain("test/hl7/deidentify.test.ts");
  });

  it("catches a staged scripts/ file, and a staged non-.ts src/ file", () => {
    for (const rel of ["scripts/seed.txt", "src/data.json"]) {
      const root = makeRepo();
      writeFileSync(join(root, rel), SYNTHETIC_PHI);
      git(root, ["add", rel]);
      const r = runIn(root, ["--staged"]);
      expect(r.code, `stderr: ${r.stderr}`).toBe(1);
      expect(r.stderr).toContain(rel);
    }
  });

  it("refuses a staged link under the WIDENED part of the scope, too", () => {
    const root = makeRepo();
    writeFileSync(join(root, TARGET_NAME), SYNTHETIC_PHI);
    symlinkSync(join("..", TARGET_NAME), join(root, "scripts", "leak.txt"));
    git(root, ["add", "scripts/leak.txt"]);

    const r = runIn(root, ["--staged"]);
    expect(r.code, `stderr: ${r.stderr}`).toBe(2);
    expect(r.stderr).toContain("scripts/leak.txt");
    expect(r.stderr).toContain("a symbolic link");
    expectNoPhi(r.stderr);
  });
});

describe("phi-scan: a scan ROOT that is not a directory refuses the sweep", () => {
  it("refuses a root replaced by a symlink (exit 2), naming the root and no target", () => {
    // The root is handed to existsSync/readdirSync directly and is never a
    // Dirent, so the entry-level refusal could not see it: BOTH follow, and the
    // sweep read a tree the repository does not contain.
    const root = makeRepo();
    mkdirSync(join(root, "elsewhere"));
    writeFileSync(join(root, "elsewhere", TARGET_NAME), SYNTHETIC_PHI);
    rmSync(join(root, "test"), { recursive: true });
    symlinkSync("elsewhere", join(root, "test"));

    const r = runIn(root, []);
    expect(r.code, `stderr: ${r.stderr}`).toBe(2);
    expect(r.stderr).toMatch(/refusing the scan/);
    expect(r.stderr).toMatch(/- test \(a symbolic link\)/);
    expectNoPhi(r.stderr);
  });

  it("refuses a root replaced by a regular FILE, and says so in those words", () => {
    const root = makeRepo();
    rmSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "src"), "not a directory\n");

    const r = runIn(root, []);
    expect(r.code, `stderr: ${r.stderr}`).toBe(2);
    expect(r.stderr).toMatch(/- src \(a regular file where a scan root is expected\)/);
  });

  it("a root that is absent is not an error, the scanner is shared across repos", () => {
    const root = makeRepo();
    rmSync(join(root, "test"), { recursive: true });

    const r = runIn(root, []);
    expect(r.code, `stderr: ${r.stderr}`).toBe(0);
  });
});

describe("phi-scan: the source-literal view reaches the inline wire text", () => {
  it("the premise, the bytes on disk carry a backslash, not a carriage return", () => {
    // If this stopped holding, the decode below would be solving a problem that
    // no longer exists, and the structured detectors would need no second view.
    expect(INLINE_HL7).not.toContain("\r");
    expect(INLINE_HL7.split(/\r\n|\r|\n/).filter((l) => l.startsWith("PID"))).toHaveLength(0);
  });

  it("catches a name / MRN / DOB in an escaped single-line HL7 literal (exit 1)", () => {
    const root = makeRepo();
    mkdirSync(join(root, "test", "hl7"), { recursive: true });
    writeFileSync(join(root, "test", "hl7", "inline.test.ts"), INLINE_HL7);

    const r = runIn(root, []);
    expect(r.code, `stderr: ${r.stderr}`).toBe(1);
    expect(r.stderr).toMatch(/PID-5\.1 value="RIVERA"/);
    expect(r.stderr).toMatch(/PID-5\.2 value="JUANITA"/);
    expect(r.stderr).toMatch(/PID-3\.1 value="REALMRN99"/);
  });

  it("catches an escaped NCPDP Telecom transmission, framed by \\x1c escapes", () => {
    const root = makeRepo();
    writeFileSync(
      join(root, "test", "inline-ncpdp.test.ts"),
      'export const t = "AM01\\x1cCBRIVERA\\x1cCAJUANITA\\x1cC419780314";\n',
    );

    const r = runIn(root, []);
    expect(r.code, `stderr: ${r.stderr}`).toBe(1);
    expect(r.stderr).toMatch(/segment=CB value="RIVERA/);
  });

  it("an all-synthetic escaped literal still passes (the over-scrub control)", () => {
    const root = makeRepo();
    writeFileSync(
      join(root, "test", "inline-clean.test.ts"),
      'export const m =\n  "MSH|^~\\\\&|A|B|C|D|20200101||ADT^A01|M1|P|2.5' +
        '\\rPID|1||ZZMRN001^^^H^MR||ZZFAMILY^ZZGIVEN||19900215";\n',
    );

    const r = runIn(root, []);
    expect(r.code, `stderr: ${r.stderr}`).toBe(0);
  });
});

describe("phi-scan: a ${…} substitution site is a hole, not a value", () => {
  const ccda = (given: string): string =>
    '<ClinicalDocument xmlns="urn:hl7-org:v3"><recordTarget><patientRole><patient>' +
    `<name><given>${given}</given></name>` +
    "</patient></patientRole></recordTarget></ClinicalDocument>\n";

  it("does not flag a bare identifier chain, the value is not in the file", () => {
    const r = scan("tpl.xml", ccda("${t.given}"));
    expect(r.code, `stderr: ${r.stderr}`).toBe(0);
  });

  it("STILL flags a quoted literal inside the braces", () => {
    const r = scan("tpl-literal.xml", ccda('${"SMITH"}'));
    expect(r.code, `stderr: ${r.stderr}`).toBe(1);
  });

  it("STILL flags a value that merely CONTAINS a placeholder", () => {
    const r = scan("tpl-suffix.xml", ccda("${t.given} SMITH"));
    expect(r.code, `stderr: ${r.stderr}`).toBe(1);
  });

  it("STILL flags an expression with an operator inside the braces", () => {
    const r = scan("tpl-expr.xml", ccda('${a + "SMITH"}'));
    expect(r.code, `stderr: ${r.stderr}`).toBe(1);
  });
});

describe("phi-scan: the exit-code contract, 1 means HITS, and nothing else may spend it", () => {
  it("a missing allow-list exits 2, not the 1 that means 'hits found'", () => {
    const root = makeRepo();
    rmSync(join(root, "scripts", "phi-allow-list.txt"));

    const r = runIn(root, []);
    expect(r.code, `stderr: ${r.stderr}`).toBe(2);
    expect(r.stderr).toMatch(/allow-list not found/);
  });

  it("an unreadable directory under a scan root exits 2, not 1", () => {
    const root = makeRepo();
    const blocked = join(root, "src", "blocked");
    mkdirSync(blocked);
    chmodSync(blocked, 0o000);
    try {
      const r = runIn(root, []);
      expect(r.code, `stderr: ${r.stderr}`).toBe(2);
      expect(r.stderr).toMatch(/could not read the directory/);
    } finally {
      chmodSync(blocked, 0o755);
    }
  });
});

describe("phi-scan: --staged enumerates an UNMERGED entry", () => {
  it("refuses a conflicted in-scope path (exit 2), naming it as unmerged", () => {
    // `U` was returned by neither `AM` nor `AMT`, so a path left conflicted by a
    // merge was enumerated by this route at all. Its destination mode is
    // `000000` and `git show :<path>` has no stage-0 blob to hand back, so the
    // honest answer is a refusal, not a scan.
    const root = makeRepo();
    const id = ["-c", "user.email=t@example.com", "-c", "user.name=t"];
    writeFileSync(join(root, "test", "fixtures", "f.hl7"), "base\n");
    git(root, ["add", "test/fixtures/f.hl7"]);
    git(root, [...id, "commit", "-qm", "base"]);
    git(root, ["checkout", "-q", "-b", "other"]);
    writeFileSync(join(root, "test", "fixtures", "f.hl7"), "other\n");
    git(root, [...id, "commit", "-qam", "other"]);
    git(root, ["checkout", "-q", "-"]);
    writeFileSync(join(root, "test", "fixtures", "f.hl7"), "mine\n");
    git(root, [...id, "commit", "-qam", "mine"]);
    spawnSync("git", [...id, "merge", "other"], { cwd: root, encoding: "utf8", shell: false });

    // The premise: git raises it as `U`, with an all-zero destination mode, and
    // neither `AM` nor `AMT` returns it.
    expect(gitOut(root, ["diff", "--cached", "--raw", "--diff-filter=AMT"]).trim()).toBe("");
    expect(gitOut(root, ["diff", "--cached", "--raw"])).toMatch(/ 000000 .* U\t/);

    const r = runIn(root, ["--staged"]);
    expect(r.code, `stderr: ${r.stderr}`).toBe(2);
    expect(r.stderr).toContain("test/fixtures/f.hl7");
    expect(r.stderr).toContain("an unmerged (conflicted) entry");
  });
});

// ---------------------------------------------------------------------------
// Staged RENAMES: the third half of the `--diff-filter` defect
// ---------------------------------------------------------------------------
//
// `R` (rename) and `C` (copy) are returned by none of `AM`, `AMT` or `AMTU`, so
// with rename detection ON (git's default) an ordinary `git mv` put an entry
// under a scan root that this route never saw. Two shapes, and the first is the
// one that reads worst: `git mv <tracked link> <scan root>` stages as `R100` at
// mode `120000`, so the mode refusal the route already carries was unreachable.
// The remedy is `--no-renames`, which makes the destination arrive as a
// single-path `A` and the source as a `D` the filter drops.
//
// Every case asserts its PREMISE first (git really does emit `R`, and `AMTU`
// really does return nothing for it), so none of them can pass by fixture.

/** A file long enough that changing one line leaves git a detectable rename. */
const RENAMEABLE_CLEAN =
  [
    "// A synthetic fixture whose identifying values are all declared in the",
    "// allow-list, so this file is CLEAN before the rename below.",
    "export const MESSAGE = [",
    '  "MSH|^~\\\\&|A|B|C|D|20240101||ADT^A01|M1|P|2.5",',
    '  "PID|1||ZZMRN001||ZZFAMILY^ZZGIVEN||19900215|F",',
    '].join("\\r");',
  ].join("\n") + "\n";

describe("phi-scan: --staged enumerates a staged RENAME", () => {
  const ID = ["-c", "user.email=t@example.com", "-c", "user.name=t"];

  it("refuses a tracked symlink MOVED into a scan root (exit 2), and reports no PHI", () => {
    const root = makeRepo();
    // The link starts OUTSIDE every scan root, so it is only the move that puts
    // a mode-120000 entry in scope. Its target name carries a synthetic person
    // name, so an echo of it would be visible.
    symlinkSync(join(root, TARGET_NAME), join(root, "legacy-link"));
    git(root, ["add", "legacy-link"]);
    git(root, [...ID, "commit", "-qm", "base"]);
    git(root, ["mv", "legacy-link", "src/legacy-link"]);

    // The premise: git raises it as `R100` at mode 120000, and the filter this
    // route used to run alone returns NOTHING for it.
    expect(gitOut(root, ["diff", "--cached", "--raw"])).toMatch(/:120000 120000 .* R100\t/);
    expect(gitOut(root, ["diff", "--cached", "--raw", "--diff-filter=AMTU"]).trim()).toBe("");

    const r = runIn(root, ["--staged"]);
    expect(r.code, `stderr: ${r.stderr}`).toBe(2);
    expect(r.stderr).toContain("src/legacy-link");
    expect(r.stderr).toContain("a symbolic link");
    expectNoPhi(r.stderr);
  });

  it("scans a rename that SUBSTITUTES an undeclared value (exit 1), at the destination path", () => {
    const root = makeRepo();
    writeFileSync(join(root, "test", "moved.ts"), RENAMEABLE_CLEAN);
    git(root, ["add", "test/moved.ts"]);
    git(root, [...ID, "commit", "-qm", "base"]);
    // The clean baseline: this content is a no-op for the scan before the move.
    expect(runIn(root, []).code).toBe(0);

    git(root, ["mv", "test/moved.ts", "test/moved-elsewhere.ts"]);
    writeFileSync(
      join(root, "test", "moved-elsewhere.ts"),
      RENAMEABLE_CLEAN.replace("ZZFAMILY^ZZGIVEN", "RIVERA^JUANITA"),
    );
    git(root, ["add", "test/moved-elsewhere.ts"]);

    // The premise: a partial rewrite is still an `R` record, so `AMTU` alone
    // returns nothing and the NEW content is never read.
    expect(gitOut(root, ["diff", "--cached", "--raw"])).toMatch(/ R\d+\t/);
    expect(gitOut(root, ["diff", "--cached", "--raw", "--diff-filter=AMTU"]).trim()).toBe("");

    const r = runIn(root, ["--staged"]);
    expect(r.code, `stderr: ${r.stderr}`).toBe(1);
    expect(r.stderr).toContain("test/moved-elsewhere.ts");
    expect(r.stderr).toMatch(/PID-5\.1 value="RIVERA"/);
  });

  it("refuses whatever the caller's diff.renames / diff.renameLimit say", () => {
    // The stride and the refusal are STRUCTURAL under `--no-renames`: git cannot
    // emit an `R` or a `C` for any of these settings, so no two-path record
    // shape is needed. `copies` is included because `diff.renames` turns COPY
    // detection on as well, which is the other status carrying a second path.
    for (const renames of ["true", "copies", "false", "1"]) {
      const root = makeRepo();
      symlinkSync(join(root, TARGET_NAME), join(root, "legacy-link"));
      git(root, ["add", "legacy-link"]);
      git(root, [...ID, "commit", "-qm", "base"]);
      git(root, ["mv", "legacy-link", "src/legacy-link"]);
      git(root, ["config", "diff.renames", renames]);
      git(root, ["config", "diff.renameLimit", "1"]);

      const r = runIn(root, ["--staged"]);
      expect(r.code, `diff.renames=${renames} stderr: ${r.stderr}`).toBe(2);
      expect(r.stderr).toContain("a symbolic link");
    }
  });

  it("scans a COPY into a scan root that `diff.renames=copies` hides (exit 1)", () => {
    // `C` is the OTHER status carrying a second path, and it is a distinct
    // enumeration shape from `R`, not a spelling of it: copy detection pairs an
    // ADD with a source that is still present. It needs `diff.renames=copies`
    // (or `-C`) AND a source modified in the same index, which is why it has its
    // own case rather than riding on the rename sweep above.
    //
    // The leak shape: the source sits OUTSIDE every scan root, so only the COPY
    // puts the payload in scope. Under `AMTU` alone git pairs them as `C100` and
    // the destination is never enumerated at all.
    const root = makeRepo();
    writeFileSync(join(root, "legacy.txt"), SYNTHETIC_PHI);
    git(root, ["add", "legacy.txt"]);
    git(root, [...ID, "commit", "-qm", "base"]);
    git(root, ["config", "diff.renames", "copies"]);

    copyFileSync(join(root, "legacy.txt"), join(root, "test", "copied.hl7"));
    writeFileSync(join(root, "legacy.txt"), `${SYNTHETIC_PHI}NTE|2||addendum\n`);
    git(root, ["add", "legacy.txt", "test/copied.hl7"]);

    // The premise: a real `C100`, and `AMTU` alone returns no record at all for
    // the destination.
    expect(gitOut(root, ["diff", "--cached", "--raw"])).toMatch(
      / C100\tlegacy\.txt\ttest\/copied\.hl7/,
    );
    expect(gitOut(root, ["diff", "--cached", "--raw", "--diff-filter=AMTU"])).not.toContain(
      "test/copied.hl7",
    );

    const r = runIn(root, ["--staged"]);
    expect(r.code, `stderr: ${r.stderr}`).toBe(1);
    expect(r.stderr).toContain("test/copied.hl7");
    expect(r.stderr).toMatch(/PID-5\.1 value="RIVERA"/);
    // The source is out of scope on this route, so it is not reported.
    expect(r.stderr).not.toContain("legacy.txt");
  });

  it("loses nothing: the rename SOURCE is a `D` the filter drops, and other staged files still scan", () => {
    // `--no-renames` only ever ADDS records, so the enumeration is a SUPERSET:
    // equal when git emitted no `R` and no `C`, larger when it did. It is never
    // smaller. The control is that an ordinary staged violator alongside the
    // rename is still caught, and that a clean rename is still clean.
    const root = makeRepo();
    writeFileSync(join(root, "test", "moved.ts"), RENAMEABLE_CLEAN);
    git(root, ["add", "test/moved.ts"]);
    git(root, [...ID, "commit", "-qm", "base"]);
    git(root, ["mv", "test/moved.ts", "test/moved-elsewhere.ts"]);

    // A clean rename stays clean: the destination is scanned and finds nothing,
    // and the source path is a deletion with no staged blob to scan.
    const clean = runIn(root, ["--staged"]);
    expect(clean.code, `stderr: ${clean.stderr}`).toBe(0);

    writeFileSync(join(root, "src", "violator.ts"), SYNTHETIC_PHI);
    git(root, ["add", "src/violator.ts"]);
    const r = runIn(root, ["--staged"]);
    expect(r.code, `stderr: ${r.stderr}`).toBe(1);
    expect(r.stderr).toContain("src/violator.ts");
  });
});

describe("phi-scan: the whole-file bypass, in the modes that actually run", () => {
  const LOG = (p: string): string =>
    `# phi-scan bypass log\n\n## Entries\n\n### ${p}\n\n- **Reason:** test\n`;

  it("subtracts a logged path from the ALL-mode sweep, and announces it", () => {
    const root = makeRepo();
    writeFileSync(join(root, "test", "violator.test.ts"), SYNTHETIC_PHI);
    writeFileSync(join(root, "phi-scan-overrides.md"), LOG("test/violator.test.ts"));

    expect(runIn(root, []).code).toBe(1); // without the flag it is a hit
    const r = runIn(root, ["--allow-fixture", "test/violator.test.ts"]);
    expect(r.code, `stderr: ${r.stderr}`).toBe(0);
    expect(r.stderr).toContain("BYPASSED");
    expect(r.stderr).toContain("test/violator.test.ts");
  });

  it("subtracts it from --staged too, the route the pre-commit hook runs", () => {
    const root = makeRepo();
    writeFileSync(join(root, "test", "violator.test.ts"), SYNTHETIC_PHI);
    writeFileSync(join(root, "phi-scan-overrides.md"), LOG("test/violator.test.ts"));
    git(root, ["add", "test/violator.test.ts"]);

    expect(runIn(root, ["--staged"]).code).toBe(1);
    expect(runIn(root, ["--staged", "--allow-fixture", "test/violator.test.ts"]).code).toBe(0);
  });

  it("refuses a logged path that no longer exists, a bypass may not rot silently", () => {
    const root = makeRepo();
    writeFileSync(join(root, "phi-scan-overrides.md"), LOG("test/renamed-away.test.ts"));

    const r = runIn(root, ["--allow-fixture", "test/renamed-away.test.ts"]);
    expect(r.code, `stderr: ${r.stderr}`).toBe(2);
    expect(r.stderr).toMatch(/non-\.md regular file\s*\n?\s*inside a scan root/);
  });

  it("refuses a logged path outside every scan root, and a logged DIRECTORY", () => {
    const root = makeRepo();
    writeFileSync(join(root, "outside.txt"), "x\n");
    writeFileSync(join(root, "phi-scan-overrides.md"), LOG("outside.txt") + "\n### test\n");

    expect(runIn(root, ["--allow-fixture", "outside.txt"]).code).toBe(2);
    expect(runIn(root, ["--allow-fixture", "test"]).code).toBe(2);
  });
});

describe("phi-scan: this repo's own wiring still carries both halves of its one bypass", () => {
  // The bypass only holds if the manifest passes the flag AND the log authorizes
  // it. Dropping either half is silent: without the flag CI reddens on the
  // scanner's own violator literals, and without the log entry the scan refuses.
  const BYPASSED = "test/scripts/phi-scan.test.ts";

  it("package.json's phi-scan script passes --allow-fixture for it", () => {
    const manifest: unknown = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8"));
    const scripts =
      typeof manifest === "object" && manifest !== null && "scripts" in manifest
        ? (manifest.scripts as Record<string, string>)
        : {};
    expect(scripts["phi-scan"]).toContain(`--allow-fixture ${BYPASSED}`);
  });

  it("phi-scan-overrides.md logs it", () => {
    expect(readFileSync(join(REPO_ROOT, "phi-scan-overrides.md"), "utf8")).toContain(
      `### ${BYPASSED}`,
    );
  });

  it("and it is the ONLY file bypassed", () => {
    // Fenced blocks are skipped here for the same reason the scanner skips them:
    // the log's own "## Format" section shows the entry shape inside a fence, and
    // a flat `^###` sweep reads that placeholder as a logged path. This assertion
    // was written flat first and failed on exactly that.
    const log = readFileSync(join(REPO_ROOT, "phi-scan-overrides.md"), "utf8");
    let fenced = false;
    const entries: string[] = [];
    for (const line of log.split(/\r?\n/)) {
      if (/^\s*(?:```|~~~)/.test(line)) {
        fenced = !fenced;
        continue;
      }
      if (fenced) continue;
      const m = /^###\s+(.+?)\s*$/.exec(line);
      if (m?.[1] !== undefined) entries.push(m[1]);
    }
    expect(entries).toEqual([BYPASSED]);
  });
});

// ---------------------------------------------------------------------------
// Recognising a document inside a hand-written source file
// ---------------------------------------------------------------------------
//
// Every structured detector has to RECOGNISE the document before it checks
// anything, and each recogniser was written for a file that IS the document. A
// conformance gate found three shapes that the widened `test/` root swept and
// every detector then declined to read; each case below is red without its fix.

describe("phi-scan: the X12 recogniser finds an ISA header that is not at offset 0", () => {
  const INTERCHANGE =
    'import { deidentifyX12 } from "../../src/x12/index.js";\n' +
    "const wire =\n" +
    `  "${ISA}" +\n` +
    '  "GS*HC*A*B*20260615*0930*2*X*005010X222A2~ST*837*0002~" +\n' +
    '  "NM1*IL*1*RIVERA*JUANITA****MI*REALMEMBER9~DMG*D8*19780314*F~" +\n' +
    '  "SE*4*0002~GE*1*2~IEA*1*000000002~";\n';

  it("catches a patient NM1 name / id and a DMG DOB inline in a .ts module", () => {
    const root = makeRepo();
    mkdirSync(join(root, "test", "x12"), { recursive: true });
    writeFileSync(join(root, "test", "x12", "inline.test.ts"), INTERCHANGE);

    const r = runIn(root, []);
    expect(r.code, `stderr: ${r.stderr}`).toBe(1);
    expect(r.stderr).toMatch(/NM1-03 value="RIVERA"/);
    expect(r.stderr).toMatch(/NM1-09 value="REALMEMBER9"/);
    expect(r.stderr).toMatch(/DMG-02 value="19780314"/);
  });

  it("the same WIRE as a fixture was always caught, so this was the container, not the format", () => {
    const root = makeRepo();
    writeFileSync(
      join(root, "test", "fixtures", "inline.edi"),
      ISA +
        "GS*HC*A*B*20260615*0930*2*X*005010X222A2~ST*837*0002~" +
        "NM1*IL*1*RIVERA*JUANITA****MI*REALMEMBER9~DMG*D8*19780314*F~" +
        "SE*4*0002~GE*1*2~IEA*1*000000002~",
    );

    const r = runIn(root, []);
    expect(r.code, `stderr: ${r.stderr}`).toBe(1);
    expect(r.stderr).toMatch(/NM1-03 value="RIVERA"/);
  });

  it("prose that merely mentions ISA does not switch the detector on", () => {
    const root = makeRepo();
    writeFileSync(
      join(root, "src", "prose.ts"),
      "// The ISA-IEA envelope wraps every X12 interchange; ISA*16 is the count.\n" +
        "export const note = 'ISA: interchange control header';\n",
    );

    const r = runIn(root, []);
    expect(r.code, `stderr: ${r.stderr}`).toBe(0);
  });
});

describe("phi-scan: the HL7 recogniser reads a segment without a usable MSH above it", () => {
  it("catches a BARE PID line with no MSH at all, the shape pasted out of a ticket", () => {
    const root = makeRepo();
    writeFileSync(
      join(root, "test", "bare.test.ts"),
      'export const seg = "PID|1||REALMRN99^^^H^MR||RIVERA^JUANITA||19780314|F";\n',
    );

    const r = runIn(root, []);
    expect(r.code, `stderr: ${r.stderr}`).toBe(1);
    expect(r.stderr).toMatch(/PID-5\.1 value="RIVERA"/);
  });

  it("catches an INDENTED segment in a multi-line template literal", () => {
    const root = makeRepo();
    writeFileSync(
      join(root, "test", "indented.test.ts"),
      "export const msg = `\n" +
        "    MSH|^~\\\\&|A|B|C|D|20200101||ADT^A01|M1|P|2.5\n" +
        "    PID|1||REALMRN99^^^H^MR||RIVERA^JUANITA||19780314|F\n" +
        "  `;\n",
    );

    const r = runIn(root, []);
    expect(r.code, `stderr: ${r.stderr}`).toBe(1);
    expect(r.stderr).toMatch(/PID-5\.1 value="RIVERA"/);
  });

  it("reads a header whose MSH-2 is too short for the strict anchor (a detection REGRESSION guard)", () => {
    // `MSH|^|…`: one encoding character. The strict anchor that derives
    // non-default delimiters rejects it; falling back to the HL7 defaults is
    // what keeps it scanned, and an earlier draft of this slice lost it.
    const root = makeRepo();
    writeFileSync(
      join(root, "test", "fixtures", "short-enc.hl7"),
      "MSH|^|A|B|C|D|20200101||ADT^A01|M1|P|2.5\rPID|1||REALMRN99^^^H^MR||RIVERA^JUANITA||19780314|F\r",
    );

    const r = runIn(root, []);
    expect(r.code, `stderr: ${r.stderr}`).toBe(1);
    expect(r.stderr).toMatch(/PID-5\.1 value="RIVERA"/);
  });

  it("does NOT invent a segment from a line that merely starts with those three letters", () => {
    const root = makeRepo();
    writeFileSync(
      join(root, "src", "prose.ts"),
      "// PID is the patient identification segment.\n" +
        "export const NK1_NOTE = 'NK1 carries next of kin';\n" +
        "export const words = 'GT1 guarantor, IN1 insurance, IN2 more insurance';\n",
    );

    const r = runIn(root, []);
    expect(r.code, `stderr: ${r.stderr}`).toBe(0);
  });

  it("reads the sub-component separator through a source literal's doubled backslash", () => {
    // In a `.ts` source MSH-2 arrives as five characters, so position 3 is the
    // backslash rather than `&`, and a component was split on the wrong byte.
    const root = makeRepo();
    writeFileSync(
      join(root, "test", "subsep.test.ts"),
      'export const m =\n  "MSH|^~\\\\&|A|B|C|D|20200101||ADT^A01|M1|P|2.5' +
        '\\rPID|1||ZZMRN001^^^H^MR||RIVERA&X^JUANITA||19850302";\n',
    );

    const r = runIn(root, []);
    expect(r.code, `stderr: ${r.stderr}`).toBe(1);
    expect(r.stderr).toMatch(/PID-5\.1 value="RIVERA"/);
  });
});

describe("phi-scan: a bypass that would subtract nothing is refused, not accepted quietly", () => {
  it("refuses --allow-fixture on a .md, which is never a scan target", () => {
    const root = makeRepo();
    writeFileSync(join(root, "test", "NOTES.md"), "x\n");
    writeFileSync(
      join(root, "phi-scan-overrides.md"),
      "# log\n\n## Entries\n\n### test/NOTES.md\n\n- **Reason:** test\n",
    );

    const r = runIn(root, ["--allow-fixture", "test/NOTES.md"]);
    expect(r.code, `stderr: ${r.stderr}`).toBe(2);
    expect(r.stderr).toMatch(/non-\.md regular file/);
  });

  it("tells a reader of a bad ROOT to restore a directory, not to make a regular file", () => {
    const root = makeRepo();
    rmSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "src"), "not a directory\n");

    const r = runIn(root, []);
    expect(r.code, `stderr: ${r.stderr}`).toBe(2);
    expect(r.stderr).toMatch(/scan root must be a directory/);
    expect(r.stderr).not.toMatch(/replace it with a regular file/);
  });
});

// ---------------------------------------------------------------------------
// The remedy for the recogniser widening, each case a REGRESSION guard
// ---------------------------------------------------------------------------
//
// Widening a recogniser is a two-sided risk, and a conformance gate found the
// second side: the per-line segment split that made an interchange assembled
// from several source literals readable ALSO stopped reading a segment broken
// across lines, which the code it replaced handled. These pin both sides.

describe("phi-scan: an X12 segment broken across lines is read BOTH ways", () => {
  const WRAPPED =
    ISA +
    "\nGS*HC*A*B*20260615*0930*2*X*005010X222A2~\nST*837*0002~\n" +
    "NM1*IL*1*\nRIVERA*JUANITA****MI*REALMEMBER9~\n" +
    "SE*3*0002~\nGE*1*2~\nIEA*1*000000002~\n";

  it("catches every element after a hard wrap inside a segment (exit 1)", () => {
    // CR/LF is non-semantic filler in X12 and @cosyte/x12 rejoins the segment,
    // so a hard-wrapped EDI dump is a real artifact and the identifiers after
    // the wrap are real patient loci. Reading only line by line lost all three.
    const root = makeRepo();
    writeFileSync(join(root, "test", "fixtures", "wrapped.edi"), WRAPPED);

    const r = runIn(root, []);
    expect(r.code, `stderr: ${r.stderr}`).toBe(1);
    expect(r.stderr).toMatch(/NM1-03 value="RIVERA"/);
    expect(r.stderr).toMatch(/NM1-04 value="JUANITA"/);
    expect(r.stderr).toMatch(/NM1-09 value="REALMEMBER9"/);
  });

  it("and reports a wrapped value ONCE, not once per view", () => {
    const root = makeRepo();
    writeFileSync(join(root, "test", "fixtures", "wrapped.edi"), WRAPPED);

    const r = runIn(root, []);
    expect(r.stderr.match(/NM1-04 value="JUANITA"/g) ?? []).toHaveLength(1);
  });

  it("still reads the multi-literal envelope idiom, which the rejoin alone cannot", () => {
    // The rejoin only reaches a segment whose PRECEDING literal happens to end
    // at a terminator. This repo's real idiom has assertion literals in between,
    // so the rejoined view reads `…blockedNM1` and the per-line split is the
    // only thing that finds the segment. Drop it and this case goes green-to-red.
    const root = makeRepo();
    mkdirSync(join(root, "test", "x12"), { recursive: true });
    writeFileSync(
      join(root, "test", "x12", "wrap.test.ts"),
      `const ISA = "${ISA}";\n` +
        "const wrap = (body) =>\n" +
        "  `${ISA}GS*HC*A*B*20260615*0930*2*X*005010X222A2~ST*837*0002~${body}SE*9*0002~IEA*1*000000002~`;\n" +
        'export const label = "blocked";\n' +
        'export const other = "pseudonymized";\n' +
        'export const raw = wrap("NM1*IL*1*RIVERA*JUANITA****MI*REALMEMBER9~");\n',
    );

    const r = runIn(root, []);
    expect(r.code, `stderr: ${r.stderr}`).toBe(1);
    expect(r.stderr).toMatch(/NM1-03 value="RIVERA"/);
  });

  it("a prose ISA does not capture the delimiters away from a real header below it", () => {
    // Built to be exactly the shape that slips past a boundary-plus-terminator
    // test: `ISA-` at a non-alphanumeric boundary and a non-alphanumeric at the
    // fixed 105th byte. ISA01's fixed two-character width is the only thing that
    // rejects it: drop that check and the real interchange below reads clean.
    const proseIsa = `${"ISA-IEA envelope".padEnd(105, ".")}:`;
    expect(proseIsa).toHaveLength(106);

    const root = makeRepo();
    mkdirSync(join(root, "test", "x12"), { recursive: true });
    writeFileSync(
      join(root, "test", "x12", "prose.test.ts"),
      `export const note = "${proseIsa}";\n` +
        `export const raw =\n  "${ISA}" +\n` +
        '  "GS*HC*A*B*20260615*0930*2*X*005010X222A2~ST*837*0002~" +\n' +
        '  "NM1*IL*1*RIVERA*JUANITA****MI*REALMEMBER9~SE*3*0002~IEA*1*000000002~";\n',
    );

    const r = runIn(root, []);
    expect(r.code, `stderr: ${r.stderr}`).toBe(1);
    expect(r.stderr).toMatch(/NM1-03 value="RIVERA"/);
    expect(r.stderr).toMatch(/NM1-09 value="REALMEMBER9"/);
  });
});

describe("phi-scan: indentation is stripped in the literal view only", () => {
  it("does not report a declared-synthetic value with the closing backtick attached", () => {
    // Stripping indentation in the RAW view too re-opened the "source syntax
    // rides along on the last field" false red that taking the literals fixed.
    const root = makeRepo();
    writeFileSync(
      join(root, "test", "indented-clean.test.ts"),
      "export const msg = `MSH|^~\\\\&|A|B|C|D|20200101||ADT^A01|M1|P|2.5\n" +
        "    PID|1||ZZMRN001^^^H^MR||ZZFAMILY^ZZGIVEN||19850302`;\n",
    );

    const r = runIn(root, []);
    expect(r.code, `stderr: ${r.stderr}`).toBe(0);
  });

  it("but still catches a REAL value in that same indented shape", () => {
    const root = makeRepo();
    writeFileSync(
      join(root, "test", "indented-dirty.test.ts"),
      "export const msg = `MSH|^~\\\\&|A|B|C|D|20200101||ADT^A01|M1|P|2.5\n" +
        "    PID|1||REALMRN99^^^H^MR||RIVERA^JUANITA||19850302`;\n",
    );

    const r = runIn(root, []);
    expect(r.code, `stderr: ${r.stderr}`).toBe(1);
    expect(r.stderr).toMatch(/PID-5\.1 value="RIVERA"/);
  });
});

// ---------------------------------------------------------------------------
// The index corpus: all mode reads the bytes git carries, as a UNION
// ---------------------------------------------------------------------------
//
// The walk reads three declared roots off the WORKING TREE, which is a claim
// that depends on the working tree being honest and on the corpus sitting where
// the roots point. Five states were reproduced on 880c79b, each printing
// `[phi-scan] OK, no hits` at exit 0 over the payload above. They are pinned
// here individually, because a single case cannot tell "the escape is closed"
// apart from "one of the five is closed".
//
// The mechanism lives in ONE place, `buildTargetsForIndex`; these cases assert
// the consumer-facing behaviour and never restate it.

/** Commit a file at `rel`, then leave DIFFERENT bytes at that path in the worktree. */
function commitThenDiverge(root: string, rel: string, committed: string, working: string): void {
  writeFileSync(join(root, rel), committed);
  commitAll(root, `commit ${rel}`);
  writeFileSync(join(root, rel), working);
}

describe("phi-scan index corpus: the five states the walk alone reported clean", () => {
  it("1. a DECOY: committed bytes carry PHI, the working tree at that path is clean", () => {
    // The escape the whole route exists for. Comparing PATH SETS is satisfied
    // completely by this tree: every root yields files and every tracked path is
    // accounted for. Only reading the blob answers it.
    const root = makeRepo();
    commitThenDiverge(root, "src/decoy.ts", SYNTHETIC_PHI, "export const clean = 1;\n");

    const r = runIn(root, []);
    expect(r.code, `stderr: ${r.stderr}`).toBe(1);
    expect(r.stderr).toContain("src/decoy.ts");
    expect(r.stderr).toContain("123-45-6789");
    expect(r.stderr).toMatch(/PID-5\.1 value="RIVERA"/);
    // The remedy differs from a file the walk never reached, so the origin does.
    expect(r.stderr).toContain("the working tree differs");
  });

  it("2. a tracked path OUTSIDE every scan root", () => {
    const root = makeRepo();
    mkdirSync(join(root, "elsewhere"));
    writeFileSync(join(root, "elsewhere", "patient.hl7"), SYNTHETIC_PHI);
    commitAll(root, "out of root");

    const r = runIn(root, []);
    expect(r.code, `stderr: ${r.stderr}`).toBe(1);
    expect(r.stderr).toContain("elsewhere/patient.hl7");
    expect(r.stderr).toMatch(/origin="git index"/);
  });

  it("3. a scan root EMPTIED from the working tree, its files still tracked", () => {
    // This scanner has no floor-of-one and no reconciliation: an absent root
    // returns silently from `enterRoot`. Deleting all three left the sweep
    // reporting `OK, no hits` over the entire corpus, which is this repo's
    // purest instance of the class.
    const root = makeRepo();
    writeFileSync(join(root, "test", "patient.hl7"), SYNTHETIC_PHI);
    commitAll(root, "fixture");
    rmSync(join(root, "test"), { recursive: true, force: true });
    rmSync(join(root, "src"), { recursive: true, force: true });

    const r = runIn(root, []);
    expect(r.code, `stderr: ${r.stderr}`).toBe(1);
    expect(r.stderr).toContain("test/patient.hl7");
  });

  it("4. an EMPTY index refuses (exit 2) rather than printing a completed sweep's line", () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "phi-scan-empty-")));
    repos.push(root);
    mkdirSync(join(root, "scripts"));
    mkdirSync(join(root, "src"));
    copyFileSync(
      join(REPO_ROOT, "scripts", "phi-allow-list.txt"),
      join(root, "scripts", "phi-allow-list.txt"),
    );
    writeFileSync(join(root, "src", "ordinary.ts"), "export const answer = 42;\n");
    git(root, ["init", "-q", "."]);

    const r = runIn(root, []);
    expect(r.code, `stderr: ${r.stderr}`).toBe(2);
    expect(r.stderr).toContain("holds no entries");
    expect(r.stdout).not.toMatch(/OK, no hits/);
  });

  it("5. a tracked SYMLINK outside every scan root is refused, and its target is NOT named", () => {
    // `walk()` classifies entries INSIDE a root, so this was reached by neither
    // route. It is refused BY MODE here, and the refusal must never echo the
    // link target: that is working-tree text which can itself carry PHI.
    const root = makeRepo();
    symlinkSync(join("..", TARGET_NAME), join(root, "outside-link"));
    git(root, ["add", "outside-link"]);
    commitAll(root, "link");

    const r = runIn(root, []);
    expect(r.code, `stderr: ${r.stderr}`).toBe(2);
    expect(r.stderr).toContain("outside-link");
    expect(r.stderr).toContain("a symbolic link");
    expectNoPhi(r.stderr);
  });

  it("...and a tracked GITLINK outside every scan root is refused by the same rule", () => {
    const root = makeRepo();
    const nested = join(root, "nested");
    mkdirSync(nested);
    git(nested, ["init", "-q", "."]);
    git(nested, ["config", "user.email", "phi-scan-test@example.com"]);
    git(nested, ["config", "user.name", "phi-scan test"]);
    git(nested, ["config", "commit.gpgsign", "false"]);
    writeFileSync(join(nested, "f.txt"), "ordinary\n");
    commitAll(nested, "nested");
    git(root, ["add", "nested"]);

    const r = runIn(root, []);
    expect(r.code, `stderr: ${r.stderr}`).toBe(2);
    expect(r.stderr).toContain("nested");
    expect(r.stderr).toContain("a gitlink");
  });
});

describe("phi-scan index corpus: it is a UNION, never a replacement", () => {
  it("still reads an UNTRACKED working-tree file under a root (the walk is not narrowed)", () => {
    // The superset property, stated as a case: git carries nothing at this path,
    // so only the walk can find it. If the index route had replaced the walk
    // rather than joining it, this would be the regression.
    const root = makeRepo();
    writeFileSync(join(root, "src", "untracked.hl7"), SYNTHETIC_PHI);

    const r = runIn(root, []);
    expect(r.code, `stderr: ${r.stderr}`).toBe(1);
    expect(r.stderr).toContain("src/untracked.hl7");
    // ...and it is the WORKING-TREE read, so it carries no index origin.
    expect(r.stderr).not.toMatch(/src\/untracked\.hl7[\s\S]*?origin=/);
  });

  it("reports BOTH routes' findings in one run", () => {
    const root = makeRepo();
    mkdirSync(join(root, "elsewhere"));
    writeFileSync(join(root, "elsewhere", "tracked.hl7"), SYNTHETIC_PHI);
    commitAll(root, "tracked out of root");
    writeFileSync(join(root, "src", "untracked.hl7"), SYNTHETIC_PHI);

    const r = runIn(root, []);
    expect(r.code, `stderr: ${r.stderr}`).toBe(1);
    expect(r.stderr).toContain("src/untracked.hl7"); // the walk
    expect(r.stderr).toContain("elsewhere/tracked.hl7"); // the index
  });

  it("reports a clean tracked file ONCE, not twice (the byte-comparison skip)", () => {
    const root = makeRepo();
    writeFileSync(join(root, "src", "dirty.hl7"), SYNTHETIC_PHI);
    commitAll(root, "dirty");

    const r = runIn(root, []);
    expect(r.code, `stderr: ${r.stderr}`).toBe(1);
    // The walk read it and the blob is byte-identical, so the index route skips
    // it: one HIT block, not two.
    expect(r.stderr.match(/HIT: src\/dirty\.hl7/g)).toHaveLength(1);
  });

  it("the skip is a BYTE comparison: bytes differing only in line endings are scanned both ways", () => {
    // The one edit that would quietly reopen the escape is normalizing line
    // endings before the comparison, because that compares a DERIVED form and a
    // decoy differing only in what the normalizer erases would then be skipped.
    // A CRLF/LF-only difference must therefore NOT be treated as "already read".
    const root = makeRepo();
    commitThenDiverge(root, "src/eol.hl7", SYNTHETIC_PHI.replace(/\n/g, "\r\n"), SYNTHETIC_PHI);

    const r = runIn(root, []);
    expect(r.code, `stderr: ${r.stderr}`).toBe(1);
    expect(r.stderr).toContain("the working tree differs");
  });

  it("does NOT reach --staged or paths mode", () => {
    // Both are bounded elsewhere: `--staged` is the pre-commit hook, so its scope
    // decides what a COMMIT is blocked on, and `paths` is bounded by argv. A
    // tracked out-of-root violator is found by all mode and by neither of them.
    const root = makeRepo();
    mkdirSync(join(root, "elsewhere"));
    writeFileSync(join(root, "elsewhere", "patient.hl7"), SYNTHETIC_PHI);
    commitAll(root, "out of root");

    expect(runIn(root, []).code).toBe(1);
    expect(runIn(root, ["--staged"]).code, "the hook's scope is unchanged").toBe(0);
  });
});

describe("phi-scan index corpus: what it excludes, and what an exclusion may not excuse", () => {
  it("does not read a tracked file under vendor/, which is declared out of scope", () => {
    // `vendor/` holds third-party `pnpm pack` tarballs: gzip, so their text is
    // compressed and no detector here can read it without decompressing an
    // archive. Handing the compressed bytes to the detectors as UTF-8 is noise,
    // not coverage. The cost is that a tracked file there is not swept.
    const root = makeRepo();
    mkdirSync(join(root, "vendor"));
    writeFileSync(join(root, "vendor", "payload.hl7"), SYNTHETIC_PHI);
    commitAll(root, "vendor");

    const r = runIn(root, []);
    expect(r.code, `stderr: ${r.stderr}`).toBe(0);
  });

  it("but a NAME exclusion never excuses an entry whose bytes the route cannot read", () => {
    // Both name rules are applied LAST, to the readable set only. Putting either
    // first is a real hole: git carries a link's TARGET PATH, which is itself a
    // PHI surface, so naming a link `vendor/…` or `….md` must not buy it a pass.
    for (const rel of ["vendor/decoy.tgz", "notes.md"]) {
      const root = makeRepo();
      mkdirSync(join(root, "vendor"));
      symlinkSync(join("..", TARGET_NAME), join(root, rel));
      git(root, ["add", rel]);
      commitAll(root, "link");

      const r = runIn(root, []);
      expect(r.code, `stderr (${rel}): ${r.stderr}`).toBe(2);
      expect(r.stderr).toContain(rel);
      expect(r.stderr).toContain("a symbolic link");
      expectNoPhi(r.stderr);
    }
  });

  it("does not read a tracked .md, exactly as the walk does not", () => {
    const root = makeRepo();
    writeFileSync(join(root, "README.md"), SYNTHETIC_PHI);
    commitAll(root, "doc");

    const r = runIn(root, []);
    expect(r.code, `stderr: ${r.stderr}`).toBe(0);
  });

  it("honors --allow-fixture, which in THIS repo is a live subtraction and not dead code", () => {
    // `parseArgs` does not seed the positional path set from the flag, so
    // `pnpm phi-scan` runs in ALL mode with the one logged bypass in force.
    // Without this subtraction the route would read the bypassed file straight
    // out of the index and red-lock the repo.
    const root = makeRepo();
    const rel = "test/scripts/phi-scan.test.ts";
    mkdirSync(join(root, "test", "scripts"), { recursive: true });
    copyFileSync(join(REPO_ROOT, "phi-scan-overrides.md"), join(root, "phi-scan-overrides.md"));
    // ▶ THE COMMITTED BYTES CARRY THE PHI AND THE WORKING-TREE BYTES DO NOT, and
    // that asymmetry is what makes this case load-bearing rather than decorative.
    // With both copies identical the byte-comparison skip fires first, the index
    // route never reaches its subtraction, and deleting that subtraction would
    // leave this case green. Diverging them forces the index route to hold a
    // PHI-bearing target for the bypassed path, so only the subtraction can
    // silence it.
    commitThenDiverge(root, rel, SYNTHETIC_PHI, "export const clean = 1;\n");

    // Unbypassed, the index route reads the committed bytes and reds.
    const un = runIn(root, []);
    expect(un.code, `stderr: ${un.stderr}`).toBe(1);
    expect(un.stderr).toContain("the working tree differs");

    // Bypassed, neither route reads it -- including the index route.
    const r = runIn(root, ["--allow-fixture", rel]);
    expect(r.code, `stderr: ${r.stderr}`).toBe(0);
    expect(r.stderr).toContain("BYPASSED");
    expectNoPhi(r.stderr);
  });
});

describe("phi-scan index corpus: a refusal must not swallow a real hit", () => {
  it("prints the walk's hits BEFORE refusing over an unreadable index entry", () => {
    // Refused before the walk was scanned, the run would be strictly WORSE than
    // the base commit's for this input: exit 1 naming every locus before, exit 2
    // naming nothing after. The exit code is still 2, because an incomplete
    // sweep is not a verdict whatever it found on the way.
    const root = makeRepo();
    writeFileSync(join(root, "src", "violator.hl7"), SYNTHETIC_PHI);
    symlinkSync(join("..", TARGET_NAME), join(root, "outside-link"));
    git(root, ["add", "outside-link"]);
    commitAll(root, "link");

    const r = runIn(root, []);
    expect(r.code, `stderr: ${r.stderr}`).toBe(2);
    expect(r.stderr).toContain("src/violator.hl7");
    expect(r.stderr).toContain("123-45-6789");
    expect(r.stderr).toContain("cannot be scanned");
    expectNoPhi(r.stderr.slice(r.stderr.indexOf("cannot be scanned")));
  });

  it("...and does the same for an empty index", () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "phi-scan-empty2-")));
    repos.push(root);
    mkdirSync(join(root, "scripts"));
    mkdirSync(join(root, "src"));
    copyFileSync(
      join(REPO_ROOT, "scripts", "phi-allow-list.txt"),
      join(root, "scripts", "phi-allow-list.txt"),
    );
    writeFileSync(join(root, "src", "violator.hl7"), SYNTHETIC_PHI);
    git(root, ["init", "-q", "."]);

    const r = runIn(root, []);
    expect(r.code, `stderr: ${r.stderr}`).toBe(2);
    expect(r.stderr).toContain("123-45-6789");
    expect(r.stderr).toContain("holds no entries");
  });
});

describe("phi-scan index corpus: the positive control on the corpus it claims to clear", () => {
  // A GREEN OVER A CORPUS NOBODY OPENED IS THE DEFECT THIS WHOLE ROUTE IS ABOUT,
  // so a case that only shows the scanner passing proves nothing. This one takes
  // THIS PACKAGE'S OWN `package.json`, byte for byte, and puts it at the same
  // out-of-every-scan-root path in a throwaway tree. It is the file that made the
  // gap concrete: 25 tracked non-markdown files sit outside all three scan roots
  // in this repo, and this is the one carrying a token the floor fires on.
  //
  // The green is then shown to be EARNED BY THE DECLARATION rather than by the
  // file never being opened, which is the only difference that matters and the
  // one a passing run cannot show on its own.

  /** This package's own manifest, read off disk so the case cannot go stale silently. */
  const OWN_MANIFEST = readFileSync(join(REPO_ROOT, "package.json"), "utf8");

  /** The declaration that makes the real corpus green, as it appears in the allow-list. */
  const OWN_DOMAIN_DECLARATION = "EMAILDOMAIN cosyte.com";

  it("premise: the manifest carries an address the floor fires on, outside every scan root", () => {
    expect(OWN_MANIFEST).toMatch(/[A-Za-z0-9._%+-]+@cosyte\.com/);
    // ...and `package.json` really does sit outside every declared scan root.
    const scanner = readFileSync(SCANNER_PATH, "utf8");
    expect(scanner).toContain(
      `const SCAN_ROOT_NAMES: readonly string[] = ["src", "test", "scripts"];`,
    );
  });

  it("the sweep OPENS it: strike the declaration and the same corpus reds (exit 1)", () => {
    const root = makeRepo();
    writeFileSync(join(root, "package.json"), OWN_MANIFEST);
    commitAll(root, "manifest");

    // Green, with the shipped allow-list.
    const declared = runIn(root, []);
    expect(declared.code, `stderr: ${declared.stderr}`).toBe(0);
    expect(declared.stdout).toMatch(/OK, no hits/);

    // The control. The ONLY thing that changes is the declaration, so a red here
    // is proof the bytes were read and judged rather than skipped.
    const allowList = join(root, "scripts", "phi-allow-list.txt");
    const text = readFileSync(allowList, "utf8");
    expect(text, "the declaration this control strikes has moved").toContain(
      OWN_DOMAIN_DECLARATION,
    );
    writeFileSync(allowList, text.replace(`${OWN_DOMAIN_DECLARATION}\n`, ""));
    commitAll(root, "strike the declaration");

    const undeclared = runIn(root, []);
    expect(undeclared.code, `stderr: ${undeclared.stderr}`).toBe(1);
    expect(undeclared.stderr).toContain("package.json");
    expect(undeclared.stderr).toContain("(email)");
    expect(undeclared.stderr).toMatch(/origin="git index"/);
  });

  it("...and no ROOT-SCOPED route reaches that path, declaration struck or not", () => {
    // The state this slice closes, shown with shipped code rather than a rebuilt
    // variant: `--staged` judges scope with the same `isUnderScanRoot` the walk
    // uses, so with the declaration struck and the manifest STAGED it is still
    // green -- the path is outside every root. All mode reds on the same tree.
    const root = makeRepo();
    const allowList = join(root, "scripts", "phi-allow-list.txt");
    writeFileSync(
      allowList,
      readFileSync(allowList, "utf8").replace(`${OWN_DOMAIN_DECLARATION}\n`, ""),
    );
    commitAll(root, "strike the declaration");

    writeFileSync(join(root, "package.json"), OWN_MANIFEST);
    git(root, ["add", "package.json"]);

    const staged = runIn(root, ["--staged"]);
    expect(staged.code, `stderr: ${staged.stderr}`).toBe(0);
    expect(staged.stdout).toMatch(/OK, no hits/);

    commitAll(root, "manifest");
    const all = runIn(root, []);
    expect(all.code, "all mode reads what git carries").toBe(1);
    // NAMED, not merely counted. Asserting the exit code alone would let this
    // case pass on any tree that happens to red for some other reason -- and it
    // very nearly did: an earlier draft spelled the address out in the
    // allow-list's own comment, which sits INSIDE a scan root, so striking the
    // declaration reddened that file through the walk and this control passed on
    // the base scanner without the manifest ever being opened.
    expect(all.stderr).toContain("HIT: package.json");
    expect(all.stderr).toMatch(/origin="git index"/);
    // Exactly one file, so the red cannot be coming from anywhere else. (The
    // remedy sentence names the allow-list on every run, so its mere presence in
    // stderr proves nothing -- the HIT lines are what to count.)
    expect(all.stderr).toContain("1 hit(s) across 1 file(s)");
  });
});
