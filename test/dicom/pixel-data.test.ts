/**
 * The DICOM writer that copies Pixel Data at most once writes exactly the file `serializeDicom`
 * writes. These compare the two byte for byte on every shape, the ones handed back to
 * `serializeDicom` included.
 *
 * Every dataset is synthetic, built in memory.
 */

import { Buffer } from "node:buffer";

import { describe, expect, it } from "vitest";
import { Dataset, Element, parseDicom, serializeDicom } from "@cosyte/dicom";

import { deidentifyDicom, deidentifyDicomBuffer } from "../../src/dicom/index.js";
import { writeDicom } from "../../src/dicom/pixel-data.js";
import { buildDicom, type BuildDicomOptions } from "./helpers/build-dicom.js";
import { pad, UID } from "./helpers/fixtures.js";

const TS_IMPLICIT_LE = "1.2.840.10008.1.2";
const TS_EXPLICIT_LE = "1.2.840.10008.1.2.1";
const TS_EXPLICIT_BE = "1.2.840.10008.1.2.2";
const DICOMDIR = "1.2.840.10008.1.3.10";

const HEADER: BuildDicomOptions["elements"] = [
  { tag: "00080016", vr: "UI", value: pad("1.2.840.10008.5.1.4.1.1.2") },
  { tag: "00080018", vr: "UI", value: pad(UID.sop) },
  { tag: "00100010", vr: "PN", value: pad("ZZPIXEL^SYNTH") },
  { tag: "00280010", vr: "US", value: Buffer.from([0x10, 0x00]) },
  { tag: "00280011", vr: "US", value: Buffer.from([0x08, 0x00]) },
];

function pixels(n: number): Buffer {
  return Buffer.from(Array.from({ length: n }, (_v, i) => (i * 7) % 256));
}

/** The bytes an empty Explicit VR `OW` Pixel Data element is written as. */
const EMPTY_PIXEL_DATA_OW = Buffer.from([0xe0, 0x7f, 0x10, 0x00, 0x4f, 0x57, 0, 0, 0, 0, 0, 0]);

/**
 * `base` with one more element the writer leaves open, so it is written after every closed element,
 * Pixel Data included, though its tag is lower: a sequence of undefined length whose bytes do not
 * read back as a sequence, written as they are.
 */
function withOpenElement(base: Dataset, bytes: Buffer): Dataset {
  const elements = new Map(base.elements().map((element) => [element.tag, element]));
  elements.set(
    "00081140",
    new Element({
      tag: "00081140",
      vr: "SQ",
      vm: 1,
      length: 0xffffffff,
      rawBytes: bytes,
      byteOffset: 0,
      littleEndian: true,
      items: [],
    }),
  );
  return new Dataset({
    warnings: [],
    elements,
    ...(base.fileMeta !== undefined ? { fileMeta: base.fileMeta } : {}),
  });
}

function dataset(
  elements: BuildDicomOptions["elements"],
  transferSyntax = TS_EXPLICIT_LE,
  extra: Partial<BuildDicomOptions> = {},
): Dataset {
  return parseDicom(
    buildDicom({
      transferSyntax,
      mediaStorageSOPInstanceUID: UID.sop,
      elements: [...HEADER, ...elements],
      ...extra,
    }),
  );
}

/** What a write produced: its bytes, or the name of what it threw. */
function outcome(write: () => Buffer): string {
  try {
    return write().toString("hex");
  } catch (error) {
    return `threw ${(error as Error).name}`;
  }
}

describe("writeDicom writes exactly what serializeDicom writes", () => {
  const shapes: readonly (readonly [string, () => Dataset])[] = [
    [
      "explicit VR little endian, OW",
      () => dataset([{ tag: "7FE00010", vr: "OW", value: pixels(256) }]),
    ],
    [
      "explicit VR little endian, OB",
      () => dataset([{ tag: "7FE00010", vr: "OB", value: pixels(64) }]),
    ],
    [
      "implicit VR little endian",
      () => dataset([{ tag: "7FE00010", vr: "OW", value: pixels(256) }], TS_IMPLICIT_LE),
    ],
    [
      "explicit VR big endian",
      () => dataset([{ tag: "7FE00010", vr: "OW", value: pixels(256) }], TS_EXPLICIT_BE),
    ],
    [
      "a Media Storage Directory",
      () =>
        dataset([{ tag: "7FE00010", vr: "OW", value: pixels(256) }], TS_EXPLICIT_LE, {
          mediaStorageSOPClassUID: DICOMDIR,
        }),
    ],
    ["no Pixel Data", () => dataset([])],
    ["no File Meta", () => new Dataset({ warnings: [], elements: new Map() })],
    [
      "Pixel Data of another VR",
      () => dataset([{ tag: "7FE00010", vr: "UN", value: pixels(256) }]),
    ],
    ["an odd length", () => dataset([{ tag: "7FE00010", vr: "OB", value: pixels(65) }])],
    [
      "an undefined length",
      () =>
        dataset([
          {
            tag: "7FE00010",
            items: [],
            undefinedLength: true,
            encapsulatedPixelData: true,
            encapsulatedFragments: [pixels(64)],
          },
        ]),
    ],
    [
      "an element after Pixel Data",
      () =>
        dataset([
          { tag: "7FE00010", vr: "OW", value: pixels(256) },
          { tag: "FFFCFFFC", vr: "OB", value: Buffer.alloc(8) },
        ]),
    ],
    [
      "an element after Pixel Data whose value ends in an empty Pixel Data element",
      () =>
        dataset([
          { tag: "7FE00010", vr: "OW", value: pixels(256) },
          { tag: "7FE00020", vr: "OW", value: EMPTY_PIXEL_DATA_OW },
        ]),
    ],
    [
      "an open element written after Pixel Data",
      () =>
        withOpenElement(
          dataset([{ tag: "7FE00010", vr: "OW", value: pixels(256) }]),
          Buffer.from([0x08, 0x00, 0x40, 0x11, 0x4f, 0x42, 0, 0, 2, 0, 0, 0, 0, 0]),
        ),
    ],
    [
      "an open element written after Pixel Data whose bytes are an empty Pixel Data element",
      () =>
        withOpenElement(
          dataset([{ tag: "7FE00010", vr: "OW", value: pixels(256) }]),
          EMPTY_PIXEL_DATA_OW,
        ),
    ],
  ];

  for (const [name, build] of shapes) {
    it(`${name}: the whole file`, () => {
      const ds = build();
      expect(outcome(() => writeDicom(ds, true))).toBe(outcome(() => serializeDicom(ds)));
    });

    it(`${name}: the bytes in front of the value are the file's own`, () => {
      const ds = build();
      const full = outcome(() => serializeDicom(ds));
      const head = outcome(() => writeDicom(ds, false));
      if (full.startsWith("threw")) {
        expect(head).toBe(full);
        return;
      }
      // Everything but the four length bytes of an emptied Pixel Data element is the file's prefix.
      const lengthAt = head.length - 8;
      expect(full.slice(0, lengthAt)).toBe(head.slice(0, lengthAt));
      expect(head === full || head.endsWith("00000000")).toBe(true);
    });
  }

  it("a file with an element after Pixel Data that ends in its bytes is de-identified, not refused", () => {
    const file = buildDicom({
      transferSyntax: TS_EXPLICIT_LE,
      mediaStorageSOPInstanceUID: UID.sop,
      elements: [
        ...HEADER,
        { tag: "7FE00010", vr: "OW", value: pixels(256) },
        { tag: "7FE00020", vr: "OW", value: EMPTY_PIXEL_DATA_OW },
      ],
    });
    const { bytes } = deidentifyDicomBuffer(file);
    expect(bytes.equals(serializeDicom(deidentifyDicom(parseDicom(file)).dataset))).toBe(true);
  });

  it("the fast shapes really are written without the value", () => {
    const ds = dataset([{ tag: "7FE00010", vr: "OW", value: pixels(256) }]);
    expect(writeDicom(ds, false).length).toBe(serializeDicom(ds).length - 256);
    const implicit = dataset([{ tag: "7FE00010", vr: "OW", value: pixels(256) }], TS_IMPLICIT_LE);
    expect(writeDicom(implicit, false).length).toBe(serializeDicom(implicit).length - 256);
  });
});
