/**
 * Unit tests for scripts/phi-scan.ts — the STARTER PHI commit-gate.
 *
 * These exercise the SHARED MACHINERY and the cross-cutting SSN/email FLOOR that
 * ships with the template. They deliberately do NOT test structured, field-level
 * PHI detection — that is format-specific and is the author's obligation to add
 * (see the STARTER banner in scripts/phi-scan.ts). When you add structured
 * detectors, add positive tests here proving they CATCH real-looking names /
 * DOBs / ids for this standard — a weak scanner is worse than none.
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
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
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

/** Write a file to the temp dir and scan it by path (paths mode — no git needed). */
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
    expect(r.stdout).toMatch(/OK — no hits/);
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
