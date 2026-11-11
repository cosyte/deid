// The cold import of each published entry on its own, against the 15 ms budget:
//   pnpm build && pnpm bench:imports [--out <dir>] [--summary <file.md>]
//
// For each ESM entry in package.json `exports`, `cosyte-bench run` imports the built file in 20
// fresh processes interleaved with 20 that import an empty module, and records every file the
// import loads with its gzip size (bench/entry.bench.mjs is the suite it hands, with --no-memory).
// The table splits what an entry loads into this package's own files and the parser it needs, an
// optional peer the consumer has installed anyway.
//
// It always exits 0 when every entry was read: the budget is advisory. It exits 2 when one was not.

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { readResults } from "@cosyte/bench";

const COLD_IMPORT_MS = 15;

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function args(argv) {
  const out = { dir: resolve(root, "bench-results/imports"), summary: undefined };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--out") out.dir = resolve(argv[++i]);
    else if (argv[i] === "--summary") out.summary = argv[++i];
  }
  return out;
}

function kib(bytes) {
  return `${(bytes / 1024).toFixed(1)} KiB`;
}

/** Every `exports` subpath with an ESM default, as [subpath, file]. */
function entries() {
  const manifest = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
  const out = [];
  for (const [subpath, target] of Object.entries(manifest.exports)) {
    const file = typeof target === "object" ? target.import?.default : undefined;
    if (typeof file === "string") out.push([subpath, file]);
  }
  return out;
}

function main() {
  const options = args(process.argv.slice(2));
  mkdirSync(options.dir, { recursive: true });
  const bin = resolve(root, "node_modules/.bin/cosyte-bench");
  const lines = [
    "### Cold import of each published entry",
    "",
    `The median of 20 fresh processes importing the built entry, and that median above an empty module's; every file the import loads, split into this package's own and the parser it imports. Budget ${String(COLD_IMPORT_MS)} ms.`,
    "",
    "| Entry | Median | Above empty | Within | Own files | Own, gzipped | Parser files | Parser, gzipped |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
  ];
  let failed = false;
  for (const [subpath, file] of entries()) {
    const slug = subpath === "." ? "root" : subpath.slice(2);
    const out = resolve(options.dir, `${slug}.json`);
    try {
      execFileSync(
        bin,
        [
          "run",
          "--suite",
          resolve(root, "bench/entry.bench.mjs"),
          "--target",
          resolve(root, file),
          "--no-memory",
          "--processes",
          "1",
          "--out",
          out,
        ],
        { cwd: root, stdio: ["ignore", "ignore", "inherit"] },
      );
    } catch {
      // A reading with a skipped measure still writes its results; read what is there.
    }
    let doc;
    try {
      doc = readResults(readFileSync(out, "utf8"));
    } catch {
      lines.push(`| \`${subpath}\` | not measured | | | | | | |`);
      failed = true;
      continue;
    }
    const cost = doc.reading.importCost;
    if (cost === null) {
      lines.push(`| \`${subpath}\` | not measured | | | | | | |`);
      failed = true;
      continue;
    }
    const own = cost.files.filter((f) => f.path.includes("dist/") && !f.path.includes("node_modules"));
    const peer = cost.files.filter((f) => f.path.includes("node_modules"));
    const sum = (list, key) => list.reduce((n, f) => n + f[key], 0);
    lines.push(
      `| \`${subpath}\` | ${cost.medianMs.toFixed(2)} ms | ${(cost.medianMs - cost.emptyMedianMs).toFixed(2)} ms | ${cost.medianMs < COLD_IMPORT_MS ? "yes" : "**no**"} | ${String(own.length)}, ${kib(sum(own, "bytes"))} | ${kib(sum(own, "gzipBytes"))} | ${String(peer.length)}, ${kib(sum(peer, "bytes"))} | ${kib(sum(peer, "gzipBytes"))} |`,
    );
  }
  const text = `${lines.join("\n")}\n`;
  process.stdout.write(text);
  if (options.summary !== undefined) writeFileSync(options.summary, text);
  return failed ? 2 : 0;
}

process.exitCode = main();
