---
"@cosyte/deid": patch
---

The FHIR adapter now removes embedded content it does not read, such as an attachment holding a scanned form, by default, and keeps a kind of it only when the caller names that kind.

- **What changed in the default output, on purpose.** Under Safe Harbor, the Limited Data Set and every other profile, these elements are now removed, each with a `DEID_LOCUS_BLOCKED` row (category (R)) at its locus that carries no value, at every depth, in choice elements, contained resources and `Bundle` entries. Before, a value that fit its format was kept verbatim and unread, with no manifest row, counted only in `unexaminedResiduals`:
  - every `Attachment.data`, wherever R4 types an `Attachment` (`DocumentReference.content`, `Media.content`, `DiagnosticReport.presentedForm`, `Communication.payload`, a `QuestionnaireResponse` answer, a `Parameters` value);
  - every `Attachment.url`: a link to the attachment's content, or a `data:` url that carries it;
  - `Binary.data` and `Signature.data`;
  - every other element R4 types as `base64Binary` outside an extension: `Attachment.hash`, `Device.udiCarrier.carrierAIDC`, `AuditEvent.entity.query`, `AuditEvent.entity.detail.valueBase64Binary`, and a `valueBase64Binary` in a `Parameters` value, a `Task` input or output, or an `ElementDefinition`.
- **What stays the same.** The rest of an `Attachment` (`contentType`, `language`, `title`, `size`, `creation`) is kept as before. An extension's value, a `valueBase64Binary` or a `valueAttachment` among them, was already blocked and still is, and the narrative `div` was already blocked and still is. A `Patient.photo` is removed whole, as before. A `base64Binary` that does not fit its format is blocked, as before.
- **The opt-in.** `FhirDeidOptions` and `FhirExtractOptions` gain `keepEmbeddedContent`, a list of kinds from the new `FHIR_EMBEDDED_CONTENT_KINDS` (`attachment-data`, `attachment-url`, `binary-data`, `signature-data`, `base64-binary`), with the type `FhirEmbeddedContentKind`. An element of a named kind is kept verbatim and unread, still held to its R4 format, and recorded at its locus with the new disposition code `DEID_EMBEDDED_CONTENT_RETAINED` (disposition `retained`, transform `retain`, category (R)), so every keep shows in the manifest. No kind keeps an extension's value or the narrative. A value in the list that is not a kind keeps nothing.
- **Core.** `GenericLocus` gains `embeddedContentKept`, the marker an adapter sets on that record. A marked locus must carry an empty value; one that carries a value is blocked rather than kept.
- **What a caller changes.** A caller who relied on attachment content or an `Attachment.url` surviving the pass adds `keepEmbeddedContent` with the kinds it needs, having checked that what they hold identifies no one. A caller that branches on every disposition code adds `DEID_EMBEDDED_CONTENT_RETAINED`.
