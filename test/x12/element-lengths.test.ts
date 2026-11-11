/**
 * The X12 element maxima the pass fits a written value to: every row is a length of at least 1, the
 * 004010 maximum is never longer than the 005010 one, and a group's version is read from `GS-08`.
 */

import { describe, expect, it } from "vitest";

import {
  X12_ELEMENT_MAX_LENGTHS,
  isX12Version5010OrLater,
  x12MaxLength,
} from "../../src/x12/element-lengths.js";

describe("the maxima table", () => {
  it("lists 004010 maxima no longer than the 005010 ones, each at least 1", () => {
    for (const [, row] of X12_ELEMENT_MAX_LENGTHS) {
      expect(row.v4010).toBeGreaterThanOrEqual(1);
      expect(row.v4010).toBeLessThanOrEqual(row.v5010);
    }
  });

  it("bounds a value written across elements by the shortest, and an unlisted element by 0", () => {
    expect(x12MaxLength("NM1", [3, 4, 5], true)).toBe(25);
    expect(x12MaxLength("NM1", [3, 4], false)).toBe(25);
    expect(x12MaxLength("NM1", [3], true)).toBe(60);
    expect(x12MaxLength("NM1", [3, 99], true)).toBe(0);
    expect(x12MaxLength("ZZZ", [1], true)).toBe(0);
    expect(x12MaxLength("NM1", [], true)).toBe(0);
  });

  it.each([
    ["005010X222A1", true],
    ["005010", true],
    ["006020X313", true],
    ["004010X098A1", false],
    ["003070", false],
    ["X", false],
    ["", false],
    ["00501", false],
    [undefined, false],
  ])("reads GS-08 %j as 005010 or later: %s", (gs08, expected) => {
    expect(isX12Version5010OrLater(gs08)).toBe(expected);
  });
});
