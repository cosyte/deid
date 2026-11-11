// Types for bench/target.mjs, so the scaling gate under test/perf times the built entries through
// the same module the benchmarks are handed. Only what the gate calls is declared, by hand: the
// built declarations exist only after a build, and the typecheck runs before one.

import type { Buffer } from "node:buffer";

import type { CcdaDocument } from "@cosyte/ccda";
import type { Hl7Message } from "@cosyte/hl7";
import type { X12Interchange } from "@cosyte/x12";

import type { GenericLocus } from "../src/locus.js";

/** What every pass returns beside its output: the manifest, one row per action. */
interface Manifested {
  readonly manifest: readonly unknown[];
}

export declare const deid: {
  readonly deidentify: (model: { readonly loci: readonly GenericLocus[] }, options: object) => Manifested;
};
export declare const deidHl7: {
  readonly deidentifyHl7: (msg: Hl7Message) => Manifested & { readonly document: Hl7Message };
};
export declare const deidFhir: {
  readonly deidentifyFhirJson: (json: string) => Manifested & { readonly json: string };
};
export declare const deidCcda: {
  readonly deidentifyCcda: (doc: CcdaDocument) => Manifested & { readonly document: CcdaDocument };
};
export declare const deidX12: {
  readonly deidentifyX12String: (raw: string) => Manifested & { readonly x12: string };
  readonly deidentifyX12: (interchange: X12Interchange) => Manifested & { readonly x12: string };
};
export declare const deidDicom: {
  readonly deidentifyDicomBuffer: (bytes: Buffer) => Manifested & { readonly bytes: Buffer };
};

export * as hl7 from "@cosyte/hl7";
export * as fhir from "@cosyte/fhir";
export * as ccda from "@cosyte/ccda";
export * as x12 from "@cosyte/x12";
export * as dicom from "@cosyte/dicom";
