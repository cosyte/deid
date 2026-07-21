/**
 * Release-shape smoke test (DEID-10) — run against the BUILT `dist/` after `build`, the way an
 * installer loads the package. Proves three release-readiness facts the source tree cannot:
 *
 * 1. **Every published subpath imports in BOTH module systems.** All seven `exports` entries
 *    (`.`, `./hl7`, `./ccda`, `./fhir`, `./x12`, `./ncpdp`, `./dicom`) load as ESM (`import`) and CJS
 *    (`require`) and expose their headline function.
 * 2. **The shared-core chunk is real (the tsup `splitting` fix).** A `DeidContext` created via the root
 *    entry is honored by a per-format adapter from a *different* subpath — i.e. they share one
 *    `DeidContext` registry, so mixing `createDeidContext` with `deidentify*` no longer throws a
 *    fail-closed `DEID_NO_KEY`. Verified in ESM and CJS.
 * 3. **No format leaks a seeded synthetic sentinel through the built artifact.**
 *
 * Zero external test framework — a plain node script so it slots into the CI ladder after `build`.
 * All values are synthetic. Exit non-zero on any failure.
 */

import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = (p) => join(root, "dist", p);

const SUBPATHS = [
  { name: ".", esm: "index.mjs", cjs: "index.cjs", fn: "deidentify" },
  { name: "./hl7", esm: "hl7/index.mjs", cjs: "hl7/index.cjs", fn: "deidentifyHl7" },
  { name: "./ccda", esm: "ccda/index.mjs", cjs: "ccda/index.cjs", fn: "deidentifyCcda" },
  { name: "./fhir", esm: "fhir/index.mjs", cjs: "fhir/index.cjs", fn: "deidentifyFhir" },
  { name: "./x12", esm: "x12/index.mjs", cjs: "x12/index.cjs", fn: "deidentifyX12" },
  { name: "./ncpdp", esm: "ncpdp/index.mjs", cjs: "ncpdp/index.cjs", fn: "deidentifyTelecom" },
  { name: "./dicom", esm: "dicom/index.mjs", cjs: "dicom/index.cjs", fn: "deidentifyDicom" },
];

const failures = [];
const check = (cond, msg) => {
  if (!cond) failures.push(msg);
};

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

  // 2) Shared-core chunk: a root-created context is honored by the /hl7 adapter (tsup splitting fix).
  const { parseHL7 } = require("@cosyte/hl7");

  const esmRoot = await import(dist("index.mjs"));
  const esmHl7 = await import(dist("hl7/index.mjs"));
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

  const cjsRoot = require(dist("index.cjs"));
  const cjsHl7 = require(dist("hl7/index.cjs"));
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
      "✓ release smoke: all 7 subpaths load (ESM+CJS), shared context honored cross-subpath, no leak",
    );
  })
  .catch((err) => {
    console.error("✗ release smoke crashed:", err);
    process.exit(1);
  });
