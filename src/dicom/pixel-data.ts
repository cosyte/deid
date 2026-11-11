/**
 * Write a de-identified dataset **without copying its Pixel Data more than once**.
 *
 * `@cosyte/dicom`'s writer encodes every element into a buffer of its own and then joins them, twice,
 * so native Pixel Data, which is almost all of an image's bytes, is copied three times on the way to
 * the file, and verifying the coded declaration needs only the header in front of it. This pass keeps
 * Pixel Data as it is, so it has no reason to pay for those copies.
 *
 * When the shape allows it, the dataset is written with an **empty** Pixel Data element in place of
 * the real one. The writer gives that element the same place it gives the real one (elements are
 * ordered by tag), and an element's bytes are its header and its value, so when the empty element's
 * header is the last thing written, the full file is exactly that header-only file with the element's
 * length filled in and the value appended. That file is built with one copy of the value, into a
 * buffer of the final size. Anything the shape does not allow is written by `serializeDicom` as
 * before, so every byte stays the writer's own:
 *
 * - a transfer syntax other than Implicit VR Little Endian or Explicit VR Little Endian (Big Endian
 *   swaps the value, Deflated compresses the body, an encapsulated syntax writes fragments);
 * - a Media Storage Directory (the writer rewrites record offsets there);
 * - Pixel Data that is not `OB` or `OW`, has an undefined length, an odd length (the writer pads it)
 *   or a length past what four bytes can state;
 * - any element written after Pixel Data.
 *
 * @packageDocumentation
 */

import { Buffer } from "node:buffer";

import { Dataset, Element, serializeDicom } from "@cosyte/dicom";

/** Pixel Data `(7FE0,0010)`. */
const TAG_PIXEL_DATA = "7FE00010";

/** The body encodings this writer handles, by Transfer Syntax UID. */
const LITTLE_ENDIAN_SYNTAXES: Readonly<Record<string, "implicit" | "explicit">> = {
  "1.2.840.10008.1.2": "implicit",
  "1.2.840.10008.1.2.1": "explicit",
};

/** Media Storage Directory Storage: a DICOMDIR, whose record offsets the writer rewrites. */
const MEDIA_STORAGE_DIRECTORY = "1.2.840.10008.1.3.10";

/** The longest value a four-byte length can state; `0xFFFFFFFF` itself means undefined length. */
const MAX_DEFINED_LENGTH = 0xfffffffe;

/** A dataset written with its Pixel Data value left out, and the value to append. */
interface PixelDataSplit {
  /** The dataset with an empty Pixel Data element in place of the real one. */
  readonly headerOnly: Dataset;
  /** The Pixel Data value, as the dataset holds it (never copied here). */
  readonly value: Buffer;
  /** The bytes the empty Pixel Data element is written as, which must end the header-only file. */
  readonly emptyElement: Buffer;
}

/** The split, or `undefined` when the dataset's shape is not one this writer handles. */
function splitPixelData(dataset: Dataset): PixelDataSplit | undefined {
  const fileMeta = dataset.fileMeta;
  if (fileMeta === undefined) return undefined;
  const encoding = LITTLE_ENDIAN_SYNTAXES[fileMeta.transferSyntaxUID];
  if (encoding === undefined || fileMeta.mediaStorageSOPClassUID === MEDIA_STORAGE_DIRECTORY) {
    return undefined;
  }
  const pixel = dataset.get(TAG_PIXEL_DATA);
  if (pixel === undefined || (pixel.vr !== "OB" && pixel.vr !== "OW")) return undefined;
  const value = pixel.rawBytes;
  if (pixel.length !== value.length || value.length % 2 !== 0) return undefined;
  // A value past four gigabytes cannot be built in a test, and the writer would refuse it anyway.
  /* v8 ignore next */
  if (value.length > MAX_DEFINED_LENGTH) return undefined;

  const elements = new Map<string, Element>();
  for (const element of dataset.elements()) {
    elements.set(element.tag, element.tag === TAG_PIXEL_DATA ? emptied(element) : element);
  }
  const headerOnly = new Dataset({ warnings: [], elements, fileMeta });
  return { headerOnly, value, emptyElement: emptyElementBytes(encoding, pixel.vr) };
}

/**
 * The same element with no value. It is only ever written, never read, and the writer reads a binary
 * element's tag, VR, length and bytes; a standard tag carries no private creator, and an `OB` or `OW`
 * value has no character set.
 */
function emptied(element: Element): Element {
  return new Element({
    tag: element.tag,
    vr: element.vr,
    vm: element.vm,
    length: 0,
    rawBytes: Buffer.alloc(0),
    byteOffset: element.byteOffset,
    littleEndian: element.littleEndian,
  });
}

/**
 * The bytes an empty Pixel Data element is written as: its tag, then (Explicit VR) its VR and two
 * reserved bytes, then a four-byte length of zero, all little endian (PS3.5 7.1.1 and 7.1.2).
 */
function emptyElementBytes(encoding: "implicit" | "explicit", vr: string): Buffer {
  const tag = Buffer.from([0xe0, 0x7f, 0x10, 0x00]);
  const length = Buffer.alloc(4);
  if (encoding === "implicit") return Buffer.concat([tag, length]);
  return Buffer.concat([tag, Buffer.from(vr, "latin1"), Buffer.alloc(2), length]);
}

/** `true` when `bytes` ends with `suffix`. */
function endsWith(bytes: Buffer, suffix: Buffer): boolean {
  return (
    bytes.length >= suffix.length && bytes.subarray(bytes.length - suffix.length).equals(suffix)
  );
}

/**
 * What the declaration check reads: the file as `serializeDicom` writes it, or, when the shape
 * allows, that file with the Pixel Data value left out. Everything in front of Pixel Data is the same
 * bytes either way, and the declaration is in front of it.
 *
 * @param dataset - The de-identified dataset to write.
 * @param whole - `true` to return the whole file (the buffer entry point returns it), `false` when
 *   only the bytes in front of the Pixel Data value are needed.
 * @returns The Part 10 bytes; the whole file when `whole` is `true`.
 * @internal
 */
export function writeDicom(dataset: Dataset, whole: boolean): Buffer {
  const split = splitPixelData(dataset);
  if (split === undefined) return serializeDicom(dataset);
  const head = serializeDicom(split.headerOnly);
  if (!endsWith(head, split.emptyElement)) return serializeDicom(dataset);
  if (!whole) return head;
  const out = Buffer.allocUnsafe(head.length + split.value.length);
  head.copy(out, 0);
  out.writeUInt32LE(split.value.length, head.length - 4);
  split.value.copy(out, head.length);
  return out;
}
