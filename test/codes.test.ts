/**
 * Stability tripwires for the public code + category surfaces. A rename/removal shows up as a failing
 * snapshot diff: a deliberate, reviewable breaking-change signal.
 */

import { describe, expect, it } from "vitest";
import { sortedCodeSet } from "@cosyte/test-utils";
import { parseHL7 } from "@cosyte/hl7";

import {
  buildExpertDeterminationSupportReport,
  DEID_DISPOSITION_CODES,
  FATAL_CODES,
  SAFE_HARBOR_CATEGORIES,
  SAFE_HARBOR_CATEGORY_META,
  type DeidManifestEntry,
} from "../src/index.js";
import { deidentifyHl7 } from "../src/hl7/index.js";

describe("code surface stability", () => {
  // `DEID_OUTPUT_INVALID` and `DEID_POSITIONS_UNENUMERABLE` are ADDITIONS, deliberately reviewed here:
  // nothing was renamed and nothing was removed, so a consumer branching on any existing code is
  // unaffected. The first carries the fail-closed outcome for a transformed document that no longer
  // round-trips through its own parser; the second the fail-closed outcome for a structure whose
  // value-bearing positions cannot be enumerated, where a zero or a partial count would read as a
  // measurement nobody can qualify.
  it("fatal codes are stable", () => {
    expect(sortedCodeSet(FATAL_CODES)).toMatchInlineSnapshot(`
      [
        "DEID_CONTEXT_INVALID",
        "DEID_NO_KEY",
        "DEID_OUTPUT_INVALID",
        "DEID_POLICY_INVALID",
        "DEID_POSITIONS_UNENUMERABLE",
        "DEID_PROFILE_INVALID",
        "EMPTY_INPUT",
      ]
    `);
  });

  // `DEID_POSITION_UNEXAMINED` is an ADDITION, reviewed here for the same reason: no existing code
  // changed name or meaning, and in particular `DEID_RESIDUAL_RETAINED` still means a residual of a
  // value the pass EXAMINED. The new code is its opposite, a position no locus rule reached, and it
  // exists precisely so the two can never be read as the same fact.
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
        "DEID_PARTY_ROLE_RETAINED",
        "DEID_POSITION_UNEXAMINED",
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

/**
 * The registries are **additions-only**, and a snapshot proves only that the *names* survived. What a
 * consumer actually branches on is what a code MEANS, so the one code this change could plausibly have
 * re-meant is pinned by behaviour instead of by spelling.
 *
 * `DEID_RESIDUAL_RETAINED` is the residual of a value the pass EXAMINED (a kept year, a safe 3-digit ZIP
 * prefix, a whole value a retention class kept), and it is the input to the determiner's
 * retained-quasi-identifier inventory. Reusing it for a position nothing examined would have corrupted
 * that inventory silently, which is why an unexamined position gets its own code and its own list.
 */
describe("no published code was re-meant", () => {
  const EXAMINED_RESIDUAL: DeidManifestEntry = {
    category: SAFE_HARBOR_CATEGORIES.DATES,
    transform: "generalize",
    locus: "PID-7",
    count: 1,
    disposition: "transformed",
    code: DEID_DISPOSITION_CODES.DEID_RESIDUAL_RETAINED,
    reidentificationCode: false,
  };

  it("DEID_RESIDUAL_RETAINED still means a residual of an EXAMINED value, and still drives that inventory", () => {
    const report = buildExpertDeterminationSupportReport([EXAMINED_RESIDUAL], {
      unexaminedResiduals: [],
    });
    expect(report.retainedQuasiIdentifiers).toEqual([
      { locus: "PID-7", category: SAFE_HARBOR_CATEGORIES.DATES, count: 1, transform: "generalize" },
    ]);
    expect(report.dispositionSummary.residualRetained).toBe(1);
  });

  it("an unexamined position carries the NEW code and never the residual one", () => {
    const { unexaminedResiduals } = deidentifyHl7(
      parseHL7(["MSH|^~\\&|A|B|C|D|20240315103000||ADT^A01|M1|P|2.5.1", "PV1|1|I"].join("\r")),
      {},
    );
    expect(unexaminedResiduals.length).toBeGreaterThan(0);
    for (const residual of unexaminedResiduals) {
      expect(residual.code).toBe(DEID_DISPOSITION_CODES.DEID_POSITION_UNEXAMINED);
      expect(residual.code).not.toBe(DEID_DISPOSITION_CODES.DEID_RESIDUAL_RETAINED);
      expect(residual.examined).toBe(false);
    }
  });

  it("and it never joins the retained-quasi-identifier inventory", () => {
    const report = buildExpertDeterminationSupportReport([], {
      unexaminedResiduals: [
        {
          locus: "PV1-8.1",
          count: 1,
          examined: false,
          locusWithheld: false,
          code: DEID_DISPOSITION_CODES.DEID_POSITION_UNEXAMINED,
        },
      ],
    });
    expect(report.retainedQuasiIdentifiers).toEqual([]);
    expect(report.dispositionSummary.residualRetained).toBe(0);
    expect(report.unexaminedResiduals.map((r) => r.locus)).toEqual(["PV1-8.1"]);
  });
});
