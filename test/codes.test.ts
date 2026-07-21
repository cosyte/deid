/**
 * Stability tripwires for the public code + category surfaces. A rename/removal shows up as a failing
 * snapshot diff — a deliberate, reviewable breaking-change signal.
 */

import { describe, expect, it } from "vitest";
import { sortedCodeSet } from "@cosyte/test-utils";

import {
  DEID_DISPOSITION_CODES,
  FATAL_CODES,
  SAFE_HARBOR_CATEGORIES,
  SAFE_HARBOR_CATEGORY_META,
} from "../src/index.js";

describe("code surface stability", () => {
  it("fatal codes are stable", () => {
    expect(sortedCodeSet(FATAL_CODES)).toMatchInlineSnapshot(`
      [
        "DEID_NO_KEY",
        "DEID_POLICY_INVALID",
        "EMPTY_INPUT",
      ]
    `);
  });

  it("disposition codes are stable", () => {
    expect(sortedCodeSet(DEID_DISPOSITION_CODES)).toMatchInlineSnapshot(`
      [
        "DEID_CATEGORY_DATE_SHIFTED",
        "DEID_CATEGORY_GENERALIZED",
        "DEID_CATEGORY_HASHED",
        "DEID_CATEGORY_PSEUDONYMIZED",
        "DEID_CATEGORY_REMOVED",
        "DEID_FREETEXT_BLOCKED",
        "DEID_FREETEXT_CONSUMER_REDACTED",
        "DEID_LOCUS_BLOCKED",
        "DEID_RESIDUAL_RETAINED",
      ]
    `);
  });

  it("the 18 Safe Harbor categories are stable and completely described", () => {
    expect(sortedCodeSet(SAFE_HARBOR_CATEGORIES)).toMatchInlineSnapshot(`
      [
        "ACCOUNT",
        "BIOMETRIC",
        "CERTIFICATE_LICENSE",
        "DATES",
        "DEVICE",
        "EMAIL",
        "FAX",
        "FULL_FACE_PHOTO",
        "GEOGRAPHIC",
        "HEALTH_PLAN_BENEFICIARY",
        "IP_ADDRESS",
        "MRN",
        "NAMES",
        "OTHER_UNIQUE_ID",
        "PHONE",
        "SSN",
        "URL",
        "VEHICLE",
      ]
    `);
    // Every category has regulatory metadata (letter A–R, number 1–18).
    const letters = Object.values(SAFE_HARBOR_CATEGORY_META)
      .map((m) => m.letter)
      .sort();
    expect(letters).toEqual("ABCDEFGHIJKLMNOPQR".split(""));
    const numbers = Object.values(SAFE_HARBOR_CATEGORY_META)
      .map((m) => m.number)
      .sort((a, b) => a - b);
    expect(numbers).toEqual(Array.from({ length: 18 }, (_, i) => i + 1));
  });
});
