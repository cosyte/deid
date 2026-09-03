/**
 * Compose the **De-identification Method Code Sequence `(0012,0064)`** for a run's applied CID 7050
 * terms, attach it to the de-identified dataset, and verify that this run's own serialized output reads
 * it back unchanged.
 *
 * **The delegated Annex E pass does not write this attribute.** It writes Patient Identity Removed
 * `(0012,0062)` and De-identification Method `(0012,0063)` and its options carry nothing for the coded
 * sequence, so composing and attaching `(0012,0064)` is this adapter's own work, done over the pass's
 * output through the peer's public dataset surface. Nothing the pass removed, kept or remapped is
 * touched: the two attributes it writes are left exactly as it produced them, byte for byte, and the
 * coded terms are added beside them.
 *
 * **The byte convention is the peer's, not an invention here.** Its Part 10 writer encodes a scalar and
 * an Implicit-VR-LE defined-length sequence from value-only bytes, and passes an Explicit-VR sequence
 * through as its **full on-wire span**, header included. A hand-built element that ignores that
 * convention serializes into something that does not read back, which is precisely the failure the
 * verification below exists to catch rather than ship.
 *
 * **The verification is not decoration.** Output stamped `(0012,0062) YES` carrying a coded claim an
 * archive will act on is worth less than no output at all if the claim cannot be read back, so the run
 * re-parses what it serialized, compares the terms read out of `(0012,0064)` against the terms it
 * declared, and fails the pass on any mismatch.
 *
 * @packageDocumentation
 */

import { Buffer } from "node:buffer";

import { Dataset, Element, Item, parseDicom, readCode, serializeDicom } from "@cosyte/dicom";

import { DeidError, FATAL_CODES } from "../codes.js";

import type { DicomCodedTerm } from "./method-codes.js";

/** De-identification Method Code Sequence. Not in Table E.1-1, so no Annex E rule acts on it. */
export const TAG_DEIDENTIFICATION_METHOD_CODE_SEQUENCE = "00120064";

/**
 * Raised when the **input** carried a De-identification Method Code Sequence and this pass replaced it
 * with its own. The prior sequence's items are dropped rather than merged: they are unaudited bytes from
 * an untrusted file, and `(0012,0064)` is not in Table E.1-1, so no Annex E rule ever inspected what was
 * inside them. Keeping any of it would put unexamined input text inside output stamped Patient Identity
 * Removed YES.
 *
 * The loss is disclosed rather than made silently, and the disclosure is **value-free**: the message is
 * a constant, so it can carry no Code Value, no Code Meaning and no other text read from the input.
 *
 * @example
 * ```ts
 * import { deidentifyDicom, INPUT_METHOD_CODE_SEQUENCE_DROPPED_CODE } from "@cosyte/deid/dicom";
 *
 * const { warnings } = deidentifyDicom(dataset);
 * warnings.some((w) => w.code === INPUT_METHOD_CODE_SEQUENCE_DROPPED_CODE);
 * ```
 */
export const INPUT_METHOD_CODE_SEQUENCE_DROPPED_CODE =
  "DICOM_INPUT_DEIDENTIFICATION_METHOD_CODES_DROPPED";

/**
 * The warning raised for a dropped input sequence. A **constant**, deliberately: an interpolated count
 * or locus would be a fact read off the input, and the rule for this warning is that it carries none.
 *
 * @internal
 */
export const INPUT_METHOD_CODE_SEQUENCE_DROPPED_WARNING = Object.freeze({
  code: INPUT_METHOD_CODE_SEQUENCE_DROPPED_CODE,
  message:
    "the input carried a De-identification Method Code Sequence; every item of it was dropped and " +
    "replaced by the coded terms this pass applied, because no de-identification rule inspects that " +
    "sequence's contents",
});

/** Code Value `(0008,0100)`, VR `SH`. */
const TAG_CODE_VALUE = "00080100";
/** Coding Scheme Designator `(0008,0102)`, VR `SH`. */
const TAG_CODING_SCHEME_DESIGNATOR = "00080102";
/** Code Meaning `(0008,0104)`, VR `LO`. */
const TAG_CODE_MEANING = "00080104";

/** The Part 10 body encoding a transfer syntax selects, mirroring the peer's own dispatch. */
type BodyEncoding = "implicit" | "explicitLE" | "explicitBE";

/**
 * Transfer Syntax UID to body encoding. The Deflated syntax encodes its body as Explicit VR LE before
 * the whole body is deflated, so it shares that branch.
 */
const BODY_ENCODING: Readonly<Record<string, BodyEncoding>> = Object.freeze({
  "1.2.840.10008.1.2": "implicit",
  "1.2.840.10008.1.2.1": "explicitLE",
  "1.2.840.10008.1.2.2": "explicitBE",
  "1.2.840.10008.1.2.1.99": "explicitLE",
});

const ITEM_TAG_GROUP = 0xfffe;
const ITEM_TAG_ELEMENT = 0xe000;
const SEQUENCE_DELIMITER_ELEMENT = 0xe0dd;
const UNDEFINED_LENGTH = 0xffffffff;

/** Resolve the body encoding of a dataset, defaulting exactly as the delegated pass defaults. */
function bodyEncoding(dataset: Dataset): BodyEncoding {
  return BODY_ENCODING[dataset.fileMeta?.transferSyntaxUID ?? ""] ?? "explicitLE";
}

/** `SH` and `LO` are space-padded to even length (PS3.5 §6.2); neither is a NUL-padded VR. */
function padEven(value: Buffer): Buffer {
  return value.length % 2 === 0 ? value : Buffer.concat([value, Buffer.from([0x20])]);
}

function uint16(n: number, littleEndian: boolean): Buffer {
  const buf = Buffer.alloc(2);
  if (littleEndian) buf.writeUInt16LE(n, 0);
  else buf.writeUInt16BE(n, 0);
  return buf;
}

function uint32(n: number, littleEndian: boolean): Buffer {
  const buf = Buffer.alloc(4);
  if (littleEndian) buf.writeUInt32LE(n, 0);
  else buf.writeUInt32BE(n, 0);
  return buf;
}

function splitTag(tag: string): { group: number; element: number } {
  return { group: parseInt(tag.slice(0, 4), 16), element: parseInt(tag.slice(4, 8), 16) };
}

/** One scalar element of a code item, as an in-memory `Element` carrying value-only bytes. */
function codeScalar(tag: string, vr: "SH" | "LO", text: string, littleEndian: boolean): Element {
  const rawBytes = padEven(Buffer.from(text, "latin1"));
  return new Element({
    tag,
    vr,
    vm: 1,
    length: rawBytes.length,
    rawBytes,
    byteOffset: 0,
    littleEndian,
  });
}

/**
 * Encode one scalar element of a code item on the wire, in the dataset's own encoding. `SH` and `LO`
 * both take the short-form Explicit header, and neither is byte-swapped under Explicit VR BE: their
 * values are text.
 */
function encodeScalar(element: Element, encoding: BodyEncoding): Buffer {
  const { group, element: elementCode } = splitTag(element.tag);
  const value = element.rawBytes;
  if (encoding === "implicit") {
    return Buffer.concat([
      uint16(group, true),
      uint16(elementCode, true),
      uint32(value.length, true),
      value,
    ]);
  }
  const littleEndian = encoding === "explicitLE";
  return Buffer.concat([
    uint16(group, littleEndian),
    uint16(elementCode, littleEndian),
    Buffer.from(element.vr, "ascii"),
    uint16(value.length, littleEndian),
    value,
  ]);
}

/** Build one `(FFFE,E000)` item holding a coded triplet, plus its on-wire bytes. */
function codeItem(
  term: DicomCodedTerm,
  index: number,
  encoding: BodyEncoding,
): { readonly item: Item; readonly bytes: Buffer } {
  const littleEndian = encoding !== "explicitBE";
  const scalars = [
    codeScalar(TAG_CODE_VALUE, "SH", term.codeValue, littleEndian),
    codeScalar(TAG_CODING_SCHEME_DESIGNATOR, "SH", term.codingSchemeDesignator, littleEndian),
    codeScalar(TAG_CODE_MEANING, "LO", term.codeMeaning, littleEndian),
  ];
  const body = Buffer.concat(scalars.map((scalar) => encodeScalar(scalar, encoding)));
  const header = Buffer.concat([
    uint16(ITEM_TAG_GROUP, littleEndian),
    uint16(ITEM_TAG_ELEMENT, littleEndian),
    uint32(body.length, littleEndian),
  ]);
  return {
    item: new Item({
      index,
      warnings: [],
      elements: new Map(scalars.map((scalar) => [scalar.tag, scalar])),
    }),
    bytes: Buffer.concat([header, body]),
  };
}

/**
 * Build the `(0012,0064)` element for a run's applied terms, in the sequence form the peer's own reader
 * reads back under this dataset's encoding.
 *
 * **Two forms, because one of them does not survive the round trip.** Under either Explicit VR encoding
 * the sequence is written in the **defined-length** form, which is what the peer emits when it rebuilds
 * any other sequence, and its `rawBytes` are the **full on-wire span**, header included, because its
 * writer passes an Explicit-VR sequence through verbatim. Under **Implicit VR LE** the sequence is
 * written in the **undefined-length** form with a `(FFFE,E0DD)` delimiter. That is not a stylistic
 * choice: measured against this peer, an Implicit-VR-LE *defined-length* sequence parses back carrying
 * no items at all, on its own reader, so a declaration written that way would be unreadable to the very
 * archive it is written for. An undefined-length element is passed through verbatim by the writer under
 * every encoding, so that branch supplies the full span too.
 *
 * The round-trip verification is what turns that from an assumption into a fact, and it is the reason
 * the difference was found rather than shipped.
 *
 * @internal
 */
export function buildMethodCodeSequenceElement(
  terms: readonly DicomCodedTerm[],
  encoding: BodyEncoding,
): Element {
  const littleEndian = encoding !== "explicitBE";
  const built = terms.map((term, index) => codeItem(term, index, encoding));
  const value = Buffer.concat(built.map((entry) => entry.bytes));
  const { group, element } = splitTag(TAG_DEIDENTIFICATION_METHOD_CODE_SEQUENCE);

  if (encoding === "implicit") {
    const rawBytes = Buffer.concat([
      uint16(group, true),
      uint16(element, true),
      uint32(UNDEFINED_LENGTH, true),
      value,
      uint16(ITEM_TAG_GROUP, true),
      uint16(SEQUENCE_DELIMITER_ELEMENT, true),
      uint32(0, true),
    ]);
    return new Element({
      tag: TAG_DEIDENTIFICATION_METHOD_CODE_SEQUENCE,
      vr: "SQ",
      vm: built.length,
      length: UNDEFINED_LENGTH,
      rawBytes,
      byteOffset: 0,
      littleEndian: true,
      items: built.map((entry) => entry.item),
    });
  }

  const header = Buffer.alloc(12);
  header.set(uint16(group, littleEndian), 0);
  header.set(uint16(element, littleEndian), 2);
  header.write("SQ", 4, "ascii");
  // Bytes 6-7 are the reserved field (PS3.5 §7.1.2) and stay zero.
  header.set(uint32(value.length, littleEndian), 8);

  return new Element({
    tag: TAG_DEIDENTIFICATION_METHOD_CODE_SEQUENCE,
    vr: "SQ",
    vm: built.length,
    length: value.length,
    rawBytes: Buffer.concat([header, value]),
    byteOffset: 0,
    littleEndian,
    items: built.map((entry) => entry.item),
  });
}

/**
 * Attach the coded declaration to a de-identified dataset, dropping any De-identification Method Code
 * Sequence the **input** carried and rebuilding the root so nothing is mutated in place.
 *
 * A sequence the input carried is replaced rather than merged with. Its items are unaudited bytes from
 * an untrusted file: Code Meaning is free text, `(0012,0064)` is not in Table E.1-1 so no Annex E rule
 * inspects what is inside it, and keeping any of it would put unexamined input text inside output
 * stamped Patient Identity Removed YES. Replacing at the same key also drops every one of its items in
 * one act, so no item can survive by being one this code did not think to look at.
 *
 * The input's parse warnings are dropped with it, for the reason the adapter already drops them: they
 * describe the bytes as they were before anything was removed.
 *
 * @internal
 */
export function attachMethodCodeSequence(
  dataset: Dataset,
  terms: readonly DicomCodedTerm[],
): Dataset {
  const elements = new Map(dataset.elements().map((element) => [element.tag, element]));
  elements.set(
    TAG_DEIDENTIFICATION_METHOD_CODE_SEQUENCE,
    buildMethodCodeSequenceElement(terms, bodyEncoding(dataset)),
  );
  return new Dataset({
    warnings: [],
    elements,
    ...(dataset.fileMeta !== undefined ? { fileMeta: dataset.fileMeta } : {}),
  });
}

/** The typed, value-free refusal: never the peer's own message, which could quote bytes. */
function failUnverifiableDeclaration(): never {
  throw new DeidError(
    FATAL_CODES.DEID_OUTPUT_INVALID,
    "the coded de-identification method declaration could not be read back from this run's own " +
      "serialized output; no de-identified dataset or bytes are returned for a declaration the pass " +
      "cannot verify",
  );
}

/**
 * Serialize the de-identified dataset and prove the coded declaration survives a round trip through the
 * peer's own reader, returning the verified bytes so the byte entry point does not serialize twice.
 *
 * The comparison is by **value**, over the triplet a reader actually gets: Code Value, Coding Scheme
 * Designator and Code Meaning, in the order declared. Anything else - a term missing, an extra term, a
 * term whose meaning came back altered, a sequence that will not re-parse at all, a dataset that cannot
 * be serialized because it carries no transfer syntax - fails the pass.
 *
 * @param dataset - The de-identified dataset carrying the attached `(0012,0064)`.
 * @param terms - The terms the run declared, in the order they were written.
 * @returns The verified Part 10 bytes.
 * @throws {@link DeidError} `DEID_OUTPUT_INVALID` when the declaration does not read back unchanged.
 * @internal
 */
export function serializeVerified(dataset: Dataset, terms: readonly DicomCodedTerm[]): Buffer {
  let bytes: Buffer;
  let items: readonly Item[];
  try {
    bytes = serializeDicom(dataset);
    items = parseDicom(bytes).get(TAG_DEIDENTIFICATION_METHOD_CODE_SEQUENCE)?.items ?? [];
  } catch (err) {
    if (err instanceof DeidError) throw err;
    return failUnverifiableDeclaration();
  }

  if (items.length !== terms.length) return failUnverifiableDeclaration();
  for (const [index, term] of terms.entries()) {
    const item = items[index];
    if (item === undefined) return failUnverifiableDeclaration();
    const read = readCode(item);
    if (
      read.codeValue !== term.codeValue ||
      read.codingSchemeDesignator !== term.codingSchemeDesignator ||
      read.codeMeaning !== term.codeMeaning
    ) {
      return failUnverifiableDeclaration();
    }
  }
  return bytes;
}
