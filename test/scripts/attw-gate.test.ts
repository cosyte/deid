/**
 * Tests for scripts/attw.mjs: the wrapper that makes the `attw` publish gate
 * report its own failure.
 *
 * WHAT THESE PIN, AND WHY EACH ONE IS HERE:
 *
 *  1. THE UPSTREAM BEHAVIOUR THE WRAPPER EXISTS FOR. `attw` prints "This package
 *     does not contain types." and exits **0**. If a future `attw` upgrade fixes
 *     that exit code or rewords the sentence, this test reds, which is the point.
 *     A guard that silently stops matching is worse than no guard, and this is the
 *     one net in `attw.mjs` that depends on a string.
 *  2. That the wrapper turns that exit 0 into a failure.
 *  3. That the preflight catches a declared-but-missing artifact, which is the
 *     shape the build window actually takes (`tsup` writes JS in one pass and
 *     declarations in a later one, so `dist/` holds `.mjs`/`.cjs` and no
 *     declarations for several seconds of every build).
 *  4. A NEGATIVE CONTROL. On a package whose tarball really does carry types, the
 *     wrapper is transparent: same exit status as `attw` itself, and green. A gate
 *     that only ever fails is not a gate, and a false red here would cost every
 *     later run an hour.
 *  5. THE GATE'S MOST BASIC OBLIGATION, that a real `attw` failure still fails.
 *     Without this, every other test here would pass on a wrapper that swallowed
 *     attw's own exit status, because net 2 reds the untyped fixture regardless.
 *  6. THAT `--profile node16` STILL MEANS WHAT IT MEANT. This package's `attw`
 *     script has always carried that flag and the port must not quietly drop it.
 *     "The wrapper accepts the flag" proves nothing, so the fixture used here is
 *     one whose VERDICT depends on it: exit 1 without, exit 0 with. Its shape is
 *     this package's own: subpath exports pointing into a directory, which node10
 *     resolution cannot follow and the node16 profile ignores.
 *  7. The refusals that keep net 2 readable, AND THE BLINDING ITSELF, re-run here
 *     rather than asserted in a comment. `--quiet`, `-q`, `--format json`, `-f json`,
 *     `--format=json` and a `.attw.json` config key each make bare `attw` hand back
 *     exit 0 with the untyped sentence unreadable, which is the exact false green
 *     this file exists to close; every one of those is measured against the real
 *     binary in the case that refuses it. `--config-path` is the exception and is
 *     kept visibly separate: it is refused on inference, was never measured, and its
 *     case asserts only the refusal.
 *
 * WHY THE FIXTURES ARE THROWAWAY PACKAGES AND NOT THIS REPO'S `dist/`. Reading the
 * real build would make the suite depend on a build having happened and race any
 * build running beside it: the very window the gate exists for. Nothing here
 * touches `dist/`. `attw` is invoked with `--no-definitely-typed` so the runs stay
 * offline; the wrapper forwards arguments, which is what makes that possible.
 *
 * TIMEOUTS ARE PER TEST, NEVER GLOBAL. Every case that reaches `attw --pack` runs a
 * real `npm pack`, and two of those in one test comfortably exceeds this suite's
 * 10s default. Raising the global default would trade this false red for a false
 * green across every other suite in the repo.
 *
 * SECURITY: every subprocess call uses spawnSync with array args. No exec, no
 * shell-form.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const REPO_ROOT = process.cwd();
const WRAPPER = join(REPO_ROOT, "scripts", "attw.mjs");
const ATTW_BIN = join(REPO_ROOT, "node_modules", ".bin", "attw");
const UNTYPED = "This package does not contain types.";
const OFFLINE = ["--no-definitely-typed"];
/** The flag this package's `attw` script carries, and case 6 above. */
const NODE16 = ["--profile", "node16"];
const SPAWN_TIMEOUT = 120_000;

interface RunResult {
  code: number;
  out: string;
}

function run(bin: string, args: string[], cwd: string): RunResult {
  const r = spawnSync(bin, args, { cwd, encoding: "utf8", timeout: 180_000 });
  return { code: r.status ?? -1, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

const runAttw = (cwd: string, args: string[] = OFFLINE): RunResult =>
  run(ATTW_BIN, ["--pack", ".", ...args], cwd);
const runWrapper = (cwd: string, args: string[] = OFFLINE): RunResult =>
  run(process.execPath, [WRAPPER, ...args], cwd);

let root: string;

/** A package whose declaration file exists on disk but is left out of `files`. */
let typesNotPacked: string;
/** A package whose `package.json` points at a `dist/` that was never built. */
let noBuild: string;
/** A well-formed dual ESM/CJS package: the negative control. */
let wellFormed: string;
/** A package with a real attw problem: `require` resolves to ESM. */
let attwFails: string;
/** Declarations present, JS entry point missing: attw itself is green on this. */
let jsMissing: string;
/** Subpath exports into a directory: node10 cannot resolve them, node16 ignores that. */
let subpathPkg: string;

function writePkg(dir: string, pkg: Record<string, unknown>, files: Record<string, string>): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "package.json"), JSON.stringify(pkg, null, 2));
  for (const [name, body] of Object.entries(files)) {
    const target = join(dir, name);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, body);
  }
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "attw-gate-"));

  typesNotPacked = join(root, "types-not-packed");
  writePkg(
    typesNotPacked,
    {
      name: "attw-gate-fixture-unpacked",
      version: "1.0.0",
      main: "./index.js",
      types: "./index.d.ts",
      files: ["index.js"],
    },
    { "index.js": "module.exports = {};\n", "index.d.ts": "export declare const a: number;\n" },
  );

  noBuild = join(root, "no-build");
  writePkg(
    noBuild,
    {
      name: "attw-gate-fixture-nobuild",
      version: "1.0.0",
      type: "module",
      exports: { ".": { types: "./dist/index.d.ts", default: "./dist/index.js" } },
      files: ["dist"],
    },
    {},
  );

  wellFormed = join(root, "well-formed");
  writePkg(
    wellFormed,
    {
      name: "attw-gate-fixture-wellformed",
      version: "1.0.0",
      type: "module",
      exports: {
        ".": {
          import: { types: "./index.d.ts", default: "./index.js" },
          require: { types: "./index.d.cts", default: "./index.cjs" },
        },
      },
      files: ["index.js", "index.d.ts", "index.cjs", "index.d.cts"],
    },
    {
      "index.js": "export const a = 1;\n",
      "index.d.ts": "export declare const a: number;\n",
      "index.cjs": "module.exports.a = 1;\n",
      "index.d.cts": "export declare const a: number;\n",
    },
  );

  // ESM-only, with no `require` condition: attw's node16 profile still reports
  // CJSResolvesToESM and exits non-zero of its own accord.
  attwFails = join(root, "attw-fails");
  writePkg(
    attwFails,
    {
      name: "attw-gate-fixture-problem",
      version: "1.0.0",
      type: "module",
      exports: { ".": { types: "./index.d.ts", default: "./index.js" } },
      files: ["index.js", "index.d.ts"],
    },
    { "index.js": "export const a = 1;\n", "index.d.ts": "export declare const a: number;\n" },
  );

  jsMissing = join(root, "js-missing");
  writePkg(
    jsMissing,
    {
      name: "attw-gate-fixture-jsmissing",
      version: "1.0.0",
      main: "./dist/index.js",
      types: "./index.d.ts",
      files: ["index.d.ts"],
    },
    { "index.d.ts": "export declare const a: number;\n" },
  );

  // This package's own shape in miniature: a subpath export whose target lives in
  // a directory. node10 resolves `pkg/sub` literally, finds nothing, and reports
  // 💀 Resolution failed; `--profile node16` ignores the node10 resolution entirely.
  subpathPkg = join(root, "subpath");
  writePkg(
    subpathPkg,
    {
      name: "attw-gate-fixture-subpath",
      version: "1.0.0",
      type: "module",
      main: "./lib/index.cjs",
      module: "./lib/index.mjs",
      types: "./lib/index.d.ts",
      exports: {
        ".": {
          import: { types: "./lib/index.d.ts", default: "./lib/index.mjs" },
          require: { types: "./lib/index.d.cts", default: "./lib/index.cjs" },
        },
        "./sub": {
          import: { types: "./lib/sub.d.ts", default: "./lib/sub.mjs" },
          require: { types: "./lib/sub.d.cts", default: "./lib/sub.cjs" },
        },
        "./package.json": "./package.json",
      },
      files: ["lib"],
    },
    {
      "lib/index.mjs": "export const a = 1;\n",
      "lib/index.d.ts": "export declare const a: number;\n",
      "lib/index.cjs": "module.exports.a = 1;\n",
      "lib/index.d.cts": "export declare const a: number;\n",
      "lib/sub.mjs": "export const b = 1;\n",
      "lib/sub.d.ts": "export declare const b: number;\n",
      "lib/sub.cjs": "module.exports.b = 1;\n",
      "lib/sub.d.cts": "export declare const b: number;\n",
    },
  );
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("attw's own exit code (the reason this wrapper exists)", () => {
  it(
    "reports an untyped pack and still exits 0",
    () => {
      const r = runAttw(typesNotPacked, [...OFFLINE, ...NODE16]);
      expect(r.out).toContain(UNTYPED);
      // If this ever fails because the status is now non-zero, attw has fixed the
      // early return in getExitCode() and net 2 of scripts/attw.mjs is redundant.
      // Read that file's header before deleting anything.
      expect(r.code).toBe(0);
    },
    SPAWN_TIMEOUT,
  );
});

describe("scripts/attw.mjs", () => {
  it(
    "fails when the tarball carries no types, where attw exits 0",
    () => {
      const r = runWrapper(typesNotPacked, [...OFFLINE, ...NODE16]);
      expect(r.out).toContain(UNTYPED);
      expect(r.code).not.toBe(0);
    },
    SPAWN_TIMEOUT,
  );

  it(
    "fails, naming the file, when a declared artifact was never built",
    () => {
      const r = runWrapper(noBuild, [...OFFLINE, ...NODE16]);
      expect(r.code).not.toBe(0);
      expect(r.out).toContain("./dist/index.d.ts");
      expect(r.out).toContain("missing");
    },
    SPAWN_TIMEOUT,
  );

  it(
    "does not predict attw's exit code when only JS is missing",
    () => {
      // Measured: with the declarations intact, bare attw reports no problems and
      // exits 0 on this fixture. The preflight still reds it, but must not tell the
      // reader something about attw's behaviour that is false for this case.
      const bare = runAttw(jsMissing, [...OFFLINE, ...NODE16]);
      expect(bare.out).toContain("No problems found");
      expect(bare.code).toBe(0);
      const r = runWrapper(jsMissing, [...OFFLINE, ...NODE16]);
      expect(r.code).not.toBe(0);
      expect(r.out).toContain("./dist/index.js");
      expect(r.out).not.toContain(UNTYPED);
    },
    SPAWN_TIMEOUT,
  );

  it(
    "still fails when attw itself fails, with attw's own status",
    () => {
      const bare = runAttw(attwFails, [...OFFLINE, ...NODE16]);
      expect(bare.code).not.toBe(0);
      expect(bare.out).not.toContain(UNTYPED);
      const wrapped = runWrapper(attwFails, [...OFFLINE, ...NODE16]);
      expect(wrapped.code).toBe(bare.code);
    },
    SPAWN_TIMEOUT,
  );

  it(
    "is transparent on a package that really does ship types",
    () => {
      const bare = runAttw(wellFormed, [...OFFLINE, ...NODE16]);
      const wrapped = runWrapper(wellFormed, [...OFFLINE, ...NODE16]);
      expect(bare.out).not.toContain(UNTYPED);
      expect(wrapped.code).toBe(bare.code);
      expect(wrapped.code).toBe(0);
    },
    SPAWN_TIMEOUT,
  );
});

describe("--profile node16 survives the port", () => {
  it(
    "forwards the flag, on a fixture whose verdict depends on it",
    () => {
      // Without the profile, node10 resolution of the subpath fails and attw exits
      // non-zero. With it, that resolution is ignored and the package is clean. So
      // a wrapper that silently dropped the flag would red here, not pass.
      const bareStrict = runAttw(subpathPkg, OFFLINE);
      expect(bareStrict.code).not.toBe(0);
      const bareNode16 = runAttw(subpathPkg, [...OFFLINE, ...NODE16]);
      expect(bareNode16.code).toBe(0);

      const wrappedStrict = runWrapper(subpathPkg, OFFLINE);
      expect(wrappedStrict.code).toBe(bareStrict.code);
      const wrappedNode16 = runWrapper(subpathPkg, [...OFFLINE, ...NODE16]);
      expect(wrappedNode16.code).toBe(0);
      expect(wrappedNode16.out).toContain("ignoring resolutions");
    },
    SPAWN_TIMEOUT,
  );

  it("is the flag package.json actually passes to this wrapper", () => {
    // The tests above prove the wrapper honours the flag. This one proves the
    // repo still sends it: a port that pointed the script at the wrapper and
    // dropped `--profile node16` would leave every test above green.
    const manifest = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(manifest.scripts["attw"]).toBe("node scripts/attw.mjs --profile node16");
  });
});

describe("the refusals that keep the post-check readable", () => {
  // THE BLINDING IS ASSERTED HERE, NOT CLAIMED IN A COMMENT. Each spelling below is
  // run through the REAL binary on the very fixture whose tarball carries no types,
  // and the assertion is the thing that makes the refusal worth having: exit 0 with
  // the untyped sentence absent from everything this gate can read. If a future attw
  // stops blinding on one of these, that case reds and the refusal can be revisited
  // deliberately rather than kept out of superstition.
  it.each([
    ["--quiet", ["--quiet"]],
    ["-q", ["-q"]],
    ["--format json", ["--format", "json"]],
    ["-f json", ["-f", "json"]],
    ["--format=json", ["--format=json"]],
    // COMBINED SHORT-OPTION CLUSTERS. commander reads `-Pf json` as
    // `--pack --format json`, so `-f` never appears as an argv token and a
    // whole-token refusal misses it. A draft of this guard did exactly that, and
    // this spelling walked back to exit 0 over an untyped pack. The wrapper still
    // passes `--pack .` itself, so the duplicate `-P` here is harmless and the
    // point stands: what matters is that `f` reached attw's format option.
    ["-Pf json", ["-Pf", "json"]],
    ["-Pq", ["-Pq"]],
  ])(
    "refuses %s, which really does blind bare attw",
    (_name, extra) => {
      const bare = runAttw(typesNotPacked, [...OFFLINE, ...NODE16, ...extra]);
      expect(bare.code).toBe(0);
      expect(bare.out).not.toContain(UNTYPED);

      const r = runWrapper(typesNotPacked, [...OFFLINE, ...NODE16, ...extra]);
      expect(r.code).not.toBe(0);
      expect(r.out).toContain("attw gate");
      expect(r.out).not.toContain("🌟");
    },
    SPAWN_TIMEOUT,
  );

  // --config-path is refused BY INFERENCE, NOT MEASUREMENT: it would move the config
  // file out of view rather than blind the output directly, and no run of it was
  // taken. So this case pins only the refusal, and deliberately asserts nothing about
  // what bare attw would do with it. Do not "complete" it by adding a bare-attw leg
  // that was never measured, that is how a claim outgrows its evidence.
  it("refuses --config-path, on inference rather than a measurement", () => {
    const r = runWrapper(typesNotPacked, [...OFFLINE, ...NODE16, "--config-path", "other.json"]);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain("attw gate");
    expect(r.out).not.toContain("🌟");
  });

  it(
    "refuses a .attw.json that sets quiet or format",
    () => {
      const dir = join(root, "config-blinded");
      writePkg(
        dir,
        {
          name: "attw-gate-fixture-configblind",
          version: "1.0.0",
          main: "./index.js",
          types: "./index.d.ts",
          files: ["index.js"],
        },
        {
          "index.js": "module.exports = {};\n",
          "index.d.ts": "export declare const a: number;\n",
          ".attw.json": JSON.stringify({ quiet: true }),
        },
      );
      // Bare attw takes the config and goes silent: exit 0 over an untyped pack.
      const bare = runAttw(dir, [...OFFLINE, ...NODE16]);
      expect(bare.code).toBe(0);
      expect(bare.out).not.toContain(UNTYPED);

      const r = runWrapper(dir, [...OFFLINE, ...NODE16]);
      expect(r.code).not.toBe(0);
      expect(r.out).toContain(".attw.json");
    },
    SPAWN_TIMEOUT,
  );
});
