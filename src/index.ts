/**
 * Public entry point for `@cosyte/deid` — a healthcare **de-identification** engine.
 *
 * `@cosyte/deid` is **not** a parser. It is a consumer-tier library: it applies a HIPAA-grounded
 * de-identification **policy** (Safe Harbor by default) to a structurally-located model of a healthcare
 * document and returns a transformed model plus a **value-free manifest** of what it acted on. It
 * borrows the parser archetype's disciplines (typed diagnostics, immutable output, a policy/profile
 * system) but **inverts the parser's reflex**: it **fails closed** — an unrecognized structure or an
 * un-locatable identifier is blocked, never passed through as safe.
 *
 * **Honesty line (governs the whole library).** Results are **"Safe-Harbor-transformed per the
 * configured policy"** — never "de-identified" and never "HIPAA-compliant". Safe Harbor is implemented
 * mechanically; the §164.514(b)(2)(ii) actual-knowledge condition is the consumer's; Expert
 * Determination (§164.514(b)(1)) is *supported* by later phases, never *rendered* or certified here.
 *
 * This phase ships the **format-agnostic core**: the policy engine, the five transforms, the 18-category
 * Safe Harbor model, the fail-closed rule, and the value-free manifest — tested against a generic locus
 * model. Per-format locus maps (HL7 v2, C-CDA, FHIR, X12, NCPDP, DICOM) arrive in later phases.
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

// ── The Safe Harbor category model (45 CFR §164.514(b)(2)(i)(A)–(R)).
export {
  SAFE_HARBOR_CATEGORIES,
  SAFE_HARBOR_CATEGORY_META,
  type SafeHarborCategory,
} from "./categories.js";

// ── Stable code registries + the fatal error type.
export {
  FATAL_CODES,
  DEID_DISPOSITION_CODES,
  DeidError,
  type FatalCode,
  type DeidDispositionCode,
} from "./codes.js";

// ── The cited restricted-ZIP list (Safe Harbor §164.514(b)(2)(i)(B)).
export { RESTRICTED_ZIP3, RESTRICTED_ZIP3_SOURCE } from "./restricted-zip.js";

// ── The context holding the consumer's key material (self-redacting; never leaks).
export { createDeidContext, DeidContext, type DeidContextSpec } from "./context.js";

// ── The corpus registry: cross-document longitudinal consistency + the key contract (DEID-7).
export { createDeidRegistry, DeidRegistry, type DeidRegistrySpec } from "./registry.js";

// ── The five transforms.
export {
  redact,
  generalizeDate,
  generalizeZip,
  generalizeAge,
  dateShift,
  pseudonymize,
  keyedHash,
  unkeyedHash,
  type GeneralizeOutcome,
} from "./transforms/index.js";

// ── The policy engine.
export {
  SAFE_HARBOR_POLICY,
  defineDeidPolicy,
  resolvePolicy,
  KEYED_TRANSFORMS,
  type DeidPolicy,
  type DeidPolicySpec,
  type TransformName,
} from "./policy.js";

// ── The generic locus model.
export {
  type LocusKind,
  type GenericLocus,
  type LocusModel,
  type TransformedLocus,
  type DeidDocument,
} from "./locus.js";

// ── The value-free manifest.
export { type DeidManifestEntry, type DeidResult } from "./manifest.js";

// ── The engine.
export { deidentify, type DeidOptions } from "./deidentify.js";

// ── The BYO free-text redaction interface (DEID-8) — the library ships the interface, never a detector.
export {
  type FreeTextRedactor,
  type FreeTextRedactionRequest,
  type FreeTextRedactionResult,
} from "./redactor.js";
