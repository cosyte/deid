---
id: installation
title: Installation
sidebar_label: Installation
description: "Install @cosyte/deid and the parser packages for the formats you transform, check the Node.js versions it supports, and run a smoke test."
---

# Installation

`@cosyte/deid` is a TypeScript library for Node.js with **zero third-party runtime dependencies**
(every cryptographic primitive comes from Node's built-in `node:crypto`). It ships dual **ESM + CJS**
builds with per-condition type declarations, so it works from either module system without
configuration.

> **Status:** `0.1`, published to npm. The command below installs the current release.
> `npm view @cosyte/deid version` is the authority on which one that is.

## Prerequisites

- **Node.js 22 or later, tested on 22, 24, and 26** (the whole `@cosyte/*` suite targets ES2023).
- A package manager: `pnpm`, `npm`, or `yarn`.

## Install

```bash
npm install @cosyte/deid
```

## Install the parser for each format you transform

The root entry point is the format-agnostic core. Each format adapter is a subpath export that reads
the model of the matching Cosyte parser, which is an **optional peer dependency**: install the ones
for the formats you handle, and nothing else is pulled in.

| Format        | Import from          | Install beside it | Lowest release supported |
| ------------- | -------------------- | ----------------- | ------------------------ |
| HL7 v2        | `@cosyte/deid/hl7`   | `@cosyte/hl7`     | 0.1.8                    |
| C-CDA         | `@cosyte/deid/ccda`  | `@cosyte/ccda`    | 0.1.6                    |
| FHIR R4       | `@cosyte/deid/fhir`  | `@cosyte/fhir`    | 0.1.8                    |
| X12 EDI       | `@cosyte/deid/x12`   | `@cosyte/x12`     | 0.1.10                   |
| NCPDP Telecom | `@cosyte/deid/ncpdp` | `@cosyte/ncpdp`   | 0.1.6                    |
| DICOM         | `@cosyte/deid/dicom` | `@cosyte/dicom`   | 0.1.11                   |

Each peer range starts at the lowest release our CI installs and passes the whole test suite on, and
admits every later 0.1 release. If npm reports a peer conflict, update the parser within its 0.1
line, for example `npm install @cosyte/hl7@^0.1.8`.

```bash
npm install @cosyte/deid @cosyte/hl7
```

## Smoke test

Confirm the package resolves and its output label is the honest one:

```ts runnable
import { OUTPUT_LABEL } from "@cosyte/deid";

OUTPUT_LABEL; // => "Safe-Harbor-transformed per the configured policy"
```

Head to the [Quickstart](./quickstart.md) to de-identify a model.
