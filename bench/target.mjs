// The module the benchmarks are handed: every built entry of this checkout, beside the parsers a
// consumer reads its input with. @cosyte/bench hands a suite one module, and this package's
// adapters are subpaths, so this file gathers them; it resolves `../dist/` against itself, so the
// base checkout's copy measures the base build and the head's measures the head build.
//
// Build first (`pnpm build`); this file is not published.

export * as deid from "../dist/index.mjs";
export * as deidHl7 from "../dist/hl7/index.mjs";
export * as deidFhir from "../dist/fhir/index.mjs";
export * as deidCcda from "../dist/ccda/index.mjs";
export * as deidX12 from "../dist/x12/index.mjs";
export * as deidDicom from "../dist/dicom/index.mjs";

export * as hl7 from "@cosyte/hl7";
export * as fhir from "@cosyte/fhir";
export * as ccda from "@cosyte/ccda";
export * as x12 from "@cosyte/x12";
export * as dicom from "@cosyte/dicom";
