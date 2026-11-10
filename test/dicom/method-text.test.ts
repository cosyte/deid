/**
 * **DICOM: the De-identification Method text written to `(0012,0063)` fits its VR.**
 *
 * PS3.6 lists `(0012,0063)` as `LO` with value multiplicity `1-n`, and PS3.5 Table 6.2-1 caps an `LO`
 * at 64 characters per Value, with the backslash (5CH) as the delimiter between Values and never part
 * of one. PS3.15 E.1.1 asks for "a text string describing the method used" there. So the text this
 * adapter writes is several Values, each one inside the cap, that together still say what was done:
 * the library, the profile, that only metadata was touched, and the policy that selected the label.
 *
 * The check reads the bytes back with `@cosyte/dicom`'s own parser and measures each Value, the way
 * the `DICOM_DEIDENT_METHOD_VALUE_OVER_LENGTH` disclosure measures it: in bytes, over the Value
 * Field split on 5CH, trailing padding ignored.
 *
 * Everything is synthetic and built in memory.
 */

import { parseDicom, serializeDicom, type Dataset } from "@cosyte/dicom";
import { describe, expect, it } from "vitest";

import { defineDeidPolicy } from "../../src/index.js";
import { deidentifyDicom, deidentifyDicomBuffer } from "../../src/dicom/index.js";
import { resolveDicomOptions } from "../../src/dicom/policy-map.js";
import { buildPhiDataset } from "./helpers/fixtures.js";

const TAG_METHOD_TEXT = "00120063";
const LO_VALUE_MAX = 64;
const OVER_LENGTH_CODE = "DICOM_DEIDENT_METHOD_VALUE_OVER_LENGTH";

/** The `(0012,0063)` Values of a dataset, split on 5CH with trailing SPACE and NUL trimmed. */
function methodValues(dataset: Dataset): string[] {
  const element = dataset.get(TAG_METHOD_TEXT);
  expect(element?.vr).toBe("LO");
  const text = element?.rawBytes.toString("latin1") ?? "";
  return text.split("\\").map((value) => value.replace(/[ \0]+$/u, ""));
}

/** Assert every Value fits an `LO` Value and none is empty. */
function expectFitsLo(values: readonly string[]): void {
  expect(values.length).toBeGreaterThan(1);
  for (const value of values) {
    expect(value.length, `"${value}" is over the LO maximum`).toBeLessThanOrEqual(LO_VALUE_MAX);
    expect(value.length).toBeGreaterThan(0);
  }
}

describe("(0012,0063) De-identification Method fits LO, 64 characters per Value", () => {
  it("writes the default method as several Values, each inside the cap, read back by @cosyte/dicom", () => {
    const { bytes, warnings } = deidentifyDicomBuffer(serializeDicom(buildPhiDataset()));
    const values = methodValues(parseDicom(bytes));

    expectFitsLo(values);
    expect(values).toEqual([
      "Cosyte @cosyte/deid",
      "PS3.15 Basic Application Level Confidentiality Profile",
      "metadata only",
      'policy "safe-harbor"',
    ]);
    expect(warnings.map((w) => w.code)).not.toContain(OVER_LENGTH_CODE);
  });

  it("keeps the in-memory entry point to the same Values", () => {
    const { dataset, warnings } = deidentifyDicom(buildPhiDataset());
    expectFitsLo(methodValues(dataset));
    expect(warnings.map((w) => w.code)).not.toContain(OVER_LENGTH_CODE);
  });

  it("bounds a custom policy name that is long, and keeps a backslash in it from splitting a Value", () => {
    const name = `research\\${"x".repeat(120)}`;
    const policy = defineDeidPolicy({ name });
    const { bytes, warnings } = deidentifyDicomBuffer(serializeDicom(buildPhiDataset()), {
      policy,
    });
    const values = methodValues(parseDicom(bytes));

    expectFitsLo(values);
    expect(values).toHaveLength(4);
    const policyValue = values[3] ?? "";
    expect(policyValue.length).toBe(LO_VALUE_MAX);
    expect(policyValue.startsWith('policy "research/xxx')).toBe(true);
    expect(policyValue.endsWith('..."')).toBe(true);
    expect(warnings.map((w) => w.code)).not.toContain(OVER_LENGTH_CODE);
  });

  it("writes a policy name that fits exactly as given", () => {
    const name = "r".repeat(LO_VALUE_MAX - 'policy ""'.length);
    const resolved = resolveDicomOptions({ policy: defineDeidPolicy({ name }) });
    const values = resolved.deidentificationMethod.split("\\");
    expect(values[3]).toBe(`policy "${name}"`);
    expect(values[3]?.length).toBe(LO_VALUE_MAX);
  });
});
