---
id: performance
title: Performance
sidebar_label: Performance
description: "How we measure @cosyte/deid: the benchmark suite in bench/, the budgets, the scaling gate on every pull request, and the numbers measured at each release."
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
  consumer imports. Each format (HL7 v2, FHIR R4, C-CDA, X12 837P, NCPDP Telecom, DICOM) has three
  benchmarks: text in, text out (parse, transform and write, what a consumer runs); the adapter
  alone on a model parsed beforehand; and the parser alone, text in, text out with nothing
  de-identified between the read and the write, so the time and memory of a pass can be split into
  the parser's share and the adapter's. The policy engine has two more, on the format-agnostic locus
  model: the built-in Safe Harbor policy, and a keyed policy that pseudonymizes, shifts dates and
  hashes through HMAC. Every benchmark runs at the size a feed sends all day and at sizes well past
  it: up to a batch of 1,000 HL7 v2 messages, a FHIR Bundle of 10,000 entries, a C-CDA document of
  1,000 results, an X12 interchange of 5,000 claims, a batch of 10,000 NCPDP Telecom claims (one
  transmission a line), an Enhanced CT of 200 frames, and 100,000 loci;
  [Current numbers](#current-numbers) gives each input's size. A reading gives throughput, latency at the
  50th, 95th and 99th percentiles, allocations per call, peak heap, a long run for leaks, and the
  cold import with every file it loads and its gzip size.
- **The budgets**, `bench/budgets.mjs`, read from a reading: peak heap under 20 times the input for
  a dense shape (HL7 v2, FHIR, C-CDA, X12, NCPDP and the engine, many small values); peak memory
  under 3 times the input for DICOM, whose bytes are almost all Pixel Data (read from the resident
  peak in the profile, since a Buffer is outside the V8 heap); throughput, in bytes a second, not
  falling by more than half from a shape's smallest size to its largest; and a cold import
  under 15 ms for each published entry, read by `bench/imports.mjs`. The budgets are advisory: a
  miss is a number to act on, not a red check.
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
It runs on demand, on a pull request that changes `src/`, `bench/` or the workflow, and on a push to
`main` that changes `package.json`, which every release commit does.

## How the numbers reach this page

No measured number is typed on this page: a number typed by hand describes the code it was
measured on, and every later change leaves it describing older code. The section below,
[Current numbers](#current-numbers), is filled when a release is built. The release finds the Bench
run on the release commit, waits for it to finish, downloads its results files, and writes their
numbers into the section of the page it publishes, with the commit, the date, the Node.js version
and the machine of each job (`scripts/performance-numbers.ts`, run by `pnpm pack:docs:release`).
Every case the suite defines and every published entry gets a row; one the run did not measure
says "not measured" with the reason, and a release whose run left nothing says why instead.

`pnpm check:docs-content` fails when this page carries a number in a measured unit (a time, a size,
a rate or a percentage) anywhere but in a budget it names, so a reading cannot be typed here by
hand.

## What these numbers are not

- **Not a promise for every input.** A document much larger or more deeply nested than the
  benchmark's inputs is not characterized by them.
- **Not a comparison with other libraries.** That is a separate suite with its own written method.
- **Not a behavior contract.** Nothing here changes what a pass removes, keeps or records.
- **Not comparable across jobs.** Each format's reading runs in its own job on its own runner;
  each reading names the machine it ran on.

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
