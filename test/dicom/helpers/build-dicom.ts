/**
 * Programmatic Part 10 fixture builder — internal test utility.
 *
 * D-37 / D-38: this helper lives in `test/helpers/` and is NOT exported from
 * `src/index.ts`.
 * Phase 2 ships zero curated `.dcm` fixture files; everything is built in
 * memory by this helper. Phase 5's serializer eventually subsumes the
 * production version of this code.
 *
 * Phase 2 plan 02-02 implements Implicit VR LE and Explicit VR LE encoders.
 * Plan 02-04 extends `encodeElement` with the Explicit VR BE branch (with
 * per-VR byte-swap) plus SQ item encoding (FFFE markers, defined- and
 * undefined-length forms, encapsulated pixel data fragments).
 * Plan 02-05 adds the Deflated Explicit VR LE branch (`zlib.deflateRawSync`
 * applied to an Explicit-LE-encoded element body — symmetric counterpart
 * to `parseDeflatedLE`'s `zlib.inflateRawSync` per CONTEXT D-26 /
 * PITFALLS §1.4).
 *
 * @module
 */

import { Buffer } from "node:buffer";
import { deflateRawSync } from "node:zlib";

/**
 * `Tag` / `VR` mirror `@cosyte/dicom`'s string-alias types. Kept as local aliases so this vendored
 * synthetic-fixture helper (copied from `@cosyte/dicom`'s `test/helpers/build-dicom.ts`) has no dependency
 * on the parser's internal module paths.
 */
type Tag = string;
type VR = string;

const LONG_FORM_VRS = new Set<VR>([
  "OB",
  "OW",
  "OF",
  "OD",
  "OL",
  "OV",
  "SQ",
  "UT",
  "UN",
  "UC",
  "UR",
  "SV",
  "UV",
]);

/**
 * Per-VR byte-stride for Explicit VR Big Endian byte-swap (mirror of the
 * production `BE_VR_STRIDE` in `src/parser/endian.ts`). Duplicated here so
 * the test helper has no runtime dependency on the source-code constant —
 * a regression in either copy is caught by the `endian.test.ts` table tests
 * + the BE round-trip tests in `explicit-be.test.ts`.
 *
 * - 0 → no swap (OB / UN / ASCII / spec-defined)
 * - 2 → AT, US, SS, OW
 * - 4 → UL, SL, FL, OF, OL
 * - 8 → FD, OD, OV, SV, UV
 */
const BE_VR_STRIDE_LOCAL: Readonly<Record<VR, 0 | 2 | 4 | 8>> = {
  AT: 2,
  US: 2,
  SS: 2,
  OW: 2,
  UL: 4,
  SL: 4,
  FL: 4,
  OF: 4,
  OL: 4,
  FD: 8,
  OD: 8,
  OV: 8,
  SV: 8,
  UV: 8,
  OB: 0,
  UN: 0,
  AE: 0,
  AS: 0,
  CS: 0,
  DA: 0,
  DS: 0,
  DT: 0,
  IS: 0,
  LO: 0,
  LT: 0,
  PN: 0,
  SH: 0,
  ST: 0,
  TM: 0,
  UC: 0,
  UI: 0,
  UR: 0,
  UT: 0,
  SQ: 0,
};

/** A single dataset element to emit. */
export interface BuildDicomElement {
  /** 8-char uppercase hex tag, e.g. `"00100010"`. */
  readonly tag: Tag;
  /** Value Representation. */
  readonly vr: VR;
  /**
   * Raw value bytes (caller pads to even length when required by the VR).
   *
   * **Endian convention for BE TS:** for numeric VRs whose
   * `BE_VR_STRIDE > 0` (US/SS/UL/SL/FL/FD/AT/OW/OF/OL/OD/OV/SV/UV), pass
   * the value bytes in **little-endian / native** order. The encoder
   * byte-swaps to BE on emit. This keeps the call-site identical for LE
   * and BE fixtures (caller writes `Buffer.from([0x05, 0x00])` for US=5
   * regardless of TS).
   */
  readonly value: Buffer;
}

/**
 * One item inside an SQ element, encoded with FFFE,E000 + length + nested
 * elements + (optional) FFFE,E00D ItemDelim. Plan 02-04 only.
 */
export interface BuildDicomSqItem {
  readonly elements: readonly (BuildDicomElement | BuildDicomSqElement)[];
  /** When true, item is encoded with undefined length + FFFE,E00D ItemDelim. */
  readonly undefinedLength?: boolean;
}

/**
 * An SQ-typed element (or encapsulated-pixel-data element when
 * `encapsulatedPixelData === true`). The encoder writes the SQ header
 * with VR=SQ (or VR=OB for encapsulated pixel data), the items, and the
 * FFFE,E0DD SeqDelim if `undefinedLength === true`. Plan 02-04 only.
 */
export interface BuildDicomSqElement {
  readonly tag: Tag;
  /** When true, the SQ value uses undefined length + FFFE,E0DD SeqDelim. */
  readonly undefinedLength?: boolean;
  readonly items: readonly BuildDicomSqItem[];
  /** Default `false`. When true, fragments are emitted as raw Buffer items. */
  readonly encapsulatedPixelData?: boolean;
  /** Required when `encapsulatedPixelData === true` — fragment byte streams. */
  readonly encapsulatedFragments?: readonly Buffer[];
  /**
   * When `encapsulatedPixelData === true`, override the on-wire VR. Defaults
   * to `OB` (per D-31). Setting to `UN` (with `undefinedLength: true`) lets
   * the test helper produce a CP-246 fixture: a UN-undefined-length value
   * containing Implicit-VR-LE-encoded SQ bytes.
   */
  readonly explicitVr?: VR;
}

/** Discriminate SqElement vs primitive. */
function isSqElement(el: BuildDicomElement | BuildDicomSqElement): el is BuildDicomSqElement {
  return Object.prototype.hasOwnProperty.call(el, "items");
}

/** Options for {@link buildDicom}. */
export interface BuildDicomOptions {
  /** Transfer Syntax UID for the dataset elements. */
  readonly transferSyntax: string;
  /** Dataset elements to emit (after File Meta). */
  readonly elements: readonly (BuildDicomElement | BuildDicomSqElement)[];
  /** When `true`, omits the 128-byte preamble + DICM magic. */
  readonly skipPreamble?: boolean;
  /**
   * `(0002,0000)` FileMetaInformationGroupLength behaviour:
   *   - `undefined` (default): emit with the actual byte count.
   *   - `"omit"`: omit the element entirely.
   *   - `"wrong"`: emit with an intentionally incorrect byte count.
   *   - `number`: emit with the specified byte count.
   */
  readonly fileMetaGroupLength?: number | "omit" | "wrong";
  /** When `true`, omits the `(0002,0010)` Transfer Syntax UID element. */
  readonly skipTransferSyntaxUID?: boolean;
  /** Optional File Meta extras (FM-02 fields beyond TS UID). */
  readonly mediaStorageSOPClassUID?: string;
  readonly mediaStorageSOPInstanceUID?: string;
  readonly implementationClassUID?: string;
  readonly implementationVersionName?: string;
  /**
   * Non-modeled `(0002,xxxx)` File Meta elements (e.g. Sending/Receiving AE
   * Title, Private Information), emitted Explicit VR LE inside the File Meta
   * group and counted in `(0002,0000)`. Caller passes even-length values.
   */
  readonly fileMetaExtraElements?: readonly BuildDicomElement[];
  /** Trailing junk appended to the buffer after all dataset elements. */
  readonly trailingBytes?: Buffer;
}

/**
 * Build a Part 10 buffer. Internal — do NOT export from `src/index.ts`.
 */
export function buildDicom(opts: BuildDicomOptions): Buffer {
  const parts: Buffer[] = [];

  if (opts.skipPreamble !== true) {
    parts.push(Buffer.alloc(128, 0x00));
    parts.push(Buffer.from("DICM", "ascii"));
  }

  // Build File Meta body (Explicit VR LE — hard-wired per FM-01 / D-17).
  const fileMetaElements: Buffer[] = [];
  if (opts.skipTransferSyntaxUID !== true) {
    fileMetaElements.push(buildExplicitLeElement("00020010", "UI", padUI(opts.transferSyntax)));
  }
  if (opts.mediaStorageSOPClassUID !== undefined) {
    fileMetaElements.push(
      buildExplicitLeElement("00020002", "UI", padUI(opts.mediaStorageSOPClassUID)),
    );
  }
  if (opts.mediaStorageSOPInstanceUID !== undefined) {
    fileMetaElements.push(
      buildExplicitLeElement("00020003", "UI", padUI(opts.mediaStorageSOPInstanceUID)),
    );
  }
  if (opts.implementationClassUID !== undefined) {
    fileMetaElements.push(
      buildExplicitLeElement("00020012", "UI", padUI(opts.implementationClassUID)),
    );
  }
  if (opts.implementationVersionName !== undefined) {
    fileMetaElements.push(
      buildExplicitLeElement("00020013", "SH", padText(opts.implementationVersionName)),
    );
  }
  for (const extra of opts.fileMetaExtraElements ?? []) {
    fileMetaElements.push(buildExplicitLeElement(extra.tag, extra.vr, extra.value));
  }
  const fileMetaBody = Buffer.concat(fileMetaElements);

  if (opts.fileMetaGroupLength !== "omit") {
    let declared: number;
    if (opts.fileMetaGroupLength === "wrong") {
      // Under-report by 8 bytes: parser reads forward until first non-(0002,xxxx)
      // group, observes actual > declared, emits MISMATCH, and trusts actual.
      // (Over-reporting can collide with the truncated-buffer fatal in T-02-02-01.)
      declared = Math.max(0, fileMetaBody.length - 8);
    } else if (typeof opts.fileMetaGroupLength === "number") {
      declared = opts.fileMetaGroupLength;
    } else {
      declared = fileMetaBody.length;
    }
    const lengthValue = Buffer.alloc(4);
    lengthValue.writeUInt32LE(declared, 0);
    parts.push(buildExplicitLeElement("00020000", "UL", lengthValue));
  }
  parts.push(fileMetaBody);

  // Dataset elements per the requested transfer syntax.
  // TS-04 (Deflated Explicit VR LE) is the symmetric counterpart of
  // `parseDeflatedLE` — encode as Explicit VR LE first, then deflate
  // the concatenation via `zlib.deflateRawSync` (RFC 1951 raw deflate,
  // matching `inflateRawSync` on the parser side per CONTEXT D-26 /
  // PITFALLS §1.4). File Meta is NOT deflated (FM-01).
  if (opts.transferSyntax === "1.2.840.10008.1.2.1.99") {
    const explicitLeBytes = Buffer.concat(
      opts.elements.map((el) => encodeAnyElement(el, "1.2.840.10008.1.2.1")),
    );
    parts.push(deflateRawSync(explicitLeBytes));
  } else {
    for (const el of opts.elements) {
      parts.push(encodeAnyElement(el, opts.transferSyntax));
    }
  }

  if (opts.trailingBytes !== undefined) {
    parts.push(opts.trailingBytes);
  }

  return Buffer.concat(parts);
}

// ---------------------------------------------------------------------------
// Encoders
// ---------------------------------------------------------------------------

function buildExplicitLeElement(tag: Tag, vr: VR, value: Buffer): Buffer {
  const { group, element } = splitTag(tag);
  const groupBuf = Buffer.alloc(2);
  groupBuf.writeUInt16LE(group, 0);
  const elementBuf = Buffer.alloc(2);
  elementBuf.writeUInt16LE(element, 0);
  const vrBuf = Buffer.from(vr, "ascii");
  if (LONG_FORM_VRS.has(vr)) {
    const reserved = Buffer.from([0x00, 0x00]);
    const lengthBuf = Buffer.alloc(4);
    lengthBuf.writeUInt32LE(value.length, 0);
    return Buffer.concat([groupBuf, elementBuf, vrBuf, reserved, lengthBuf, value]);
  }
  const lengthBuf = Buffer.alloc(2);
  lengthBuf.writeUInt16LE(value.length, 0);
  return Buffer.concat([groupBuf, elementBuf, vrBuf, lengthBuf, value]);
}

function buildImplicitLeElement(tag: Tag, value: Buffer): Buffer {
  const { group, element } = splitTag(tag);
  const groupBuf = Buffer.alloc(2);
  groupBuf.writeUInt16LE(group, 0);
  const elementBuf = Buffer.alloc(2);
  elementBuf.writeUInt16LE(element, 0);
  const lengthBuf = Buffer.alloc(4);
  lengthBuf.writeUInt32LE(value.length, 0);
  return Buffer.concat([groupBuf, elementBuf, lengthBuf, value]);
}

/**
 * In-place reverse of `count` consecutive groups of `stride` bytes inside
 * `src`. Returns a new Buffer; `src` is not mutated. Used by the BE
 * encoder to flip caller-supplied LE / native value bytes to BE on wire.
 */
function swapBytes(src: Buffer, stride: 0 | 2 | 4 | 8): Buffer {
  if (stride === 0) return Buffer.from(src);
  if (src.length % stride !== 0) {
    throw new Error(
      `buildDicom: BE swap stride=${String(stride)} does not divide value length=${String(src.length)}.`,
    );
  }
  const out = Buffer.alloc(src.length);
  for (let i = 0; i < src.length; i += stride) {
    for (let j = 0; j < stride; j++) {
      out[i + j] = src[i + (stride - 1 - j)] ?? 0;
    }
  }
  return out;
}

function buildExplicitBeElement(tag: Tag, vr: VR, value: Buffer): Buffer {
  const { group, element } = splitTag(tag);
  const groupBuf = Buffer.alloc(2);
  groupBuf.writeUInt16BE(group, 0);
  const elementBuf = Buffer.alloc(2);
  elementBuf.writeUInt16BE(element, 0);
  const vrBuf = Buffer.from(vr, "ascii");
  // Per D-23 / D-24: swap value bytes per the per-VR stride before emit.
  // OB / UN stride = 0 → no swap (D-24).
  // AT stride=2: caller-supplied bytes are interpreted as a contiguous run
  // of group/element 16-bit halves, each emitted BE — total swap count is
  // value.length/2.
  const swapped = swapBytes(value, BE_VR_STRIDE_LOCAL[vr] ?? 0);
  if (LONG_FORM_VRS.has(vr)) {
    const reserved = Buffer.from([0x00, 0x00]);
    const lengthBuf = Buffer.alloc(4);
    lengthBuf.writeUInt32BE(swapped.length, 0);
    return Buffer.concat([groupBuf, elementBuf, vrBuf, reserved, lengthBuf, swapped]);
  }
  const lengthBuf = Buffer.alloc(2);
  lengthBuf.writeUInt16BE(swapped.length, 0);
  return Buffer.concat([groupBuf, elementBuf, vrBuf, lengthBuf, swapped]);
}

// ---------------------------------------------------------------------------
// FFFE markers + SQ encoders (D-25, D-28, D-29)
// ---------------------------------------------------------------------------

const ITEM_TAG_GROUP = 0xfffe;
const ITEM_TAG_ELEMENT = 0xe000;
const ITEM_DELIM_TAG_ELEMENT = 0xe00d;
const SEQ_DELIM_TAG_ELEMENT = 0xe0dd;
const UNDEFINED_LENGTH = 0xffffffff;

/**
 * Build a 4-byte FFFE marker tag. Identical layout under Implicit/Explicit
 * LE (group/element 16-bit LE); mirrored to BE under Explicit BE per D-25.
 *
 * The `littleEndian` flag matches the dataset cursor's endianness — the
 * canonical FFFE-under-BE bug per PITFALLS §2.3 is exactly the case where
 * a parser fails to honor this rule.
 */
function buildFffeTagBytes(elementCode: number, littleEndian: boolean): Buffer {
  const buf = Buffer.alloc(4);
  if (littleEndian) {
    buf.writeUInt16LE(ITEM_TAG_GROUP, 0);
    buf.writeUInt16LE(elementCode, 2);
  } else {
    buf.writeUInt16BE(ITEM_TAG_GROUP, 0);
    buf.writeUInt16BE(elementCode, 2);
  }
  return buf;
}

function buildLengthBytes(length: number, littleEndian: boolean): Buffer {
  const buf = Buffer.alloc(4);
  if (littleEndian) buf.writeUInt32LE(length, 0);
  else buf.writeUInt32BE(length, 0);
  return buf;
}

/** Build an SQ-item header (FFFE,E000 + length). */
function buildItemHeader(length: number, littleEndian: boolean): Buffer {
  return Buffer.concat([
    buildFffeTagBytes(ITEM_TAG_ELEMENT, littleEndian),
    buildLengthBytes(length, littleEndian),
  ]);
}

/** Build an SQ-item delimiter (FFFE,E00D + length=0). */
function buildItemDelim(littleEndian: boolean): Buffer {
  return Buffer.concat([
    buildFffeTagBytes(ITEM_DELIM_TAG_ELEMENT, littleEndian),
    buildLengthBytes(0, littleEndian),
  ]);
}

/** Build an SQ-sequence delimiter (FFFE,E0DD + length=0). */
function buildSeqDelim(littleEndian: boolean): Buffer {
  return Buffer.concat([
    buildFffeTagBytes(SEQ_DELIM_TAG_ELEMENT, littleEndian),
    buildLengthBytes(0, littleEndian),
  ]);
}

function tsLittleEndian(ts: string): boolean {
  // 1.2.840.10008.1.2.2 is Explicit VR BE; everything else in v1 is LE.
  return ts !== "1.2.840.10008.1.2.2";
}

/** Encode an item (FFFE,E000 + length + nested elements + optional ItemDelim). */
function encodeSqItem(item: BuildDicomSqItem, ts: string): Buffer {
  const littleEndian = tsLittleEndian(ts);
  const innerParts: Buffer[] = [];
  for (const inner of item.elements) {
    innerParts.push(encodeAnyElement(inner, ts));
  }
  const innerBody = Buffer.concat(innerParts);
  if (item.undefinedLength === true) {
    return Buffer.concat([
      buildItemHeader(UNDEFINED_LENGTH, littleEndian),
      innerBody,
      buildItemDelim(littleEndian),
    ]);
  }
  return Buffer.concat([buildItemHeader(innerBody.length, littleEndian), innerBody]);
}

/** Encode an SQ element (header + items + optional SeqDelim). */
function encodeSqElement(sq: BuildDicomSqElement, ts: string): Buffer {
  const littleEndian = tsLittleEndian(ts);

  // Encapsulated pixel data path (D-31): VR=OB undefined-length + raw
  // fragment items (no nested elements). The first fragment is the Basic
  // Offset Table per PS3.5 §A.4. Use undefinedLength=true unconditionally.
  if (sq.encapsulatedPixelData === true) {
    const fragments = sq.encapsulatedFragments ?? [];
    const itemBufs: Buffer[] = [];
    for (const frag of fragments) {
      itemBufs.push(buildItemHeader(frag.length, littleEndian));
      itemBufs.push(frag);
    }
    const body = Buffer.concat([...itemBufs, buildSeqDelim(littleEndian)]);
    const overrideVr: VR = sq.explicitVr ?? "OB";
    return encodeSqHeader(sq.tag, overrideVr, ts, body, /* undefinedLength */ true);
  }

  const itemBufs: Buffer[] = [];
  for (const item of sq.items) {
    itemBufs.push(encodeSqItem(item, ts));
  }
  if (sq.undefinedLength === true) {
    const body = Buffer.concat([...itemBufs, buildSeqDelim(littleEndian)]);
    const vr: VR = sq.explicitVr ?? "SQ";
    return encodeSqHeader(sq.tag, vr, ts, body, /* undefinedLength */ true);
  }
  const body = Buffer.concat(itemBufs);
  const vr: VR = sq.explicitVr ?? "SQ";
  return encodeSqHeader(sq.tag, vr, ts, body, /* undefinedLength */ false);
}

/**
 * Encode an SQ-element header followed by its body. The header layout
 * depends on the TS:
 *  - Implicit VR LE (1.2.840.10008.1.2): group(2)+element(2)+length(4).
 *  - Explicit VR LE/BE: long-form header (group/element/VR/reserved/length).
 *
 * `undefinedLength` controls whether the 4-byte length field is the body
 * length or 0xFFFFFFFF.
 */
function encodeSqHeader(
  tag: Tag,
  vr: VR,
  ts: string,
  body: Buffer,
  undefinedLength: boolean,
): Buffer {
  const { group, element } = splitTag(tag);
  const length = undefinedLength ? UNDEFINED_LENGTH : body.length;

  if (ts === "1.2.840.10008.1.2") {
    // Implicit VR LE — no on-wire VR field.
    const groupBuf = Buffer.alloc(2);
    groupBuf.writeUInt16LE(group, 0);
    const elementBuf = Buffer.alloc(2);
    elementBuf.writeUInt16LE(element, 0);
    const lengthBuf = Buffer.alloc(4);
    lengthBuf.writeUInt32LE(length, 0);
    return Buffer.concat([groupBuf, elementBuf, lengthBuf, body]);
  }

  // Explicit VR LE / BE — long-form header (SQ/OB/UN are all in LONG_FORM_VRS).
  const littleEndian = tsLittleEndian(ts);
  const groupBuf = Buffer.alloc(2);
  const elementBuf = Buffer.alloc(2);
  const lengthBuf = Buffer.alloc(4);
  if (littleEndian) {
    groupBuf.writeUInt16LE(group, 0);
    elementBuf.writeUInt16LE(element, 0);
    lengthBuf.writeUInt32LE(length, 0);
  } else {
    groupBuf.writeUInt16BE(group, 0);
    elementBuf.writeUInt16BE(element, 0);
    lengthBuf.writeUInt32BE(length, 0);
  }
  const vrBuf = Buffer.from(vr, "ascii");
  const reserved = Buffer.from([0x00, 0x00]);
  return Buffer.concat([groupBuf, elementBuf, vrBuf, reserved, lengthBuf, body]);
}

/** Top-level encoder dispatch — picks per-TS strategy and SQ vs primitive. */
function encodeAnyElement(el: BuildDicomElement | BuildDicomSqElement, ts: string): Buffer {
  if (isSqElement(el)) return encodeSqElement(el, ts);
  return encodeElement(el, ts);
}

function encodeElement(el: BuildDicomElement, ts: string): Buffer {
  if (ts === "1.2.840.10008.1.2") return buildImplicitLeElement(el.tag, el.value);
  if (ts === "1.2.840.10008.1.2.1") return buildExplicitLeElement(el.tag, el.vr, el.value);
  if (ts === "1.2.840.10008.1.2.2") return buildExplicitBeElement(el.tag, el.vr, el.value);
  // TS-04 (Deflated Explicit VR LE) is handled at the buildDicom level —
  // dataset elements are encoded as Explicit VR LE, then the entire
  // dataset is deflated. encodeElement is never reached for TS-04.
  throw new Error(
    `buildDicom: encodeElement is not used for transferSyntax="${ts}" — Deflated TS encodes at the buildDicom level (caller bug).`,
  );
}

function splitTag(tag: Tag): { group: number; element: number } {
  return {
    group: parseInt(tag.slice(0, 4), 16),
    element: parseInt(tag.slice(4, 8), 16),
  };
}

/** UI VR is even-length and pads with NUL (0x00) per PS3.5. */
function padUI(s: string): Buffer {
  const buf = Buffer.from(s, "ascii");
  return buf.length % 2 === 0 ? buf : Buffer.concat([buf, Buffer.from([0x00])]);
}

/** Short-string VRs (SH, etc.) pad with space (0x20) per PS3.5. */
function padText(s: string): Buffer {
  const buf = Buffer.from(s, "ascii");
  return buf.length % 2 === 0 ? buf : Buffer.concat([buf, Buffer.from([0x20])]);
}
