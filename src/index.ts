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

// ── The output label + version (own module, so internal modules read them without an index cycle).
export { OUTPUT_LABEL, VERSION } from "./labels.js";

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

// ── Policy profiles: named, reusable presets + the widen-never-narrow contract (DEID-10).
export {
  SAFE_HARBOR_PROFILE,
  LIMITED_DATA_SET_PROFILE,
  defineDeidProfile,
  profileOptions,
  type DeidProfile,
  type DeidProfileSpec,
  type DeidStandard,
} from "./profile.js";

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

// ── The Expert-Determination *support* report (DEID-9) — supports a determination, never renders one.
export {
  EXPERT_DETERMINATION_DISCLAIMER,
  buildExpertDeterminationSupportReport,
  formatExpertDeterminationSupportReport,
  type ExpertDeterminationSupportReport,
  type ExpertDeterminationReportOptions,
  type CategoryCoverage,
  type DispositionSummary,
  type RetainedQuasiIdentifier,
  type QuasiIdentifierClassInput,
  type QuasiIdentifierStatistics,
  type ReportDisposition,
} from "./report.js";
