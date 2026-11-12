/**
 * The FHIR elements that **embed content the adapter does not read**: bytes or a link to bytes that
 * can hold a whole document (a scanned form, a PDF, a C-CDA, an image), which no locus rule here can
 * look inside. Each is named by the R4 type and element it sits at, read from the generated element
 * table, so it is found at every depth and in every choice element R4 defines.
 *
 * By default each one is removed with a manifest row that carries no value. A caller who knows the
 * content is safe names the kinds to keep ({@link FHIR_EMBEDDED_CONTENT_KINDS}), and each kept one is
 * recorded in the manifest as `DEID_EMBEDDED_CONTENT_RETAINED`.
 *
 * @packageDocumentation
 */

/**
 * A kind of FHIR element that embeds content the adapter does not read:
 *
 * - `attachment-data`: an `Attachment.data`, wherever an `Attachment` sits (`DocumentReference`,
 *   `Media`, `DiagnosticReport.presentedForm`, `Communication.payload`, a `QuestionnaireResponse`
 *   answer, a `Parameters` value, and every other place R4 types one);
 * - `attachment-url`: an `Attachment.url`, which points at the attachment's content (a server url, a
 *   relative reference to a `Binary`, or a `data:` url that carries the content itself);
 * - `binary-data`: a `Binary.data`;
 * - `signature-data`: a `Signature.data`, the signature itself, which can enclose the signed content;
 * - `base64-binary`: every other element R4 types as `base64Binary` (an `Attachment.hash`,
 *   `Device.udiCarrier.carrierAIDC`, `AuditEvent.entity.query`, a `valueBase64Binary` outside an
 *   extension).
 *
 * An extension's value is not among them: every extension value is blocked whatever its type, and no
 * kind here keeps one.
 *
 * @example
 * ```ts
 * import { type FhirEmbeddedContentKind } from "@cosyte/deid/fhir";
 *
 * const kind: FhirEmbeddedContentKind = "attachment-data";
 * ```
 */
export type FhirEmbeddedContentKind =
  "attachment-data" | "attachment-url" | "binary-data" | "signature-data" | "base64-binary";

/**
 * Every {@link FhirEmbeddedContentKind}, in a fixed order: the values `keepEmbeddedContent` accepts.
 *
 * @example
 * ```ts
 * import { FHIR_EMBEDDED_CONTENT_KINDS } from "@cosyte/deid/fhir";
 *
 * FHIR_EMBEDDED_CONTENT_KINDS.includes("binary-data"); // => true
 * ```
 */
export const FHIR_EMBEDDED_CONTENT_KINDS: readonly FhirEmbeddedContentKind[] = Object.freeze([
  "attachment-data",
  "attachment-url",
  "binary-data",
  "signature-data",
  "base64-binary",
]);

/** The three `base64Binary` elements that carry content under a kind of their own, by R4 path. */
const NAMED_DATA: ReadonlyMap<string, FhirEmbeddedContentKind> = new Map<
  string,
  FhirEmbeddedContentKind
>([
  ["Attachment.data", "attachment-data"],
  ["Binary.data", "binary-data"],
  ["Signature.data", "signature-data"],
]);

/**
 * The kind of embedded content an element holds, from the structure it belongs to, its name and the
 * type R4 gives it, or `undefined` for an element that embeds nothing.
 *
 * @param structure - The R4 structure the element belongs to (`Attachment`, `Binary`, a backbone path).
 * @param name - The element name (`data`, `url`, `valueBase64Binary`).
 * @param type - What R4 types the element as (`base64Binary`, `url`, a structure name, `null`).
 * @internal
 */
export function embeddedContentKind(
  structure: string | null,
  name: string,
  type: string | null,
): FhirEmbeddedContentKind | undefined {
  const element = `${String(structure)}.${name}`;
  if (type === "base64Binary") return NAMED_DATA.get(element) ?? "base64-binary";
  return element === "Attachment.url" ? "attachment-url" : undefined;
}
