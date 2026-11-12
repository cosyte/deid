/**
 * The scaling gates for each format adapter and for the policy engine, from
 * `@cosyte/test-utils/perf`, run by `pnpm test:perf` and never under coverage (see
 * `vitest.perf.config.ts`).
 *
 * Each asks one question: does the cost of a de-identification pass grow faster than its input? On
 * the count axis, 4 times the single messages a feed sends; on the size axis, the same number of
 * documents each 4 times longer (an HL7 v2 batch of 4 times the messages, a FHIR Bundle of 4 times
 * the entries, a C-CDA of 4 times the results, an X12 interchange of 4 times the claims, an NCPDP
 * Telecom batch of 4 times the transmissions, a DICOM object of 4 times the frames, a locus model of
 * 4 times the loci). Each ratio must stay inside the band the shared contract fixes. A gate does not see a constant-factor slowdown: a pass 10% slower
 * everywhere passes, and always will. The base against head comparison on a pull request
 * (`bench/deid.bench.mjs`) is the instrument for that.
 *
 * Each self-check proves its fixtures are large enough for its gate to fail: the same pass with its
 * input read the wrong way (everything received so far walked again from the start every few
 * characters, or for DICOM copied again every 16 bytes; for the engine, every locus checked against
 * every one before it) must clear the ceiling at exactly these sizes. Every input is synthetic and built in code
 * by `bench/shapes.mjs`, the same code the benchmarks use.
 */

import { Buffer } from "node:buffer";

import {
  assertScalingGateFires,
  scalingGate,
  type ScalingGateOptions,
} from "@cosyte/test-utils/perf";
import { describe, expect, it } from "vitest";

import {
  ccdaDocument,
  ctImage,
  enhancedCt,
  fhirBundle,
  fhirPatient,
  hl7Batch,
  hl7Message,
  locusModel,
  ncpdpBatch,
  ncpdpClaim,
  x12Claims,
} from "../../bench/shapes.mjs";
import * as target from "../../bench/target.mjs";

// The built entries, through the module the benchmarks are handed, so the gate times what a
// consumer runs; `pnpm test:perf` builds first.
const { deidentify } = target.deid;
const { deidentifyCcda } = target.deidCcda;
const { deidentifyDicomBuffer } = target.deidDicom;
const { deidentifyFhirJson } = target.deidFhir;
const { deidentifyHl7 } = target.deidHl7;
const { deidentifyTelecomString } = target.deidNcpdp;
const { deidentifyX12String } = target.deidX12;
const { parseCcda } = target.ccda;
const { parseDicom } = target.dicom;
const { splitBatch } = target.hl7;

/**
 * The bytes assembled the wrong way: each time `chunk` bytes arrive, everything received so far is
 * copied again from the start, as a buffer that re-flushes its whole contents on every append
 * does. The result is the same bytes; the cost grows with the square of their length. One output
 * is allocated, so the extra cost is copying alone and not the collector.
 */
function assembleQuadratically(bytes: Buffer, chunk: number): Buffer {
  const out = Buffer.alloc(bytes.length);
  for (let end = chunk; end < bytes.length + chunk; end += chunk) {
    out.set(bytes.subarray(0, Math.min(end, bytes.length)));
  }
  return out;
}

/**
 * The text read the wrong way: each time `step` characters arrive, the reader walks everything
 * received so far from the start to find where it is, instead of carrying a cursor. The result is
 * the same text, sliced at the position the walk found; the cost grows with the square of its
 * length.
 */
function readTextQuadratically(text: string, step: number): string {
  let at = 0;
  for (let end = step; end < text.length + step; end += step) {
    const stop = Math.min(end, text.length);
    let walked = 0;
    for (let k = 0; k < stop; k++) walked += text.charCodeAt(k) === 0 ? 0 : 1;
    at = walked === stop ? stop : at;
  }
  return text.slice(0, at);
}

/** Characters between rescans in the text regressions. */
const TEXT_STEP = 4;

/** A skip is not a pass: a gate that could not measure says so here, rather than reading green. */
function expectMeasured(report: ReturnType<typeof scalingGate>): void {
  expect(report.count.status, report.count.diagnostic).toBe("measured");
  expect(report.size.status, report.size.diagnostic).toBe("measured");
}

/**
 * One gate and its self-check, the self-check on the same options the gate runs. Each sizes its own
 * phases (`selfSize`): a rep runs as many passes over the base corpus as it takes to reach 20 ms, so
 * a fixture that a fast runner finishes under the 4 ms phase floor is measured rather than skipped,
 * and the ratio the gate reads is unchanged. The floor, the ceiling and the self-check stay as they
 * are.
 */
function gate<TInput, TResult>(
  name: string,
  options: () => ScalingGateOptions<TInput, TResult>,
  regressedParse: (input: TInput) => TResult,
  equals?: (a: TResult, b: TResult) => boolean,
): void {
  const sized = (): ScalingGateOptions<TInput, TResult> => ({ ...options(), selfSize: true });
  describe(`the scaling gate: ${name}`, () => {
    it("has not acquired a complexity regression on either axis", () => {
      expectMeasured(scalingGate(sized()));
    });

    it("has fixtures large enough for that gate to fail", () => {
      const report = assertScalingGateFires(sized(), {
        regressedParse,
        ...(equals === undefined ? {} : { equals }),
      });
      expect(report.margin).toBeGreaterThan(1);
    });
  });
}

/** Split, de-identify and write back every message of an HL7 v2 batch, as a batch consumer does. */
function deidentifyHl7Text(text: string): string {
  let out = "";
  for (const entry of splitBatch(text).messages) {
    // A message the parser refuses is not de-identified; the shapes never carry one.
    if (entry.ok) out += deidentifyHl7(entry.message).document.toString();
  }
  return out;
}

const hl7 = (): ScalingGateOptions<string, string> => ({
  name: "@cosyte/deid HL7 v2, text in, text out",
  parse: deidentifyHl7Text,
  weigh: (text) => text.length,
  count: { n: 16, generate: (i) => hl7Message(i) },
  size: { inputs: 2, size: 16, generate: (i, size) => hl7Batch(i, size) },
});
gate("HL7 v2", hl7, (text) => deidentifyHl7Text(readTextQuadratically(text, TEXT_STEP)));

const fhirText = (text: string): string => deidentifyFhirJson(text).json;
const fhir = (): ScalingGateOptions<string, string> => ({
  name: "@cosyte/deid FHIR R4, text in, text out",
  parse: fhirText,
  weigh: (text) => text.length,
  count: { n: 256, generate: (i) => fhirPatient(i) },
  // Four Bundles, not two: at two, the clean base phase measured 2.8 to 3.7 ms on a fast runner,
  // under the 4 ms the contract needs to read a ratio, so the axis skipped. The ratio is unchanged.
  size: { inputs: 4, size: 50, generate: (i, size) => fhirBundle(i, size) },
});
gate("FHIR R4", fhir, (text) => fhirText(readTextQuadratically(text, TEXT_STEP)));

const ccdaText = (text: string): string => deidentifyCcda(parseCcda(text)).document.toString();
const ccda = (): ScalingGateOptions<string, string> => ({
  name: "@cosyte/deid C-CDA, text in, text out",
  parse: ccdaText,
  weigh: (text) => text.length,
  count: { n: 4, generate: (i) => ccdaDocument(i, 10) },
  size: { inputs: 2, size: 50, generate: (i, size) => ccdaDocument(i, size) },
});
gate("C-CDA", ccda, (text) => ccdaText(readTextQuadratically(text, TEXT_STEP)));

const x12Text = (text: string): string => deidentifyX12String(text).x12;
const x12 = (): ScalingGateOptions<string, string> => ({
  name: "@cosyte/deid X12 837P, text in, text out",
  parse: x12Text,
  weigh: (text) => text.length,
  count: { n: 128, generate: (i) => x12Claims(i, 1) },
  size: { inputs: 2, size: 50, generate: (i, size) => x12Claims(i, size) },
});
gate("X12 837P", x12, (text) => x12Text(readTextQuadratically(text, TEXT_STEP)));

/** De-identify and write back every transmission of an NCPDP Telecom batch, one a line. */
function deidentifyTelecomText(text: string): string {
  let out = "";
  for (const line of text.split("\n")) {
    if (line.length > 0) out += `${deidentifyTelecomString(line).telecom}\n`;
  }
  return out;
}

const ncpdp = (): ScalingGateOptions<string, string> => ({
  name: "@cosyte/deid NCPDP Telecom, text in, text out",
  parse: deidentifyTelecomText,
  weigh: (text) => text.length,
  count: { n: 64, generate: (i) => ncpdpClaim(i) },
  size: { inputs: 2, size: 64, generate: (i, size) => ncpdpBatch(i, size) },
});
gate("NCPDP Telecom", ncpdp, (text) =>
  deidentifyTelecomText(readTextQuadratically(text, TEXT_STEP)),
);

/**
 * The DICOM gate's frames are 32 by 32: the pass keeps Pixel Data as it is, so the header (one
 * Per-frame Functional Groups Item a frame, four nested sequences each) is what can grow badly,
 * and small frames keep every input under 100 KiB.
 */
const GATE_SIDE = 32;
const dicomFile = (bytes: Buffer): Buffer => deidentifyDicomBuffer(bytes).bytes;
const dicom = (): ScalingGateOptions<Buffer, Buffer> => ({
  name: "@cosyte/deid DICOM, file in, file out",
  parse: dicomFile,
  weigh: (bytes) => bytes.length,
  count: { n: 32, generate: (i) => ctImage(i, GATE_SIDE) },
  size: { inputs: 4, size: 50, generate: (i, size) => enhancedCt(i, size, GATE_SIDE) },
});
gate(
  "DICOM",
  dicom,
  (bytes) => dicomFile(assembleQuadratically(bytes, 16)),
  (a, b) => a.equals(b),
);

/**
 * The engine's input, sized in loci. Its regression checks that no two loci share a path, the rule
 * that two positions never share a manifest row, by scanning every locus before each one.
 */
type Model = ReturnType<typeof locusModel>;
const engine = (): ScalingGateOptions<Model, number> => ({
  name: "@cosyte/deid policy engine, Safe Harbor",
  parse: (model) => deidentify(model, {}).manifest.length,
  weigh: (n) => n,
  count: { n: 2_048, generate: (i) => locusModel(i, 16) },
  // 4 inputs: the manifest step no longer builds a key for every value, and 2 inputs of 8,000 loci
  // measured 3.94 ms on a GitHub runner, under the 4 ms a phase needs to be measured.
  size: { inputs: 4, size: 8_000, generate: (i, size) => locusModel(i, size) },
});
gate("policy engine", engine, (model) => {
  const loci: Model["loci"] = [];
  for (const locus of model.loci) {
    if (!loci.some((seen) => seen.path === locus.path)) loci.push(locus);
  }
  return deidentify({ loci }, {}).manifest.length;
});

// The DICOM shapes read cleanly enough to measure: the pass returns a file for every one of them.
describe("the DICOM gate's inputs", () => {
  it("are files the pass de-identifies, not files it refuses", () => {
    expect(parseDicom(ctImage(0, GATE_SIDE)).get("7FE00010")?.length).toBe(
      GATE_SIDE * GATE_SIDE * 2,
    );
    expect(dicomFile(enhancedCt(0, 4, GATE_SIDE)).length).toBeGreaterThan(
      4 * GATE_SIDE * GATE_SIDE * 2,
    );
  });
});
