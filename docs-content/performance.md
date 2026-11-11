---
id: performance
title: Performance
sidebar_label: Performance
description: "How we measure @cosyte/deid: the benchmark suite in bench/, the budgets, the scaling gate on every pull request, and the latest reading on a GitHub runner."
---

# Performance

This page describes what we measure on `@cosyte/deid`, how, and how to run the measurements
yourself. The shared method every Cosyte package follows (throughput, latency percentiles, memory,
import time and bundle size, and how a pull request is compared with `main`) is written down in the
performance standard in
[cosyte/config's decision records](https://github.com/cosyte/config/tree/main/documentation/decisions).
The numbers for the current release are in [Current numbers](#current-numbers) below.

## What we measure

Three instruments, all in the repository, all on synthetic input built in code by
`bench/shapes.mjs`. No file is read and no patient data is involved, so a run is the same anywhere.

- **The benchmark suite**, `bench/deid.bench.mjs`, on `@cosyte/bench`, against the built entries a
  consumer imports. Each format (HL7 v2, FHIR R4, C-CDA, X12 837P, DICOM) has two benchmarks: text
  in, text out (parse, transform and write, what a consumer runs), and the adapter alone on a model
  parsed beforehand. The policy engine has two more, on the format-agnostic locus model: the
  built-in Safe Harbor policy, and a keyed policy that pseudonymizes, shifts dates and hashes
  through HMAC. Every benchmark runs at the size a feed sends all day and at sizes well past it:
  up to a batch of 1,000 HL7 v2 messages (1.6 MiB), a FHIR Bundle of 10,000 entries (5.8 MiB), a
  C-CDA document of 1,000 results (640 KiB), an X12 interchange of 5,000 claims (2.7 MiB), an
  Enhanced CT of 200 frames (100 MiB), and 100,000 loci. A reading gives throughput, latency at
  the 50th, 95th and 99th percentiles, allocations per call, peak heap, a long run for leaks, and
  the cold import with every file it loads and its gzip size.
- **The budgets**, `bench/budgets.mjs`, read from a reading: peak heap under 20 times the input for
  a dense shape (HL7 v2, FHIR, C-CDA, X12 and the engine, many small values); peak memory under 3
  times the input for DICOM, whose bytes are almost all Pixel Data (read from the resident peak in
  the profile, since a Buffer is outside the V8 heap); throughput, in bytes a second, not falling
  by more than half from a shape's smallest size to its largest; and a cold import under 15 ms for
  each published entry, read by `bench/imports.mjs`. The budgets are advisory: a miss is a number
  to act on, not a red check.
- **The scaling gate**, `test/perf/scaling-gate.perf.ts`, run by `pnpm test:perf` in the
  `ci / scaling-gate` job on every pull request. For each format adapter and the policy engine it
  asks one question: does the cost of a pass grow faster than its input? It times 4 times the
  inputs (the count axis) and inputs 4 times longer (the size axis), and fails when either ratio
  passes the ceiling the shared contract fixes, 8 for a 4 times step. Each gate has a self-check
  that runs the same pass with its input read the wrong way (quadratically) and proves the gate
  fails on it at exactly these sizes. A gate does not see a constant-factor slowdown; the base
  against head comparison below is the instrument for that.

On a pull request, the `ci / bench-compare` job times the suite on the base build and the head
build, interleaved on one runner, at each format's smallest size and the engine's. It is advisory
and never fails. The Bench workflow (`.github/workflows/bench.yml`) takes a full reading, the
budgets, the cold import of each entry and a profile on GitHub-hosted runners, one job per format.
It runs on demand and on a pull request that changes `bench/` or the workflow.

## What these numbers are not

- **Not a promise for every input.** A document much larger or more deeply nested than the
  benchmark's inputs is not characterized by them.
- **Not a comparison with other libraries.** That is a separate suite with its own written method.
- **Not a behavior contract.** Nothing here changes what a pass removes, keeps or records.
- **Not comparable across jobs.** Each format's reading runs in its own job on its own runner;
  each reading names the machine it ran on.

## Latest reading on a GitHub runner

Three readings of the same library code (0.2.10, as merged with `main` at `8273ab7`), from the
Bench workflow's runs 43030470989 (commit `8273ab7`), 43031925977 (commit `ffb72b8`) and
43039149171 (commit `be443cd`): the commits between them change only documentation. Node 22.23.4
on GitHub-hosted `ubuntu` x64 runners with 4 vCPUs. Each format ran in its own job on its own
machine (AMD EPYC 7763, 9V45 or 9V74, or Intel Xeon Platinum 8370C or 8573C), and the machine
changed between runs, so each cell gives the range of the three readings, lower first. Earlier runs
of this page's branch measured older DICOM and C-CDA code and are not counted here. Compare rows
within a format, not across formats, and read them as a scale, not a specification: the same pass
ran up to 2.03 times as fast in one run as in another.

**Method.** Throughput and time per call are the median of 3 fresh processes; latency is per call,
nearest rank (a slow size takes too few calls in its sample to give a p99, shown as none); peak
heap is one call's V8 heap above the settled heap. A size whose warmup did not settle reports
"skipped" with its median call time, never a guessed number.

Text in, text out (what a consumer runs), at each format's smallest and largest size:

| Format and size                          | Per call              | p50                              | p99                 | Throughput              | Peak heap            |
| ---------------------------------------- | --------------------- | -------------------------------- | ------------------- | ----------------------- | -------------------- |
| HL7 v2, 1 ORU^R01, 1.6 KiB               | 206.09 to 222.77 us   | 194.67 to 203.85 us              | 441.45 to 552.68 us | 7.04 to 7.61 MiB/s      | 667.4 to 687 KiB     |
| HL7 v2, batch of 1,000, 1.6 MiB          | 272.998 ms (one run)  | 255.018 to 299.167 ms            | none                | 5.75 MiB/s (one run)    | 107.79 to 132.58 MiB |
| FHIR R4, 1 Patient, 1 KiB                | 23.3 to 47.3 us       | 23.11 to 45.69 us                | 41.99 to 103.5 us   | 18.13 to 36.79 MiB/s    | 89.5 to 93.2 KiB     |
| FHIR R4, Bundle of 10,000, 5.8 MiB       | 559.025 ms (one run)  | 550.722 ms (one run)             | none                | 10.43 MiB/s (one run)   | 167.27 to 168.47 MiB |
| C-CDA, 10 results, 11 KiB                | 1.782 to 2.39 ms      | 1.686 to 2.231 ms                | 2.92 ms (one run)   | 4.37 to 5.86 MiB/s      | 1.79 to 1.82 MiB     |
| C-CDA, 1,000 results, 640 KiB            | 130.693 to 148.474 ms | 131.077 to 151.671 ms            | none                | 4.23 to 4.8 MiB/s       | 40.75 to 40.83 MiB   |
| X12 837P, 1 claim, 1 KiB                 | 101.56 to 202.41 us   | 92.98 to 182.17 us               | 196.43 to 383.25 us | 5.07 to 10.1 MiB/s      | 253 to 253.7 KiB     |
| X12 837P, 5,000 claims, 2.7 MiB          | 838.729 ms (one run)  | 509.263 to 772.873 ms (two runs) | none                | 3.23 MiB/s (one run)    | 175.41 to 177.94 MiB |
| DICOM, CT slice, 514 KiB                 | 692.09 to 784.68 us   | 527.28 to 569.68 us              | 1.144 to 1.458 ms   | 639.39 to 724.93 MiB/s  | 573.1 to 583.3 KiB   |
| DICOM, Enhanced CT, 200 frames, 100 MiB  | 75.57 to 77.583 ms    | 74.246 to 78.929 ms              | none                | 1289.44 to 1323.8 MiB/s | 15.94 to 15.98 MiB   |
| Policy engine, Safe Harbor, 16 loci      | 1.93 to 3.77 us       | 2.09 to 3.8 us                   | 3.6 to 8.44 us      | 317.02 to 621.05 MiB/s  | 17.7 KiB in all      |
| Policy engine, Safe Harbor, 100,000 loci | 40.015 to 60.241 ms   | 39.157 to 55.578 ms              | none                | 128.65 to 193.68 MiB/s  | 29.63 to 30.06 MiB   |
| Policy engine, keyed, 16 loci            | 16.13 to 28.23 us     | 14.53 to 26.16 us                | 23.57 to 44.71 us   | 42.36 to 74.14 MiB/s    | 32.2 KiB in all      |
| Policy engine, keyed, 100,000 loci       | 134.756 to 229.798 ms | 138.232 to 230.96 ms             | none                | 33.72 to 57.51 MiB/s    | 38.85 to 38.9 MiB    |

"One run" or "two runs" marks a value only that many runs measured: the others skipped the size or
gave no value. The DICOM peak heap leaves out Pixel Data, which is a Buffer: counted with every
byte, the 100 MiB Enhanced CT peaked at 117.70 to 123.64 MiB resident, 1.18 to 1.24 times its
input. The engine's throughput is over the JSON size of its locus model.

**Against the budgets**, in the same three runs:

- **Peak heap, 20 times the input for a dense shape:** missed by every format row but one in all
  three runs. The multiples run from 19.16 to 19.18 (the FHIR adapter on a Bundle of 10,000, the
  one within it) up to 415.47 to 427.66 (one HL7 v2 message, text in, text out); a small input
  pays a fixed cost that a large one spreads. The policy engine is within it at every size but the
  keyed policy at 16 loci (26.31 times in all three).
- **Peak memory, 3 times the input for DICOM:** within it in all three, from 0.07 to 2.08 times
  resident.
- **Throughput kept from smallest to largest size, at least half**, read by the profile: within it
  in all three for HL7 v2 (72 to 75% text in, text out; 92 to 100% the adapter), C-CDA (90 to 91%
  text in, text out; 76 to 86% the adapter), X12 (52 to 66% text in, text out; 50 to 61% the
  adapter, at the edge in one run), DICOM (141 to 171% text in, text out; 686 to 795% the adapter)
  and the keyed engine (79% in all three). Missed by FHIR R4 (27 to 33% text in, text out; 22 to
  29% the adapter) and the Safe Harbor engine (39 to 41%).
- **Cold import, 15 ms an entry:** within it in all three for the root (4.02 to 5.96 ms) and
  `/ncpdp` (5.88 to 8.18 ms). `/ccda` (11.51 to 16.91 ms) and `/fhir` (11.86 to 17.51 ms) were
  within it in two runs and missed it in one; `/hl7` (13.29 to 20.44 ms) and `/dicom` (14.72 to
  21.27 ms) were within it in one run and missed it in two; `/x12` (18.05 to 26.77 ms) missed it
  in all three. Each of those five loads its parser, which is most of the bytes.

The budgets are proposals, so a miss here is a number to act on, not a failed check.

## Run the benchmarks yourself

Build first: the suite measures the built package.

```bash
pnpm build
pnpm bench:reading --out bench-results/reading.json
pnpm bench:reading --only "HL7 v2: text in, text out" --out bench-results/hl7.json
pnpm bench:budgets bench-results/reading.json
pnpm bench:imports
pnpm bench:profile --out bench-results/profile
pnpm test:perf
```

A base against head comparison, with the base built in another checkout:

```bash
pnpm bench:compare --base ../deid-base/bench/target.mjs --head bench/target.mjs
```

A reading on a shared or busy machine is noisy. Take a reading you mean to compare on a GitHub
runner, through the Bench workflow.

## Current numbers

The numbers for this section are measured on `main` at each release and filled in when the release
is built. They are never typed by hand.
