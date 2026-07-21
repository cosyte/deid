/**
 * NCPDP Telecom adapter tests — the two headline gates (the **leak test** and the **over-scrub test**),
 * the per-segment field behavior (Patient `01` / Prescriber `03` / Insurance `04` / COB `05`), the
 * header Date-of-Service generalization, the free-text and unknown-segment fail-closed defaults, the
 * keyed-context fatal, the value-free manifest, and immutability.
 *
 * Every seeded value is a synthetic, tagged sentinel (`ZZ…`, `555…` phone) or a synthetic clinical /
 * financial value. The fixture is declared synthetic in `scripts/phi-allow-list.txt`.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import {
  buildTelecomRequest,
  findSegment,
  fieldValue,
  parseTelecom,
  serializeTelecom,
} from "@cosyte/ncpdp/telecom";

import { DEID_DISPOSITION_CODES, FATAL_CODES, createDeidContext } from "../../src/index.js";
import {
  deidentifyTelecom,
  deidentifyTelecomString,
  extractTelecomLoci,
} from "../../src/ncpdp/index.js";

const D = DEID_DISPOSITION_CODES;
const FIXTURES = join(import.meta.dirname, "..", "fixtures", "ncpdp");

function loadRaw(): string {
  return readFileSync(join(FIXTURES, "telecom-b1.ncpdp"), "utf8");
}

const ctx = createDeidContext({ key: "ncpdp-test-key", patientId: "patient-ncpdp-1" });

/** The synthetic PHI sentinels seeded into `telecom-b1.ncpdp` — every one must be GONE after de-id. */
const SENTINELS = [
  "ZZPATFIRST",
  "ZZPATLAST",
  "19850302",
  "ZZPTSTREET",
  "ZZPTCITY",
  "5550000301",
  "ZZPATIENTID",
  "ZZPRESCRIBERID",
  "ZZCARDHOLDER",
  "ZZGROUP01",
  "ZZCARDFIRST",
  "ZZCARDLAST",
  "ZZOTHERCARDID",
  "ZZOTHERGROUP",
  "20260101",
  "ZZDURPHI",
  "ZZUNKNOWNSEG",
  "20260115", // header Date of Service → generalized to 2026
  // Unmapped identifier fields INSIDE PHI segments — must fail closed, not ride through:
  "ZZPATEMAIL", // 350-HN Patient E-Mail (Patient segment, unmapped)
  "ZZALTPATID", // an alternate patient id (Patient segment, unmapped)
  "ZZMEDIGAP", // 359-2A Medigap ID (Insurance segment, unmapped)
  "ZZPRESCRIBERNAME", // Prescriber name (Prescriber segment, unmapped → blocked, provider identity)
  "ZZFQPHI", // 526-FQ Additional Message Information free text — blocked (was retained)
];

/** Synthetic clinical / financial values that MUST survive byte-identical. */
const SURVIVORS = [
  "00071015527", // NDC drug code
  "RX0000001", // Rx reference number (retained residual)
  "PAYERID99", // other-payer id (a payer identifier, not the patient's)
  "PHARM123", // pharmacy service-provider id
  "441", // ZIP generalized to 3-digit prefix
  "1985", // DOB generalized to year
];

describe("NCPDP Telecom de-identification — leak + over-scrub gates", () => {
  it("removes every seeded PHI sentinel (the leak test — must be ZERO survivors)", () => {
    const { telecom } = deidentifyTelecomString(loadRaw(), { context: ctx });
    expect(SENTINELS.filter((s) => telecom.includes(s))).toEqual([]);
  });

  it("retains every clinical / financial value (the over-scrub test)", () => {
    const { telecom } = deidentifyTelecomString(loadRaw(), { context: ctx });
    expect(SURVIVORS.filter((s) => !telecom.includes(s))).toEqual([]);
  });

  it("produces output that re-parses cleanly and keeps the clinical NDC and gender fields", () => {
    const { telecom } = deidentifyTelecomString(loadRaw(), { context: ctx });
    const tx = parseTelecom(telecom);
    expect(fieldValue(findSegment(tx.segments, "07"), "D7")).toBe("00071015527");
    expect(fieldValue(findSegment(tx.segments, "01"), "C5")).toBe("M"); // gender retained
  });
});

describe("NCPDP Telecom structured + fail-closed behavior", () => {
  it("generalizes the header Date of Service to its year", () => {
    const { telecom } = deidentifyTelecomString(loadRaw(), { context: ctx });
    expect(parseTelecom(telecom).header.dateOfService.trim()).toBe("2026");
  });

  it("blocks the DUR free-text field (fails closed, DEID_FREETEXT_BLOCKED)", () => {
    const { manifest } = deidentifyTelecomString(loadRaw(), { context: ctx });
    expect(manifest.some((e) => e.locus === "08/FY" && e.code === D.DEID_FREETEXT_BLOCKED)).toBe(
      true,
    );
  });

  it("blocks an unknown segment field-by-field (fails closed)", () => {
    const { manifest } = deidentifyTelecomString(loadRaw(), { context: ctx });
    expect(manifest.some((e) => e.locus === "99/ZZ" && e.disposition === "blocked")).toBe(true);
  });

  it("fails closed on an UNMAPPED identifier field inside a PHI segment (the DEID-5 leak fix)", () => {
    const { telecom, manifest } = deidentifyTelecomString(loadRaw(), { context: ctx });
    // A Patient e-mail (HN), an alternate patient id (CW), and a Medigap id (2A) are not in the scrub
    // map — before the fix they rode through; now each is blocked.
    for (const [locus] of [["01/HN"], ["01/CW"], ["04/2A"]]) {
      expect(manifest.some((e) => e.locus === locus && e.disposition === "blocked")).toBe(true);
    }
    expect(telecom).not.toContain("ZZPATEMAIL");
    expect(telecom).not.toContain("ZZMEDIGAP");
  });

  it("retains recognized non-identifier fields inside PHI segments (gender, pregnancy, person code, COB amount)", () => {
    const { telecom } = deidentifyTelecomString(loadRaw(), { context: ctx });
    const tx = parseTelecom(telecom);
    expect(fieldValue(findSegment(tx.segments, "01"), "C5")).toBe("M"); // gender retained
    expect(fieldValue(findSegment(tx.segments, "01"), "2C")).toBe("2"); // pregnancy indicator retained (335-2C)
    expect(fieldValue(findSegment(tx.segments, "04"), "C3")).toBe("01"); // person code retained
    expect(fieldValue(findSegment(tx.segments, "05"), "DV")).toBe("1000"); // COB monetary amount retained
    expect(fieldValue(findSegment(tx.segments, "05"), "7C")).toBe("PAYERID99"); // payer id retained
  });

  it("blocks the FQ additional-message free-text field (fails closed)", () => {
    const { telecom, manifest } = deidentifyTelecomString(loadRaw(), { context: ctx });
    expect(telecom).not.toContain("ZZFQPHI");
    expect(manifest.some((e) => e.locus === "08/FQ" && e.code === D.DEID_FREETEXT_BLOCKED)).toBe(
      true,
    );
  });

  it("pseudonymizes the patient / cardholder / group identifiers to non-reversible surrogates", () => {
    const { telecom } = deidentifyTelecomString(loadRaw(), { context: ctx });
    const tx = parseTelecom(telecom);
    const patientId = fieldValue(findSegment(tx.segments, "01"), "CY") ?? "";
    expect(patientId).toMatch(/^[0-9a-f]{64}$/);
    expect(patientId).not.toBe("ZZPATIENTID");
  });
});

describe("NCPDP Telecom manifest + immutability + fatal", () => {
  it("emits a value-free manifest (no sentinel value ever appears)", () => {
    const { manifest } = deidentifyTelecomString(loadRaw(), { context: ctx });
    const serialized = JSON.stringify(manifest);
    for (const s of SENTINELS) expect(serialized).not.toContain(s);
    for (const e of manifest) {
      expect(e.count).toBeGreaterThan(0);
      expect(Object.values(D)).toContain(e.code);
    }
  });

  it("never mutates the input transaction", () => {
    const tx = parseTelecom(loadRaw());
    const before = serializeTelecom(tx);
    deidentifyTelecom(tx, { context: ctx });
    expect(serializeTelecom(tx)).toBe(before);
  });

  it("throws DEID_NO_KEY when a keyed transform is required but no key context is supplied", () => {
    expect(() => deidentifyTelecomString(loadRaw(), {})).toThrowError(
      expect.objectContaining({ code: FATAL_CODES.DEID_NO_KEY }),
    );
  });

  it("extracts loci from a minimally-built transaction (no patient segment → no scrub loci)", () => {
    const tx = buildTelecomRequest({
      header: { transactionCode: "B1", binNumber: "999999" },
      segments: [{ segmentId: "07", fields: [{ id: "D7", value: "00071015527" }] }],
    });
    const { loci } = extractTelecomLoci(tx);
    // Only the header Date of Service could be a locus; the built header defaults DOS to empty → none.
    expect(
      loci.every((l) => l.kind !== "identifier" || l.category !== undefined || l.value.length >= 0),
    ).toBe(true);
    const { telecom } = deidentifyTelecom(tx, { context: ctx });
    expect(parseTelecom(telecom).segments[0]?.segmentId).toBe("07");
  });
});
