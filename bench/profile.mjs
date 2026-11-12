// The parts of the audit a reading cannot give, against the built entries:
//   pnpm build && pnpm bench:profile [--out <dir>] [--only <section>]
//
// 1. Memory with every byte counted, and single-call time. The reading's peak heap is the V8 heap
//    only (a Buffer's bytes live outside it), and a size whose single call outlasts a warmup batch
//    is skipped by the reading. Here each case runs in a fresh process: it builds its input, parses
//    it first when the case is the adapter on a parsed model, settles the heap, resets the
//    process's resident high water mark (Linux, /proc/self/clear_refs), makes one call while
//    holding the result, and reads the high water mark back. That peak is every byte the call made
//    resident, transient copies included, over the input's bytes. The same process times that
//    first call, then the median of 3 warm calls.
// 2. Throughput from each shape's smallest size to its largest, timed the same simple way for every
//    size: warmed, then the median of whole passes over the size's inputs.
// 3. A CPU profile and a sampled heap profile of the hottest paths, with the top functions of each.
//    Each workload is warmed, then profiled alone for two seconds through the inspector. With
//    --enable-source-maps a function is named by its src/ file and line.
//
// `--out <dir>` writes profile.md there with every .cpuprofile and .heapprofile, for a profiler's
// own view (Chrome DevTools, speedscope). `--only memory|throughput|cpu` runs one section. The
// inputs are the bench's own, from bench/shapes.mjs: synthetic, built in code.

import { Buffer } from "node:buffer";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { Session } from "node:inspector/promises";
import { findSourceMap } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { deidentifyHl7Batch, deidentifyTelecomBatch, ENGINE_SIZES, FORMATS } from "./deid.bench.mjs";
import {
  ccdaDocument,
  enhancedCt,
  fhirBundle,
  hl7Batch,
  hl7Message,
  locusModel,
  ncpdpBatch,
  x12Claims,
} from "./shapes.mjs";

const PROFILE_MS = 2_000;
const WARMUP_MS = 500;
const TOP = 10;
/** Sizes below this are left to the reading's peak heap: the resident set moves in pages and arenas. */
const RESIDENT_MIN_BYTES = 256 * 1024;

const OPERATIONS = ["text in, text out", "adapter on a parsed model", "parser alone, text in, text out"];

function args(argv) {
  const out = { target: argv[0], dir: undefined, memoryCase: undefined, only: undefined };
  for (let i = 1; i < argv.length; i++) {
    if (argv[i] === "--out") out.dir = argv[++i];
    else if (argv[i] === "--memory-case") out.memoryCase = argv[++i];
    else if (argv[i] === "--only") out.only = argv[++i];
  }
  return out;
}

function byteLength(input) {
  return typeof input === "string" ? Buffer.byteLength(input) : input.length;
}

/** The function one operation of a format measures, its model parsed beforehand for the adapter. */
function operation(pkg, format, op, raw) {
  if (op === OPERATIONS[0]) {
    const run = format.endToEnd(pkg);
    return () => run(raw);
  }
  if (op === OPERATIONS[2]) {
    const run = format.parserAlone(pkg);
    return () => run(raw);
  }
  const model = format.parse(pkg, raw);
  const run = format.adapter(pkg);
  return () => run(model);
}

/** The policy engine as a format: its input is the locus model, sized by its JSON. */
function engineOperation(pkg, keyed, model) {
  // Named, so a profile charges the call to this frame by name rather than to a neighbour's.
  if (!keyed) return function safeHarborPass() {
    return pkg.deid.deidentify(model, {});
  };
  const C = pkg.deid.SAFE_HARBOR_CATEGORIES;
  const options = {
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
  return () => pkg.deid.deidentify(model, options);
}

/** Every memory case: [name, size label, build the call and its input's bytes]. */
function memoryCases(pkg) {
  const cases = [];
  for (const format of FORMATS) {
    for (const size of format.sizes) {
      for (const op of OPERATIONS) {
        cases.push({
          name: `${format.name}: ${op}`,
          size: size.label,
          make: () => {
            const raw = size.build(0);
            return { bytes: byteLength(raw), call: operation(pkg, format, op, raw) };
          },
        });
      }
    }
  }
  for (const size of ENGINE_SIZES) {
    for (const keyed of [false, true]) {
      cases.push({
        name: `policy engine: ${keyed ? "keyed" : "Safe Harbor"}`,
        size: size.label,
        make: () => {
          const model = locusModel(0, size.loci);
          return { bytes: Buffer.byteLength(JSON.stringify(model)), call: engineOperation(pkg, keyed, model) };
        },
      });
    }
  }
  return cases;
}

function status(field) {
  const line = readFileSync("/proc/self/status", "utf8")
    .split("\n")
    .find((l) => l.startsWith(`${field}:`));
  if (line === undefined) throw new Error(`no ${field} in /proc/self/status`);
  return Number.parseInt(line.slice(field.length + 1), 10) * 1024;
}

function settle() {
  for (let i = 0; i < 6; i++) globalThis.gc();
}

/** The child half of section 1: one case, one fresh process, printed as JSON. */
function memoryCase(pkg, index) {
  const c = memoryCases(pkg)[index];
  const { bytes, call } = c.make();
  if (bytes < RESIDENT_MIN_BYTES) return { bytes };
  settle();
  const before = process.memoryUsage();
  writeFileSync("/proc/self/clear_refs", "5");
  const rssBefore = status("VmRSS");
  const start = performance.now();
  const result = call();
  const firstMs = performance.now() - start;
  const peak = status("VmHWM") - rssBefore;
  // What the result holds once the call's garbage is collected; `result` is read after, so it is
  // still reachable here.
  settle();
  const after = process.memoryUsage();
  const held = result === undefined ? 0 : 1;
  call();
  const warm = [];
  for (let i = 0; i < 3; i++) {
    const t = performance.now();
    call();
    warm.push(performance.now() - t);
  }
  warm.sort((a, b) => a - b);
  return {
    bytes,
    peakResidentBytes: peak,
    retainedHeapBytes: after.heapUsed - before.heapUsed,
    retainedExternalBytes: after.arrayBuffers - before.arrayBuffers,
    firstCallMs: firstMs,
    warmCallMs: warm[1],
    held,
  };
}

function mib(bytes) {
  if (Math.abs(bytes) >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`;
  return `${(bytes / 1024).toFixed(1)} KiB`;
}

function ms(value) {
  return value >= 100 ? `${value.toFixed(0)} ms` : `${value.toFixed(2)} ms`;
}

/** Section 1: every case of at least `RESIDENT_MIN_BYTES`, each in its own process. */
function memorySection(pkg, target) {
  const lines = [
    "### Peak memory with every byte counted, and single-call time",
    "",
    "One call in a fresh process: its peak resident memory above the resident set before it (every byte, V8 heap and Buffers alike, transient copies included), over the input's bytes; what the result still holds after it, on the V8 heap and outside it; the first call's time, and the median of 3 warm calls. Sizes under 256 KiB are left to the reading's peak heap. The input of the policy engine is sized by its JSON.",
    "",
    "| Benchmark | Size | Input | Peak resident | Multiple | Held, heap | Held, Buffers | First call | Warm call | MiB/s, warm |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  ];
  const self = fileURLToPath(import.meta.url);
  for (const [index, c] of memoryCases(pkg).entries()) {
    const out = execFileSync(
      process.execPath,
      ["--expose-gc", "--enable-source-maps", self, target, "--memory-case", String(index)],
      { encoding: "utf8", maxBuffer: 1024 * 1024 },
    );
    const r = JSON.parse(out);
    if (r.peakResidentBytes === undefined) continue;
    lines.push(
      `| ${c.name} | ${c.size} | ${mib(r.bytes)} | ${mib(r.peakResidentBytes)} | ${(r.peakResidentBytes / r.bytes).toFixed(2)}x | ${mib(r.retainedHeapBytes)} | ${mib(r.retainedExternalBytes)} | ${ms(r.firstCallMs)} | ${ms(r.warmCallMs)} | ${(r.bytes / (1024 * 1024) / (r.warmCallMs / 1000)).toFixed(2)} |`,
    );
  }
  return lines;
}

/** Run `pass` until `duration` milliseconds have gone by; returns how many passes ran. */
function runFor(pass, duration) {
  const end = performance.now() + duration;
  let passes = 0;
  while (performance.now() < end) {
    pass();
    passes++;
  }
  return passes;
}

const SAMPLES = 5;
const SAMPLE_MS = 100;

/** Milliseconds a pass, one sample: whole passes until at least `SAMPLE_MS` have gone by. */
function sample(pass) {
  const start = performance.now();
  let passes = 0;
  while (performance.now() - start < SAMPLE_MS) {
    pass();
    passes++;
  }
  return (performance.now() - start) / passes;
}

/** The median milliseconds a pass of `pass`, warmed, one workload at a time. */
function msPerPass(pass) {
  runFor(pass, WARMUP_MS);
  const samples = [];
  for (let i = 0; i < SAMPLES; i++) samples.push(sample(pass));
  samples.sort((a, b) => a - b);
  return samples[Math.floor(SAMPLES / 2)];
}

/** Section 2: bytes a second at each shape's smallest and largest size, for each operation. */
function throughputSection(pkg) {
  const lines = [
    "### Throughput, smallest size against largest",
    "",
    `Every size timed the same way: warmed for ${String(WARMUP_MS)} ms, then the median of ${String(SAMPLES)} samples of at least ${String(SAMPLE_MS)} ms of whole passes over the size's inputs, one size at a time, in one process. The budget keeps at least 50%.`,
    "",
    "| Benchmark | Smallest | Largest | MiB/s, smallest | MiB/s, largest | Kept | Within |",
    "| --- | --- | --- | --- | --- | --- | --- |",
  ];
  const row = (name, first, last, small, large) => {
    const kept = large / small;
    lines.push(
      `| ${name} | ${first} | ${last} | ${(small / (1024 * 1024)).toFixed(2)} | ${(large / (1024 * 1024)).toFixed(2)} | ${(kept * 100).toFixed(0)}% | ${kept >= 0.5 ? "yes" : "**no**"} |`,
    );
  };
  for (const format of FORMATS) {
    const first = format.sizes[0];
    const last = format.sizes[format.sizes.length - 1];
    for (const op of OPERATIONS) {
      const rate = (size) => {
        const raws = Array.from({ length: size.inputs }, (_v, i) => size.build(i));
        const calls = raws.map((raw) => operation(pkg, format, op, raw));
        const bytes = raws.reduce((n, raw) => n + byteLength(raw), 0);
        return bytes / (msPerPass(() => calls.forEach((c) => c())) / 1000);
      };
      row(`${format.name}: ${op}`, first.label, last.label, rate(first), rate(last));
    }
  }
  const first = ENGINE_SIZES[0];
  const last = ENGINE_SIZES[ENGINE_SIZES.length - 1];
  for (const keyed of [false, true]) {
    const rate = (size) => {
      const models = Array.from({ length: size.inputs }, (_v, i) => locusModel(i, size.loci));
      const calls = models.map((m) => engineOperation(pkg, keyed, m));
      const bytes = models.reduce((n, m) => n + Buffer.byteLength(JSON.stringify(m)), 0);
      return bytes / (msPerPass(() => calls.forEach((c) => c())) / 1000);
    };
    row(`policy engine: ${keyed ? "keyed" : "Safe Harbor"}`, first.label, last.label, rate(first), rate(last));
  }
  return lines;
}

/** Where a call frame is: its src/ file and line through the source map when there is one. */
function locate(frame) {
  const line = frame.lineNumber;
  if (frame.url === "") return "(native)";
  let where = frame.url;
  try {
    const path = frame.url.startsWith("file:") ? fileURLToPath(frame.url) : frame.url;
    const map = findSourceMap(path);
    const entry = map?.findEntry(line, frame.columnNumber);
    if (entry !== undefined && entry.originalSource !== undefined) {
      const inPeer = /node_modules\/(?:\.pnpm\/[^/]+\/node_modules\/)?(@cosyte\/[^/]+)\//.exec(path);
      const source = entry.originalSource.replace(/^.*?(src\/)/, "$1");
      return `${inPeer === null ? "" : `${inPeer[1]} `}${source}:${String(entry.originalLine + 1)}`;
    }
    // A file with no source map: a parser's own dist is named by its package, ours by its path.
    const peer = /node_modules\/(?:\.pnpm\/[^/]+\/node_modules\/)?((?:@[^/]+\/)?[^/]+)\/(.*)$/.exec(path);
    where = peer === null ? path.replace(/^.*?(dist\/|bench\/)/, "$1") : `${peer[1]} ${peer[2]}`;
  } catch {
    // An unparseable URL keeps its own text.
  }
  return `${where}:${String(line + 1)}`;
}

function key(frame) {
  return `${frame.functionName === "" ? "(anonymous)" : frame.functionName} ${locate(frame)}`;
}

function isProfilerFrame(frame) {
  return (
    frame.url.startsWith("node:inspector") ||
    frame.functionName === "(program)" ||
    frame.functionName === "(idle)"
  );
}

/** Self time by function, from a CPU profile: the share of samples each one was on top. */
function topSelfTime(profile) {
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  const self = new Map();
  let total = 0;
  for (let i = 0; i < profile.samples.length; i++) {
    const node = byId.get(profile.samples[i]);
    if (isProfilerFrame(node.callFrame)) continue;
    const dt = profile.timeDeltas[i] ?? 0;
    total += dt;
    const k = key(node.callFrame);
    self.set(k, (self.get(k) ?? 0) + dt);
  }
  return [...self.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP)
    .map(([name, us]) => ({ name, share: us / total }));
}

/** Bytes allocated by function, from a sampled heap profile (sampled, so an estimate). */
function topAllocations(profile) {
  const self = new Map();
  let total = 0;
  const walk = (node) => {
    if (!isProfilerFrame(node.callFrame) && node.selfSize > 0) {
      const k = key(node.callFrame);
      self.set(k, (self.get(k) ?? 0) + node.selfSize);
      total += node.selfSize;
    }
    for (const child of node.children) walk(child);
  };
  walk(profile.head);
  return [...self.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP)
    .map(([name, bytes]) => ({ name, share: total === 0 ? 0 : bytes / total }));
}

/** Section 3: the hottest paths, profiled one at a time. */
async function profileSection(pkg, dir) {
  const feed = Array.from({ length: 64 }, (_v, i) => hl7Message(i));
  const batch = hl7Batch(0, 100);
  const batchMessages = pkg.hl7.splitBatch(batch).messages.map((e) => e.message);
  const bundle = fhirBundle(0, 1_000);
  const ccd = ccdaDocument(0, 100);
  const claims = x12Claims(0, 1_000);
  const telecom = ncpdpBatch(0, 1_000);
  const series = enhancedCt(0, 20);
  const engineSmall = locusModel(0, 1_000);
  const engineLarge = locusModel(0, 100_000);
  const keyed = engineOperation(pkg, true, engineSmall);
  const safeHarborLarge = engineOperation(pkg, false, engineLarge);
  const workloads = [
    {
      name: "HL7 v2, text in, text out: 64 single messages",
      pass: () => feed.reduce((n, m) => n + deidentifyHl7Batch(pkg, m).length, 0),
    },
    {
      name: "HL7 v2, adapter on parsed messages: a batch of 100",
      pass: () => batchMessages.reduce((n, m) => n + pkg.deidHl7.deidentifyHl7(m).manifest.length, 0),
    },
    {
      name: "FHIR R4, text in, text out: a Bundle of 1,000",
      pass: () => pkg.deidFhir.deidentifyFhirJson(bundle).json.length,
    },
    {
      name: "C-CDA, text in, text out: 100 results",
      pass: () => pkg.deidCcda.deidentifyCcda(pkg.ccda.parseCcda(ccd)).manifest.length,
    },
    {
      name: "X12 837P, text in, text out: 1,000 claims",
      pass: () => pkg.deidX12.deidentifyX12String(claims).x12.length,
    },
    {
      name: "NCPDP Telecom, text in, text out: a batch of 1,000",
      pass: () => deidentifyTelecomBatch(pkg, telecom).length,
    },
    {
      name: "DICOM, file in, file out: Enhanced CT, 20 frames",
      pass: () => pkg.deidDicom.deidentifyDicomBuffer(series).bytes.length,
    },
    { name: "policy engine, keyed: 1,000 loci", pass: () => keyed().manifest.length },
    { name: "policy engine, Safe Harbor: 100,000 loci", pass: () => safeHarborLarge().manifest.length },
  ];

  const session = new Session();
  session.connect();
  await session.post("Profiler.enable");
  await session.post("Profiler.setSamplingInterval", { interval: 100 });
  await session.post("HeapProfiler.enable");
  const lines = [
    "### CPU and heap profile of the hottest paths",
    "",
    `Each workload warmed for ${String(WARMUP_MS)} ms, then profiled alone for ${String(PROFILE_MS)} ms: self time from a CPU profile sampled every 100 us, and allocation from a sampled heap profile (an estimate, V8 heap only). A function in a parser is named by its package.`,
  ];
  for (const [index, w] of workloads.entries()) {
    runFor(w.pass, WARMUP_MS);
    // The heap sampler starts first and stops last, so the CPU profile holds the workload and not
    // the sampler's own start and stop. It keeps what a collection freed, so a function is charged
    // for everything it allocated, not only for what was still alive at the end.
    await session.post("HeapProfiler.startSampling", {
      samplingInterval: 16_384,
      includeObjectsCollectedByMajorGC: true,
      includeObjectsCollectedByMinorGC: true,
    });
    await session.post("Profiler.start");
    const passes = runFor(w.pass, PROFILE_MS);
    const { profile: cpu } = await session.post("Profiler.stop");
    const { profile: heap } = await session.post("HeapProfiler.stopSampling");
    if (dir !== undefined) {
      writeFileSync(resolve(dir, `${String(index + 1)}.cpuprofile`), JSON.stringify(cpu));
      writeFileSync(resolve(dir, `${String(index + 1)}.heapprofile`), JSON.stringify(heap));
    }
    lines.push(
      "",
      `#### ${String(index + 1)}. ${w.name}`,
      "",
      `${String(passes)} passes in ${String(PROFILE_MS)} ms, ${(PROFILE_MS / passes).toFixed(2)} ms a pass.`,
      "",
      "| Self time | Function | Allocated | Function |",
      "| --- | --- | --- | --- |",
    );
    const cpuTop = topSelfTime(cpu);
    const heapTop = topAllocations(heap);
    for (let i = 0; i < TOP; i++) {
      const c = cpuTop[i];
      const h = heapTop[i];
      lines.push(
        `| ${c === undefined ? "" : `${(c.share * 100).toFixed(1)}%`} | ${c === undefined ? "" : `\`${c.name}\``} | ${h === undefined ? "" : `${(h.share * 100).toFixed(1)}%`} | ${h === undefined ? "" : `\`${h.name}\``} |`,
      );
    }
  }
  session.disconnect();
  return lines;
}

async function main() {
  const options = args(process.argv.slice(2));
  if (options.target === undefined) {
    process.stderr.write("usage: node bench/profile.mjs <bench/target.mjs> [--out <dir>] [--only <section>]\n");
    return 2;
  }
  const pkg = await import(pathToFileURL(resolve(options.target)).href);
  if (options.memoryCase !== undefined) {
    process.stdout.write(JSON.stringify(memoryCase(pkg, Number(options.memoryCase))));
    return 0;
  }
  if (options.dir !== undefined) mkdirSync(options.dir, { recursive: true });
  const run = (section) => options.only === undefined || options.only === section;
  const lines = [
    "## @cosyte/deid: memory, throughput and profile",
    "",
    `Node ${process.version}, ${process.platform}-${process.arch}.`,
  ];
  if (run("memory")) lines.push("", ...memorySection(pkg, options.target));
  if (run("throughput")) lines.push("", ...throughputSection(pkg));
  if (run("cpu")) lines.push("", ...(await profileSection(pkg, options.dir)));
  const text = `${lines.join("\n")}\n`;
  process.stdout.write(text);
  if (options.dir !== undefined) writeFileSync(resolve(options.dir, "profile.md"), text);
  return 0;
}

process.exitCode = await main();
