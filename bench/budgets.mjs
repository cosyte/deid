// The performance budgets, read from a reading that `pnpm bench:reading --out <file>` wrote:
//   pnpm bench:budgets bench-results/reading.json [--summary <file.md>]
//
// Three of the four budgets are read here, each a proposal until the package's numbers show it can
// be held:
// - peak heap under 20 times the input for a dense shape (HL7 v2, FHIR, C-CDA, X12 and the policy
//   engine: many small values);
// - peak memory under 3 times the input for a large opaque payload (DICOM, whose bytes are almost
//   all Pixel Data);
// - throughput, in bytes a second, not falling by more than half from a shape's smallest size to
//   its largest.
// The fourth, a cold import under 15 ms, is read per published entry by `pnpm bench:imports`: the
// reading's own import line is the bench target, which loads every entry and every parser at once.
//
// The reading's peak heap is the V8 heap only. Pixel Data is a Buffer, outside it, so for the
// DICOM rows the heap row is the header's cost alone, and the opaque budget is read from the
// resident peak in `pnpm bench:profile`, which counts every byte. A size the reading skipped (a
// single call longer than its warmup can settle) is timed by the profile too.
//
// When the reading carries the parser alone beside a format's text in, text out benchmark, a last
// table splits each of those rows into the parser's share and the adapter's, so a row over budget
// is attributed by measurement rather than by guess.
//
// It prints a Markdown table and always exits 0 when it could read the reading: the budgets are
// advisory, and a finding is a number to act on, not a red check. It exits 2 when it cannot read it.

import { readFileSync, writeFileSync } from "node:fs";

import { readResults } from "@cosyte/bench";

const DENSE_PEAK_MULTIPLE = 20;
const OPAQUE_PEAK_MULTIPLE = 3;
const COLD_IMPORT_MS = 15;
const THROUGHPUT_KEPT = 0.5;

function isOpaque(benchmark) {
  return benchmark.startsWith("DICOM");
}

/** A case's bytes a second, or why there is none. */
function bytesPerSecond(c) {
  if (c.throughput.status !== "measured") return `skipped (${c.throughput.reason})`;
  return c.throughput.bytesPerSecond ?? "no byte count";
}

function mib(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`;
  return `${(bytes / 1024).toFixed(1)} KiB`;
}

const END_TO_END = ": text in, text out";
const PARSER_ALONE = ": parser alone, text in, text out";

function ms(value) {
  return value >= 100 ? `${value.toFixed(0)} ms` : `${value.toFixed(3)} ms`;
}

/**
 * Each text in, text out row beside the parser alone on the same input: how much of the pass's
 * time and peak heap the parser takes with no de-identification between its read and its write,
 * and what is left for the adapter. A share is a ratio of two measures taken in one job.
 */
function attribution(cases) {
  const parser = new Map();
  for (const c of cases) {
    if (c.benchmark.endsWith(PARSER_ALONE)) {
      parser.set(`${c.benchmark.slice(0, -PARSER_ALONE.length)}\n${c.size}`, c);
    }
  }
  if (parser.size === 0) return [];
  const lines = [
    "",
    "Where a text in, text out pass goes: the parser alone (read and write back, nothing de-identified) on the same input, its share of the pass, and the multiple of the input it peaks at on its own.",
    "",
    "| Format | Size | Pass, per op | Parser, per op | Parser's time | Pass, peak heap | Parser, peak heap | Parser's peak | Parser alone, multiple |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  ];
  for (const c of cases) {
    if (!c.benchmark.endsWith(END_TO_END)) continue;
    const format = c.benchmark.slice(0, -END_TO_END.length);
    const p = parser.get(`${format}\n${c.size}`);
    if (p === undefined) continue;
    const time = (x) => (x.throughput.status === "measured" ? x.throughput.medianMsPerOp : undefined);
    const peak = (x) => (x.peak !== null && x.peak.status === "measured" ? x.peak.peakHeapBytes : undefined);
    const share = (part, whole) =>
      part === undefined || whole === undefined ? "n/a" : `${((part / whole) * 100).toFixed(0)}%`;
    const cell = (v, f) => (v === undefined ? "not measured" : f(v));
    const [passMs, parserMs, passPeak, parserPeak] = [time(c), time(p), peak(c), peak(p)];
    const perInput = p.bytesPerPass === null ? undefined : p.bytesPerPass / p.inputsPerPass;
    lines.push(
      `| ${format} | ${c.size} | ${cell(passMs, ms)} | ${cell(parserMs, ms)} | ${share(parserMs, passMs)} | ${cell(passPeak, mib)} | ${cell(parserPeak, mib)} | ${share(parserPeak, passPeak)} | ${parserPeak === undefined || perInput === undefined ? "n/a" : `${(parserPeak / perInput).toFixed(2)}x`} |`,
    );
  }
  return lines;
}

function main(argv) {
  const file = argv[0];
  if (file === undefined) {
    process.stderr.write("usage: node bench/budgets.mjs <reading.json> [--summary <file.md>]\n");
    return 2;
  }
  const summaryAt = argv.indexOf("--summary");
  const summary = summaryAt === -1 ? undefined : argv[summaryAt + 1];
  let doc;
  try {
    doc = readResults(readFileSync(file, "utf8"));
  } catch (error) {
    process.stderr.write(
      `could not read ${file}: ${error instanceof Error ? error.name : "error"}\n`,
    );
    return 2;
  }
  if (doc.kind !== "reading") {
    process.stderr.write(`${file} is a ${doc.kind}, not a reading\n`);
    return 2;
  }
  const { cases, importCost } = doc.reading;
  const lines = [
    "### Budgets",
    "",
    `Peak heap is one call's peak above the settled heap, V8 heap only, over one input's bytes; the budget is ${String(DENSE_PEAK_MULTIPLE)} times for a dense shape. The DICOM rows show the header's heap cost alone: their ${String(OPAQUE_PEAK_MULTIPLE)} times budget counts Pixel Data, and is read from the resident peak in the profile.`,
    "",
    "| Benchmark | Size | Input | Peak heap | Multiple | Budget | Within |",
    "| --- | --- | --- | --- | --- | --- | --- |",
  ];
  for (const c of cases) {
    if (c.peak === null || c.bytesPerPass === null) continue;
    const perInput = c.bytesPerPass / c.inputsPerPass;
    if (c.peak.status !== "measured") {
      lines.push(
        `| ${c.benchmark} | ${c.size} | ${mib(perInput)} | skipped (${c.peak.reason}) | n/a | | not measured |`,
      );
      continue;
    }
    const multiple = c.peak.peakHeapBytes / perInput;
    const opaque = isOpaque(c.benchmark);
    const budget = opaque ? "see profile" : `${String(DENSE_PEAK_MULTIPLE)}x`;
    const within = opaque ? "n/a" : multiple < DENSE_PEAK_MULTIPLE ? "yes" : "**no**";
    lines.push(
      `| ${c.benchmark} | ${c.size} | ${mib(perInput)} | ${mib(c.peak.peakHeapBytes)} | ${multiple.toFixed(2)}x | ${budget} | ${within} |`,
    );
  }

  lines.push(
    "",
    `Throughput from a shape's smallest size to its largest; the budget keeps at least ${String(THROUGHPUT_KEPT * 100)}% of it. A size the reading skipped is timed by the profile.`,
    "",
    "| Benchmark | Smallest | Largest | Bytes/s, smallest | Bytes/s, largest | Kept | Within |",
    "| --- | --- | --- | --- | --- | --- | --- |",
  );
  const byBenchmark = new Map();
  for (const c of cases) {
    const list = byBenchmark.get(c.benchmark) ?? [];
    list.push(c);
    byBenchmark.set(c.benchmark, list);
  }
  for (const [benchmark, list] of byBenchmark) {
    if (list.length < 2) continue;
    const first = list[0];
    const last = list[list.length - 1];
    const small = bytesPerSecond(first);
    const large = bytesPerSecond(last);
    if (typeof small === "string" || typeof large === "string") {
      // A skip is not a pass: the row says what could not be measured.
      const cell = (v) => (typeof v === "string" ? v : `${mib(v)}/s`);
      lines.push(
        `| ${benchmark} | ${first.size} | ${last.size} | ${cell(small)} | ${cell(large)} | n/a | not measured |`,
      );
      continue;
    }
    const kept = large / small;
    lines.push(
      `| ${benchmark} | ${first.size} | ${last.size} | ${mib(small)}/s | ${mib(large)}/s | ${(kept * 100).toFixed(0)}% | ${kept >= THROUGHPUT_KEPT ? "yes" : "**no**"} |`,
    );
  }

  lines.push(...attribution(cases));

  if (importCost !== null) {
    const own = importCost.medianMs - importCost.emptyMedianMs;
    lines.push(
      "",
      `Cold import of the bench target (every entry and every parser at once, not what a consumer loads): median ${importCost.medianMs.toFixed(2)} ms, ${own.toFixed(2)} ms above an empty module. Loaded ${String(importCost.files.length)} file(s), ${mib(importCost.totalBytes)}, ${mib(importCost.totalGzipBytes)} gzipped. The ${String(COLD_IMPORT_MS)} ms budget is read per entry by \`pnpm bench:imports\`.`,
    );
  }
  const text = `${lines.join("\n")}\n`;
  process.stdout.write(text);
  if (summary !== undefined) writeFileSync(summary, text);
  return 0;
}

process.exitCode = main(process.argv.slice(2));
