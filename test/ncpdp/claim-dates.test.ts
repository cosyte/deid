/**
 * **NCPDP Telecom: the dates of the Claim segment.** The Claim segment (`07`) is retained as a
 * structure (NDC, quantity, days supply), but two of its fields are dates of the individual's care:
 * `414-DE` Date Prescription Written and `457-EP` Associated Prescription/Service Date. Each is
 * handled the way the adapter already handles the header Date of Service and the other payer date
 * (`443-E8`): a date locus in the Safe Harbor dates category, generalized to its year under Safe
 * Harbor, and recorded in the manifest. Every other field of the Claim segment, and every field of the
 * Pricing segment (`11`), is still retained untouched and counted as an unexamined residual.
 *
 * Every value is synthetic: a made-up NDC, a made-up Rx number, and dates chosen for the test.
 */

import { buildTelecomRequest, findSegment, fieldValue, parseTelecom } from "@cosyte/ncpdp/telecom";
import { describe, expect, it } from "vitest";

import {
  createDeidContext,
  LIMITED_DATA_SET_PROFILE,
  profileOptions,
  SAFE_HARBOR_CATEGORIES,
} from "../../src/index.js";
import {
  deidentifyTelecom,
  extractTelecomLoci,
  TELECOM_RETAINED_SEGMENT_RULES,
} from "../../src/ncpdp/index.js";

const C = SAFE_HARBOR_CATEGORIES;

/** A B1 request with a dated Claim segment and a Pricing segment; every value synthetic. */
function claimRequest(claimFields: readonly { id: string; value: string }[] = []) {
  return buildTelecomRequest({
    header: { transactionCode: "B1", binNumber: "999999", dateOfService: "20250610" },
    segments: [
      {
        segmentId: "07",
        fields: [
          { id: "EM", value: "1" },
          { id: "D2", value: "900000001" },
          { id: "E1", value: "03" },
          { id: "D7", value: "99999000001" },
          { id: "E7", value: "30000" },
          { id: "D5", value: "30" },
          { id: "DE", value: "20250602" },
          { id: "EN", value: "900000000" },
          { id: "EP", value: "20250415" },
          ...claimFields,
        ],
      },
      {
        segmentId: "11",
        fields: [
          { id: "D9", value: "1500{" },
          { id: "DC", value: "250{" },
          { id: "DU", value: "1750{" },
        ],
      },
    ],
  });
}

describe("NCPDP Telecom Claim segment dates", () => {
  it("generalizes the Date Prescription Written (414-DE) to its year under Safe Harbor", () => {
    const { telecom, manifest } = deidentifyTelecom(claimRequest());
    expect(telecom).not.toContain("20250602");
    expect(fieldValue(findSegment(parseTelecom(telecom).segments, "07"), "DE")).toBe("2025");
    expect(manifest.some((e) => e.locus === "07/DE" && e.category === C.DATES)).toBe(true);
  });

  it("generalizes the Associated Prescription/Service Date (457-EP) to its year", () => {
    const { telecom, manifest } = deidentifyTelecom(claimRequest());
    expect(telecom).not.toContain("20250415");
    expect(fieldValue(findSegment(parseTelecom(telecom).segments, "07"), "EP")).toBe("2025");
    expect(manifest.some((e) => e.locus === "07/EP" && e.category === C.DATES)).toBe(true);
  });

  it("locates each as a date locus, not as a residual", () => {
    const { loci } = extractTelecomLoci(claimRequest());
    const de = loci.find((l) => l.path === "07/DE");
    const ep = loci.find((l) => l.path === "07/EP");
    expect(de).toMatchObject({ kind: "date", category: C.DATES, value: "20250602" });
    expect(ep).toMatchObject({ kind: "date", category: C.DATES, value: "20250415" });
    expect(de?.dateOfBirth).toBeUndefined();
    const { unexaminedResiduals } = deidentifyTelecom(claimRequest());
    const residualLoci = unexaminedResiduals.map((r) => r.locus);
    expect(residualLoci).not.toContain("07/DE");
    expect(residualLoci).not.toContain("07/EP");
  });

  it("treats each the way it treats the header Date of Service, under another profile too", () => {
    const ctx = createDeidContext({ key: "claim-dates-synthetic-key", patientId: "p-claim" });
    const { manifest } = deidentifyTelecom(
      claimRequest(),
      profileOptions(LIMITED_DATA_SET_PROFILE, ctx),
    );
    const header = manifest.find((e) => e.locus === "header/dateOfService");
    const de = manifest.find((e) => e.locus === "07/DE");
    const ep = manifest.find((e) => e.locus === "07/EP");
    expect(header).toBeDefined();
    for (const entry of [de, ep]) {
      expect(entry?.transform).toBe(header?.transform);
      expect(entry?.disposition).toBe(header?.disposition);
    }
  });

  it("keeps every other Claim field and every Pricing field untouched and counted", () => {
    const { telecom, unexaminedResiduals } = deidentifyTelecom(claimRequest());
    const segments = parseTelecom(telecom).segments;
    const claim = findSegment(segments, "07");
    expect(fieldValue(claim, "D2")).toBe("900000001");
    expect(fieldValue(claim, "D7")).toBe("99999000001");
    expect(fieldValue(claim, "EN")).toBe("900000000");
    expect(fieldValue(findSegment(segments, "11"), "DU")).toBe("1750{");
    const residualLoci = unexaminedResiduals.map((r) => r.locus);
    for (const locus of ["07/D2", "07/D7", "07/EN", "11/D9", "11/DC", "11/DU"]) {
      expect(residualLoci).toContain(locus);
    }
  });

  it("names exactly the two Claim dates in the retained-segment rules", () => {
    expect(Object.keys(TELECOM_RETAINED_SEGMENT_RULES).sort()).toEqual(["07", "24"]);
    expect(Object.keys(TELECOM_RETAINED_SEGMENT_RULES["07"] ?? {}).sort()).toEqual(["DE", "EP"]);
  });
});
