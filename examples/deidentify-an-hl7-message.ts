/**
 * De-identify a parsed HL7 v2 ORU^R01 with the `@cosyte/deid/hl7` adapter.
 *
 * The adapter locates identifiers by the message's structure (PID-5 is the patient's name because
 * HL7 v2 says so), never by a regular expression over the bytes, and returns a transformed
 * `Hl7Message` plus the value-free manifest. `@cosyte/hl7` is an optional peer dependency: install
 * it beside `@cosyte/deid` to use this subpath. The built-in Safe Harbor policy uses no keyed
 * transform, so no key is needed here.
 *
 * Run it after `pnpm build`:
 *
 *     pnpm tsx examples/deidentify-an-hl7-message.ts
 */

import assert from "node:assert/strict";

import { parseHL7 } from "@cosyte/hl7";

import { deidentifyHl7 } from "@cosyte/deid/hl7";

// The repository's synthetic fixture test/fixtures/hl7/oru-r01.hl7: every identifier is a ZZ
// placeholder, a reserved 555 phone number or a 900-range number that is never issued.
const message = [
  "MSH|^~\\&|LABAPP|LABFAC|EHRAPP|EHRFAC|20200102080000||ORU^R01|SYNTHMSG002|P|2.5",
  "PID|1||ZZMRN002^^^HOSP^MR||ZZLABFAMILY^ZZLABGIVEN||19850302|F|||ZZLABSTREET^^ZZLABCITY^MA^90210|049|5550000010|||||ZZACCT200|900000010",
  "OBR|1|PLACER001|FILLER001|2951-2^Sodium^LN|||20200102080000",
  "OBX|1|NM|2951-2^Sodium^LN|1|140|mmol/L|135-145|N|||F",
  "OBX|2|NM|2823-3^Potassium^LN|1|4.2|mmol/L|3.5-5.1|N|||F",
  "OBX|3|CWE|883-9^ABO group^LN|1|O^O positive^L||||||F",
  "OBX|4|ST|11557-6^Interpretation^LN|1|Within normal limits|||N|||F",
  "OBX|5|TX|1234-5^Pathology note^LN|1|Specimen from ZZLABFAMILY reviewed; contact 5550000010 for questions|||||F",
  "NTE|1|L|Reported by ZZLABFAMILY on behalf of the ordering provider.",
].join("\r");

const { document, manifest, unexaminedResiduals } = deidentifyHl7(parseHL7(message));
const output = document.toString();
console.log(output.split("\r").join("\n"));

const segments = output.split("\r").map((segment) => segment.split("|"));
const pid = segments.find((fields) => fields[0] === "PID") ?? [];
const obx = segments.filter((fields) => fields[0] === "OBX");

assert.equal(pid[5], "", "PID-5, the patient's name, is removed");
assert.equal(pid[7], "1985", "PID-7, the date of birth, keeps its year only");
assert.equal(pid[11], "^^^^902", "PID-11 keeps only a safe three-digit ZIP");
assert.deepEqual(
  obx.map((fields) => fields[5]),
  ["140", "4.2", "O^O positive^L", "", ""],
  "structured clinical results survive; string and narrative results are blocked",
);

// Not one identifier from the input survives anywhere in the output, or in the manifest.
const identifiers = [
  "ZZMRN002",
  "ZZLABFAMILY",
  "ZZLABGIVEN",
  "19850302",
  "ZZLABSTREET",
  "ZZLABCITY",
  "5550000010",
  "ZZACCT200",
  "900000010",
];
const recorded = JSON.stringify(manifest);
for (const identifier of identifiers) {
  assert.ok(!output.includes(identifier), "no input identifier survives in the output");
  assert.ok(!recorded.includes(identifier), "the manifest carries no input value");
}

const removed = manifest
  .filter((entry) => entry.disposition === "removed")
  .map((entry) => entry.locus);
const blocked = manifest
  .filter((entry) => entry.disposition === "blocked")
  .map((entry) => entry.locus);
console.log(`removed: ${removed.join(", ")}`);
console.log(`blocked (fail closed): ${blocked.join(", ")}`);
console.log(
  `positions no rule examined, counted and never cleaned: ${String(unexaminedResiduals.length)}`,
);
assert.ok(blocked.includes("NTE-3"), "the NTE comment is blocked");
