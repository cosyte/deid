/**
 * The library's output **labels** and version — factored into their own module so any internal module
 * (the report builder, the format adapters) can read them without importing the public barrel
 * (`index.ts`) and creating an import cycle.
 *
 * @packageDocumentation
 */

/**
 * The label the library applies to its output. Deliberately **not** "de-identified" / "HIPAA-compliant"
 * — the certification is always the consumer's.
 *
 * @example
 * ```ts
 * import { OUTPUT_LABEL } from "@cosyte/deid";
 *
 * OUTPUT_LABEL; // => "Safe-Harbor-transformed per the configured policy"
 * ```
 */
export const OUTPUT_LABEL = "Safe-Harbor-transformed per the configured policy";

/**
 * Library version string, synced with `package.json#version` at release time.
 *
 * @example
 * ```ts
 * import { VERSION } from "@cosyte/deid";
 *
 * typeof VERSION; // => "string"
 * ```
 */
export const VERSION = "0.0.0";
