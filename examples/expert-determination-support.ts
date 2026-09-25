/**
 * Build the Expert Determination support report from a manifest, and see what it will not say.
 *
 * HIPAA has two routes to de-identification. Safe Harbor is mechanical, and this library applies
 * it. Expert Determination (45 CFR 164.514(b)(1)) is a qualified statistician's judgment about a
 * specific dataset and its recipient. `@cosyte/deid` supports that judgment and never renders it:
 * the report structures what a pass did and what it left in place, `determination` is always
 * `null`, and no re-identification risk score is computed. The determination, and any
 * certification, stays with you and your expert.
 *
 * Run it after `pnpm build`:
 *
 *     pnpm tsx examples/expert-determination-support.ts
 */

import assert from "node:assert/strict";

import { parseHL7 } from "@cosyte/hl7";

import {
  buildExpertDeterminationSupportReport,
  EXPERT_DETERMINATION_DISCLAIMER,
  formatExpertDeterminationSupportReport,
} from "@cosyte/deid";
import { deidentifyHl7 } from "@cosyte/deid/hl7";

// A synthetic ADT^A01 in the shape of the repository's fixtures: ZZ placeholders, a reserved 555
// phone number, a 900-range number that is never issued.
const message = [
  "MSH|^~\\&|SENDAPP|SENDFAC|RECVAPP|RECVFAC|20200101120000||ADT^A01|SYNTHMSG001|P|2.5",
  "PID|1||ZZMRN001^^^HOSP^MR||ZZFAMILY^ZZGIVEN||19900215|M|||ZZSTREET^^ZZCITY^MA^90210||5550000001|||||ZZACCT018|900000005",
  "PV1|1|I|WARD^ROOM^BED",
].join("\r");

const { manifest, unexaminedResiduals } = deidentifyHl7(parseHL7(message));
const report = buildExpertDeterminationSupportReport(manifest, {
  policy: "safe-harbor",
  unexaminedResiduals,
});

console.log(`determination: ${String(report.determination)}`);
console.log(`output label: ${report.outputLabel}`);
console.log(
  `loci acted on: ${String(report.totals.loci)}, Safe Harbor categories acted on: ${String(report.totals.categoriesActedOn)} of 18`,
);
console.log(
  `retained quasi-identifiers: ${report.retainedQuasiIdentifiers.map((q) => q.locus).join(", ")}`,
);
console.log(
  `positions no rule examined: ${String(report.unexaminedResiduals.length)} (measured: ${String(report.unexaminedResidualsMeasured)})`,
);

assert.equal(report.determination, null, "the library never renders a determination");
assert.equal(
  report.unexaminedResidualsMeasured,
  true,
  "the residual inventory was handed over and measured",
);
assert.equal(report.disclaimer, EXPERT_DETERMINATION_DISCLAIMER);
assert.ok(report.disclaimer.includes("NOT a determination"));

// The Markdown rendering for a statistician leads with the same disclaimer.
const markdown = formatExpertDeterminationSupportReport(report);
console.log(markdown.split("\n").slice(0, 3).join("\n"));
assert.ok(markdown.includes("NOT A DETERMINATION"));
assert.ok(!markdown.includes("ZZFAMILY"), "the report is value-free");
