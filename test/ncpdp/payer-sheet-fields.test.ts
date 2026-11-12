/**
 * **NCPDP Telecom: three fields placed by public payer sheets.** The Claim segment (`07`) and the
 * Clinical segment (`13`) are kept as structures, and three of their fields used to leave the pass
 * unchanged, counted only as unexamined residuals, because no field table we held placed them. Public
 * Medicaid payer sheets name them:
 *
 * - `454-EK` Scheduled Prescription ID Number, Claim segment: the identifier of one scheduled
 *   (controlled) drug prescription, so it is removed and recorded;
 * - `330-CW` Alternate ID, Claim segment: an alternate reference to the claim or member (one sheet
 *   says Medicare's reference number on a crossover claim), so it is removed and recorded;
 * - `494-ZE` Measurement Date, Clinical segment, `CCYYMMDD`: the date a measurement of the patient
 *   was taken, so it is generalized to the year under Safe Harbor and shifted under a profile that
 *   shifts dates, like the other dates of the individual's care.
 *
 * Every value is synthetic: made-up identifiers, codes and dates chosen for the test.
 */

import {
  buildTelecomRequest,
  fieldValue,
  findSegment,
  parseTelecom,
  type TelecomTransaction,
} from "@cosyte/ncpdp/telecom";
import { describe, expect, it } from "vitest";

import {
  createDeidContext,
  LIMITED_DATA_SET_PROFILE,
  profileOptions,
  SAFE_HARBOR_CATEGORIES,
} from "../../src/index.js";
import { deidentifyTelecom, TELECOM_RETAINED_SEGMENT_RULES } from "../../src/ncpdp/index.js";

const C = SAFE_HARBOR_CATEGORIES;

/** A B1 request with a Claim segment carrying both identifiers and a Clinical segment with two dates. */
function request(): TelecomTransaction {
  return buildTelecomRequest({
    header: { transactionCode: "B1", binNumber: "999999", dateOfService: "20250610" },
    segments: [
      {
        segmentId: "07",
        fields: [
          { id: "EM", value: "1" },
          { id: "D2", value: "900000201" },
          { id: "D7", value: "99999000201" },
          { id: "EK", value: "ZZSCHEDRXID02" },
          { id: "CW", value: "ZZCLAIMALTID02" },
          { id: "D5", value: "30" },
        ],
      },
      {
        segmentId: "13",
        fields: [
          { id: "XE", value: "2" },
          { id: "ZE", value: "20250301" },
          { id: "H1", value: "0930" },
          { id: "ZE", value: "20250307" },
          { id: "H1", value: "1015" },
        ],
      },
    ],
  });
}

const residualLoci = (tx: TelecomTransaction): string[] =>
  deidentifyTelecom(tx).unexaminedResiduals.map((r) => r.locus);

describe("the Claim segment's Scheduled Prescription ID Number (454-EK) and Alternate ID (330-CW)", () => {
  it("removes each value from the output and records it in the manifest", () => {
    const { telecom, manifest } = deidentifyTelecom(request());
    expect(telecom).not.toContain("ZZSCHEDRXID02");
    expect(telecom).not.toContain("ZZCLAIMALTID02");
    expect(manifest.some((e) => e.locus === "07/EK")).toBe(true);
    expect(manifest.some((e) => e.locus === "07/CW")).toBe(true);
  });

  it("no longer counts either as an unexamined residual", () => {
    const loci = residualLoci(request());
    expect(loci).not.toContain("07/EK");
    expect(loci).not.toContain("07/CW");
  });

  it("keeps the rest of the Claim segment byte for byte", () => {
    const { telecom } = deidentifyTelecom(request());
    const claim = findSegment(parseTelecom(telecom).segments, "07");
    expect(fieldValue(claim, "D7")).toBe("99999000201");
    expect(fieldValue(claim, "D5")).toBe("30");
    expect(fieldValue(claim, "D2")).toBe("900000201");
  });

  it("removes them under a profile that keeps identifiers as surrogates, too", () => {
    const shiftCtx = createDeidContext({ key: "payer-sheet-lds-key", patientId: "p-sheet" });
    const { telecom } = deidentifyTelecom(
      request(),
      profileOptions(LIMITED_DATA_SET_PROFILE, shiftCtx),
    );
    expect(telecom).not.toContain("ZZSCHEDRXID02");
    expect(telecom).not.toContain("ZZCLAIMALTID02");
  });

  it("is a removal rule of the kept Claim segment", () => {
    expect(TELECOM_RETAINED_SEGMENT_RULES["07"]?.["EK"]).toEqual({ mode: "block" });
    expect(TELECOM_RETAINED_SEGMENT_RULES["07"]?.["CW"]).toEqual({ mode: "block" });
  });
});

describe("the Clinical segment's Measurement Date (494-ZE)", () => {
  it("cuts every Measurement Date to its year under Safe Harbor and records it as a date", () => {
    const { telecom, manifest } = deidentifyTelecom(request());
    expect(telecom).not.toContain("20250301");
    expect(telecom).not.toContain("20250307");
    const clinical = findSegment(parseTelecom(telecom).segments, "13");
    const dates = clinical?.fields.filter((f) => f.id === "ZE").map((f) => f.value);
    expect(dates).toEqual(["2025", "2025"]);
    expect(manifest.some((e) => e.locus === "13/ZE" && e.category === C.DATES)).toBe(true);
    expect(residualLoci(request())).not.toContain("13/ZE");
  });

  it("keeps the measurement counter and times, counted as residuals", () => {
    const { telecom, unexaminedResiduals } = deidentifyTelecom(request());
    const clinical = findSegment(parseTelecom(telecom).segments, "13");
    expect(fieldValue(clinical, "XE")).toBe("2");
    expect(unexaminedResiduals.map((r) => r.locus)).toContain("13/H1");
  });

  it("is shifted like the other dates under a profile that shifts dates", () => {
    const shiftCtx = createDeidContext({ key: "payer-sheet-shift-key", patientId: "p-sheet" });
    const { manifest } = deidentifyTelecom(
      request(),
      profileOptions(LIMITED_DATA_SET_PROFILE, shiftCtx),
    );
    const ze = manifest.find((e) => e.locus === "13/ZE");
    expect(ze?.category).toBe(C.DATES);
    expect(ze?.transform).toBe("date-shift");
  });

  it("is a date rule of the kept Clinical segment, not of a date of birth", () => {
    expect(TELECOM_RETAINED_SEGMENT_RULES["13"]?.["ZE"]).toEqual({
      mode: "date",
      category: C.DATES,
    });
  });
});
