/**
 * The DICOM pass keeps Pixel Data as it is, so it copies the value at most once: once into the file
 * the buffer entry point returns, and not at all when the caller asks for the dataset.
 *
 * Every dataset is synthetic, built in code by the benchmark shapes.
 */

import { Buffer } from "node:buffer";

import { afterEach, describe, expect, it, vi } from "vitest";
import { parseDicom, serializeDicom } from "@cosyte/dicom";

import { deidentifyDicom, deidentifyDicomBuffer } from "../../src/dicom/index.js";
import { enhancedCt } from "../../bench/shapes.mjs";

/** Every Buffer.concat and Buffer.from result at least `size` bytes long, during `run`. */
function largeCopies(size: number, run: () => void): number {
  const sizes: number[] = [];
  const concat = Buffer.concat.bind(Buffer);
  const from = Buffer.from.bind(Buffer) as (...args: unknown[]) => Buffer;
  vi.spyOn(Buffer, "concat").mockImplementation((list, total) => {
    const out = concat(list, total);
    sizes.push(out.length);
    return out;
  });
  vi.spyOn(Buffer, "from").mockImplementation(((...args: unknown[]) => {
    const out = from(...args);
    sizes.push(out.length);
    return out;
  }) as typeof Buffer.from);
  run();
  vi.restoreAllMocks();
  return sizes.filter((n) => n >= size).length;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Pixel Data is copied at most once", () => {
  const frames = enhancedCt(2, 4, 32);
  const pixelBytes = 4 * 32 * 32 * 2;

  it("the buffer entry point builds its file without copying the value through the writer", () => {
    let bytes: Buffer = Buffer.alloc(0);
    const copies = largeCopies(pixelBytes, () => {
      bytes = deidentifyDicomBuffer(frames).bytes;
    });
    expect(copies).toBe(0);
    expect(bytes.equals(serializeDicom(deidentifyDicom(parseDicom(frames)).dataset))).toBe(true);
  });

  it("the dataset entry point never copies the value", () => {
    const parsed = parseDicom(frames);
    const copies = largeCopies(pixelBytes, () => {
      deidentifyDicom(parsed);
    });
    expect(copies).toBe(0);
  });
});
