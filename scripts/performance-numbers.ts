#!/usr/bin/env tsx
/**
 * scripts/performance-numbers.ts
 *
 * The "Current numbers" section of `docs-content/performance.md`, and the check that keeps every
 * other measured number off that page.
 *
 *   tsx scripts/performance-numbers.ts check docs-content/performance.md
 *   tsx scripts/performance-numbers.ts fill docs-content/performance.md --results <dir> --commit <sha>
 *       [--run <url>] [--missing <reason>]
 *   tsx scripts/performance-numbers.ts release docs-content/performance.md
 *
 * WHY. A number typed on the page describes the code it was measured on, and every later change
 * leaves it describing older code; a pull request that changes `bench/` starts a Bench run its own
 * page can never include. So the page holds no measured number in the repository. The section
 * headed "Current numbers" holds the shared placeholder there (the docs-content standard, which
 * `pnpm check:docs-content` enforces), and the release fills it from the Bench run on the release
 * commit, in the release job's checkout only, before the docs artifact is packed.
 *
 * `check` exits 1 when the page carries a number in a measured unit (a time, a size, a rate, a
 * percentage, or "N times as fast") anywhere but in a budget it names (`BUDGET_PHRASES`).
 *
 * `fill` replaces the placeholder with the numbers in the results files under `--results` (the
 * Bench workflow's artifacts, as `gh run download` writes them). Every case the suite defines gets
 * a row; a case no file measured says "not measured for this release" with the reason, never left
 * out. It refuses a page whose section is anything but the placeholder.
 *
 * `release` is what the release runs (`pnpm pack:docs:release`, the shared release workflow's
 * pack-docs command): it finds the Bench run on the checked-out commit, waits for it to finish up to
 * `waitMinutes`, downloads its reading and import artifacts and fills the page; the package script
 * then packs the docs and puts the committed page back. A run that is
 * missing, failed to list or never finished is named as the reason in the section. It exits 0 in
 * every case, so the GitHub release and the docs rebuild are never held back by a number; an
 * unexpected error leaves the placeholder and prints a warning to the job log.
 */

import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { readResults, type CaseReading, type ResultsDocument } from "@cosyte/bench";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** The heading of the section the release fills. */
export const NUMBERS_HEADING = "## Current numbers";

/** What the section holds in the repository, word for word, however its lines wrap. */
export const PLACEHOLDER =
  "The numbers for this section are measured on `main` at each release and filled in when the release is built. They are never typed by hand.";

/** The cold import budget, the same constant `bench/imports.mjs` and `bench/budgets.mjs` hold. */
export const COLD_IMPORT_BUDGET_MS = 15;

/**
 * The only measured-unit numbers the page may carry: budgets, each named with where it is held.
 * A budget is a number we chose, not one we measured, so it stays when the code changes.
 */
export const BUDGET_PHRASES: readonly { readonly phrase: string; readonly source: string }[] = [
  {
    phrase: `under ${String(COLD_IMPORT_BUDGET_MS)} ms`,
    source: "COLD_IMPORT_MS in bench/imports.mjs and bench/budgets.mjs",
  },
];

/** A number in a measured unit, found where the page may not carry one. */
export interface TypedNumber {
  /** The 1-based line. */
  readonly line: number;
  /** The number with its unit, as written. */
  readonly text: string;
}

/**
 * A number followed by a unit a measurement is given in. Counts ("1,000 results", "100,000 loci")
 * and multiples of a budget ("20 times the input") carry no such unit and are not matched.
 */
const MEASURED =
  /(?<![\w.])\d[\d,]*(?:\.\d+)?(?:\s|&nbsp;)*(?:(?:ns|us|µs|μs|ms|s|sec|secs|seconds?|minutes?|B|kB|KB|KiB|MB|MiB|GB|GiB|ops)(?:\/s)?(?![\w/])|%|x(?![\w])|times\s+(?:as\s+(?:fast|slow)|faster|slower))/g;

/**
 * Every number in a measured unit on a page, budgets aside.
 *
 * @example
 * findTypedNumbers("a call took 2.4 ms").map((f) => f.text); // => ["2.4 ms"]
 */
export function findTypedNumbers(page: string): TypedNumber[] {
  const found: TypedNumber[] = [];
  page.split("\n").forEach((raw, index) => {
    let line = raw;
    for (const { phrase } of BUDGET_PHRASES)
      line = line.split(phrase).join(" ".repeat(phrase.length));
    for (const match of line.matchAll(MEASURED)) {
      found.push({ line: index + 1, text: match[0].replace(/\s+/g, " ") });
    }
  });
  return found;
}

/** Where the section starts and ends: the heading line, and the next level 1 or 2 heading. */
function sectionBounds(lines: readonly string[]): { start: number; end: number } {
  const start = lines.findIndex((l) => l.trimEnd() === NUMBERS_HEADING);
  if (start === -1) throw new Error(`the page has no "${NUMBERS_HEADING}" section`);
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^#{1,2}\s/.test(lines[i] ?? "")) {
      end = i;
      break;
    }
  }
  return { start, end };
}

/**
 * The page with its "Current numbers" section replaced by `body`. Refuses a section that holds
 * anything but the placeholder, so a filled page is never filled twice and nothing typed is lost.
 *
 * @example
 * fillPage(`## Current numbers\n\n${PLACEHOLDER}\n`, "Filled.").endsWith("Filled.\n"); // => true
 */
export function fillPage(page: string, body: string): string {
  const lines = page.split("\n");
  const { start, end } = sectionBounds(lines);
  const held = lines
    .slice(start + 1, end)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  if (held !== PLACEHOLDER) {
    throw new Error(`the "${NUMBERS_HEADING}" section holds something other than the placeholder`);
  }
  const tail = lines.slice(end);
  return [
    ...lines.slice(0, start + 1),
    "",
    body.trimEnd(),
    ...(tail.length > 0 && !(tail.length === 1 && tail[0] === "") ? ["", ...tail] : [""]),
  ].join("\n");
}

/** The results files a Bench run left, read and sorted by kind. */
export interface Collected {
  /** Readings of `bench/deid.bench.mjs`, one per format job. */
  readonly readings: readonly ResultsDocument[];
  /** Readings of `bench/entry.bench.mjs`: the cold import of one published entry each. */
  readonly imports: readonly ResultsDocument[];
  /** Files that could not be read, with why, relative to the results directory. */
  readonly unreadable: readonly { readonly file: string; readonly reason: string }[];
}

function jsonFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...jsonFiles(path));
    else if (name.endsWith(".json")) out.push(path);
  }
  return out;
}

/**
 * Every results file under `dir`, at any depth.
 *
 * @example
 * collectResults("/no/such/dir").readings.length; // => 0
 */
export function collectResults(dir: string): Collected {
  const readings: ResultsDocument[] = [];
  const imports: ResultsDocument[] = [];
  const unreadable: { file: string; reason: string }[] = [];
  for (const path of jsonFiles(dir)) {
    let doc: ResultsDocument;
    try {
      doc = readResults(readFileSync(path, "utf8"));
    } catch (error) {
      const reason = error instanceof Error ? (error.message.split("\n")[0] ?? "") : "unreadable";
      unreadable.push({ file: relative(dir, path).split(sep).join("/"), reason });
      continue;
    }
    if (doc.kind !== "reading") continue;
    if (doc.suite.file.endsWith("entry.bench.mjs")) imports.push(doc);
    else readings.push(doc);
  }
  return { readings, imports, unreadable };
}

/** A benchmark and its size labels, as the suite defines them. */
export interface SuiteShape {
  readonly benchmarks: readonly {
    readonly name: string;
    readonly sizes: readonly { readonly label: string }[];
  }[];
}

/** What the section says about where its numbers came from. */
export interface RenderMeta {
  /** The release commit. */
  readonly commit: string;
  /** The Bench run's page, when one was found. */
  readonly run?: string;
  /** Why nothing could be measured, when nothing was. */
  readonly missing?: string;
  /** The published entries, as [subpath, built file]. */
  readonly entries: readonly (readonly [string, string])[];
}

const KIB = 1024;
const MIB = 1024 * 1024;

/** Bytes, in B, KiB or MiB. */
export function formatBytes(bytes: number): string {
  if (bytes >= MIB) return `${(bytes / MIB).toFixed(2)} MiB`;
  if (bytes >= KIB) return `${(bytes / KIB).toFixed(1)} KiB`;
  return `${String(Math.round(bytes))} B`;
}

/** Milliseconds, in us, ms or s. */
export function formatMs(ms: number): string {
  if (ms < 1) return `${(ms * 1000).toFixed(2)} us`;
  if (ms < 1000) return `${ms.toFixed(3)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

function notMeasured(reason: string): string {
  return `not measured: ${reason}`;
}

function cell(text: string): string {
  return text.replace(/\|/g, "\\|");
}

/** The row cells of one measured case. */
function caseCells(c: CaseReading): string[] {
  const perInput = c.bytesPerPass === null ? null : c.bytesPerPass / c.inputsPerPass;
  const input = perInput === null ? "no byte count" : formatBytes(perInput);
  let perCall: string;
  let throughput: string;
  if (c.throughput.status === "measured") {
    perCall = formatMs(c.throughput.medianMsPerOp);
    throughput =
      c.throughput.bytesPerSecond === null
        ? `${c.throughput.opsPerSecond.toFixed(0)} calls/s`
        : `${(c.throughput.bytesPerSecond / MIB).toFixed(2)} MiB/s`;
  } else {
    perCall = notMeasured(c.throughput.reason);
    throughput = notMeasured(c.throughput.reason);
  }
  const pct = (ns: number | null | undefined): string =>
    ns === null || ns === undefined ? notMeasured("too few calls") : formatMs(ns / 1e6);
  let p50: string;
  let p95: string;
  let p99: string;
  if (c.latency === null) {
    p50 = p95 = p99 = notMeasured("not asked for");
  } else if (c.latency.status === "skipped") {
    p50 = `under the timer: ${formatMs(c.latency.p50Ns / 1e6)}`;
    p95 = p99 = notMeasured("below the timer's resolution");
  } else {
    p50 = pct(c.latency.p50Ns);
    p95 = pct(c.latency.p95Ns);
    p99 = pct(c.latency.p99Ns);
  }
  const allocated =
    c.allocations === null
      ? notMeasured("not asked for")
      : c.allocations.status === "measured"
        ? formatBytes(c.allocations.heapBytesPerOp)
        : notMeasured(c.allocations.reason);
  let peak: string;
  if (c.peak === null) peak = notMeasured("not asked for");
  else if (c.peak.status !== "measured") peak = notMeasured(c.peak.reason);
  else {
    const multiple =
      perInput === null ? "" : `, ${(c.peak.peakHeapBytes / perInput).toFixed(2)} times the input`;
    peak = `${formatBytes(c.peak.peakHeapBytes)}${multiple}`;
  }
  const longRun =
    c.longRun === null
      ? notMeasured("not asked for")
      : c.longRun.status === "measured"
        ? c.longRun.verdict
        : notMeasured(c.longRun.reason);
  return [input, perCall, p50, p95, p99, throughput, allocated, peak, longRun];
}

function date(doc: ResultsDocument): string {
  return doc.createdAt.slice(0, 10);
}

function machine(doc: ResultsDocument): string {
  const env = doc.environment;
  const cpu = env.cpuModel ?? "an unnamed CPU";
  return `${cpu}, ${String(env.logicalCpus)} logical CPUs`;
}

function readingJob(doc: ResultsDocument): string {
  if (doc.kind !== "reading") return "";
  return doc.reading.cases
    .map((c) => c.benchmark)
    .filter((n, i, all) => all.indexOf(n) === i)
    .join("; ");
}

/**
 * The body of the "Current numbers" section, from the results a Bench run left and the suite's
 * own list of cases.
 *
 * @example
 * renderNumbers({ readings: [], imports: [], unreadable: [] }, { benchmarks: [] },
 *   { commit: "0000000", missing: "no run", entries: [] }).includes("no run"); // => true
 */
export function renderNumbers(collected: Collected, suite: SuiteShape, meta: RenderMeta): string {
  const short = meta.commit.slice(0, 7);
  const from =
    meta.run === undefined ? "the Bench workflow" : `[the Bench workflow's run](${meta.run})`;
  const out: string[] = [];
  if (collected.readings.length === 0 && collected.imports.length === 0) {
    out.push(
      `Not measured for this release (commit \`${short}\`): ${meta.missing ?? "the Bench run on the release commit left no results"}. The method is in [What we measure](#what-we-measure), and [Run the benchmarks yourself](#run-the-benchmarks-yourself) says how to take a reading.`,
    );
    return `${out.join("\n")}\n`;
  }
  out.push(
    `Measured on \`main\` at the release commit \`${short}\` by ${from}, filled in from its results files when the release was built. The method is in [What we measure](#what-we-measure). Each format ran in its own job on its own runner, so compare rows within a format, not across formats; a reading is one run of one machine, not a bound.`,
    "",
  );
  if (meta.missing !== undefined) out.push(`Not everything was measured: ${meta.missing}.`, "");
  for (const bad of collected.unreadable) {
    out.push(`A results file was not read, \`${bad.file}\`: ${bad.reason}.`, "");
  }

  const all = [...collected.readings, ...collected.imports];
  out.push(
    "### Where it ran",
    "",
    "| Job | Date | Node.js | Runner class | Machine |",
    "| --- | --- | --- | --- | --- |",
  );
  for (const doc of collected.readings) {
    out.push(
      `| ${cell(readingJob(doc))} | ${date(doc)} | ${doc.environment.node} | ${cell(doc.environment.runner.class)} | ${cell(machine(doc))} |`,
    );
  }
  if (collected.imports.length > 0) {
    const first = collected.imports[0] as ResultsDocument;
    out.push(
      `| cold import of each entry | ${date(first)} | ${first.environment.node} | ${cell(first.environment.runner.class)} | ${cell(machine(first))} |`,
    );
  }
  const commits = new Set(all.map((d) => (d.kind === "reading" ? d.subject.commit : null)));
  if (commits.size > 1 || !commits.has(meta.commit)) {
    out.push(
      "",
      `Each results file names the commit it measured: ${[...commits].map((c) => (c === null ? "none" : `\`${c.slice(0, 7)}\``)).join(", ")}.`,
    );
  }

  out.push(
    "",
    "### Throughput, latency and memory",
    "",
    "Per call and throughput are the median of the reading's fresh processes; latency is per call, nearest rank; allocated is V8 heap a call allocates; peak heap is one call's V8 heap above the settled heap, with its multiple of the input; the long run says whether the heap stays flat.",
    "",
    "| Benchmark | Size | Input | Per call | p50 | p95 | p99 | Throughput | Allocated per call | Peak heap | Long run |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  );
  const cases = new Map<string, CaseReading>();
  for (const doc of collected.readings) {
    if (doc.kind !== "reading") continue;
    for (const c of doc.reading.cases) cases.set(`${c.benchmark}\u0000${c.size}`, c);
  }
  for (const benchmark of suite.benchmarks) {
    for (const { label } of benchmark.sizes) {
      const c = cases.get(`${benchmark.name}\u0000${label}`);
      const cells =
        c === undefined
          ? [notMeasured("no reading of this case in the run"), "", "", "", "", "", "", "", ""]
          : caseCells(c);
      out.push(`| ${cell(benchmark.name)} | ${cell(label)} | ${cells.map(cell).join(" | ")} |`);
    }
  }

  out.push(
    "",
    "### Cold import of each published entry",
    "",
    `The median of the reading's fresh processes importing the built entry, and every file it loads, the parser it needs included. The budget is ${String(COLD_IMPORT_BUDGET_MS)} ms an entry.`,
    "",
    "| Entry | Median | Above an empty module | Files loaded | Bytes loaded | Gzipped | Within the budget |",
    "| --- | --- | --- | --- | --- | --- | --- |",
  );
  for (const [subpath, file] of meta.entries) {
    const want = file.replace(/^\.\//, "");
    const doc = collected.imports.find(
      (d) => d.kind === "reading" && d.subject.target.replace(/\\/g, "/").endsWith(want),
    );
    const cost = doc?.kind === "reading" ? doc.reading.importCost : null;
    if (cost === null || cost === undefined) {
      out.push(
        `| \`${subpath}\` | ${notMeasured("no reading of this entry in the run")} | | | | | |`,
      );
      continue;
    }
    out.push(
      `| \`${subpath}\` | ${formatMs(cost.medianMs)} | ${formatMs(Math.max(0, cost.medianMs - cost.emptyMedianMs))} | ${String(cost.files.length)} | ${formatBytes(cost.totalBytes)} | ${formatBytes(cost.totalGzipBytes)} | ${cost.medianMs < COLD_IMPORT_BUDGET_MS ? "yes" : "no"} |`,
    );
  }
  return `${out.join("\n")}\n`;
}

/** Every `exports` subpath with an ESM default, as [subpath, built file]. */
export function publishedEntries(manifest: {
  exports?: Record<string, unknown>;
}): [string, string][] {
  const out: [string, string][] = [];
  for (const [subpath, target] of Object.entries(manifest.exports ?? {})) {
    if (typeof target !== "object" || target === null) continue;
    const esm = (target as { import?: { default?: unknown } }).import?.default;
    if (typeof esm === "string") out.push([subpath, esm]);
  }
  return out;
}

async function loadSuite(): Promise<SuiteShape> {
  const mod = (await import(pathToFileURL(join(ROOT, "bench/deid.bench.mjs")).href)) as {
    default: SuiteShape;
  };
  return mod.default;
}

function loadEntries(): [string, string][] {
  return publishedEntries(
    JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
      exports?: Record<string, unknown>;
    },
  );
}

/** Fill `page` in place from the results under `results`. */
export async function fillFile(
  page: string,
  results: string,
  meta: Omit<RenderMeta, "entries">,
): Promise<void> {
  const body = renderNumbers(collectResults(results), await loadSuite(), {
    ...meta,
    entries: loadEntries(),
  });
  writeFileSync(page, fillPage(readFileSync(page, "utf8"), body));
}

/** What `release` needs from the world, so a test can stand in for GitHub and the clock. */
export interface ReleaseIo {
  /** Runs `gh` with these arguments and returns its standard output; throws when it fails. */
  readonly gh: (args: readonly string[]) => string;
  readonly sleep: (ms: number) => Promise<void>;
  readonly now: () => number;
  readonly log: (line: string) => void;
}

/** The Bench run found for a commit, and where its artifacts were put, or why there are none. */
export interface FoundRun {
  readonly results: string;
  readonly run?: string;
  readonly missing?: string;
}

/**
 * Find the Bench run on `commit`, wait for it up to `waitMinutes`, and download its artifacts into
 * `into`. Never throws for a run that is missing or unfinished: that is reported as `missing`.
 */
export async function fetchRun(
  repo: string,
  commit: string,
  into: string,
  waitMinutes: number,
  io: ReleaseIo,
): Promise<FoundRun> {
  const deadline = io.now() + waitMinutes * 60_000;
  const query = `repos/${repo}/actions/workflows/bench.yml/runs?head_sha=${commit}&event=push&per_page=1`;
  for (;;) {
    let listed: string;
    try {
      listed = io.gh([
        "api",
        query,
        "--jq",
        ".workflow_runs[0] // {} | [.id, .status, .html_url] | @tsv",
      ]);
    } catch {
      return { results: into, missing: "the Bench runs on the release commit could not be listed" };
    }
    const [id = "", status = "", url = ""] = listed.trim().split("\t");
    if (id === "" || id === "null") {
      if (io.now() >= deadline) {
        return { results: into, missing: "no Bench run started on the release commit" };
      }
    } else if (status === "completed") {
      try {
        io.gh([
          "run",
          "download",
          id,
          "--repo",
          repo,
          "--dir",
          into,
          "--pattern",
          "bench-reading-*",
          "--pattern",
          "bench-imports",
        ]);
      } catch {
        return {
          results: into,
          run: url,
          missing: "the Bench run's results could not be downloaded",
        };
      }
      return { results: into, run: url };
    } else if (io.now() >= deadline) {
      return {
        results: into,
        run: url,
        missing: `the Bench run on the release commit had not finished after ${String(waitMinutes)} minutes`,
      };
    }
    io.log(`performance-numbers: waiting for the Bench run on ${commit.slice(0, 7)}`);
    await io.sleep(60_000);
  }
}

/**
 * How long `release` waits for the Bench run: `BENCH_WAIT_MINUTES` when it is a number, else 45
 * minutes in the release job (bounded at 360) and 10 in the shared workflow's `finalize` job, which
 * sets `FINALIZE_SHA` and is bounded at 30 minutes in all.
 *
 * @example
 * waitMinutes({ FINALIZE_SHA: "abc" }); // => 10
 */
export function waitMinutes(env: NodeJS.ProcessEnv): number {
  const set = Number(env["BENCH_WAIT_MINUTES"]);
  if (
    env["BENCH_WAIT_MINUTES"] !== undefined &&
    env["BENCH_WAIT_MINUTES"] !== "" &&
    Number.isFinite(set) &&
    set >= 0
  ) {
    return set;
  }
  return env["FINALIZE_SHA"] === undefined || env["FINALIZE_SHA"] === "" ? 45 : 10;
}

function usage(): number {
  process.stderr.write(
    "usage: tsx scripts/performance-numbers.ts check <page>\n" +
      "       tsx scripts/performance-numbers.ts fill <page> --results <dir> --commit <sha> [--run <url>] [--missing <reason>]\n" +
      "       tsx scripts/performance-numbers.ts release <page>\n",
  );
  return 2;
}

function option(argv: readonly string[], name: string): string | undefined {
  const at = argv.indexOf(name);
  return at === -1 ? undefined : argv[at + 1];
}

/** The command line. Returns the exit code. */
export async function main(
  argv: readonly string[],
  io: ReleaseIo,
  env: NodeJS.ProcessEnv,
): Promise<number> {
  const [command, page] = argv;
  if (page === undefined) return usage();
  if (command === "check") {
    const found = findTypedNumbers(readFileSync(page, "utf8"));
    for (const f of found) {
      process.stderr.write(
        `${page}:${String(f.line)}: "${f.text}" is a measured number typed on the page; the release fills the "Current numbers" section, and a budget goes in BUDGET_PHRASES\n`,
      );
    }
    if (found.length > 0) return 1;
    process.stdout.write(`performance-numbers: ${page} carries no typed measured number\n`);
    return 0;
  }
  if (command === "fill") {
    const results = option(argv, "--results");
    const commit = option(argv, "--commit");
    if (results === undefined || commit === undefined) return usage();
    const run = option(argv, "--run");
    const missing = option(argv, "--missing");
    await fillFile(page, results, {
      commit,
      ...(run === undefined ? {} : { run }),
      ...(missing === undefined ? {} : { missing }),
    });
    return 0;
  }
  if (command === "release") {
    try {
      const commit = execFileSync("git", ["rev-parse", "HEAD"], {
        cwd: ROOT,
        encoding: "utf8",
      }).trim();
      const repo = env["GITHUB_REPOSITORY"];
      const into = mkdtempSync(join(env["RUNNER_TEMP"] ?? tmpdir(), "bench-results-"));
      const minutes = waitMinutes(env);
      const found =
        repo === undefined || repo === ""
          ? { results: into, missing: "the release ran outside GitHub Actions" }
          : await fetchRun(repo, commit, into, minutes, io);
      await fillFile(page, found.results, {
        commit,
        ...(found.run === undefined ? {} : { run: found.run }),
        ...(found.missing === undefined ? {} : { missing: found.missing }),
      });
      io.log(`performance-numbers: filled ${page} for ${commit.slice(0, 7)}`);
    } catch (error) {
      io.log(
        `::warning::performance-numbers: the "Current numbers" section was not filled: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    return 0;
  }
  return usage();
}

const realIo: ReleaseIo = {
  gh: (args) =>
    execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }),
  sleep: (ms) => new Promise((done) => setTimeout(done, ms)),
  now: () => Date.now(),
  log: (line) => process.stdout.write(`${line}\n`),
};

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2), realIo, process.env);
}
