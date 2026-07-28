/**
 * Release-shape smoke test, run against the BUILT `dist/` after `build`, the way an installer loads
 * the package. Proves three release-readiness facts the source tree cannot:
 *
 * 1. **Every published subpath imports in BOTH module systems.** Each `exports` entry loads as ESM
 *    (`import`) and CJS (`require`) and exposes its headline function.
 * 2. **The shared-core chunk is real (the tsup `splitting` setting).** A `DeidContext` created via the
 *    root entry is honored by a per-format adapter from a *different* subpath, i.e. they share one
 *    `DeidContext` registry, so mixing `createDeidContext` with `deidentify*` does not throw a
 *    fail-closed `DEID_NO_KEY`. Verified in ESM and CJS.
 * 3. **The built HL7 artifact does not leak a seeded synthetic sentinel.** Scoped exactly: the sweep
 *    runs over `deidentifyHl7`'s output and no other adapter's, so this is a release-shape leak check
 *    for one format, not a cross-format one. The cross-format zero-leak and clinical-survivor gates
 *    are `test/corpus/`, which runs from source under `pnpm test`. Do not read this line as covering
 *    the other five adapters; they are checked here for load and export shape only.
 *
 * Zero external test framework, a plain node script so it slots into the CI ladder after `build`.
 * All values are synthetic. Exit non-zero on any failure.
 *
 * ▶ WHAT THE SUBPATH LIST IS DERIVED FROM, AND WHY IT IS NOT A LIST HERE.
 * The set of subpaths this script loads is read out of `package.json`'s `exports` map at run time,
 * and the file paths come from that map's own `import`/`require` conditions. Only the headline
 * export NAME per subpath is declared below, and the two sets are asserted EQUAL before anything
 * loads: a subpath published without an entry here is a FAILURE, not a silent skip, and an entry
 * here for a subpath that is no longer published is a failure too.
 *
 * That is deliberate. A gate whose scope is a hand-maintained list inside the gate can be narrowed
 * without touching the workflow that runs it and without touching the ruleset that requires it, so
 * it keeps reporting green over a shrinking subject. This repo already carries one gate with that
 * shape (the leak corpus, scoped by the `include` glob in `vitest.config.ts`) and it is called out
 * in `CLAUDE.md` as a hazard. Do not reintroduce it here: the published `exports` map is the
 * subject, so the subject cannot shrink without the published surface shrinking with it.
 */

import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = (p) => join(root, p);

const failures = [];
const check = (cond, msg) => {
  if (!cond) failures.push(msg);
};

/**
 * The headline export each published subpath must expose. Keys are asserted to match
 * `package.json`'s `exports` exactly, so this map cannot fall behind the published surface.
 */
const HEADLINE = {
  ".": "deidentify",
  "./hl7": "deidentifyHl7",
  "./ccda": "deidentifyCcda",
  "./fhir": "deidentifyFhir",
  "./x12": "deidentifyX12",
  "./ncpdp": "deidentifyTelecom",
  "./dicom": "deidentifyDicom",
};

/**
 * True for an `exports` entry that is data rather than a loadable JS entry point, i.e. a bare
 * string target ending in `.json` (`"./package.json": "./package.json"`).
 *
 * Derived on purpose, and this is not a detail. The obvious spelling is a set of excluded keys, but
 * a hand-maintained exclusion set is a second lever on the gate's scope: adding `"./dicom"` to it
 * and deleting one line from `HEADLINE` drops a published adapter out of the check while `exports`
 * is untouched and the run still reports green. That is the same escape hatch this file exists to
 * close, one level up. There is no list to edit here: a subpath leaves the gate's subject only by
 * ceasing to be a JS entry point in `package.json`, which is not something that happens quietly.
 */
const isDataEntry = (target) => typeof target === "string" && target.endsWith(".json");

/**
 * Read the published subpaths out of `package.json` and pair each with its headline export.
 * Refuses (throws) rather than trimming its own scope if the two sets disagree.
 */
function resolveSubpaths() {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const exportsMap = pkg.exports;
  if (exportsMap === null || typeof exportsMap !== "object") {
    throw new Error("package.json has no `exports` map: nothing to smoke");
  }

  const published = Object.keys(exportsMap).filter((k) => !isDataEntry(exportsMap[k]));
  const declared = Object.keys(HEADLINE);

  const unchecked = published.filter((k) => !declared.includes(k));
  const stale = declared.filter((k) => !published.includes(k));
  if (unchecked.length > 0 || stale.length > 0) {
    throw new Error(
      "the smoke's subpath coverage does not match package.json `exports`" +
        (unchecked.length > 0 ? `; published but unchecked: ${unchecked.join(", ")}` : "") +
        (stale.length > 0 ? `; declared here but not published: ${stale.join(", ")}` : "") +
        ". Add the headline export to HEADLINE in this file rather than narrowing the check.",
    );
  }
  if (published.length === 0) {
    throw new Error("package.json `exports` publishes no entry points: nothing to smoke");
  }
  if (!published.includes(".")) {
    throw new Error("package.json `exports` has no root entry `.`");
  }

  return published.map((name) => {
    const entry = exportsMap[name];
    const esm = entry?.import?.default;
    const cjs = entry?.require?.default;
    if (typeof esm !== "string" || typeof cjs !== "string") {
      throw new Error(
        `package.json \`exports\` for "${name}" is missing an import.default and/or require.default target`,
      );
    }
    return { name, esm, cjs, fn: HEADLINE[name] };
  });
}

const SUBPATHS = resolveSubpaths();

const SYNTHETIC_HL7 =
  "MSH|^~\\&|A|B|C|D|20200101||ADT^A01|1|P|2.5\r" +
  "PID|1||ZZSMOKEMRN^^^HOSP^MR||ZZSMOKEFAMILY^ZZSMOKEGIVEN||19800101|M|||1 Main St^^Boston^MA^02115\r";
const HL7_SENTINELS = ["ZZSMOKEMRN", "ZZSMOKEFAMILY", "ZZSMOKEGIVEN"];

async function run() {
  // 1) Every subpath imports in ESM and CJS and exposes its headline function.
  for (const s of SUBPATHS) {
    const esm = await import(dist(s.esm));
    check(typeof esm[s.fn] === "function", `ESM ${s.name}: missing export ${s.fn}`);
    const cjs = require(dist(s.cjs));
    check(typeof cjs[s.fn] === "function", `CJS ${s.name}: missing export ${s.fn}`);
  }

  // 2) Shared-core chunk: a root-created context is honored by the /hl7 adapter (tsup `splitting`).
  const { parseHL7 } = require("@cosyte/hl7");
  const entry = (name) => {
    const s = SUBPATHS.find((x) => x.name === name);
    if (s === undefined) throw new Error(`the cross-subpath check needs "${name}" to be published`);
    return s;
  };

  const esmRoot = await import(dist(entry(".").esm));
  const esmHl7 = await import(dist(entry("./hl7").esm));
  const esmCtx = esmRoot.createDeidContext({ key: "smoke-key", patientId: "p1" });
  let esmWire = "";
  try {
    esmWire = esmHl7
      .deidentifyHl7(parseHL7(SYNTHETIC_HL7), { context: esmCtx })
      .document.toString();
  } catch (err) {
    failures.push(
      `ESM cross-subpath context threw ${err?.code ?? ""} ${String(err?.message ?? err)}`,
    );
  }
  for (const sent of HL7_SENTINELS) {
    check(!esmWire.includes(sent), `ESM leak: sentinel ${sent} survived`);
  }

  const cjsRoot = require(dist(entry(".").cjs));
  const cjsHl7 = require(dist(entry("./hl7").cjs));
  const cjsCtx = cjsRoot.createDeidContext({ key: "smoke-key", patientId: "p1" });
  let cjsWire = "";
  try {
    cjsWire = cjsHl7
      .deidentifyHl7(parseHL7(SYNTHETIC_HL7), { context: cjsCtx })
      .document.toString();
  } catch (err) {
    failures.push(
      `CJS cross-subpath context threw ${err?.code ?? ""} ${String(err?.message ?? err)}`,
    );
  }
  for (const sent of HL7_SENTINELS) {
    check(!cjsWire.includes(sent), `CJS leak: sentinel ${sent} survived`);
  }
}

run()
  .then(() => {
    if (failures.length > 0) {
      console.error("✗ release smoke FAILED:");
      for (const f of failures) console.error("    - " + f);
      process.exit(1);
    }
    console.log(
      `✓ release smoke: all ${SUBPATHS.length} published subpaths load (ESM+CJS), ` +
        "shared context honored cross-subpath, no HL7 leak",
    );
  })
  .catch((err) => {
    console.error("✗ release smoke crashed:", err);
    process.exit(1);
  });
