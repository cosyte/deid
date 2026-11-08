---
id: installation
title: Installation
sidebar_position: 1
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

## Smoke test

Confirm the package resolves and its output label is the honest one:

```ts
import { OUTPUT_LABEL } from "@cosyte/deid";

console.log(OUTPUT_LABEL); // "Safe-Harbor-transformed per the configured policy"
```

Head to the [Quickstart](./quickstart) to de-identify a model.
