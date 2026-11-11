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

Two readings of the same library code (0.2.10), from the Bench workflow's runs 43023900708 (commit
`99833a8`) and 43028309781 (commit `aa0b7db`), Node 22.23.4 on GitHub-hosted `ubuntu` x64 runners
with 4 vCPUs. Each format ran in its own job on its own machine (AMD EPYC 7763, 9V45 or 9V74, or
Intel Xeon Platinum 8573C), and the machine changed between the runs, so each cell gives the range
of the two readings, lower first. Compare rows within a format, not across formats, and read them
as a scale, not a specification: the policy engine ran about twice as fast on one machine as on
the other.

**Method.** Throughput and time per call are the median of 3 fresh processes; latency is per call,
nearest rank (a slow size takes too few calls in its sample to give a p99, shown as none); peak
heap is one call's V8 heap above the settled heap. A size whose warmup did not settle reports
"skipped" with its median call time, never a guessed number.

Text in, text out (what a consumer runs), at each format's smallest and largest size:

| Format and size                          | Per call              | p50                   | p99                 | Throughput               | Peak heap            |
| ---------------------------------------- | --------------------- | --------------------- | ------------------- | ------------------------ | -------------------- |
| HL7 v2, 1 ORU^R01, 1.6 KiB               | 219.24 to 296.13 us   | 200.13 to 276.73 us   | 456.24 to 708.78 us | 5.3 to 7.16 MiB/s        | 671.2 to 681.6 KiB   |
| HL7 v2, batch of 1,000, 1.6 MiB          | skipped in both       | 286.969 to 383.488 ms | none                | none                     | 107.68 to 107.71 MiB |
| FHIR R4, 1 Patient, 1 KiB                | 26.26 to 38.82 us     | 23.75 to 37.15 us     | 60.41 to 77.76 us   | 22.08 to 32.65 MiB/s     | 93.2 KiB in both     |
| FHIR R4, Bundle of 10,000, 5.8 MiB       | skipped in both       | 616.776 ms (one run)  | none                | none                     | 168.31 to 169.92 MiB |
| C-CDA, 10 results, 11 KiB                | 2.383 to 2.407 ms     | 2.213 to 2.253 ms     | none                | 4.34 to 4.38 MiB/s       | 1.81 to 1.82 MiB     |
| C-CDA, 1,000 results, 640 KiB            | 145.242 to 145.9 ms   | 140.599 to 142.458 ms | none                | 4.3 to 4.32 MiB/s        | 40.72 to 40.79 MiB   |
| X12 837P, 1 claim, 1 KiB                 | 90.06 to 120.46 us    | 88.78 to 117.67 us    | 204.24 to 289.51 us | 8.52 to 11.39 MiB/s      | 258.8 to 259.7 KiB   |
| X12 837P, 5,000 claims, 2.7 MiB          | 506.227 ms (one run)  | 494.886 to 588.381 ms | none                | 5.36 MiB/s (one run)     | 173.86 to 175.85 MiB |
| DICOM, CT slice, 514 KiB                 | 452.36 to 547.55 us   | 372.24 to 375.01 us   | 1.035 to 1.599 ms   | 916.28 to 1109.09 MiB/s  | 537.6 to 549.8 KiB   |
| DICOM, Enhanced CT, 200 frames, 100 MiB  | 61.25 to 64.011 ms    | 60.468 to 61.755 ms   | none                | 1562.84 to 1633.29 MiB/s | 15.75 to 15.76 MiB   |
| Policy engine, Safe Harbor, 16 loci      | 1.9 to 3.78 us        | 2.02 to 3.84 us       | 3.45 to 8.22 us     | 316.2 to 630.22 MiB/s    | 17.7 KiB in both     |
| Policy engine, Safe Harbor, 100,000 loci | 40.121 to 65.251 ms   | 37.685 to 65.93 ms    | none                | 118.77 to 193.16 MiB/s   | 29.58 to 30.23 MiB   |
| Policy engine, keyed, 16 loci            | 15.64 to 29.52 us     | 14.5 to 27.24 us      | 22.11 to 53.19 us   | 40.52 to 76.49 MiB/s     | 32.2 KiB in both     |
| Policy engine, keyed, 100,000 loci       | 137.612 to 240.137 ms | 138.538 to 246.701 ms | none                | 32.27 to 56.32 MiB/s     | 38.87 to 38.89 MiB   |

"One run" marks a size the other run skipped. The DICOM peak heap leaves out Pixel Data, which is
a Buffer: counted with every byte, the 100 MiB Enhanced CT peaked at 123.23 to 123.66 MiB
resident, 1.23 to 1.24 times its input. The engine's throughput is over the JSON size of its locus
model.

**Against the budgets**, in the same two runs:

- **Peak heap, 20 times the input for a dense shape:** missed by every format row but one in both
  runs. The multiples run from 18.67 to 18.90 (the FHIR adapter on a Bundle of 10,000, the one
  within it) up to 417.84 to 424.30 (one HL7 v2 message, text in, text out); a small input pays a
  fixed cost that a large one spreads. The policy engine is within it at every size but the keyed
  policy at 16 loci (26.31 times in both).
- **Peak memory, 3 times the input for DICOM:** within it in both, from 0.08 to 2.09 times
  resident.
- **Throughput kept from smallest to largest size, at least half**, read by the profile: within it
  for HL7 v2 (79 to 80% text in, text out; 92 to 99% the adapter), C-CDA (88 to 90%), X12 (52% in
  both) and DICOM. Missed by FHIR R4 (27% text in, text out; 22 to 23% the adapter) and the Safe
  Harbor engine (40% in both).
- **Cold import, 15 ms an entry:** within it for the root (5.95 to 6.19 ms) and `/ncpdp` (8.18 to
  8.42 ms); missed by `/ccda` (16.84 to 17.52 ms), `/fhir` (17.52 to 18.06 ms), `/hl7` (20.36 to
  20.98 ms), `/dicom` (21.15 to 21.73 ms) and `/x12` (26.19 to 27.25 ms). Each of those loads its
  parser, which is most of the bytes.

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
