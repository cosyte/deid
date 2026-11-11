// Types for bench/shapes.mjs, so the scaling gate under test/perf builds its inputs from the same
// code the benchmarks do.

import type { Buffer } from "node:buffer";

import type { GenericLocus } from "../src/locus.js";

/** 1024. */
export declare const KIB: number;
/** 1024 * 1024. */
export declare const MIB: number;
/** One synthetic ORU^R01 with every identifying segment filled, the same length at every index. */
export declare function hl7Message(i: number): string;
/** `messages` synthetic ORU^R01 messages in one FHS/BHS batch file. */
export declare function hl7Batch(i: number, messages: number): string;
/** One synthetic Patient resource as FHIR JSON. */
export declare function fhirPatient(i: number): string;
/** A collection Bundle of one Patient and `entries` resources about them, as FHIR JSON. */
export declare function fhirBundle(i: number, entries: number): string;
/** A CCD with a full header and a Results section of `results` observations. */
export declare function ccdaDocument(i: number, results: number): string;
/** One 837P interchange with a billing provider and `claims` claim loops. */
export declare function x12Claims(i: number, claims: number): string;
/** One CT slice of `side` by `side` (512 by default, about 514 KiB) by 16-bit native Pixel Data. */
export declare function ctImage(i: number, side?: number): Buffer;
/** An Enhanced CT object of `frames` frames of `side` by `side` (512 by default) by 16 bits. */
export declare function enhancedCt(i: number, frames: number, side?: number): Buffer;
/** A format-agnostic locus model of `loci` loci across the categories the engine acts on. */
export declare function locusModel(i: number, loci: number): { loci: GenericLocus[] };
