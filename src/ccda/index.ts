/**
 * `@cosyte/deid/ccda` — the **C-CDA de-identification adapter**. The C-CDA binding of the
 * format-agnostic core (roadmap §Phase 3): it locates PHI **structurally** in an HL7 CDA R2.1 document,
 * applies the configured de-identification policy, and returns a transformed `CcdaDocument` plus the
 * core's value-free manifest.
 *
 * **`@cosyte/ccda` is an optional peer dependency**, consumed only from this subpath — a consumer who
 * only de-identifies C-CDA installs it alongside `@cosyte/deid`; the core stays third-party-dep-free.
 * The adapter reaches the CDA DOM **only** through `@cosyte/ccda`'s exported, XXE-hardened
 * `parseSecureXml` and re-serializes through the DOM node the parser hands back — it never imports the
 * XML substrate (`@xmldom/xmldom`, the parser's own ratified dependency — ccda ADR 0001) directly, so
 * `@cosyte/deid` declares no third-party runtime dependency of its own.
 *
 * **What it covers.** The structured PHI loci of the CDA **header participations** — `recordTarget`
 * (patient) + the nested `guardian`, and `author` / `informant` / `authenticator` /
 * `legalAuthenticator` / `dataEnterer` / `participant` / `custodian` / `documentationOf` /
 * `componentOf` (relatives / providers / contacts — §4.6) — via the cited {@link CCDA_LOCUS_MAP}:
 * person `<name>` and `<telecom>` removed; person-role `<id>` pseudonymized (assigning root retained,
 * SSN-rooted ids redacted); `<addr>` reduced to the safe 3-digit ZIP; `<birthTime>` / participation and
 * encounter dates generalized to year. **Fail closed** everywhere else: section narrative `<text>`
 * blocks and the unstructured `nonXMLBody` are blocked (no naive scrub); an element carrying a value
 * that is neither mapped PHI nor recognized coded/administrative structure is blocked; foreign / `sdtc`
 * elements are blocked. Coded clinical structure — the **structuredBody** entries' codes, values,
 * units, and statuses — is **retained untouched** (the over-scrub guard); a `<name>` there is a drug or
 * material name, never a person, and survives. The honesty line is unchanged: the output is
 * **"Safe-Harbor-transformed per the configured policy"**, never "de-identified".
 *
 * **Known limitations (this phase).** Narrative is block-only (no semantic narrative de-id — Phase 8).
 * Within the **retained** clinical body, entry-level service dates (`effectiveTime`), entry ids,
 * in-entry performer names, and family-history relative demographics are a deferred later phase —
 * exactly mirroring HL7 v2 Phase 2's retained-clinical-segment boundary; forgetting one fails **safe**
 * (retained), never leaked, because the leak surface for this phase is the header + narrative. The
 * document `id` / `title` / `code` envelope is retained (like HL7's MSH); the address generalization
 * keeps state + country (permitted) and the safe 3-digit ZIP, dropping every finer component.
 *
 * @packageDocumentation
 */

import { parseCcda, parseSecureXml, resolveLimits, type CcdaDocument } from "@cosyte/ccda";

import { deidentify, type DeidOptions } from "../deidentify.js";
import { DeidError, FATAL_CODES } from "../codes.js";
import { type DeidManifestEntry } from "../manifest.js";
import { applyCcda } from "./apply.js";
import { extractCcdaLoci } from "./extract.js";

/** The conservative XML declaration prepended when the serialized root carries none. @internal */
const XML_DECLARATION = '<?xml version="1.0" encoding="UTF-8"?>';

/**
 * The result of de-identifying a C-CDA document: the transformed document plus the core's value-free
 * manifest of every category acted on and every locus blocked.
 *
 * @example
 * ```ts
 * import { parseCcda } from "@cosyte/ccda";
 * import { deidentifyCcda } from "@cosyte/deid/ccda";
 *
 * const result: CcdaDeidResult = deidentifyCcda(parseCcda(xml), {});
 * result.document.toString(); // de-identified C-CDA XML
 * ```
 */
export interface CcdaDeidResult {
  /** The de-identified document — a fresh, independent {@link CcdaDocument}; the input is never mutated. */
  readonly document: CcdaDocument;
  /** The value-free audit of every action, in locus order (never a value, never a key). */
  readonly manifest: readonly DeidManifestEntry[];
}

/**
 * De-identify a parsed C-CDA document under a policy (Safe Harbor by default). PHI is located
 * structurally from the CDA header participations and the section narrative; the input document is
 * never mutated (the adapter re-parses its serialized form into a fresh, independent DOM to edit).
 *
 * The output is **"Safe-Harbor-transformed per the configured policy"** — it is not certified
 * de-identified, and Expert Determination is not rendered.
 *
 * @param doc - The parsed C-CDA document to de-identify (produced by `@cosyte/ccda`'s `parseCcda`).
 * @param options - The policy and (for keyed transforms — id pseudonymization) the key context. A keyed
 *   transform with no context is a fatal `DEID_NO_KEY`, never an unkeyed fallback.
 * @returns The de-identified document and the value-free manifest.
 * @throws {@link DeidError} `EMPTY_INPUT` when the document carries no serializable `ClinicalDocument`
 *   root; `DEID_NO_KEY` when a keyed transform is required but no key context was supplied.
 * @example
 * ```ts
 * import { parseCcda } from "@cosyte/ccda";
 * import { deidentifyCcda } from "@cosyte/deid/ccda";
 * import { createDeidContext } from "@cosyte/deid";
 *
 * const context = createDeidContext({ key: process.env.DEID_KEY! });
 * const { document, manifest } = deidentifyCcda(parseCcda(xml), { context });
 * // document.getPatient()?.name === undefined  (name removed)
 * // manifest records each category + locus, never a value.
 * ```
 */
export function deidentifyCcda(doc: CcdaDocument, options: DeidOptions = {}): CcdaDeidResult {
  // The parser retains the source XML; re-parsing it yields a fresh DOM independent of the caller's
  // model, so nothing the caller holds is ever mutated. `toString()` throws only for a hand-constructed
  // document (never one from parseCcda) — a documented, acceptable precondition.
  const source = doc.toString();
  const dom = parseSecureXml(source, resolveLimits(undefined), () => {
    /* de-id re-parses spec-clean source; parse warnings are not part of the de-id contract */
  });
  const root = dom.documentElement;
  if (root === null) {
    throw new DeidError(
      FATAL_CODES.EMPTY_INPUT,
      "de-identify requires a document with a ClinicalDocument root",
    );
  }

  const { loci, coords } = extractCcdaLoci(root);
  const { document, manifest } = deidentify({ loci }, options);
  applyCcda(document.loci, coords);

  // `@xmldom/xmldom` nodes serialize through `toString()` (verified round-trip); the interface makes
  // that override explicit so the serialize is not read as a base Object stringification.
  const serializable: { toString(): string } = root;
  const serialized = serializable.toString();
  const xml = serialized.startsWith("<?xml") ? serialized : `${XML_DECLARATION}\n${serialized}`;
  return { document: parseCcda(xml), manifest };
}

export {
  CCDA_LOCUS_MAP,
  CCDA_ENVELOPE_ELEMENTS,
  CCDA_CODED_ELEMENTS,
  isRetainedCcdaElement,
  categoryForIdRoot,
  type CcdaElementMode,
} from "./locus-map.js";
export {
  extractCcdaLoci,
  type CcdaCoord,
  type CcdaExtraction,
  type CcdaEditKind,
} from "./extract.js";
export { applyCcda } from "./apply.js";
export { SAFE_HARBOR_CATEGORIES, type SafeHarborCategory } from "../categories.js";
