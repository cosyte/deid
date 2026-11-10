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

/** Every byte that is a C0 or C1 control character or DEL: PS3.5 6.2 allows none of them in an `LO`. */
function controlBytes(dataset: Dataset): number[] {
  const raw = dataset.get(TAG_METHOD_TEXT)?.rawBytes ?? Buffer.alloc(0);
  return [...raw].filter((byte) => byte < 0x20 || (byte >= 0x7f && byte <= 0x9f));
}

/**
 * Every byte outside printable ASCII (20H to 7EH). The pass never sets Specific Character Set
 * (0008,0005), so the default repertoire (PS3.5 6.1.2.1) is the only one the method text can assume.
 */
function nonAsciiBytes(dataset: Dataset): number[] {
  const raw = dataset.get(TAG_METHOD_TEXT)?.rawBytes ?? Buffer.alloc(0);
  return [...raw].filter((byte) => byte < 0x20 || byte > 0x7e);
}

/** `a`, the character at `codePoint`, then `b`. */
function between(codePoint: number): string {
  return `a${String.fromCodePoint(codePoint)}b`;
}

describe("(0012,0063) carries a policy name only as characters an LO Value can hold", () => {
  // The method text is written as latin1, one byte per UTF-16 code unit, so a character above U+00FF
  // lands on the wire as its low byte: U+015C as 5CH, the delimiter, and U+0100 as NUL. A byte from
  // A0H to FFH is only a letter under a declared Specific Character Set, which the pass never sets.
  const cases: readonly { label: string; name: string; expected: string }[] = [
    { label: "U+015C, whose low byte is the delimiter", name: between(0x15c), expected: "a?b" },
    { label: "U+0100, whose low byte is NUL", name: between(0x100), expected: "a?b" },
    { label: "a newline", name: between(0x0a), expected: "a?b" },
    { label: "a NUL", name: between(0x00), expected: "a?b" },
    { label: "a backslash", name: between(0x5c), expected: "a/b" },
    { label: "DEL", name: between(0x7f), expected: "a?b" },
    { label: "a C1 control character", name: between(0x85), expected: "a?b" },
    { label: "a no-break space, U+00A0", name: between(0xa0), expected: "a?b" },
    { label: "a latin1 letter, U+00E9", name: between(0xe9), expected: "a?b" },
    { label: "U+00FF", name: between(0xff), expected: "a?b" },
    {
      label: "a character outside the BMP, as one character",
      name: between(0x1f600),
      expected: "a?b",
    },
  ];

  for (const { label, name, expected } of cases) {
    it(`writes a name holding ${label} as exactly four Values with no control character`, () => {
      const policy = defineDeidPolicy({ name });
      const { bytes, warnings } = deidentifyDicomBuffer(serializeDicom(buildPhiDataset()), {
        policy,
      });
      const dataset = parseDicom(bytes);
      const values = methodValues(dataset);

      expect(values).toHaveLength(4);
      expectFitsLo(values);
      expect(values[3]).toBe(`policy "${expected}"`);
      expect(controlBytes(dataset)).toEqual([]);
      expect(nonAsciiBytes(dataset)).toEqual([]);
      expect(warnings.map((w) => w.code)).not.toContain(OVER_LENGTH_CODE);
    });
  }

  it("keeps every printable ASCII character but the backslash as written", () => {
    const printable = Array.from({ length: 0x7f - 0x20 }, (_, i) => String.fromCharCode(0x20 + i))
      .filter((character) => character !== "\\")
      .join("");
    for (const part of [printable.slice(0, 40), printable.slice(40)]) {
      const resolved = resolveDicomOptions({ policy: defineDeidPolicy({ name: part }) });
      expect(resolved.deidentificationMethod.split("\\")[3]).toBe(`policy "${part}"`);
    }
  });

  it("measures a long name after mapping, so its Value is 64 characters on the wire", () => {
    const name = String.fromCodePoint(0x15c).repeat(40) + String.fromCodePoint(0x1f600).repeat(40);
    const policy = defineDeidPolicy({ name });
    const { bytes, warnings } = deidentifyDicomBuffer(serializeDicom(buildPhiDataset()), {
      policy,
    });
    const dataset = parseDicom(bytes);
    const values = methodValues(dataset);

    expect(values).toHaveLength(4);
    expect(values[3]).toBe(`policy "${"?".repeat(LO_VALUE_MAX - 'policy "..."'.length)}..."`);
    expect(values[3]?.length).toBe(LO_VALUE_MAX);
    expect(controlBytes(dataset)).toEqual([]);
    expect(nonAsciiBytes(dataset)).toEqual([]);
    expect(warnings.map((w) => w.code)).not.toContain(OVER_LENGTH_CODE);
  });
});
