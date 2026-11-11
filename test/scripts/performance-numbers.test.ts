/**
 * Tests for `scripts/performance-numbers.ts`: the performance page carries no measured number typed
 * by hand, and the release fills its "Current numbers" section from the Bench run's results files.
 *
 * The results documents here are built in code: invented machine data in the results schema, no
 * clinical content at all.
 */
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { readResults } from "@cosyte/bench";
import { afterAll, describe, expect, it } from "vitest";

import {
  BUDGET_PHRASES,
  cell,
  COLD_IMPORT_BUDGET_MS,
  collectResults,
  fetchRun,
  fillPage,
  findTypedNumbers,
  formatBytes,
  formatMs,
  GH_TIMEOUT_MS,
  main,
  NUMBERS_HEADING,
  PLACEHOLDER,
  publishedEntries,
  renderNumbers,
  runGh,
  type ReleaseIo,
  type SuiteShape,
  waitMinutes,
} from "../../scripts/performance-numbers.js";

const PAGE = "docs-content/performance.md";

const scratch = mkdtempSync(join(tmpdir(), "performance-numbers-"));
afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

function environment(cpu: string): Record<string, unknown> {
  return {
    node: "v22.0.0",
    v8: "12.4",
    platform: "linux",
    arch: "x64",
    osRelease: "6.0.0",
    cpuModel: cpu,
    logicalCpus: 4,
    totalMemoryBytes: 16 * 1024 ** 3,
    cgroupCpuMax: null,
    nodeOptionsSet: false,
    loadAverage: [0, 0, 0],
    runner: {
      ci: true,
      provider: "github-actions",
      environment: "github-hosted",
      imageOS: "ubuntu24",
      imageVersion: "1.0",
      class: "github-actions-ubuntu24-x64",
    },
  };
}

function doc(suiteFile: string, target: string, body: Record<string, unknown>): string {
  return JSON.stringify({
    schemaVersion: 1,
    kind: "reading",
    tool: { name: "@cosyte/bench", version: "0.1.1" },
    createdAt: "2026-01-02T03:04:05.000Z",
    suite: { name: "@cosyte/deid", file: suiteFile },
    environment: environment("Example CPU 9000"),
    contract: { bench: {}, warmup: {} },
    subject: { target, commit: "abcdef0123456789" },
    reading: body,
  });
}

const measuredCase = {
  benchmark: "Format A: text in, text out",
  size: "small",
  inputsPerPass: 4,
  bytesPerPass: 4096,
  throughput: {
    status: "measured",
    processes: [{ samplesMsPerOp: [0.5], medianMsPerOp: 0.5 }],
    medianMsPerOp: 0.5,
    opsPerSecond: 2000,
    bytesPerSecond: 2 * 1024 * 1024,
  },
  latency: {
    status: "measured",
    calls: 100,
    timerOverheadNs: 20,
    p50Ns: 400_000,
    p95Ns: 600_000,
    p99Ns: null,
    maxNs: 900_000,
  },
  allocations: { status: "measured", windowOps: 10, heapBytesPerOp: 2048, externalBytesPerOp: 0 },
  peak: { status: "measured", calls: 3, peakHeapBytes: 20_480, medianPeakHeapBytes: 20_000 },
  longRun: { status: "skipped", reason: "gc-unsettled" },
};

const skippedCase = {
  benchmark: "Format A: text in, text out",
  size: "large",
  inputsPerPass: 1,
  bytesPerPass: 8 * 1024 * 1024,
  throughput: { status: "skipped", reason: "warmup-unstable" },
  latency: null,
  allocations: null,
  peak: null,
  longRun: null,
};

const importCost = {
  runs: 20,
  coldImportMs: [12],
  medianMs: 12,
  p95Ms: 13,
  emptyImportMs: [2],
  emptyMedianMs: 2,
  files: [{ path: "dist/index.mjs", bytes: 2048, gzipBytes: 1024 }],
  totalBytes: 2048,
  totalGzipBytes: 1024,
};

const SUITE: SuiteShape = {
  benchmarks: [
    { name: "Format A: text in, text out", sizes: [{ label: "small" }, { label: "large" }] },
    { name: "Format B: text in, text out", sizes: [{ label: "small" }] },
  ],
};

const ENTRIES: [string, string][] = [
  [".", "./dist/index.mjs"],
  ["./hl7", "./dist/hl7/index.mjs"],
];

function resultsDir(): string {
  const dir = join(scratch, `run-${String(Math.random()).slice(2)}`);
  mkdirSync(join(dir, "bench-reading-a"), { recursive: true });
  mkdirSync(join(dir, "bench-imports"), { recursive: true });
  writeFileSync(
    join(dir, "bench-reading-a", "reading-a.json"),
    doc("bench/deid.bench.mjs", "bench/target.mjs", {
      processes: 3,
      cases: [measuredCase, skippedCase],
      importCost: null,
    }),
  );
  writeFileSync(
    join(dir, "bench-imports", "root.json"),
    doc("bench/entry.bench.mjs", "dist/index.mjs", { processes: 1, cases: [], importCost }),
  );
  writeFileSync(join(dir, "bench-reading-a", "reading-a.md"), "not json, ignored\n");
  writeFileSync(join(dir, "bench-imports", "broken.json"), "{");
  return dir;
}

describe("the committed performance page", () => {
  it("carries no measured number typed by hand", () => {
    expect(findTypedNumbers(readFileSync(PAGE, "utf8"))).toEqual([]);
  });

  it("keeps the placeholder in its Current numbers section, so the release can fill it", () => {
    const filled = fillPage(readFileSync(PAGE, "utf8"), "FILLED");
    expect(filled).toContain(`${NUMBERS_HEADING}\n\nFILLED\n`);
  });
});

describe("findTypedNumbers", () => {
  it.each([
    ["a call took 206.09 us", "206.09 us"],
    ["p99 of 1.458 ms", "1.458 ms"],
    ["a run of 2 s", "2 s"],
    ["a peak of 664.6 KiB", "664.6 KiB"],
    ["peaked at 117.70 MiB resident", "117.70 MiB"],
    ["3.56 to 7.61 MiB/s", "7.61 MiB/s"],
    ["kept 65% of it", "65%"],
    ["ran 2.14 times as fast", "2.14 times as fast"],
    ["a 1.5x slowdown", "1.5x"],
    ["1,200 ops/s", "1,200 ops/s"],
    ["a call took 2.5 milliseconds", "2.5 milliseconds"],
    ["a call took 1 millisecond", "1 millisecond"],
    ["p50 of 206 microseconds", "206 microseconds"],
    ["a timer step of 40 nanoseconds", "40 nanoseconds"],
    ["2000 calls/s on one core", "2000 calls/s"],
    ["1,200 ops/sec", "1,200 ops/sec"],
    ["2,000 calls per second", "2,000 calls per second"],
    ["about 300 per second", "300 per second"],
    ["3 MB per second", "3 MB per second"],
  ])("finds the number in %j", (line, text) => {
    expect(findTypedNumbers(line).map((f) => f.text)).toContain(text);
  });

  it("gives the line of each number", () => {
    expect(findTypedNumbers("no number\nnone here\nit took 5 ms")).toEqual([
      { line: 3, text: "5 ms" },
    ]);
  });

  it.each([
    "a batch of 1,000 messages and 100,000 loci",
    "peak heap under 20 times the input",
    "an Enhanced CT of 200 frames",
    "latency at the 50th, 95th and 99th percentiles",
    "Node.js 22 on commit 8273ab7, runner 43030470989",
    "fails when a ratio passes 8 for a 4 times step",
    "`ORU^R01` from `ES2022`",
    "a batch of 1,000 calls, then 20 calls more",
    "throughput, in bytes a second",
  ])("leaves a count, a ratio or a name alone: %j", (line) => {
    expect(findTypedNumbers(line)).toEqual([]);
  });

  it("allows a budget only in the words it is named with", () => {
    expect(findTypedNumbers("a cold import under 15 ms for each entry")).toEqual([]);
    expect(findTypedNumbers("a cold import of 15 ms")).toEqual([{ line: 1, text: "15 ms" }]);
  });

  it("names each budget as the bench scripts hold it", () => {
    for (const file of ["bench/imports.mjs", "bench/budgets.mjs"]) {
      expect(readFileSync(file, "utf8")).toContain(
        `COLD_IMPORT_MS = ${String(COLD_IMPORT_BUDGET_MS)};`,
      );
    }
    expect(BUDGET_PHRASES.map((b) => b.phrase)).toEqual([
      `under ${String(COLD_IMPORT_BUDGET_MS)} ms`,
    ]);
  });
});

describe("fillPage", () => {
  const page = [
    "# Performance",
    "",
    NUMBERS_HEADING,
    "",
    "The numbers for this section are measured on `main` at each release and filled in when the",
    "release is built. They are never typed by hand.",
    "",
    "## After",
    "",
    "Kept.",
    "",
  ].join("\n");

  it("replaces the placeholder however it wraps, and keeps what follows", () => {
    expect(fillPage(page, "Body.\n")).toBe(
      ["# Performance", "", NUMBERS_HEADING, "", "Body.", "", "## After", "", "Kept.", ""].join(
        "\n",
      ),
    );
  });

  it("fills a section at the end of the page", () => {
    expect(fillPage(`${NUMBERS_HEADING}\n\n${PLACEHOLDER}\n`, "Body.")).toBe(
      `${NUMBERS_HEADING}\n\nBody.\n`,
    );
  });

  it("refuses a section that holds anything but the placeholder", () => {
    expect(() => fillPage(fillPage(page, "Body."), "Again.")).toThrow(/other than the placeholder/);
    expect(() => fillPage("# Performance\n", "Body.")).toThrow(/no "## Current numbers" section/);
  });
});

describe("renderNumbers", () => {
  it("gives every case and entry a row, measured or named as not measured", () => {
    const collected = collectResults(resultsDir(), readResults);
    expect(collected.readings).toHaveLength(1);
    expect(collected.imports).toHaveLength(1);
    expect(collected.unreadable.map((u) => u.file)).toEqual(["bench-imports/broken.json"]);

    const text = renderNumbers(collected, SUITE, {
      commit: "abcdef0123456789",
      run: "https://github.com/cosyte/deid/actions/runs/1",
      entries: ENTRIES,
    });
    expect(text).toContain("release commit `abcdef0`");
    expect(text).toContain(
      "[the Bench workflow's run](https://github.com/cosyte/deid/actions/runs/1)",
    );
    expect(text).toContain(
      "| Format A: text in, text out | 2026-01-02 | v22.0.0 | github-actions-ubuntu24-x64 | Example CPU 9000, 4 logical CPUs |",
    );
    expect(text).toContain(
      "| Format A: text in, text out | small | 1.0 KiB | 500.00 us | 400.00 us | 600.00 us | not measured: too few calls | 2.00 MiB/s | 2.0 KiB | 20.0 KiB, 20.00 times the input | not measured: gc-unsettled |",
    );
    expect(text).toContain(
      "| Format A: text in, text out | large | 8.00 MiB | not measured: warmup-unstable | not measured: not asked for |",
    );
    expect(text).toContain(
      "| Format B: text in, text out | small | not measured: no reading of this case in the run |",
    );
    expect(text).toContain("| `.` | 12.000 ms | 10.000 ms | 1 | 2.0 KiB | 1.0 KiB | yes |");
    expect(text).toContain("| `./hl7` | not measured: no reading of this entry in the run |");
    expect(text).toContain("A results file was not read, `bench-imports/broken.json`");
    expect(text).not.toContain("Each results file names the commit");
  });

  it("says why when the run left nothing", () => {
    const text = renderNumbers(collectResults(join(scratch, "absent"), readResults), SUITE, {
      commit: "abcdef0123456789",
      missing: "no Bench run started on the release commit",
      entries: ENTRIES,
    });
    expect(text).toMatch(
      /^Not measured for this release \(commit `abcdef0`\): no Bench run started on the release commit\./,
    );
  });

  it("names the commits the results measured when they are not the release commit", () => {
    const text = renderNumbers(collectResults(resultsDir(), readResults), SUITE, {
      commit: "1234567000",
      missing: "the Bench run had not finished",
      entries: ENTRIES,
    });
    expect(text).toContain("Each results file names the commit it measured: `abcdef0`.");
    expect(text).toContain("Not everything was measured: the Bench run had not finished.");
  });

  it("escapes the reason a results file was not read, so it cannot break the page", () => {
    const { readings, imports } = collectResults(resultsDir(), readResults);
    const text = renderNumbers(
      {
        readings,
        imports,
        unreadable: [{ file: "a.json", reason: "expected {value} at <here> a|b \\ end" }],
      },
      SUITE,
      { commit: "abcdef0", entries: ENTRIES },
    );
    expect(text).toContain(
      "A results file was not read, `a.json`: expected \\{value\\} at \\<here\\> a\\|b \\\\ end.",
    );
  });

  it("covers every case the real suite defines, so a new benchmark gets a row", async () => {
    const suite = (
      (await import(pathToFileURL(resolve("bench/deid.bench.mjs")).href)) as { default: SuiteShape }
    ).default;
    const text = renderNumbers(collectResults(resultsDir(), readResults), suite, {
      commit: "abcdef0",
      entries: publishedEntries(
        JSON.parse(readFileSync("package.json", "utf8")) as { exports: Record<string, unknown> },
      ),
    });
    for (const b of suite.benchmarks)
      for (const s of b.sizes) expect(text).toContain(`| ${b.name} | ${s.label} |`);
    for (const entry of ["`.`", "`./hl7`", "`./dicom`"]) expect(text).toContain(`| ${entry} |`);
  });
});

describe("formatting", () => {
  it.each([
    [0.000_5, "0.50 us"],
    [12.3456, "12.346 ms"],
    [2500, "2.50 s"],
  ])("formatMs(%d)", (ms, text) => {
    expect(formatMs(ms)).toBe(text);
  });

  it.each([
    [512, "512 B"],
    [1536, "1.5 KiB"],
    [3 * 1024 * 1024, "3.00 MiB"],
  ])("formatBytes(%d)", (bytes, text) => {
    expect(formatBytes(bytes)).toBe(text);
  });
});

describe("fetchRun", () => {
  function io(answers: string[], fail: (args: readonly string[]) => boolean = () => false) {
    let clock = 0;
    const calls: string[][] = [];
    const fake: ReleaseIo = {
      gh: (args) => {
        calls.push([...args]);
        if (fail(args)) throw new Error("gh failed");
        if (args[0] === "run") return "";
        return answers.length > 1 ? (answers.shift() as string) : (answers[0] ?? "");
      },
      sleep: (ms) => {
        clock += ms;
        return Promise.resolve();
      },
      now: () => clock,
      log: () => undefined,
    };
    return { fake, calls };
  }

  it("waits for the run to finish, then downloads its artifacts", async () => {
    const { fake, calls } = io(["7\tin_progress\thttps://x/7\n", "7\tcompleted\thttps://x/7\n"]);
    const found = await fetchRun("cosyte/deid", "abc", "/out", 45, fake);
    expect(found).toEqual({ results: "/out", run: "https://x/7" });
    expect(calls[0]?.[1]).toBe(
      "repos/cosyte/deid/actions/workflows/bench.yml/runs?head_sha=abc&event=push&per_page=1",
    );
    expect(calls.at(-1)).toEqual([
      "run",
      "download",
      "7",
      "--repo",
      "cosyte/deid",
      "--dir",
      "/out",
      "--pattern",
      "bench-reading-*",
      "--pattern",
      "bench-imports",
    ]);
  });

  it("gives up at the deadline and says why", async () => {
    const { fake } = io(["7\tqueued\thttps://x/7\n"]);
    expect(await fetchRun("cosyte/deid", "abc", "/out", 3, fake)).toEqual({
      results: "/out",
      run: "https://x/7",
      missing: "the Bench run on the release commit had not finished after 3 minutes",
    });
    const none = io(["\t\t\n"]);
    expect(await fetchRun("cosyte/deid", "abc", "/out", 2, none.fake)).toEqual({
      results: "/out",
      missing: "no Bench run started on the release commit",
    });
  });

  it("reports a listing or a download that fails, never throws", async () => {
    const listing = io([""], () => true);
    expect((await fetchRun("cosyte/deid", "abc", "/out", 1, listing.fake)).missing).toBe(
      "the Bench runs on the release commit could not be listed",
    );
    const download = io(["7\tcompleted\thttps://x/7\n"], (args) => args[0] === "run");
    expect((await fetchRun("cosyte/deid", "abc", "/out", 1, download.fake)).missing).toBe(
      "the Bench run's results could not be downloaded",
    );
  });
});

describe("waitMinutes", () => {
  it("waits 45 minutes in the release job, 10 in the finalize job, or what it is told", () => {
    expect(waitMinutes({})).toBe(45);
    expect(waitMinutes({ FINALIZE_SHA: "abc" })).toBe(10);
    expect(waitMinutes({ BENCH_WAIT_MINUTES: "0", FINALIZE_SHA: "abc" })).toBe(0);
    expect(waitMinutes({ BENCH_WAIT_MINUTES: "soon" })).toBe(45);
    expect(waitMinutes({ BENCH_WAIT_MINUTES: "" })).toBe(45);
  });
});

describe("the command line", () => {
  const quiet: ReleaseIo = {
    gh: () => {
      throw new Error("no GitHub here");
    },
    sleep: () => Promise.resolve(),
    now: () => 0,
    log: () => undefined,
  };

  function pageCopy(): string {
    const path = join(scratch, `page-${String(Math.random()).slice(2)}.md`);
    writeFileSync(path, readFileSync(PAGE, "utf8"));
    return path;
  }

  it("check fails on a page with a typed number, and passes the committed page", async () => {
    const typed = pageCopy();
    writeFileSync(typed, `${readFileSync(typed, "utf8")}\nOne call took 2.5 ms.\n`);
    expect(await main(["check", typed], quiet, {})).toBe(1);
    expect(await main(["check", PAGE], quiet, {})).toBe(0);
  });

  it("fill writes the numbers into the page, which then holds no placeholder", async () => {
    const page = pageCopy();
    expect(
      await main(["fill", page, "--results", resultsDir(), "--commit", "abcdef0123"], quiet, {}),
    ).toBe(0);
    const filled = readFileSync(page, "utf8");
    expect(filled).not.toContain("They are never typed by hand.");
    expect(filled).toContain(
      "| HL7 v2: text in, text out | 1 ORU^R01, 1.6 KiB | not measured: no reading of this case in the run |",
    );
    expect(filled).toContain(
      "## Current numbers\n\nMeasured on `main` at the release commit `abcdef0`",
    );
  });

  it("release outside GitHub Actions fills the section with the reason, and exits 0", async () => {
    const page = pageCopy();
    expect(await main(["release", page], quiet, { RUNNER_TEMP: scratch })).toBe(0);
    expect(readFileSync(page, "utf8")).toMatch(
      /## Current numbers\n\nNot measured for this release \(commit `[0-9a-f]{7}`\): the release ran outside GitHub Actions\./,
    );
  });

  it("release leaves the page as it was, and still exits 0, when it cannot fill it", async () => {
    const page = pageCopy();
    writeFileSync(page, "# No numbers section\n");
    expect(await main(["release", page], quiet, { RUNNER_TEMP: scratch })).toBe(0);
    expect(readFileSync(page, "utf8")).toBe("# No numbers section\n");
  });

  it("release leaves the placeholder, warns and exits 0 when @cosyte/bench will not load", async () => {
    const page = pageCopy();
    const before = readFileSync(page, "utf8");
    const lines: string[] = [];
    const broken: ReleaseIo = {
      ...quiet,
      log: (line) => lines.push(line),
      loadBench: () => Promise.reject(new Error("Cannot find package '@cosyte/bench'")),
    };
    expect(await main(["release", page], broken, { RUNNER_TEMP: scratch })).toBe(0);
    expect(readFileSync(page, "utf8")).toBe(before);
    expect(lines.join("\n")).toContain(
      "::warning::performance-numbers: the \"Current numbers\" section was not filled: Cannot find package '@cosyte/bench'",
    );
  });

  it("loads nothing but Node.js built-ins before the guarded path, so a load failure is caught", () => {
    const source = readFileSync("scripts/performance-numbers.ts", "utf8");
    const loaded = [...source.matchAll(/^import\s+(?!type\b)[^;]*?from\s+"([^"]+)";/gms)].map(
      (m) => m[1],
    );
    expect(loaded.length).toBeGreaterThan(0);
    expect(loaded.filter((from) => !from?.startsWith("node:"))).toEqual([]);
  });

  it("refuses a command it does not know, or a missing argument", async () => {
    expect(await main(["typo", PAGE], quiet, {})).toBe(2);
    expect(await main(["check"], quiet, {})).toBe(2);
    expect(await main(["fill", PAGE], quiet, {})).toBe(2);
  });
});

describe("cell", () => {
  it("escapes a backslash before a pipe, so neither ends the cell", () => {
    expect(cell("a|b")).toBe("a\\|b");
    expect(cell("a\\|b")).toBe("a\\\\\\|b");
    expect(cell("plain")).toBe("plain");
  });
});

describe("runGh", () => {
  it("gives every gh call a timeout well under the release's wait", () => {
    const seen: { file: string; args: readonly string[]; timeout: unknown; killSignal: unknown }[] =
      [];
    const out = runGh(["api", "x"], (file, args, options) => {
      seen.push({ file, args, timeout: options.timeout, killSignal: options.killSignal });
      return "ok";
    });
    expect(out).toBe("ok");
    expect(seen).toEqual([
      { file: "gh", args: ["api", "x"], timeout: GH_TIMEOUT_MS, killSignal: "SIGKILL" },
    ]);
    expect(GH_TIMEOUT_MS).toBeGreaterThan(0);
    expect(GH_TIMEOUT_MS).toBeLessThanOrEqual(5 * 60_000);
  });
});

describe("pack:docs:release", () => {
  it.skipIf(process.platform === "win32")(
    "puts the committed page back even when packing the docs fails",
    () => {
      const scripts = (
        JSON.parse(readFileSync("package.json", "utf8")) as { scripts: Record<string, string> }
      ).scripts;
      const command = scripts["pack:docs:release"];
      expect(command).toBeDefined();
      const bin = join(scratch, `bin-${String(Math.random()).slice(2)}`);
      mkdirSync(bin);
      const log = join(bin, "calls.log");
      const stub = (name: string, code: number): void => {
        const path = join(bin, name);
        writeFileSync(path, `#!/bin/sh\necho "${name} $*" >> "${log}"\nexit ${String(code)}\n`);
        chmodSync(path, 0o755);
      };
      stub("tsx", 0);
      stub("cosyte-process", 3);
      stub("git", 0);
      const run = spawnSync("/bin/sh", ["-c", command ?? ""], {
        env: { PATH: `${bin}:/usr/bin:/bin` },
        encoding: "utf8",
      });
      expect(run.status).not.toBe(0);
      expect(readFileSync(log, "utf8").trim().split("\n")).toEqual([
        "tsx scripts/performance-numbers.ts release docs-content/performance.md",
        "cosyte-process pack-docs",
        "git checkout -- docs-content/performance.md",
      ]);
    },
  );
});
