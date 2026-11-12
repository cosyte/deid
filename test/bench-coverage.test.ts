/**
 * **Every published adapter is measured.** The benchmark suite, the module it is handed, the Bench
 * workflow's reading jobs and the scaling gate each list the formats by hand, so a format can ship
 * with none of them knowing: NCPDP Telecom did, with its adapter published and no benchmark, reading
 * job or scaling gate behind it. This holds each list to the adapter subpaths in `package.json`
 * `exports`, and holds every format to the three benchmarks a row over budget is attributed with:
 * text in, text out; the adapter on a parsed model; and the parser alone on the same input.
 *
 * It reads the files as text or imports the suite, which builds nothing: the inputs are built in
 * code, synthetic, only when a benchmark runs.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

interface FormatShape {
  readonly name: string;
  readonly entry: string;
  readonly parserAlone?: unknown;
}

interface SuiteModule {
  readonly FORMATS: readonly FormatShape[];
  readonly default: { readonly benchmarks: readonly { readonly name: string }[] };
}

const read = (file: string): string => readFileSync(resolve(file), "utf8");

/** Every published subpath but the root and package.json: one adapter each. */
function adapterEntries(): string[] {
  const manifest = JSON.parse(read("package.json")) as { exports: Record<string, unknown> };
  return Object.keys(manifest.exports)
    .filter((subpath) => subpath !== "." && subpath !== "./package.json")
    .sort();
}

async function suite(): Promise<SuiteModule> {
  return (await import(pathToFileURL(resolve("bench/deid.bench.mjs")).href)) as SuiteModule;
}

describe("every published adapter is measured", () => {
  it("has a format in the benchmark suite", async () => {
    const { FORMATS } = await suite();
    expect(FORMATS.map((f) => f.entry).sort()).toEqual(adapterEntries());
  });

  it("is in the module the benchmarks and the scaling gate are handed", () => {
    const target = read("bench/target.mjs");
    for (const entry of adapterEntries()) {
      expect(target).toContain(`from "../dist/${entry.slice(2)}/index.mjs"`);
    }
  });

  it("has text in, text out, the adapter alone and the parser alone", async () => {
    const { FORMATS, default: built } = await suite();
    const names = new Set(built.benchmarks.map((b) => b.name));
    for (const format of FORMATS) {
      expect(typeof format.parserAlone, format.name).toBe("function");
      for (const operation of [
        "text in, text out",
        "adapter on a parsed model",
        "parser alone, text in, text out",
      ]) {
        expect(names.has(`${format.name}: ${operation}`), `${format.name}: ${operation}`).toBe(
          true,
        );
      }
    }
  });

  it("has a reading job in the Bench workflow that runs all three", async () => {
    const { FORMATS } = await suite();
    const workflow = read(".github/workflows/bench.yml");
    for (const format of FORMATS) {
      expect(workflow).toContain(`first: "${format.name}: text in, text out"`);
      expect(workflow).toContain(`second: "${format.name}: adapter on a parsed model"`);
      expect(workflow).toContain(`third: "${format.name}: parser alone, text in, text out"`);
    }
  });

  it("has a scaling gate", async () => {
    const { FORMATS } = await suite();
    const gates = read("test/perf/scaling-gate.perf.ts");
    for (const format of FORMATS) {
      const at = gates.search(
        new RegExp(`gate\\(\\s*"${format.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}",`),
      );
      expect(at, format.name).toBeGreaterThan(-1);
    }
  });
});
