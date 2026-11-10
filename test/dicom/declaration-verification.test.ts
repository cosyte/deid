/**
 * **DICOM: the read-back of the coded declaration fails closed on every way it can disagree.**
 *
 * Every pass serializes its output and reads `(0012,0064)` back through `@cosyte/dicom` before
 * returning anything. On a spec-clean file the read-back always agrees, so the branches that refuse a
 * disagreeing one are driven here by standing in for the peer's writer and reader, one call at a time:
 * a sequence that does not come back, one with the wrong number of items, a hole where an item should
 * be, a term whose meaning came back altered, and a fatal of this library's own raised mid-write. Each
 * returns no dataset and no bytes, and the last keeps its own code rather than being re-labelled.
 *
 * Everything is synthetic and built in memory.
 */

import * as dicom from "@cosyte/dicom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DeidError, FATAL_CODES } from "../../src/index.js";
import { deidentifyDicom } from "../../src/dicom/index.js";
import { buildPhiDataset } from "./helpers/fixtures.js";

vi.mock("@cosyte/dicom", async (importOriginal) => {
  const real = await importOriginal<typeof dicom>();
  return {
    ...real,
    serializeDicom: vi.fn(real.serializeDicom),
    parseDicom: vi.fn(real.parseDicom),
    readCode: vi.fn(real.readCode),
  };
});

const TAG_METHOD_CODE_SEQUENCE = "00120064";

/** A stand-in for the reader's result, answering `(0012,0064)` with the given items. */
function readBack(items: readonly unknown[] | undefined): dicom.Dataset {
  return {
    get: (tag: string) =>
      tag === TAG_METHOD_CODE_SEQUENCE && items !== undefined ? { items } : undefined,
  } as unknown as dicom.Dataset;
}

/** Run one pass over an input built before any stand-in was set, and return what it threw. */
function refusal(input: dicom.Dataset): DeidError {
  let returned: unknown;
  let thrown: unknown;
  try {
    returned = deidentifyDicom(input);
  } catch (err) {
    thrown = err;
  }
  expect(returned).toBeUndefined();
  expect(thrown).toBeInstanceOf(DeidError);
  return thrown as DeidError;
}

beforeEach(() => {
  vi.mocked(dicom.serializeDicom).mockClear();
  vi.mocked(dicom.parseDicom).mockClear();
  vi.mocked(dicom.readCode).mockClear();
});

describe("the read-back of the coded declaration", () => {
  it("NON-VACUITY: an unaltered round trip returns the dataset and its one declared term", () => {
    const { deidentificationMethodCodes } = deidentifyDicom(buildPhiDataset());
    expect(deidentificationMethodCodes).toHaveLength(1);
    expect(dicom.serializeDicom).toHaveBeenCalledTimes(1);
  });

  it("refuses output whose re-read carries no method code sequence", () => {
    const input = buildPhiDataset();
    vi.mocked(dicom.parseDicom).mockReturnValueOnce(readBack(undefined));
    expect(refusal(input).code).toBe(FATAL_CODES.DEID_OUTPUT_INVALID);
  });

  it("refuses output whose re-read carries a different number of terms", () => {
    const input = buildPhiDataset();
    vi.mocked(dicom.parseDicom).mockReturnValueOnce(readBack([]));
    expect(refusal(input).code).toBe(FATAL_CODES.DEID_OUTPUT_INVALID);
  });

  it("refuses output whose re-read has a hole where a term should be", () => {
    const input = buildPhiDataset();
    vi.mocked(dicom.parseDicom).mockReturnValueOnce(readBack(new Array<unknown>(1)));
    expect(refusal(input).code).toBe(FATAL_CODES.DEID_OUTPUT_INVALID);
  });

  it("refuses output whose re-read term carries an altered meaning", () => {
    const input = buildPhiDataset();
    vi.mocked(dicom.parseDicom).mockReturnValueOnce(readBack([{}]));
    vi.mocked(dicom.readCode).mockReturnValueOnce({
      codeValue: "113100",
      codingSchemeDesignator: "DCM",
      codeMeaning: "ZZ Altered Meaning",
    });
    const err = refusal(input);
    expect(err.code).toBe(FATAL_CODES.DEID_OUTPUT_INVALID);
    expect(err.message).not.toContain("ZZ Altered Meaning");
  });

  it("passes one of this library's own fatals out unchanged rather than re-labelling it", () => {
    const input = buildPhiDataset();
    const own = new DeidError(FATAL_CODES.DEID_POSITIONS_UNENUMERABLE, "raised mid-write");
    vi.mocked(dicom.serializeDicom).mockImplementationOnce(() => {
      throw own;
    });
    expect(refusal(input)).toBe(own);
  });
});
