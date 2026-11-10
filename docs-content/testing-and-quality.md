---
id: testing-and-quality
title: Testing and quality
sidebar_label: Testing and quality
description: "How we test @cosyte/deid: unit tests, the zero-leak and over-scrub corpus, property-based tests, fuzzing, doc samples and the PHI scan, and what each misses."
---

# Testing and quality

This page describes how we test `@cosyte/deid`, what each technique catches, and what it cannot.
The shared rules every Cosyte package follows (the coverage and mutation floors, the property-based
runners, what a pull request must prove) are written down in the testing standard in
[cosyte/config's decision records](https://github.com/cosyte/config/tree/main/documentation/decisions).
The numbers for the current release are in [Current numbers](#current-numbers) below.

A de-identifier fails in two directions, and we test both. An identifier that survives the pass, or
that the manifest never mentions, cannot be recalled once the output is shared. A clinical value
scrubbed by mistake destroys data a clinician relies on. So most of what follows checks what the
output holds, not only that the pass did not throw.

## What we run, and what each technique catches

| Technique | What it catches | What it cannot catch |
| --- | --- | --- |
| Unit tests | each documented behavior and each failure path of the core and the six format adapters, run against the source | an input nobody thought to write down |
| The leak and over-scrub corpus | an identifier that survives a pass, in the serialized output or in the manifest, across all six adapters; and a clinical value the pass removed. Each seeded synthetic sentinel is first shown present in the input, and one injected back into the output is shown to be caught, so a green run is not an empty search | an identifier at a position no fixture seeds; behavior on real traffic, since every fixture is synthetic |
| Property-based tests | a whole class of generated input breaking a stated rule: no seeded sentinel survives, the manifest carries no value, the input is never mutated, the same patient's date shifts to the same value in every pass and intervals are kept, the key never appears in the output | a rule nobody stated; a case outside the cases run; a gap in what the generators produce |
| Fuzzing | a leak or a hang on damaged input: 200 random truncations of each of the HL7 v2, X12 and NCPDP fixtures, run through parse and de-identify, leak no full seeded sentinel, and 200 single-character replacements of each end in a result or a bounded refusal | a wrong but plausible result, unless a property states what right is |
| Coverage gate | code no test runs: lines, branches, functions and statements, held at a floor for the whole of `src/`, and on their own for the transforms and the HL7 v2, X12 and NCPDP adapters | a test that runs code without checking what it returns |
| Test-selection check | a change to the test configuration that silently stops a suite from running: it compares the test files that exist with the ones the runner selects, and reds on a shortfall | a test that runs and asserts nothing |
| Mutation testing | a test that runs code but would not notice it changing | not yet run on this package; the numbers below say "not measured" until it is |
| Doc samples | a documentation sample that no longer matches the code: every TypeScript sample on these pages is compiled against the built package's types and run against it, and its `// =>` values are checked | prose that is wrong beside a sample that is right |
| Examples and the smoke test | an example program in `examples/` that no longer runs against the built package; a published subpath that fails to load in ESM or CommonJS | anything the examples and the smoke test do not call |
| PHI scan | a realistic patient identifier in a fixture or a staged file, checked against a declared allow-list of synthetic values | an identifier in a format it does not know; it detects after a write, it does not prevent one |

## How each one runs

- **Unit tests, the corpus, properties, fuzzing and doc samples** run in one Vitest suite on every
  pull request and on `main`. The property tests run a fixed number of cases each and draw a new
  seed on every run, so a run can find a case an earlier run missed; fast-check prints the seed and
  path that replay a failure.
- **The coverage gate** runs with the suite. A floor that is not met fails the pull request, and a
  floor only rises: a line no input can reach carries a comment naming why, never a lower number.
- **The test-selection check, the examples and the smoke test** run as their own CI jobs on every
  pull request, against the built package.
- **The PHI scan** runs on every commit (a pre-commit hook) and in CI.

## Run them yourself

```bash
pnpm install --frozen-lockfile
pnpm test                    # unit tests, the corpus, properties, fuzzing and doc samples
pnpm test:coverage           # the same suite with the coverage gate
pnpm exec vitest run test/corpus/leak-corpus.test.ts   # the leak and over-scrub corpus alone
pnpm check:test-selection    # every test file is one the runner selects
pnpm build && pnpm examples  # the example programs, against the built package
pnpm smoke                   # every published subpath in ESM and CommonJS (after a build)
pnpm phi-scan                # the PHI scan over the repository
```

## Current numbers

The numbers for this section are measured on `main` at each release and filled in when the release
is built. They are never typed by hand.
