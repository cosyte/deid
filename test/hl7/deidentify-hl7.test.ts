/**
 * HL7 v2 adapter tests: the two headline gates (the **leak test** and the **over-scrub test**), the
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
  LIMITED_DATA_SET_PROFILE,
  SAFE_HARBOR_CATEGORIES,
  SAFE_HARBOR_PROFILE,
  createDeidContext,
  defineDeidPolicy,
  profileOptions,
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
 * The patient / relative / guarantor / insured / **employer** PHI sentinels seeded across
 * `adt-a01.hl7`. Every one must be GONE after a de-id pass. §164.514(b)(2)(i) removes the identifiers
 * of the individual "or of relatives, **employers**, or household members", so the employer positions
 * of the guarantor and insurance segments are on this list beside the relatives'. (Retained-by-design
 * values, the MSH/EVN envelope timestamps, the PV1 provider name, the coded employment status and the
 * insurer org id/name/address/phone, are deliberately not `ZZ`-tagged and are not in this list; the
 * employer suite in `employer.test.ts` asserts those the other way. The encounter dates and the
 * encounter / order identifiers are NOT among them either: they are removed under this profile, and
 * `adt-a03.hl7` is the fixture that seeds and proves it.)
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
  "ZZGTEMPFAMILY",
  "ZZGTEMPGIVEN",
  "ZZGTEMPSTREET",
  "ZZGTEMPCITY",
  "11201",
  "5550000007",
  "ZZGTEMPLOYERID",
  "ZZGTEMPEIN",
  "ZZGROUP001",
  "ZZINSGRPEMPID",
  "ZZINSGRPEMPNAME",
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
  "ZZEMPCONTACTFAM",
  "ZZEMPCONTACTGIV",
  "5550000008",
  "5550000009",
  "ZZEMPORGNAME",
  "ZZEMPORGID",
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

describe("deidentifyHl7, the leak test (zero surviving sentinels)", () => {
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

describe("deidentifyHl7, the over-scrub test (clinical values survive byte-identical)", () => {
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

describe("deidentifyHl7, structured per-category behavior", () => {
  it("removes the MRN (keeping the assigning authority) and redacts the SSN in a PID-3 list", () => {
    const msg = parseHL7(
      "MSH|^~\\&|A|B|C|D|20200101||ADT^A01|M1|P|2.5\rPID|1||ZZMRN001^^^HOSP^MR~900000001^^^SSA^SS",
    );
    const { document, manifest } = deidentifyHl7(msg, { context: ctx });
    // MRN (CX.1) → REMOVED under the Safe Harbor default; assigning authority + type code retained.
    expect(document.get("PID.3[0].1")).toBe("");
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

describe("deidentifyHl7, fail closed on free text and unknown structure", () => {
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

  it("redacts OBX-5 / NTE-3 free text in place with a BYO redactor (consumer-asserted, §Phase 8)", () => {
    const msg = parseHL7(
      "MSH|^~\\&|A|B|C|D|20200101||ORU^R01|M1|P|2.5\r" +
        "OBX|1|NM|2951-2^Sodium^LN|1|140|mmol/L|135-145|N|||F\r" +
        "OBX|2|TX|1234-5^Note^LN|1|Specimen from ZZLEAKNAME reviewed|||||F\r" +
        "NTE|1||comment naming ZZLEAKNTE",
    );
    // A consumer-supplied redactor that scrubs the seeded sentinels. The library bundles none.
    const redactor = ({ text }: { text: string }) => ({ text: text.replace(/ZZLEAK\w+/g, "[X]") });
    const { document, manifest } = deidentifyHl7(msg, { context: ctx, redactor });
    // Free text redacted IN PLACE (not blocked) and recorded as consumer-asserted.
    expect(document.get("OBX[1].5")).toBe("Specimen from [X] reviewed");
    expect(document.get("NTE.3")).toBe("comment naming [X]");
    expect(
      manifest
        .filter((m) => m.code === D.DEID_FREETEXT_CONSUMER_REDACTED)
        .every((m) => m.transform === "byo-redact" && m.disposition === "transformed"),
    ).toBe(true);
    // Leak test on the BYO path: no seeded sentinel survives in the serialized wire.
    expect(document.toString()).not.toMatch(/ZZLEAK/);
    // Over-scrub unchanged: the structured numeric OBX-5 survives byte-identical.
    expect(document.get("OBX[0].5")).toBe("140");
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
    // A merge/move ADT carries the patient's PRIOR name + MRN in MRG: patient PHI, not provider.
    // MRG is a recognized segment but not on the retain-list, so it must block, not pass through.
    const msg = parseHL7(
      "MSH|^~\\&|A|B|C|D|20200101||ADT^A40|M1|P|2.5\r" +
        "PID|1||NEWMRN^^^H^MR||ZZSURVIVOR^ZZJANE||19850302|F\r" +
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

  it("leaves recognized clinical/administrative segments (PV1) untouched, retain-list, not blanket-scrub", () => {
    const msg = parseHL7("MSH|^~\\&|A|B|C|D|20200101||ADT^A01|M1|P|2.5\rPV1|1|I|WARD^ROOM^BED");
    const { document, manifest } = deidentifyHl7(msg, { context: ctx });
    expect(document.get("PV1.3.1")).toBe("WARD");
    expect(manifest.filter((m) => m.locus.startsWith("PV1"))).toEqual([]);
  });
});

describe("deidentifyHl7, fatal + policy + immutability", () => {
  it("throws DEID_NO_KEY when the message needs a keyed transform but no context is supplied", () => {
    const msg = parseHL7("MSH|^~\\&|A|B|C|D|20200101||ADT^A01|M1|P|2.5\rPID|1||ZZMRN001^^^HOSP^MR");
    // The Safe Harbor default is no longer keyed at an identifier locus, so the keyed policy is named.
    const keyed = defineDeidPolicy({ name: "keyed", transforms: { [C.MRN]: "pseudonymize" } });
    expect(() => deidentifyHl7(msg, { policy: keyed })).toThrowError(
      expect.objectContaining({ code: FATAL_CODES.DEID_NO_KEY }),
    );
  });

  it("completes with NO key at all under the built-in Safe Harbor default", () => {
    const msg = parseHL7("MSH|^~\\&|A|B|C|D|20200101||ADT^A01|M1|P|2.5\rPID|1||ZZMRN001^^^HOSP^MR");
    const { document } = deidentifyHl7(msg, {});
    expect(document.toString().includes("ZZMRN001")).toBe(false);
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

  it("records only the envelope date for a message with no patient PHI loci", () => {
    // MSH-7 is a date the standard types, inside a segment the retain-list keeps, so it is acted on
    // and recorded like any other: an acknowledgement carries that one entry and nothing else.
    const msg = parseHL7("MSH|^~\\&|A|B|C|D|20200101||ACK|M1|P|2.5\rMSA|AA|M1");
    const { document, manifest } = deidentifyHl7(msg, { context: ctx });
    expect(manifest.map((m) => m.locus)).toEqual(["MSH-7[0]"]);
    expect(document.get("MSH.7")).toBe("2020");
  });
});

/**
 * The encounter loci carved out of the RETAINED visit / order / diagnosis segments, seeded in
 * `adt-a03.hl7`. Each row is one of the seven the two profiles must treat differently.
 *
 * Under `safe-harbor` every one must be GONE: the dates are elements of dates directly related to the
 * individual (§164.514(b)(2)(i)(C) names admission and discharge in the regulation text itself, and
 * permits only the year), and the visit / order numbers are unique identifying codes the (R) catch-all
 * reaches. Under `limited-data-set` every one must SURVIVE BYTE-IDENTICAL: §164.514(e)(2)'s list of
 * sixteen direct identifiers names no date and carries no catch-all, so a limited data set may keep
 * them.
 *
 * Both directions are asserted, because a removal test that passes because the detector never found the
 * locus is indistinguishable from one that passes because the locus was removed.
 */
const ENCOUNTER_LOCI: readonly {
  readonly what: string;
  readonly locus: string;
  readonly seeded: string;
}[] = [
  { what: "visit number", locus: "PV1-19", seeded: "ZZVISIT700" },
  { what: "admit date/time", locus: "PV1-44", seeded: "20200103040500" },
  { what: "discharge date/time", locus: "PV1-45", seeded: "20200109060700" },
  { what: "placer order number (order control)", locus: "ORC-2", seeded: "ZZPLACER700" },
  { what: "filler order number (order control)", locus: "ORC-3", seeded: "ZZFILLER700" },
  { what: "placer order number (observation request)", locus: "OBR-2", seeded: "ZZPLACER700" },
  { what: "filler order number (observation request)", locus: "OBR-3", seeded: "ZZFILLER700" },
  { what: "observation (service) date/time", locus: "OBR-7", seeded: "20200104080000" },
  { what: "diagnosis date/time", locus: "DG1-5", seeded: "20200105090000" },
];

describe("deidentifyHl7, the encounter loci inside retained segments (§164.514(b)(2) vs §164.514(e))", () => {
  it("PRE-CONDITION: every seeded encounter value is really present in the original wire", () => {
    const raw = loadFixture("adt-a03");
    const missing = ENCOUNTER_LOCI.filter((l) => !raw.includes(l.seeded));
    expect(missing).toEqual([]);
  });

  it("safe-harbor: every encounter date and encounter/order identifier is REMOVED from the wire", () => {
    const wire = deidentifyHl7(
      parseHL7(loadFixture("adt-a03")),
      profileOptions(SAFE_HARBOR_PROFILE, ctx),
    ).document.toString();
    const survivors = ENCOUNTER_LOCI.filter((l) => wire.includes(l.seeded));
    expect(survivors).toEqual([]);
  });

  it("safe-harbor: the dates keep their YEAR (permitted) and the identifiers are blocked as (R)", () => {
    const { document, manifest } = deidentifyHl7(
      parseHL7(loadFixture("adt-a03")),
      profileOptions(SAFE_HARBOR_PROFILE, ctx),
    );
    // Dates: generalized to the four-digit year, recorded as a coarse residual.
    for (const path of ["PV1.44.1", "PV1.45.1", "OBR.7.1", "DG1.5.1"]) {
      expect(document.get(path)).toBe("2020");
    }
    for (const locus of ["PV1-44", "PV1-45", "OBR-7", "DG1-5"]) {
      const entry = manifest.find((m) => m.locus === locus);
      expect(entry?.category).toBe(C.DATES);
      expect(entry?.disposition).toBe("transformed");
      expect(entry?.code).toBe(D.DEID_RESIDUAL_RETAINED);
    }
    // The EI order numbers: the whole field is gone. PV1-19 is a CX list, handled per repetition like
    // PID-3, so its id-number component is cleared and the assigning authority / type code remain.
    for (const path of ["ORC.2.1", "ORC.3.1", "OBR.2.1", "OBR.3.1"]) {
      expect(document.get(path)).toBeUndefined();
    }
    expect(document.get("PV1.19.1")).toBe("");
    expect(document.get("PV1.19.5")).toBe("VN"); // type code retained, the value is what had to go
    for (const locus of ["PV1-19[0]", "ORC-2", "ORC-3", "OBR-2", "OBR-3"]) {
      const entry = manifest.find((m) => m.locus === locus);
      expect(entry?.category).toBe(C.OTHER_UNIQUE_ID);
      expect(entry?.disposition).toBe("blocked");
      expect(entry?.code).toBe(D.DEID_LOCUS_BLOCKED);
    }
  });

  it("limited-data-set: every one SURVIVES byte-identical, and every one is RECORDED", () => {
    const original = parseHL7(loadFixture("adt-a03"));
    const { document, manifest } = deidentifyHl7(
      parseHL7(loadFixture("adt-a03")),
      profileOptions(LIMITED_DATA_SET_PROFILE, ctx),
    );
    const wire = document.toString();
    const removed = ENCOUNTER_LOCI.filter((l) => !wire.includes(l.seeded));
    expect(removed).toEqual([]);
    // Byte-identical, not merely "the token appears somewhere": the composite survives intact, so the
    // visit number keeps its assigning authority and identifier-type components.
    for (const path of ["PV1.19.1", "PV1.19.4", "PV1.19.5", "PV1.44.1", "OBR.2.1", "DG1.5.1"]) {
      expect(document.get(path)).toBe(original.get(path));
    }
    // Recorded, every one: a kept identifier that no artifact names is invisible twice over.
    for (const locus of [
      "PV1-19[0]",
      "PV1-44",
      "PV1-45",
      "ORC-2",
      "ORC-3",
      "OBR-2",
      "OBR-3",
      "OBR-7",
      "DG1-5",
    ]) {
      const entry = manifest.find((m) => m.locus === locus);
      expect(entry?.disposition).toBe("retained");
      expect(entry?.transform).toBe("retain");
      expect(entry?.code).toBe(D.DEID_RESIDUAL_RETAINED);
    }
  });

  it("limited-data-set still removes the PATIENT identifiers §164.514(e)(2) DOES name", () => {
    const wire = deidentifyHl7(
      parseHL7(loadFixture("adt-a03")),
      profileOptions(LIMITED_DATA_SET_PROFILE, ctx),
    ).document.toString();
    // Names, STREET address detail, phone, and the raw medical record number are all on the
    // limited-data-set exclusion list, so keeping the encounter loci must not have loosened any of
    // them. The town or city is deliberately absent from this list: §164.514(e)(2)(ii) is a PARTIAL
    // exclusion and names it as surviving. `retained-geography.test.ts` owns that half.
    for (const s of ["ZZENCFAMILY", "ZZENCGIVEN", "ZZENCSTREET", "5550000020", "ZZMRN003"]) {
      expect(wire.includes(s)).toBe(false);
    }
  });

  it("retention is OPT-IN: a bare options bag keeps nothing (fail closed)", () => {
    // A consumer who builds options by hand from the limited-data-set POLICY, without the profile's
    // retention set, gets the strict treatment rather than a silent pass-through.
    const wire = deidentifyHl7(parseHL7(loadFixture("adt-a03")), {
      policy: LIMITED_DATA_SET_PROFILE.policy,
      context: ctx,
    }).document.toString();
    const survivors = ENCOUNTER_LOCI.filter((l) => wire.includes(l.seeded));
    expect(survivors).toEqual([]);
  });

  it("an absent encounter field is not invented as a locus (no manifest row, no over-scrub)", () => {
    // adt-a01 carries a PV1 with no visit number and no admit/discharge date.
    const { manifest } = deidentifyHl7(parseHL7(loadFixture("adt-a01")), {
      context: ctx,
    });
    expect(manifest.filter((m) => m.locus.startsWith("PV1-"))).toEqual([]);
  });

  it("the clinical value alongside the encounter loci survives byte-identical (over-scrub guard)", () => {
    const original = parseHL7(loadFixture("adt-a03"));
    const { document } = deidentifyHl7(
      parseHL7(loadFixture("adt-a03")),
      profileOptions(SAFE_HARBOR_PROFILE, ctx),
    );
    for (const path of ["OBX[0].5", "OBX[0].6", "OBX[0].3.1", "OBR.4.1", "DG1.3.1", "PV1.3.1"]) {
      expect(document.get(path)).toBe(original.get(path));
    }
  });
});

describe("a visit-number field carrying a REAL direct identifier is never retained", () => {
  // §164.514(e)(2) enumerates sixteen direct identifiers, and (vii) NAMES medical record numbers while
  // (ix) NAMES account numbers. The whole argument for keeping a visit number in a limited data set is
  // that the list has no catch-all: that argument evaporates the moment the field actually carries one
  // of the sixteen, which PV1-19 routinely does. The standard types it for us at CX-5 (Table 0203).

  /** Build a PV1 whose 19th field is exactly `visitNumber`, counted rather than eyeballed. */
  function pv1(visitNumber: string): string {
    const fields = new Array<string>(19).fill("");
    fields[0] = "1";
    fields[1] = "I";
    fields[2] = "W^R^B";
    fields[18] = visitNumber; // PV1-19
    return `PV1|${fields.join("|")}`;
  }

  const wire = (visitNumber: string): string =>
    [
      "MSH|^~\\&|A|B|C|D|20200101||ADT^A03|M1|P|2.5",
      "PID|1||ZZMRN500^^^HOSP^MR||ZZFAM^ZZGIV||19850302",
      pv1(visitNumber),
    ].join("\r");

  it("the fixture builder really puts the value at PV1-19 (pre-condition)", () => {
    // A test that silently seeded PV1-20 would assert nothing at all.
    expect(parseHL7(wire("ZZMRN500^^^HOSP^VN")).get("PV1.19.1")).toBe("ZZMRN500");
  });

  it("an MR-typed visit number is pseudonymized, not retained, EVEN under limited-data-set", () => {
    const ctx = createDeidContext({ key: "pv19-key", patientId: "p1" });
    const { document, manifest } = deidentifyHl7(
      parseHL7(wire("ZZMRN500^^^HOSP^MR")),
      profileOptions(LIMITED_DATA_SET_PROFILE, ctx),
    );
    expect(document.toString().includes("ZZMRN500")).toBe(false);
    const entry = manifest.find((m) => m.locus === "PV1-19[0]");
    expect(entry?.category).toBe(C.MRN);
    expect(entry?.disposition).toBe("transformed");
    // And the surrogate is the SAME one PID-3 got, so a pass can never republish in the clear the
    // identifier it just pseudonymized elsewhere in the very same message.
    expect(document.get("PV1.19.1")).toBe(document.get("PID.3[0].1"));
  });

  it("AN / SS / MA typed visit numbers are likewise transformed, never retained", () => {
    const ctx = createDeidContext({ key: "pv19-key", patientId: "p1" });
    for (const [typeCode, category] of [
      ["AN", C.ACCOUNT],
      ["SS", C.SSN],
      ["MA", C.HEALTH_PLAN_BENEFICIARY],
    ] as const) {
      const { document, manifest } = deidentifyHl7(
        parseHL7(wire(`ZZMRN500^^^HOSP^${typeCode}`)),
        profileOptions(LIMITED_DATA_SET_PROFILE, ctx),
      );
      expect(document.toString().includes("ZZMRN500")).toBe(false);
      const entry = manifest.find((m) => m.locus === "PV1-19[0]");
      expect(entry?.category).toBe(category);
      expect(entry?.disposition).not.toBe("retained");
    }
  });

  it("an untyped or VN-typed visit number IS the encounter identifier, and is retained under LDS", () => {
    const ctx = createDeidContext({ key: "pv19-key", patientId: "p1" });
    for (const visitNumber of ["ZZVISIT500^^^HOSP^VN", "ZZVISIT500"]) {
      const { document, manifest } = deidentifyHl7(
        parseHL7(wire(visitNumber)),
        profileOptions(LIMITED_DATA_SET_PROFILE, ctx),
      );
      const entry = manifest.find((m) => m.locus === "PV1-19[0]");
      expect(entry?.category).toBe(C.OTHER_UNIQUE_ID);
      expect(entry?.disposition).toBe("retained");
      expect(document.get("PV1.19.1")).toBe("ZZVISIT500");
    }
  });

  it("a mixed PV1-19 list routes each repetition on its own type code", () => {
    const ctx = createDeidContext({ key: "pv19-key", patientId: "p1" });
    const msg = parseHL7(wire("ZZVISIT500^^^H^VN~ZZMRN500^^^H^MR"));
    const { document, manifest } = deidentifyHl7(
      msg,
      profileOptions(LIMITED_DATA_SET_PROFILE, ctx),
    );
    expect(manifest.find((m) => m.locus === "PV1-19[0]")?.disposition).toBe("retained");
    expect(manifest.find((m) => m.locus === "PV1-19[1]")?.category).toBe(C.MRN);
    expect(manifest.find((m) => m.locus === "PV1-19[1]")?.disposition).toBe("transformed");
    const out = document.toString();
    expect(out.includes("ZZVISIT500")).toBe(true); // the real encounter identifier survives
    expect(out.includes("ZZMRN500")).toBe(false); // the medical record number does not
  });
});
