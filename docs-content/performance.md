---
id: performance
title: Performance
sidebar_label: Performance
description: "What the performance standard measures on a Cosyte package, what we measure on @cosyte/deid today (nothing yet), and where the numbers will appear."
---

# Performance

This page describes what we measure on `@cosyte/deid`, how, and how to run the measurements
yourself. The shared method every Cosyte package follows (throughput, latency percentiles, memory,
import time and bundle size, and how a pull request is compared with `main`) is written down in the
performance standard in
[cosyte/config's decision records](https://github.com/cosyte/config/tree/main/documentation/decisions).
The numbers for the current release are in [Current numbers](#current-numbers) below.

## What we measure today

Nothing yet. `@cosyte/deid` has no benchmark and no performance regression test in its repository,
so we make no claim about how fast it is or how much memory it uses. Until it has one, every number
in [Current numbers](#current-numbers) reads "not measured for this release", with that reason.

## What the measurement will cover

When the package is brought under the performance standard, its benchmark will measure what the
standard asks of every package:

- **Throughput**: by document size.
- **Latency**: the 50th, 95th and 99th percentiles of a single pass.
- **Memory**: peak heap and allocations over a long run.
- **Import time and bundle size** of the root entry point and of each subpath.

Its inputs will be synthetic, like every fixture in this repository, so a run is the same anywhere
and no patient data is involved.

## What these numbers are not

- **Not a guarantee for every input.** A document much larger or more deeply nested than the
  benchmark's inputs is not characterized by them.
- **Not a comparison with other libraries.** That is a separate suite with its own written method.
- **Not a behavior contract.** Nothing here changes what a pass removes, keeps or records.

## Run the benchmarks yourself

There is no benchmark to run yet. When one is added, this section will give the command.

## Current numbers

The numbers for this section are measured on `main` at each release and filled in when the release
is built. They are never typed by hand.
