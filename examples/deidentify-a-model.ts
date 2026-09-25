/**
 * Apply the built-in Safe Harbor policy to a generic locus model and read the value-free manifest.
 *
 * The core works on a flat list of structurally located values; the per-format adapters build that
 * list for you. Identifiers are removed, a date keeps its year, a ZIP keeps a safe three-digit
 * prefix, a clinical value is kept untouched, and anything uncertain (free text, a value with no
 * known category) is blocked. The result is "Safe-Harbor-transformed per the configured policy":
 * a record of what the code did, not a certification that the output is de-identified.
 *
 * Run it after `pnpm build`:
 *
 *     pnpm tsx examples/deidentify-a-model.ts
 */

import assert from "node:assert/strict";

import { deidentify, OUTPUT_LABEL, SAFE_HARBOR_CATEGORIES } from "@cosyte/deid";

// Synthetic values in the shape of the repository's own fixtures: none of them is a person.
const syntheticName = "ZZLABFAMILY^ZZLABGIVEN";
const syntheticDateOfBirth = "19850302";
const syntheticZip = "90210";
const narrative = "Reported by ZZLABFAMILY on behalf of the ordering provider.";

const { document, manifest } = deidentify(
  {
    loci: [
      {
        path: "PID-5",
        kind: "identifier",
        category: SAFE_HARBOR_CATEGORIES.NAMES,
        value: syntheticName,
      },
      {
        path: "PID-7",
        kind: "date",
        category: SAFE_HARBOR_CATEGORIES.DATES,
        value: syntheticDateOfBirth,
      },
      {
        path: "PID-11",
        kind: "zip",
        category: SAFE_HARBOR_CATEGORIES.GEOGRAPHIC,
        value: syntheticZip,
      },
      { path: "OBX-5", kind: "clinical", value: "140 mmol/L" },
      { path: "NTE-3", kind: "freetext", value: narrative },
      { path: "ZPI-2", kind: "unknown", value: "ZZSECRETNOTE" },
    ],
  },
  {},
);

for (const locus of document.loci) {
  console.log(
    `${locus.path.padEnd(7)} ${locus.disposition.padEnd(12)} ${JSON.stringify(locus.value)}`,
  );
}

const byPath = new Map(document.loci.map((locus) => [locus.path, locus]));
assert.equal(byPath.get("PID-5")?.value, null, "the name is removed");
assert.equal(byPath.get("PID-7")?.value, "1985", "the date of birth keeps its year only");
assert.equal(byPath.get("PID-11")?.value, "902", "the ZIP keeps a safe three-digit prefix");
assert.equal(byPath.get("OBX-5")?.value, "140 mmol/L", "the clinical value is retained untouched");
assert.equal(byPath.get("NTE-3")?.disposition, "blocked", "free text fails closed");
assert.equal(byPath.get("ZPI-2")?.disposition, "blocked", "a value of unknown kind fails closed");

// The manifest records category, transform, locus, count, disposition and code: never a value.
console.log("manifest:");
for (const entry of manifest) {
  console.log(
    `  ${entry.locus.padEnd(7)} ${entry.category.padEnd(16)} ${entry.transform.padEnd(11)} ${entry.code}`,
  );
}
const recorded = JSON.stringify(manifest);
for (const input of [
  syntheticName,
  syntheticDateOfBirth,
  syntheticZip,
  narrative,
  "ZZSECRETNOTE",
]) {
  assert.ok(!recorded.includes(input), "the manifest carries no input value");
}

console.log(`label: ${OUTPUT_LABEL}`);
assert.equal(OUTPUT_LABEL, "Safe-Harbor-transformed per the configured policy");
