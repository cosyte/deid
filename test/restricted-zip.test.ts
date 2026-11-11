/**
 * The restricted three-digit ZIP list, pinned. §164.514(b)(2)(i)(B) keeps the initial three digits
 * of a ZIP only when, according to the current publicly available Census data, the area those digits
 * form holds more than 20,000 people. The list follows the 2020 Census (table P1 of the Demographic
 * and Housing Characteristics File, by five-digit ZCTA, summed over the first three digits), and keeps
 * the 17 prefixes the HHS guidance names from the 2000 Census, so no prefix the library generalized
 * before is kept now. A change to either half is a change to what a caller's output keeps, so it
 * moves this test on purpose.
 */

import { describe, expect, it } from "vitest";

import { RESTRICTED_ZIP3, RESTRICTED_ZIP3_SOURCE, generalizeZip } from "../src/index.js";

/** The prefixes whose 2020 Census population, summed over their five-digit ZCTAs, is 20,000 or less. */
const CENSUS_2020 = [
  "036",
  "059",
  "102",
  "202",
  "203",
  "204",
  "205",
  "369",
  "556",
  "692",
  "753",
  "772",
  "821",
  "823",
  "878",
  "879",
  "884",
  "893",
];

/** The 17 prefixes the HHS guidance lists from the 2000 Census. */
const HHS_2000 = [
  "036",
  "059",
  "063",
  "102",
  "203",
  "556",
  "692",
  "790",
  "821",
  "823",
  "830",
  "831",
  "878",
  "879",
  "884",
  "890",
  "893",
];

describe("the restricted three-digit ZIP list", () => {
  it("names the 2020 Census as its source", () => {
    expect(RESTRICTED_ZIP3_SOURCE.census).toBe("2020");
    expect(RESTRICTED_ZIP3_SOURCE.dataset).toBe(
      "2020 Census Demographic and Housing Characteristics File, table P1, by five-digit ZCTA",
    );
    expect(RESTRICTED_ZIP3_SOURCE.citation).toContain("164.514(b)(2)(i)(B)");
    expect(Object.isFrozen(RESTRICTED_ZIP3_SOURCE)).toBe(true);
  });

  it("is exactly the 2020 Census prefixes plus the 17 the HHS guidance lists", () => {
    const expected = [...new Set([...CENSUS_2020, ...HHS_2000])].sort();
    expect([...RESTRICTED_ZIP3].sort()).toEqual(expected);
    expect(RESTRICTED_ZIP3.size).toBe(23);
  });

  it("generalizes a ZIP in every prefix the 2020 Census adds to 000", () => {
    for (const prefix of ["202", "204", "205", "369", "753", "772"]) {
      expect(generalizeZip(`${prefix}01`)).toEqual({ value: "000", residual: false });
    }
  });

  it("still generalizes every prefix the HHS guidance lists to 000", () => {
    for (const prefix of HHS_2000) {
      expect(generalizeZip(`${prefix}45`)).toEqual({ value: "000", residual: false });
    }
  });

  it("keeps the three digits of a prefix just over the threshold in 2020", () => {
    // 576 held 20,310 people and 999 held 21,178 in the 2020 Census: both are kept.
    expect(generalizeZip("57601")).toEqual({ value: "576", residual: true });
    expect(generalizeZip("99901")).toEqual({ value: "999", residual: true });
  });
});
