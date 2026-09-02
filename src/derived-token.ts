/**
 * **Bounding for identifiers read out of a document before they enter a manifest locus.**
 *
 * Five of the six per-format adapters build a `locus` by interpolating an identifier they read from the
 * input: an HL7 v2 segment id, a CDA element local name **and attribute name**, a FHIR element name and
 * `resourceType`, an X12 segment id and `ST-01`, an NCPDP segment code and field id. Those all *claim*
 * to be identifiers, but nothing
 * upstream is obliged to make them so: when a parser cannot recognize the structure at that position it
 * hands back whatever bytes stood there, and on an unrecognized narrative line that is clinical prose.
 * Interpolating it unbounded writes document content into the value-free manifest, and from there into
 * the Expert-Determination support report.
 *
 * **The DICOM adapter is deliberately absent from that list**, and the reason is worth stating so it is
 * not "fixed" later. Its locus is built from `@cosyte/dicom`'s de-identification report, not from bytes
 * it reads: the tag is normalised to eight uppercase hex digits by the parser, the keyword is a string
 * from a static table, and a sequence-context entry is a structurally-composed `TAG[index]`. None of the
 * three is document-derived, so a shape test there buys nothing and costs real accuracy. A first version
 * of this module applied one anyway, against an invented contract, and it refused every sequence-context
 * entry and two genuine attribute names on spec-clean input.
 *
 * **This bound is deliberately local to `@cosyte/deid`.** A parser that bounds its own diagnostics
 * protects its own diagnostics; it does not protect a consumer that reads its model and builds a
 * different diagnostic from it. This package is the de-identification layer, so it holds the bound for
 * every upstream it consumes, whether or not that upstream also holds one.
 *
 * ## Why a shape test rather than a length cap
 *
 * Truncating to N characters still emits the first N characters of whatever was there. A shape test
 * refuses the token outright, and it can afford to because each of these identifiers has a narrow,
 * spec-defined form (cited per entry below). A conforming token is returned **unchanged**, so
 * well-formed input sees no behaviour change at all.
 *
 * ## Why the refusal is visible
 *
 * A refused token renders as {@link WITHHELD_LOCUS_TOKEN}, never as an empty string and never as a
 * silent truncation. A de-identification manifest whose job is to say *what was acted on and where*
 * must not quietly drop the "where": a reader has to be able to tell "this locus sat at a position
 * whose identifier could not be trusted" apart from "this locus sat at the document root".
 *
 * ## Where a shape test bottoms out, stated rather than papered over
 *
 * A forged token that happens to match the shape is still returned, and the residue is only ever as
 * narrow as the shape actually written below, not as narrow as this paragraph would like it to be.
 * Four of the six are genuinely tiny: `hl7SegmentId`, `x12SegmentId`, `x12TransactionSetId` and
 * `ncpdpCode` admit at most three characters with no separator and no whitespace, so the worst case
 * there is a narrative line whose entire content is `JQD`, which is indistinguishable from a segment
 * identifier. The residue of `xmlName` is the widest of the six for a second reason as well: it is
 * applied at **two** kinds of position, an element's local name and an attribute's name, and an
 * attribute name is the one a schema constrains least. The other two, `xmlName` and `fhirElementName`,
 * are materially larger:
 * they admit up to 64 and 65 characters respectively, and `xmlName` additionally admits `.`, `-` and
 * `_`, so a single unspaced 64-character token is echoed. No whitespace passes either of them, which is
 * what keeps prose out, but "no whitespace" is not "no content" and this package therefore makes no
 * absolute "a locus never carries document content" claim anywhere.
 *
 * @packageDocumentation
 */

/**
 * What a manifest locus prints in place of an identifier it may not echo, i.e. an identifier the adapter
 * read out of the document that does not match the shape its position promises.
 *
 * Deliberately carries **no length and no prefix of the refused token**: the length of a refused
 * identifier is itself derived from the content that was refused.
 *
 * @example
 * ```ts
 * import { WITHHELD_LOCUS_TOKEN } from "@cosyte/deid";
 *
 * // A manifest entry whose position could not be trusted reads, e.g., "<withheld>-1".
 * WITHHELD_LOCUS_TOKEN; // => "<withheld>"
 * ```
 */
export const WITHHELD_LOCUS_TOKEN = "<withheld>";

/**
 * The spec-defined shape each class of document-derived identifier is required to match.
 *
 * @internal
 */
const DERIVED_TOKEN_SHAPES = {
  /**
   * HL7 v2 Ch. 2 §2.5 segment identifier: three characters, the first alphabetic. Every segment name
   * in the standard is exactly three, and a custom Z-segment is `Z` plus two alphanumerics, so nothing
   * legitimate is longer. Requiring a leading letter additionally excludes a bare numeric residue,
   * which matters out of proportion to its size: a forged line reading `120` is a dose or a result.
   */
  hl7SegmentId: /^[A-Za-z][A-Za-z0-9]{2}$/,
  /**
   * X12 (ASC X12.6) segment identifier: two or three alphanumeric characters beginning with a letter
   * (`NM1`, `N3`, `DTP`, `CLP`, `K3`).
   */
  x12SegmentId: /^[A-Za-z][A-Za-z0-9]{1,2}$/,
  /**
   * X12 `ST-01` Transaction Set Identifier Code (data element 143): exactly three characters
   * (`837`, `835`, `270`).
   */
  x12TransactionSetId: /^[A-Za-z0-9]{3}$/,
  /**
   * An XML element local name **or attribute name** in an HL7 v3 / CDA document. No colon: an element's
   * prefix is already stripped by the time a local name is read, and a **prefixed attribute name is
   * therefore refused and reads withheld**, which is the accepted cost of one shape covering both
   * positions. The XML `Name` production is itself unbounded, so the shape carries an explicit
   * 64-character ceiling as well; the longest element name in the CDA R2 schema is well inside that, and
   * 64 leaves room for a vendor or `sdtc` extension element or attribute.
   *
   * Deliberately **narrower than XML NCName**, which also admits non-ASCII name characters. Widening it
   * to the real production would be worse than the gap it closes: a narrative line in a script that does
   * not separate words with spaces is a single legal NCName, so a Unicode-aware class would admit whole
   * sentences. The cost is that a non-ASCII element name is refused and its locus reads withheld, which
   * degrades the audit label for that locus and changes nothing about what is de-identified.
   */
  xmlName: /^[A-Za-z_][A-Za-z0-9_.-]{0,63}$/,
  /**
   * A FHIR element name or resource type. FHIR restricts both to `[A-Za-z][A-Za-z0-9]{0,63}`; the
   * optional leading underscore is the JSON representation's primitive-extension form (`_birthDate`).
   */
  fhirElementName: /^_?[A-Za-z][A-Za-z0-9]{0,63}$/,
  /**
   * An NCPDP Telecom Segment Identification (111-AM) code or field identifier: exactly two
   * alphanumeric characters (`01`, `AM`, `C4`, `D2`).
   */
  ncpdpCode: /^[A-Za-z0-9]{2}$/,
} as const;

/**
 * Which spec-defined shape a document-derived identifier is required to match.
 *
 * @internal
 */
export type DerivedTokenKind = keyof typeof DERIVED_TOKEN_SHAPES;

/**
 * Render an identifier read out of a document, for inclusion in a manifest locus.
 *
 * Returns the token unchanged when it matches the shape its `kind` promises, and
 * {@link WITHHELD_LOCUS_TOKEN} otherwise, including for the empty string, which at an identifier
 * position is an absence the position does not allow rather than a legitimate value.
 *
 * @internal
 */
export function safeLocusToken(value: string, kind: DerivedTokenKind): string {
  return DERIVED_TOKEN_SHAPES[kind].test(value) ? value : WITHHELD_LOCUS_TOKEN;
}

/**
 * `true` when a rendered locus token was refused. The callers use it to decide whether a positional
 * index has to be appended so two refused identifiers at different positions stay distinct.
 *
 * @internal
 */
export function isWithheldToken(token: string): boolean {
  return token === WITHHELD_LOCUS_TOKEN;
}
