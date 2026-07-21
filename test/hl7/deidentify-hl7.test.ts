/**
 * HL7 v2 adapter tests — the two headline gates (the **leak test** and the **over-scrub test**), the
 * per-category structured behavior, the free-text / Z-segment fail-closed defaults, the keyed-context
 * fatal, and immutability.
 *
 * Every value is a synthetic, tagged sentinel (`ZZ…`, invalid `9xxxxxxxx` SSN shapes, `555…` phones) or
 * a synthetic clinical value. Fixtures are declared synthetic in `scripts/phi-allow-list.txt`.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import { parseHL7 } from "@cosyte/hl7";

import {
  DEID_DISPOSITION_CODES,
  FATAL_CODES,
  SAFE_HARBOR_CATEGORIES,
  createDeidContext,
  defineDeidPolicy,
} from "../../src/index.js";
import { deidentifyHl7 } from "../../src/hl7/index.js";

const C = SAFE_HARBOR_CATEGORIES;
const D = DEID_DISPOSITION_CODES;
const FIXTURES = join(import.meta.dirname, "..", "fixtures", "hl7");

/** Load a fixture and normalize its line endings to HL7 `\r` segment separators. */
function loadFixture(name: string): string {
  return readFileSync(join(FIXTURES, `${name}.hl7`), "utf8")
    .trim()
    .split(/\r?\n/)
    .join("\r");
}

const ctx = createDeidContext({ key: "hl7-test-key", patientId: "patient-1" });

/**
 * The patient / relative / guarantor / insured PHI sentinels seeded across `adt-a01.hl7`. Every one
 * must be GONE after a de-id pass. (Retained-by-design values — the MSH/EVN envelope timestamps, the
 * PV1 provider, the insurer org name/address, the OBR order numbers — are deliberately not `ZZ`-tagged
 * and are not in this list; provider/order loci are an explicit Phase-2 scope boundary.)
 */
const ADT_SENTINELS: readonly string[] = [
  "ZZMRN001",
  "900000001",
  "ZZACCT001",
  "ZZFAMILY",
  "ZZGIVEN",
  "ZZMOTHERMAIDEN",
  "19900215",
  "ZZALIAS",
  "ZZSTREET",
  "ZZCITY",
  "90210",
  "5550000001",
  "ZZACCT018",
  "900000005",
  "ZZDL001",
  "ZZMOTHERID001",
  "ZZBIRTHPLACE",
  "20211130",
  "ZZNKFAMILY",
  "ZZNKGIVEN",
  "ZZNKSTREET",
  "ZZNKCITY",
  "03601",
  "5550000003",
  "5550000004",
  "ZZGTNUM001",
  "ZZGTFAMILY",
  "ZZGTGIVEN",
  "ZZGTSPOUSE",
  "ZZGTSTREET",
  "ZZGTCITY",
  "10001",
  "5550000005",
  "5550000006",
  "19850302",
  "900000006",
  "ZZGTEMPLOYERID",
  "ZZGROUP001",
  "ZZINSURED",
  "ZZINSGIVEN",
  "19850303",
  "ZZINSSTREET",
  "ZZINSCITY",
  "55901",
  "ZZPOLICY001",
  "ZZMEMBER001",
  "900000007",
  "ZZEMPLOYERINC",
  "ZZMEDICARE001",
  "ZZMEDICAIDCASE001",
  "ZZMEDICAIDNAME",
  "ZZCUSTOM001",
  "ZZSECRETNOTE",
  "ZZEXTRAID001",
];

/** The sentinels seeded across `oru-r01.hl7` (patient demographics + free-text embeds). */
const ORU_SENTINELS: readonly string[] = [
  "ZZMRN002",
  "ZZLABFAMILY",
  "ZZLABGIVEN",
  "19850302",
  "ZZLABSTREET",
  "ZZLABCITY",
  "90210",
  "5550000010",
  "ZZACCT200",
  "900000010",
];

describe("deidentifyHl7 — the leak test (zero surviving sentinels)", () => {
  it("removes every seeded PHI sentinel across PID/NK1/GT1/IN1/IN2 + free text + Z-segment (ADT^A01)", () => {
    const wire = deidentifyHl7(parseHL7(loadFixture("adt-a01")), {
      context: ctx,
    }).document.toString();
    const survivors = ADT_SENTINELS.filter((s) => wire.includes(s));
    expect(survivors).toEqual([]);
  });

  it("removes every seeded PHI sentinel, including PHI embedded in OBX-5/NTE free text (ORU^R01)", () => {
    const wire = deidentifyHl7(parseHL7(loadFixture("oru-r01")), {
      context: ctx,
    }).document.toString();
    const survivors = ORU_SENTINELS.filter((s) => wire.includes(s));
    expect(survivors).toEqual([]);
  });
});

describe("deidentifyHl7 — the over-scrub test (clinical values survive byte-identical)", () => {
  it("retains OBX values, units, codes, statuses, and reference ranges unchanged (ORU^R01)", () => {
    const original = parseHL7(loadFixture("oru-r01"));
    const { document } = deidentifyHl7(original, { context: ctx });
    // Sodium + potassium numeric results, their units, LOINC codes, status, and reference range.
    const clinical = [
      "OBX[0].5", // NM sodium value
      "OBX[0].6", // units
      "OBX[0].7", // reference range
      "OBX[0].3.1", // LOINC observation identifier
      "OBX[0].11", // result status
      "OBX[1].5", // NM potassium value
      "OBX[1].6",
      "OBX[1].3.1",
      "OBX[2].3.1", // CWE ABO group code
      "OBX[2].5.2", // CWE ABO group text
    ];
    for (const path of clinical) {
      expect(document.get(path)).toBe(original.get(path));
    }
    // The structured clinical OBX-5 values (NM sodium/potassium, CWE ABO group) are NOT acted on.
    const { manifest } = deidentifyHl7(original, { context: ctx });
    const clinicalLoci = manifest.filter((m) =>
      ["OBX-5", "OBX[1]-5", "OBX[2]-5"].includes(m.locus),
    );
    expect(clinicalLoci).toEqual([]);
  });
});

describe("deidentifyHl7 — structured per-category behavior", () => {
  it("pseudonymizes the MRN (keeping the assigning authority) and redacts the SSN in a PID-3 list", () => {
    const msg = parseHL7(
      "MSH|^~\\&|A|B|C|D|20200101||ADT^A01|M1|P|2.5\rPID|1||ZZMRN001^^^HOSP^MR~900000001^^^SSA^SS",
    );
    const { document, manifest } = deidentifyHl7(msg, { context: ctx });
    // MRN (CX.1) → HMAC surrogate; assigning authority + type code retained.
    expect(document.get("PID.3[0].1")).toMatch(/^[0-9a-f]{64}$/);
    expect(document.get("PID.3[0].4")).toBe("HOSP");
    expect(document.get("PID.3[0].5")).toBe("MR");
    // SSN-typed identifier (CX.5 = SS) redacted, not pseudonymized.
    expect(document.get("PID.3[1].1")).toBe("");
    expect(manifest.find((m) => m.locus === "PID-3[0]")?.category).toBe(C.MRN);
    expect(manifest.find((m) => m.locus === "PID-3[1]")?.category).toBe(C.SSN);
  });

  it("generalizes a DOB to its year (residual retained for the actual-knowledge test)", () => {
    const msg = parseHL7(
      "MSH|^~\\&|A|B|C|D|20200101||ADT^A01|M1|P|2.5\rPID|1||ZZMRN001^^^HOSP^MR||ZZFAM^ZZGIV||19850302",
    );
    const { document, manifest } = deidentifyHl7(msg, { context: ctx });
    expect(document.get("PID.7.1")).toBe("1985");
    expect(manifest.find((m) => m.locus === "PID-7")?.code).toBe(D.DEID_RESIDUAL_RETAINED);
  });

  it("generalizes an address ZIP to its safe 3-digit form and drops street/city (residual)", () => {
    const msg = parseHL7(
      "MSH|^~\\&|A|B|C|D|20200101||ADT^A01|M1|P|2.5\rPID|1||ZZMRN001^^^HOSP^MR||||||||ZZSTREET^^ZZCITY^MA^90210",
    );
    const { document } = deidentifyHl7(msg, { context: ctx });
    expect(document.get("PID.11.5")).toBe("902");
    expect(document.get("PID.11.1")).toBe(""); // street dropped
    expect(document.get("PID.11.3")).toBe(""); // city dropped
  });

  it("fully suppresses a restricted-prefix ZIP to 000 (no residual)", () => {
    const msg = parseHL7(
      "MSH|^~\\&|A|B|C|D|20200101||ADT^A01|M1|P|2.5\rPID|1||ZZMRN001^^^HOSP^MR||||||||ZZSTREET^^ZZCITY^NH^03601",
    );
    const { document, manifest } = deidentifyHl7(msg, { context: ctx });
    expect(document.get("PID.11.5")).toBe("000");
    expect(manifest.find((m) => m.locus === "PID-11[0]")?.code).toBe(D.DEID_CATEGORY_GENERALIZED);
  });

  it("fails closed when an address has no generalizable ZIP (whole address dropped, blocked)", () => {
    const msg = parseHL7(
      "MSH|^~\\&|A|B|C|D|20200101||ADT^A01|M1|P|2.5\rPID|1||ZZMRN001^^^HOSP^MR||||||||ZZSTREET^^ZZCITY^MA",
    );
    const { document, manifest } = deidentifyHl7(msg, { context: ctx });
    expect(document.get("PID.11.1")).toBeUndefined();
    expect(document.get("PID.11.3")).toBeUndefined();
    expect(manifest.find((m) => m.locus === "PID-11[0]")?.disposition).toBe("blocked");
  });

  it("removes a name field entirely, including an unexpected extra repetition (adversarial)", () => {
    // A name hidden in a second repetition of PID-5 must not survive.
    const msg = parseHL7(
      "MSH|^~\\&|A|B|C|D|20200101||ADT^A01|M1|P|2.5\rPID|1||ZZMRN001^^^HOSP^MR||ZZFAM^ZZGIV~ZZHIDDENALIAS^ZZHIDDENGIVEN",
    );
    const wire = deidentifyHl7(msg, { context: ctx }).document.toString();
    expect(wire.includes("ZZFAM")).toBe(false);
    expect(wire.includes("ZZHIDDENALIAS")).toBe(false);
    expect(wire.includes("ZZHIDDENGIVEN")).toBe(false);
  });

  it("routes CX-5 identifier type codes to the right category (SS/MR/AN/MA/DL)", () => {
    const msg = parseHL7(
      "MSH|^~\\&|A|B|C|D|20200101||ADT^A01|M1|P|2.5\r" +
        "PID|1||I1^^^H^MR~I2^^^H^SS~I3^^^H^AN~I4^^^H^MA~I5^^^H^DL",
    );
    const { manifest } = deidentifyHl7(msg, { context: ctx });
    const cat = (locus: string) => manifest.find((m) => m.locus === locus)?.category;
    expect(cat("PID-3[0]")).toBe(C.MRN);
    expect(cat("PID-3[1]")).toBe(C.SSN);
    expect(cat("PID-3[2]")).toBe(C.ACCOUNT);
    expect(cat("PID-3[3]")).toBe(C.HEALTH_PLAN_BENEFICIARY);
    expect(cat("PID-3[4]")).toBe(C.CERTIFICATE_LICENSE);
  });
});

describe("deidentifyHl7 — fail closed on free text and unknown structure", () => {
  it("retains a numeric OBX-5 (NM) but fails closed on narrative (TX), String (ST), and empty OBX-2", () => {
    const msg = parseHL7(
      "MSH|^~\\&|A|B|C|D|20200101||ORU^R01|M1|P|2.5\r" +
        "OBX|1|NM|1^x^L||140|mg||||F\r" +
        "OBX|2|TX|2^note^L||free text ZZLEAKTX here||||F\r" +
        "OBX|3|ST|3^s^L||string ZZLEAKST here||||F\r" +
        "OBX|4||4^u^L||untyped ZZLEAKEMPTY here||||F",
    );
    const { document, manifest } = deidentifyHl7(msg, { context: ctx });
    expect(document.get("OBX[0].5")).toBe("140"); // structured numeric survives
    expect(document.get("OBX[1].5")).toBeUndefined(); // narrative TX blocked
    expect(document.get("OBX[2].5")).toBeUndefined(); // ambiguous ST blocked (fail closed)
    expect(document.get("OBX[3].5")).toBeUndefined(); // empty/unknown OBX-2 blocked (fail closed)
    expect(manifest.filter((m) => m.code === D.DEID_FREETEXT_BLOCKED)).toHaveLength(3);
    const wire = document.toString();
    for (const s of ["ZZLEAKTX", "ZZLEAKST", "ZZLEAKEMPTY"]) expect(wire.includes(s)).toBe(false);
  });

  it("blocks NTE-3 comments by default", () => {
    const msg = parseHL7(
      "MSH|^~\\&|A|B|C|D|20200101||ORU^R01|M1|P|2.5\rNTE|1||comment naming ZZLEAKNTE",
    );
    const { document, manifest } = deidentifyHl7(msg, { context: ctx });
    expect(document.get("NTE.3")).toBeUndefined();
    expect(manifest.find((m) => m.locus === "NTE-3")?.code).toBe(D.DEID_FREETEXT_BLOCKED);
  });

  it("fails closed on every populated field of a Z-segment (unknown structure)", () => {
    const msg = parseHL7("MSH|^~\\&|A|B|C|D|20200101||ADT^A01|M1|P|2.5\rZPI|ZZKEEP1|ZZKEEP2");
    const { document, manifest } = deidentifyHl7(msg, { context: ctx });
    expect(document.get("ZPI.1")).toBeUndefined();
    expect(document.get("ZPI.2")).toBeUndefined();
    expect(
      manifest
        .filter((m) => m.locus.startsWith("ZPI"))
        .every((m) => m.code === D.DEID_LOCUS_BLOCKED),
    ).toBe(true);
  });

  it("fails closed on a KNOWN segment carrying patient identity but absent from the map (MRG merge)", () => {
    // A merge/move ADT carries the patient's PRIOR name + MRN in MRG — patient PHI, not provider.
    // MRG is a recognized segment but not on the retain-list, so it must block, not pass through.
    const msg = parseHL7(
      "MSH|^~\\&|A|B|C|D|20200101||ADT^A40|M1|P|2.5\r" +
        "PID|1||NEWMRN^^^H^MR||ZZSURVIVOR^ZZJANE||19800101|F\r" +
        "MRG|ZZPRIORMRN^^^H^MR|||||ZZPRIORACCT|ZZPRIORNAME^ZZPRIORGIVEN",
    );
    const { document, manifest } = deidentifyHl7(msg, { context: ctx });
    const wire = document.toString();
    for (const s of ["ZZPRIORMRN", "ZZPRIORACCT", "ZZPRIORNAME", "ZZPRIORGIVEN"]) {
      expect(wire.includes(s)).toBe(false);
    }
    expect(manifest.filter((m) => m.locus.startsWith("MRG")).length).toBeGreaterThan(0);
  });

  it("fails closed on a relative segment (FAM family history) absent from the retain-list", () => {
    const msg = parseHL7("MSH|^~\\&|A|B|C|D|20200101||ADT^A01|M1|P|2.5\rFAM|1|ZZRELATIVEPHI");
    const wire = deidentifyHl7(msg, { context: ctx }).document.toString();
    expect(wire.includes("ZZRELATIVEPHI")).toBe(false);
  });

  it("leaves recognized clinical/administrative segments (PV1) untouched — retain-list, not blanket-scrub", () => {
    const msg = parseHL7("MSH|^~\\&|A|B|C|D|20200101||ADT^A01|M1|P|2.5\rPV1|1|I|WARD^ROOM^BED");
    const { document, manifest } = deidentifyHl7(msg, { context: ctx });
    expect(document.get("PV1.3.1")).toBe("WARD");
    expect(manifest.filter((m) => m.locus.startsWith("PV1"))).toEqual([]);
  });
});

describe("deidentifyHl7 — fatal + policy + immutability", () => {
  it("throws DEID_NO_KEY when the message needs a keyed transform but no context is supplied", () => {
    const msg = parseHL7("MSH|^~\\&|A|B|C|D|20200101||ADT^A01|M1|P|2.5\rPID|1||ZZMRN001^^^HOSP^MR");
    expect(() => deidentifyHl7(msg, {})).toThrowError(
      expect.objectContaining({ code: FATAL_CODES.DEID_NO_KEY }),
    );
  });

  it("date-shifts under an Expert-Determination policy while preserving intervals", () => {
    const shift = defineDeidPolicy({ name: "research", transforms: { [C.DATES]: "date-shift" } });
    const msg = parseHL7(
      "MSH|^~\\&|A|B|C|D|20200101||ADT^A01|M1|P|2.5\r" +
        "PID|1||ZZMRN001^^^HOSP^MR||ZZF^ZZG||20200110\r" +
        "PID|2||ZZMRN002^^^HOSP^MR||ZZF2^ZZG2||20200210",
    );
    const { document, manifest } = deidentifyHl7(msg, { policy: shift, context: ctx });
    // date-shift re-emits HL7 `YYYYMMDD`; parse both and confirm the 31-day interval is preserved.
    const toEpoch = (s: string) =>
      Date.UTC(Number(s.slice(0, 4)), Number(s.slice(4, 6)) - 1, Number(s.slice(6, 8)));
    const a = toEpoch(document.get("PID[0].7.1") as string);
    const b = toEpoch(document.get("PID[1].7.1") as string);
    expect((b - a) / 86_400_000).toBe(31);
    expect(document.get("PID[0].7.1")).not.toBe("20200110"); // actually shifted
    expect(manifest.find((m) => m.locus === "PID-7")?.code).toBe(D.DEID_CATEGORY_DATE_SHIFTED);
  });

  it("never mutates the input message", () => {
    const msg = parseHL7(
      "MSH|^~\\&|A|B|C|D|20200101||ADT^A01|M1|P|2.5\rPID|1||ZZMRN001^^^HOSP^MR||ZZFAM^ZZGIV",
    );
    const before = msg.toString();
    deidentifyHl7(msg, { context: ctx });
    expect(msg.toString()).toBe(before);
  });

  it("defaults to the Safe Harbor policy when options are omitted (no keyed categories present)", () => {
    const msg = parseHL7(
      "MSH|^~\\&|A|B|C|D|20200101||ADT^A01|M1|P|2.5\rPID|1||||ZZFAM^ZZGIV||19850302",
    );
    const { document, manifest } = deidentifyHl7(msg);
    expect(document.get("PID.5.1")).toBeUndefined();
    expect(document.get("PID.7.1")).toBe("1985");
    expect(manifest.length).toBeGreaterThan(0);
  });

  it("returns an empty manifest for a message with no PHI loci", () => {
    const msg = parseHL7("MSH|^~\\&|A|B|C|D|20200101||ACK|M1|P|2.5\rMSA|AA|M1");
    const { manifest } = deidentifyHl7(msg, { context: ctx });
    expect(manifest).toEqual([]);
  });
});
