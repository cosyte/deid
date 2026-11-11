// Benchmarks for @cosyte/deid, on @cosyte/bench, against the built entries a consumer imports.
//
// A reading of this build (throughput, latency p50/p95/p99, allocations, peak heap, a long run for
// leaks, and the cold import with every file it loads and its gzip size):
//   pnpm build && pnpm bench:reading --out bench-results/reading.json
// One format only (its benchmarks are named `<format> ...`):
//   pnpm bench:reading --only "HL7 v2: text in, text out" --only "HL7 v2: adapter on a parsed message"
// A base against head comparison, the base built in another checkout:
//   pnpm bench:compare --base <base checkout>/bench/target.mjs --head bench/target.mjs
// The budgets, read from a reading, and the profile (peak memory with Buffers counted, single-call
// time and throughput at every size, and a CPU and heap profile of the hottest paths):
//   pnpm bench:budgets bench-results/reading.json
//   pnpm bench:profile --out bench-results/profile
// The cold import of each published entry on its own:
//   pnpm bench:imports
// On a pull request CI runs the comparison in its bench-compare job, and the Bench workflow takes a
// reading and a profile on a GitHub-hosted runner. Both are advisory: they post their numbers and
// fail nothing.
//
// The suite is handed the module under test rather than importing it, so one file measures both
// builds. That module is bench/target.mjs, which gathers this package's subpath entries and the
// parsers beside them. Every input is synthetic and built in code by bench/shapes.mjs: no file is
// read.

import { Buffer } from "node:buffer";

import { defineBenchmark, defineSuite } from "@cosyte/bench";

import {
  ccdaDocument,
  ctImage,
  enhancedCt,
  fhirBundle,
  fhirPatient,
  hl7Batch,
  hl7Message,
  locusModel,
  x12Claims,
} from "./shapes.mjs";

/**
 * The keyed policy a research extract runs: names, MRNs and accounts pseudonymized, dates shifted,
 * SSNs hashed, so the engine's HMAC paths are measured beside the Safe Harbor default.
 */
function keyedOptions(pkg) {
  const C = pkg.deid.SAFE_HARBOR_CATEGORIES;
  return {
    policy: pkg.deid.defineDeidPolicy({
      name: "bench-keyed",
      transforms: {
        [C.NAMES]: "pseudonymize",
        [C.MRN]: "pseudonymize",
        [C.ACCOUNT]: "pseudonymize",
        [C.DATES]: "date-shift",
        [C.SSN]: "hash",
      },
    }),
    context: pkg.deid.createDeidContext({
      key: "bench-synthetic-hmac-key-0123456789",
      patientId: "bench",
    }),
  };
}

/** De-identify every message of an HL7 v2 batch and write each back: what a batch consumer does. */
export function deidentifyHl7Batch(pkg, text) {
  const out = [];
  for (const entry of pkg.hl7.splitBatch(text).messages) {
    // A message the parser refuses is not de-identified; the shapes never carry one.
    if (entry.ok) out.push(pkg.deidHl7.deidentifyHl7(entry.message).document.toString());
  }
  return out.join("");
}

// Each format at the size a feed sends all day, then at sizes well past it. `inputs` keeps a pass
// at the small sizes from being one input repeated. `bytes` is the size of the input as text or as
// a file. The pull request comparison runs only the sizes marked `compare`: it runs every case 24
// times in fresh processes inside a 600 second budget shared by the whole suite.
export const FORMATS = [
  {
    name: "HL7 v2",
    sizes: [
      { label: "1 ORU^R01, 1.6 KiB", inputs: 64, build: (i) => hl7Message(i), compare: true },
      { label: "batch of 100, 160 KiB", inputs: 1, build: (i) => hl7Batch(i, 100) },
      { label: "batch of 1,000, 1.6 MiB", inputs: 1, build: (i) => hl7Batch(i, 1_000) },
    ],
    // Text in, text out: split the batch, parse, de-identify and write each message.
    endToEnd: (pkg) => (text) => deidentifyHl7Batch(pkg, text),
    // The parsed messages, kept per input, so the adapter's own cost is timed alone.
    parse: (pkg, text) => pkg.hl7.splitBatch(text).messages.map((e) => e.message),
    adapter: (pkg) => (messages) => {
      let n = 0;
      for (const m of messages) n += pkg.deidHl7.deidentifyHl7(m).manifest.length;
      return n;
    },
  },
  {
    name: "FHIR R4",
    sizes: [
      { label: "1 Patient, 1 KiB", inputs: 64, build: (i) => fhirPatient(i), compare: true },
      { label: "Bundle of 100, 60 KiB", inputs: 1, build: (i) => fhirBundle(i, 100) },
      { label: "Bundle of 1,000, 600 KiB", inputs: 1, build: (i) => fhirBundle(i, 1_000) },
      { label: "Bundle of 10,000, 5.8 MiB", inputs: 1, build: (i) => fhirBundle(i, 10_000) },
    ],
    endToEnd: (pkg) => (text) => pkg.deidFhir.deidentifyFhirJson(text).json,
    parse: (pkg, text) => pkg.fhir.parseResource(text).resource,
    adapter: (pkg) => (resource) => pkg.deidFhir.deidentifyFhir(resource).manifest.length,
  },
  {
    name: "C-CDA",
    sizes: [
      { label: "10 results, 11 KiB", inputs: 16, build: (i) => ccdaDocument(i, 10), compare: true },
      { label: "100 results, 68 KiB", inputs: 1, build: (i) => ccdaDocument(i, 100) },
      { label: "1,000 results, 640 KiB", inputs: 1, build: (i) => ccdaDocument(i, 1_000) },
    ],
    endToEnd: (pkg) => (text) =>
      pkg.deidCcda.deidentifyCcda(pkg.ccda.parseCcda(text)).document.toString(),
    parse: (pkg, text) => pkg.ccda.parseCcda(text),
    adapter: (pkg) => (doc) => pkg.deidCcda.deidentifyCcda(doc).manifest.length,
  },
  {
    name: "X12 837P",
    sizes: [
      { label: "1 claim, 1 KiB", inputs: 64, build: (i) => x12Claims(i, 1), compare: true },
      { label: "100 claims, 56 KiB", inputs: 1, build: (i) => x12Claims(i, 100) },
      { label: "1,000 claims, 560 KiB", inputs: 1, build: (i) => x12Claims(i, 1_000) },
      { label: "5,000 claims, 2.7 MiB", inputs: 1, build: (i) => x12Claims(i, 5_000) },
    ],
    endToEnd: (pkg) => (text) => pkg.deidX12.deidentifyX12String(text).x12,
    parse: (pkg, text) => pkg.x12.parseX12(text),
    adapter: (pkg) => (interchange) => pkg.deidX12.deidentifyX12(interchange).x12,
  },
  {
    name: "DICOM",
    sizes: [
      { label: "CT slice, 514 KiB", inputs: 4, build: (i) => ctImage(i), compare: true },
      { label: "Enhanced CT, 20 frames, 10 MiB", inputs: 1, build: (i) => enhancedCt(i, 20) },
      { label: "Enhanced CT, 200 frames, 100 MiB", inputs: 1, build: (i) => enhancedCt(i, 200) },
    ],
    endToEnd: (pkg) => (bytes) => pkg.deidDicom.deidentifyDicomBuffer(bytes).bytes,
    parse: (pkg, bytes) => pkg.dicom.parseDicom(bytes),
    adapter: (pkg) => (dataset) => pkg.deidDicom.deidentifyDicom(dataset).manifest.length,
  },
];

/** The policy engine on the format-agnostic locus model, at a message's loci and far past it. */
export const ENGINE_SIZES = [
  { label: "16 loci", inputs: 64, loci: 16, compare: true },
  { label: "1,000 loci", inputs: 4, loci: 1_000 },
  { label: "100,000 loci", inputs: 1, loci: 100_000 },
];

function byteLength(input) {
  return typeof input === "string" ? Buffer.byteLength(input) : input.length;
}

/**
 * One input: its text or bytes, in an object so a parsed model can be cached against it rather
 * than against a string.
 */
function sizes(format) {
  return format.sizes.map((size) => ({
    label: size.label,
    compare: size.compare ?? false,
    build: () => {
      const inputs = Array.from({ length: size.inputs }, (_v, i) => ({ raw: size.build(i) }));
      return { inputs, bytes: inputs.reduce((n, x) => n + byteLength(x.raw), 0) };
    },
  }));
}

/**
 * The parsed model of an input, parsed once and kept, so the adapter benchmark times only the
 * adapter. The warmup runs every input many times before any sample is taken, so no sample
 * includes that parse. The adapters never change their input.
 */
function modelOf(format, pkg) {
  const models = new WeakMap();
  return (x) => {
    let model = models.get(x);
    if (model === undefined) {
      model = format.parse(pkg, x.raw);
      models.set(x, model);
    }
    return model;
  };
}

function engineSizes() {
  return ENGINE_SIZES.map((size) => ({
    label: size.label,
    compare: size.compare ?? false,
    build: () => {
      const inputs = Array.from({ length: size.inputs }, (_v, i) => locusModel(i, size.loci));
      return {
        inputs,
        bytes: inputs.reduce((n, model) => n + Buffer.byteLength(JSON.stringify(model)), 0),
      };
    },
  }));
}

const benchmarks = [];
for (const format of FORMATS) {
  benchmarks.push(
    defineBenchmark({
      // What a consumer runs: the text or the file in, the transformed text or file out.
      name: `${format.name}: text in, text out`,
      sizes: sizes(format),
      bind: (pkg) => {
        const run = format.endToEnd(pkg);
        return (x) => run(x.raw);
      },
      weigh: (out) => byteLength(out),
    }),
    defineBenchmark({
      // The adapter alone on a model parsed beforehand: locate, transform, apply, verify.
      name: `${format.name}: adapter on a parsed model`,
      sizes: sizes(format).map((size) => ({ ...size, compare: false })),
      bind: (pkg) => {
        const model = modelOf(format, pkg);
        const run = format.adapter(pkg);
        return (x) => run(model(x));
      },
      weigh: (out) => (typeof out === "number" ? out : byteLength(out)),
    }),
  );
}

benchmarks.push(
  defineBenchmark({
    // The format-agnostic core under the built-in Safe Harbor policy: redact and generalize.
    name: "policy engine: Safe Harbor",
    sizes: engineSizes(),
    bind: (pkg) => (model) => pkg.deid.deidentify(model, {}),
    weigh: (result) => result.manifest.length,
  }),
  defineBenchmark({
    // The same loci under a keyed policy: pseudonymize, date-shift and hash through HMAC.
    name: "policy engine: keyed",
    sizes: engineSizes(),
    bind: (pkg) => {
      const options = keyedOptions(pkg);
      return (model) => pkg.deid.deidentify(model, options);
    },
    weigh: (result) => result.manifest.length,
  }),
);

export default defineSuite({ name: "@cosyte/deid", benchmarks });
