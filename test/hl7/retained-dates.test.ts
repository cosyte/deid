/**
 * **Dates inside RETAINED HL7 v2 segments**: the class the retain-list used to pass through untouched
 * and unrecorded. Every date position the HL7 v2.5.1 segment definitions type as a date or date/time,
 * inside a segment the retain-list keeps, is now acted on under the configured policy and recorded in
 * the value-free manifest.
 *
 * The suite is written to be **non-vacuous**: every seeded date is first asserted PRESENT at its exact
 * path in the original wire (a removal test that passes because the locus was never found asserts
 * nothing), and only then asserted acted-on and recorded.
 *
 * Every value is a synthetic timestamp or a `ZZ`-tagged sentinel; the fixture's literals are declared
 * synthetic in `scripts/phi-allow-list.txt`.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import { DEFAULT_ENCODING_CHARACTERS, Hl7Message, parseHL7 } from "@cosyte/hl7";

import {
  DEID_DISPOSITION_CODES,
  FATAL_CODES,
  LIMITED_DATA_SET_PROFILE,
  RETAINED_LOCUS_CLASSES,
  SAFE_HARBOR_CATEGORIES,
  SAFE_HARBOR_PROFILE,
  buildExpertDeterminationSupportReport,
  createDeidContext,
  defineDeidPolicy,
  profileOptions,
  type DeidPolicy,
} from "../../src/index.js";
import { RETAIN_SEGMENTS, deidentifyHl7 } from "../../src/hl7/index.js";

const C = SAFE_HARBOR_CATEGORIES;
const D = DEID_DISPOSITION_CODES;
const FIXTURES = join(import.meta.dirname, "..", "fixtures", "hl7");
const MSH = "MSH|^~\\&|A|B|C|D|20240315103000||ORM^O01|M1|P|2.5.1";

/** Load a fixture and normalize its line endings to HL7 `\r` segment separators. */
function loadFixture(name: string): string {
  return readFileSync(join(FIXTURES, `${name}.hl7`), "utf8")
    .trim()
    .split(/\r?\n/)
    .join("\r");
}

const ctx = createDeidContext({ key: "retained-dates-key", patientId: "patient-700" });

/**
 * Every date position the fixture seeds inside a RETAINED segment: the dot-path the parser reads it
 * at, the manifest locus path the pass must record it under, and the seeded full-precision value.
 *
 * `PV1-44`, `PV1-45`, `OBR-7` and `DG1-5` are deliberately absent: they are the encounter-date class
 * the carve-out already owned before this change, and `deidentify-hl7.test.ts` owns their behaviour.
 */
const DATE_LOCI: readonly {
  readonly path: string;
  readonly locus: string;
  readonly seeded: string;
}[] = [
  { path: "MSH.7", locus: "MSH-7[0]", seeded: "20240315103000" },
  { path: "EVN.2", locus: "EVN-2[0]", seeded: "20240315103000" },
  { path: "EVN.3", locus: "EVN-3[0]", seeded: "20240316104500" },
  { path: "EVN.6", locus: "EVN-6[0]", seeded: "20240314102000" },
  { path: "PV1.37.2", locus: "PV1-37[0].2", seeded: "20240320" },
  { path: "PV2.8", locus: "PV2-8[0]", seeded: "20240309120000" },
  { path: "PV2.47", locus: "PV2-47[0]", seeded: "20240318150000" },
  { path: "ORC.7.4", locus: "ORC-7[0].4", seeded: "20240311090000" },
  { path: "ORC.7.5", locus: "ORC-7[0].5", seeded: "20240312090000" },
  { path: "ORC.9", locus: "ORC-9[0]", seeded: "20240315103000" },
  { path: "ORC.15", locus: "ORC-15[0]", seeded: "20240316000000" },
  { path: "OBR.6", locus: "OBR-6[0]", seeded: "20240310110000" },
  { path: "OBR.8", locus: "OBR-8[0]", seeded: "20240311130000" },
  { path: "OBR.14", locus: "OBR-14[0]", seeded: "20240311140000" },
  { path: "OBR.22", locus: "OBR-22[0]", seeded: "20240312150000" },
  { path: "OBR.27.4", locus: "OBR-27[0].4", seeded: "20240313090000" },
  { path: "OBR.27.5", locus: "OBR-27[0].5", seeded: "20240313100000" },
  { path: "OBR.32.2", locus: "OBR-32[0].2", seeded: "20240314080000" },
  { path: "OBR.32.3", locus: "OBR-32[0].3", seeded: "20240314090000" },
  { path: "SPM.17.1", locus: "SPM-17[0].1", seeded: "20240311070000" },
  { path: "SPM.17.2", locus: "SPM-17[0].2", seeded: "20240311073000" },
  { path: "SPM.18", locus: "SPM-18[0]", seeded: "20240311080000" },
  { path: "SPM.19", locus: "SPM-19[0]", seeded: "20250411080000" },
  { path: "TXA.4", locus: "TXA-4[0]", seeded: "20240315110000" },
  { path: "TXA.6", locus: "TXA-6[0]", seeded: "20240315120000" },
  { path: "TXA.7", locus: "TXA-7[0]", seeded: "20240315130000" },
  { path: "TXA.8", locus: "TXA-8[0]", seeded: "20240315140000" },
  { path: "RXA.3", locus: "RXA-3[0]", seeded: "20240315090000" },
  { path: "RXA.4", locus: "RXA-4[0]", seeded: "20240315093000" },
  { path: "RXA.16", locus: "RXA-16[0]", seeded: "20250101000000" },
  { path: "RXA.22", locus: "RXA-22[0]", seeded: "20240315094500" },
  { path: "FT1.4.1", locus: "FT1-4[0].1", seeded: "20240315" },
  { path: "FT1.4.2", locus: "FT1-4[0].2", seeded: "20240316" },
  { path: "FT1.5", locus: "FT1-5[0]", seeded: "20240317080000" },
  { path: "DG1.19", locus: "DG1-19[0]", seeded: "20240312100000" },
  { path: "OBX[0].12", locus: "OBX-12[0]", seeded: "20240301080000" },
  { path: "OBX[0].14", locus: "OBX-14[0]", seeded: "20240311150000" },
  { path: "OBX[0].19", locus: "OBX-19[0]", seeded: "20240311160000" },
  { path: "OBX[1].5", locus: "OBX[1]-5[0]", seeded: "20240311" },
  { path: "OBX[2].5", locus: "OBX[2]-5[0]", seeded: "20240311120000" },
  { path: "OBX[3].5.1", locus: "OBX[3]-5[0].1", seeded: "20240311070000" },
  { path: "OBX[3].5.2", locus: "OBX[3]-5[0].2", seeded: "20240311073000" },
];

/** The full-precision literals that must not survive a Safe Harbor pass anywhere in the wire. */
const FULL_PRECISION: readonly string[] = [
  ...new Set(DATE_LOCI.map((l) => l.seeded).filter((v) => v.length > 4)),
  "20240316140000", // the second repetition of TXA-8
];

describe("retained-segment date loci: the fixture really seeds them (non-vacuity)", () => {
  it("PRE-CONDITION: every seeded date is present at its exact path in the original wire", () => {
    const original = parseHL7(loadFixture("orm-o01-retained-dates"));
    const missing = DATE_LOCI.filter((l) => original.get(l.path) !== l.seeded);
    expect(missing).toEqual([]);
  });

  it("PRE-CONDITION: the repeating date field really carries two repetitions", () => {
    const original = parseHL7(loadFixture("orm-o01-retained-dates"));
    const txa = original.allSegments().find((s) => s.type === "TXA");
    expect(txa?.field(8).repetitions).toHaveLength(2);
  });
});

describe("AC-1 / AC-2 / AC-2b: safe-harbor generalizes and records every retained-segment date", () => {
  const run = () =>
    deidentifyHl7(
      parseHL7(loadFixture("orm-o01-retained-dates")),
      profileOptions(SAFE_HARBOR_PROFILE, ctx),
    );

  it("no full-precision date survives anywhere in the serialized output", () => {
    const wire = run().document.toString();
    const survivors = FULL_PRECISION.filter((s) => wire.includes(s));
    expect(survivors).toEqual([]);
  });

  it("every date locus is emitted at no precision finer than its four-digit year", () => {
    const { document } = run();
    const wrong = DATE_LOCI.filter((l) => document.get(l.path) !== l.seeded.slice(0, 4));
    expect(wrong).toEqual([]);
  });

  it("every populated date locus is recorded, with category, transform, disposition and count", () => {
    const { manifest } = run();
    const missing = DATE_LOCI.filter((l) => !manifest.some((m) => m.locus === l.locus));
    expect(missing).toEqual([]);
    for (const l of DATE_LOCI) {
      const entry = manifest.find((m) => m.locus === l.locus);
      expect(entry?.category).toBe(C.DATES);
      expect(entry?.transform).toBe("generalize");
      expect(entry?.disposition).toBe("transformed");
      expect(entry?.code).toBe(D.DEID_RESIDUAL_RETAINED);
      expect(entry?.count).toBe(1);
    }
  });

  it("AC-2b: a retained ORC no published limitation names is acted on and recorded (ORC-9, ORC-15)", () => {
    const { document, manifest } = run();
    expect(document.get("ORC.9")).toBe("2024");
    expect(document.get("ORC.15")).toBe("2024");
    expect(manifest.find((m) => m.locus === "ORC-9[0]")?.disposition).toBe("transformed");
    expect(manifest.find((m) => m.locus === "ORC-15[0]")?.disposition).toBe("transformed");
  });

  it("AC-2b: the classification is fixed at one version, so MSH-12 moves no locus", () => {
    const raw = loadFixture("orm-o01-retained-dates");
    const asV23 = raw.replace("|P|2.5.1", "|P|2.3");
    expect(asV23).not.toBe(raw); // the rewrite really happened
    const loci = (wire: string): string[] =>
      deidentifyHl7(parseHL7(wire), profileOptions(SAFE_HARBOR_PROFILE, ctx)).manifest.map(
        (m) => m.locus,
      );
    expect(loci(asV23)).toEqual(loci(raw));
  });

  it("AC-2b: classification is structural, never read from the value's shape", () => {
    // An eight-digit NUMERIC observation value looks exactly like an HL7 date and is not one: OBX-2
    // types it NM, so it is out of the class and survives byte-identical.
    const { document, manifest } = run();
    expect(document.get("OBX[5].5")).toBe("20241231");
    expect(manifest.some((m) => m.locus.startsWith("OBX[5]"))).toBe(false);
  });
});

describe("AC-2 / AC-2b: an OBX's OWN date/time fields, not just the OBX-5 the message types", () => {
  // OBX is NOT on the retain-list and is passed through all the same: the OBX-2 branch decides OBX-5
  // and every other field keeps its bytes. A result message is the commonest carrier of an observation
  // and an analysis timestamp, and OBX-5 there is a plain numeric result, so the one OBX date position
  // the message types for itself is not even in play. This is the exact wire that reproduced the leak.
  const ORU = "MSH|^~\\&|A|B|C|D|20240315103000||ORU^R01|M1|P|2.5.1";
  const OBX =
    "OBX|1|NM|1234-6^Sodium^LN|1|140|mmol/L|135-145|N|||F|||20240315103000|||||20240316104500";
  const run = () =>
    deidentifyHl7(parseHL7([ORU, OBX].join("\r")), profileOptions(SAFE_HARBOR_PROFILE, ctx));

  it("PRE-CONDITION: the observation and analysis timestamps really sit at OBX-14 and OBX-19", () => {
    const original = parseHL7([ORU, OBX].join("\r"));
    expect(original.get("OBX.14")).toBe("20240315103000");
    expect(original.get("OBX.19")).toBe("20240316104500");
  });

  it("both are generalized to their year and no full-precision value survives the wire", () => {
    const { document } = run();
    expect(document.get("OBX.14")).toBe("2024");
    expect(document.get("OBX.19")).toBe("2024");
    const wire = document.toString();
    for (const value of ["20240315103000", "20240316104500"]) {
      expect(wire).not.toContain(value);
    }
  });

  it("both are recorded, so no date survives in any form absent from the manifest", () => {
    const { manifest } = run();
    for (const locus of ["OBX-14[0]", "OBX-19[0]"]) {
      const entry = manifest.find((m) => m.locus === locus);
      expect(entry?.category).toBe(C.DATES);
      expect(entry?.transform).toBe("generalize");
      expect(entry?.disposition).toBe("transformed");
    }
  });

  it("the numeric OBX-5 beside them is untouched: acting on the segment is not scrubbing it", () => {
    const { document, manifest } = run();
    expect(document.get("OBX.5")).toBe("140");
    expect(document.get("OBX.7")).toBe("135-145");
    expect(manifest.some((m) => m.locus === "OBX-5" || m.locus.startsWith("OBX-5["))).toBe(false);
  });

  it("adds no segment to the retain-list: what the adapter RETAINS is unchanged", () => {
    expect(RETAIN_SEGMENTS.has("OBX")).toBe(false);
  });
});

describe("AC-21: occurrence, repetition and component all get their own locus path", () => {
  const run = () =>
    deidentifyHl7(
      parseHL7(loadFixture("orm-o01-retained-dates")),
      profileOptions(SAFE_HARBOR_PROFILE, ctx),
    );

  it("a repeated segment distinguishes its occurrences", () => {
    const { manifest } = run();
    // Two DG1 occurrences: the first carries DG1-19, both carry the carved-out DG1-5.
    expect(manifest.some((m) => m.locus === "DG1-5")).toBe(true);
    expect(manifest.some((m) => m.locus === "DG1[1]-5")).toBe(true);
    expect(manifest.some((m) => m.locus === "DG1-19[0]")).toBe(true);
  });

  it("a repeating date field gets one entry per repetition, each individually addressable", () => {
    const { document, manifest } = run();
    const txa8 = manifest.filter((m) => m.locus.startsWith("TXA-8"));
    expect(txa8.map((m) => m.locus)).toEqual(["TXA-8[0]", "TXA-8[1]"]);
    expect(txa8.every((m) => m.count === 1)).toBe(true);
    const seg = document.allSegments().find((s) => s.type === "TXA");
    expect(seg?.field(8).repetitions).toHaveLength(2);
  });

  it("two date components of one field never share a locus path and never aggregate", () => {
    const { manifest } = run();
    const spm17 = manifest.filter((m) => m.locus.startsWith("SPM-17"));
    expect(spm17.map((m) => m.locus)).toEqual(["SPM-17[0].1", "SPM-17[0].2"]);
    expect(spm17.every((m) => m.count === 1)).toBe(true);
  });

  it("entries aggregate only on an identical five-field tuple", () => {
    // Three EVN occurrences carrying the same field: three DISTINCT paths, three entries of count 1.
    const msg = parseHL7(
      [MSH, "EVN|A01|20240315103000", "EVN|A01|20240316103000", "EVN|A01|20240317103000"].join(
        "\r",
      ),
    );
    const { manifest } = deidentifyHl7(msg, profileOptions(SAFE_HARBOR_PROFILE, ctx));
    const evn2 = manifest.filter((m) => m.locus.startsWith("EVN"));
    expect(evn2.map((m) => m.locus)).toEqual(["EVN-2[0]", "EVN[1]-2[0]", "EVN[2]-2[0]"]);
    expect(evn2.every((m) => m.count === 1)).toBe(true);
  });
});

describe("AC-9: an uninterpretable date locus is emptied AT ITS OWN UNIT and recorded blocked", () => {
  it("the worked component example: one generalize entry, one blocked entry, siblings intact", () => {
    // A retained SPM whose collection-range field carries an interpretable start and a garbled end.
    const spm = `SPM|1|||BLD^Blood^HL70487|||||||||||||20240315103000^GARBLED|20240311080000`;
    const { document, manifest } = deidentifyHl7(
      parseHL7([MSH, spm].join("\r")),
      profileOptions(SAFE_HARBOR_PROFILE, ctx),
    );
    expect(document.get("SPM.17.1")).toBe("2024");
    expect(document.get("SPM.17.2") ?? "").toBe(""); // emptied component, never a value
    expect(document.get("SPM.18")).toBe("2024"); // the field beside it is untouched by the block
    const one = manifest.find((m) => m.locus === "SPM-17[0].1");
    const two = manifest.find((m) => m.locus === "SPM-17[0].2");
    expect(one?.transform).toBe("generalize");
    expect(one?.disposition).toBe("transformed");
    expect(two?.transform).toBe("block");
    expect(two?.disposition).toBe("blocked");
    expect(two?.code).toBe(D.DEID_LOCUS_BLOCKED);
  });

  it("a blocked component does not empty the field that contains it, and keeps sibling ordinals", () => {
    // The garbled component is FIRST here, so a sibling that survives must keep its ordinal (2).
    const spm = `SPM|1|||BLD^Blood^HL70487|||||||||||||GARBLED^20240315103000`;
    const { document } = deidentifyHl7(
      parseHL7([MSH, spm].join("\r")),
      profileOptions(SAFE_HARBOR_PROFILE, ctx),
    );
    expect(document.get("SPM.17.1") ?? "").toBe("");
    expect(document.get("SPM.17.2")).toBe("2024");
  });

  it("a field-granular locus is emptied as a whole field, no component residue", () => {
    const { document, manifest } = deidentifyHl7(
      parseHL7([MSH, "EVN|A01|GARBLED"].join("\r")),
      profileOptions(SAFE_HARBOR_PROFILE, ctx),
    );
    expect(document.get("EVN.2")).toBeUndefined();
    expect(document.toString()).not.toContain("GARBLED");
    expect(manifest.find((m) => m.locus === "EVN-2[0]")?.disposition).toBe("blocked");
  });

  it("only the offending REPETITION is emptied; a sibling repetition keeps its value and ordinal", () => {
    const msg = parseHL7(
      [MSH, "OBX|1|TS|1234-6^Observed^LN|1|20240315103000~PT SAYS AROUND THEN||||||F"].join("\r"),
    );
    const { document, manifest } = deidentifyHl7(msg, profileOptions(SAFE_HARBOR_PROFILE, ctx));
    const obx5 = document
      .allSegments()
      .find((s) => s.type === "OBX")
      ?.field(5);
    expect(obx5?.repetitions).toHaveLength(2);
    expect(obx5?.repetitions[0]?.components[0]?.subcomponents[0]).toBe("2024");
    expect(obx5?.repetitions[1]?.components[0]?.subcomponents[0]).toBe("");
    expect(manifest.find((m) => m.locus === "OBX-5[0]")?.disposition).toBe("transformed");
    expect(manifest.find((m) => m.locus === "OBX-5[1]")?.disposition).toBe("blocked");
  });
});

describe("AC-8: nothing on this path carries a byte of the value at a date locus", () => {
  it("a date locus holding free text with a name is blocked, and the manifest carries none of it", () => {
    const msg = parseHL7([MSH, "EVN|A01|PT SAYS AROUND 1985 PER ZZDAUGHTER"].join("\r"));
    const { document, manifest } = deidentifyHl7(msg, profileOptions(SAFE_HARBOR_PROFILE, ctx));
    // Fail closed: the policy's date transform cannot interpret it, so the locus is emptied. No
    // year is scraped out of free text by a second, shape-based reader.
    expect(document.get("EVN.2")).toBeUndefined();
    const rendered = JSON.stringify(manifest);
    for (const fragment of ["ZZDAUGHTER", "PT SAYS", "1985"]) {
      expect(rendered).not.toContain(fragment);
    }
  });

  it("no manifest entry of the whole fixture carries any seeded value or fragment of one", () => {
    const { manifest } = deidentifyHl7(
      parseHL7(loadFixture("orm-o01-retained-dates")),
      profileOptions(SAFE_HARBOR_PROFILE, ctx),
    );
    const rendered = JSON.stringify(manifest);
    for (const value of FULL_PRECISION) {
      expect(rendered).not.toContain(value);
      expect(rendered).not.toContain(value.slice(0, 8));
    }
  });
});

describe("AC-6 / AC-14: the over-scrub guard survives, component-wise", () => {
  it("every non-date position of the fixture is emitted byte-identical", () => {
    const original = parseHL7(loadFixture("orm-o01-retained-dates"));
    const { document } = deidentifyHl7(
      parseHL7(loadFixture("orm-o01-retained-dates")),
      profileOptions(SAFE_HARBOR_PROFILE, ctx),
    );
    const untouched = [
      "PV1.3.1", // room
      "PV1.37.1", // the discharged-to location beside its effective-date component
      "ORC.1", // order control
      "OBR.4.1", // LOINC service identifier
      "OBR.32.1", // the interpreter name component beside its two date components
      "SPM.4.1", // specimen type
      "TXA.2", // document type
      "RXA.5.1", // administered code
      "RXA.7.1", // administered units
      "FT1.6", // transaction type
      "FT1.7.1", // transaction code
      "DG1.3.1", // diagnosis code
      "OBX[0].5", // NM sodium result
      "OBX[0].6", // units
      "OBX[0].7", // reference range
      "OBX[4].5", // TM draw time: a time of day carries no element of a date
      "OBX[5].5", // NM value that merely looks like a date
    ];
    for (const path of untouched) {
      expect(document.get(path)).toBe(original.get(path));
    }
  });

  it("a TM-typed OBX-5 is neither acted on nor recorded", () => {
    const { manifest } = deidentifyHl7(
      parseHL7(loadFixture("orm-o01-retained-dates")),
      profileOptions(SAFE_HARBOR_PROFILE, ctx),
    );
    expect(manifest.some((m) => m.locus.startsWith("OBX[4]"))).toBe(false);
  });

  it("a retained segment carrying no date is emitted byte-identical and recorded nowhere", () => {
    const wire = [MSH, "AL1|1|DA|Z001^Penicillin^L|SV|Rash"].join("\r");
    const { document, manifest } = deidentifyHl7(
      parseHL7(wire),
      profileOptions(SAFE_HARBOR_PROFILE, ctx),
    );
    expect(document.toString()).toContain("AL1|1|DA|Z001^Penicillin^L|SV|Rash");
    expect(manifest.some((m) => m.locus.startsWith("AL1"))).toBe(false);
  });

  it("a non-retained segment is unchanged in what it does (still fails closed)", () => {
    const { document, manifest } = deidentifyHl7(
      parseHL7([MSH, "ZPI|ZZCUSTOM700|20240315103000"].join("\r")),
      profileOptions(SAFE_HARBOR_PROFILE, ctx),
    );
    expect(document.get("ZPI.1")).toBeUndefined();
    expect(document.get("ZPI.2")).toBeUndefined();
    expect(manifest.filter((m) => m.locus.startsWith("ZPI")).map((m) => m.code)).toEqual([
      D.DEID_LOCUS_BLOCKED,
      D.DEID_LOCUS_BLOCKED,
    ]);
  });
});

describe("AC-11: an empty or absent date locus is unchanged and unrecorded", () => {
  it("an absent date field yields no manifest entry", () => {
    const { manifest } = deidentifyHl7(
      parseHL7([MSH, "EVN|A01"].join("\r")),
      profileOptions(SAFE_HARBOR_PROFILE, ctx),
    );
    expect(manifest.some((m) => m.locus.startsWith("EVN"))).toBe(false);
  });

  it("a retained segment whose date loci are all empty is emitted byte-identical", () => {
    const wire = [MSH, "EVN|A01|||ZZREASON"].join("\r");
    const { document, manifest } = deidentifyHl7(
      parseHL7(wire),
      profileOptions(SAFE_HARBOR_PROFILE, ctx),
    );
    expect(document.toString()).toContain("EVN|A01|||ZZREASON");
    expect(manifest.some((m) => m.locus.startsWith("EVN"))).toBe(false);
  });

  it("an empty date COMPONENT beside a populated one is unchanged and unrecorded", () => {
    const spm = "SPM|1|||BLD^Blood^HL70487|||||||||||||^20240315103000";
    const { document, manifest } = deidentifyHl7(
      parseHL7([MSH, spm].join("\r")),
      profileOptions(SAFE_HARBOR_PROFILE, ctx),
    );
    // The empty component 1 yields no entry at all; the envelope's own message timestamp is the only
    // other date this two-segment message carries.
    expect(manifest.map((m) => m.locus)).toEqual(["MSH-7[0]", "SPM-17[0].2"]);
    expect(document.get("SPM.17.2")).toBe("2024");
  });
});

describe("AC-10: a legitimately reduced-precision date is never padded into a fuller instant", () => {
  it("safe-harbor keeps the arrived precision or the year, whichever is coarser", () => {
    for (const [arrived, expected] of [
      ["2024", "2024"],
      ["202403", "2024"],
      ["20240315", "2024"],
    ] as const) {
      const { document } = deidentifyHl7(
        parseHL7([MSH, `EVN|A01|${arrived}`].join("\r")),
        profileOptions(SAFE_HARBOR_PROFILE, ctx),
      );
      expect(document.get("EVN.2")).toBe(expected);
    }
  });

  it("a date-shift policy blocks a reduced-precision value rather than expanding it", () => {
    const shift = defineDeidPolicy({ name: "research", transforms: { [C.DATES]: "date-shift" } });
    for (const arrived of ["2024", "202403"]) {
      const { document, manifest } = deidentifyHl7(
        parseHL7([MSH, `EVN|A01|${arrived}`].join("\r")),
        { policy: shift, context: ctx },
      );
      expect(document.get("EVN.2")).toBeUndefined();
      expect(manifest.find((m) => m.locus === "EVN-2[0]")?.disposition).toBe("blocked");
    }
  });
});

describe("AC-4 / AC-4b: date-shift over the newly classified loci", () => {
  const shift = defineDeidPolicy({ name: "research", transforms: { [C.DATES]: "date-shift" } });

  it("shifts every locus whose encoding the shipped transform accepts, preserving the interval", () => {
    const msg = parseHL7([MSH, "EVN|A01|20240310|20240410"].join("\r"));
    const { document, manifest } = deidentifyHl7(msg, { policy: shift, context: ctx });
    const toEpoch = (s: string): number =>
      Date.UTC(Number(s.slice(0, 4)), Number(s.slice(4, 6)) - 1, Number(s.slice(6, 8)));
    const a = document.get("EVN.2") as string;
    const b = document.get("EVN.3") as string;
    expect(a).not.toBe("20240310"); // actually shifted
    expect((toEpoch(b) - toEpoch(a)) / 86_400_000).toBe(31);
    expect(manifest.find((m) => m.locus === "EVN-2[0]")?.code).toBe(D.DEID_CATEGORY_DATE_SHIFTED);
  });

  it("AC-4b: an encoding the shipped transform does not accept is BLOCKED, never partly shifted", () => {
    // A full-precision HL7 timestamp is outside the set the shipped date-shift transform accepts.
    const { document, manifest } = deidentifyHl7(
      parseHL7([MSH, "EVN|A01|20240315103000"].join("\r")),
      { policy: shift, context: ctx },
    );
    expect(document.get("EVN.2")).toBeUndefined();
    const entry = manifest.find((m) => m.locus === "EVN-2[0]");
    expect(entry?.disposition).toBe("blocked");
    expect(entry?.transform).toBe("block");
  });

  it("AC-13: a keyed policy with no context is the existing fatal, never an unkeyed fallback", () => {
    expect(() =>
      deidentifyHl7(parseHL7([MSH, "EVN|A01|20240310"].join("\r")), { policy: shift }),
    ).toThrowError(expect.objectContaining({ code: FATAL_CODES.DEID_NO_KEY }));
  });
});

describe("AC-3 / AC-3b / AC-19: the two profiles, and the illegal pairing", () => {
  it("the limited-data-set profile keeps the encounter dates and acts on every new date locus", () => {
    const original = parseHL7(loadFixture("orm-o01-retained-dates"));
    const { document, manifest } = deidentifyHl7(
      parseHL7(loadFixture("orm-o01-retained-dates")),
      profileOptions(LIMITED_DATA_SET_PROFILE, ctx),
    );
    // The encounter-date class is kept byte-identical and recorded as a residual.
    for (const path of ["PV1.44", "PV1.45", "OBR.7", "DG1.5"]) {
      expect(document.get(path)).toBe(original.get(path));
    }
    for (const locus of ["PV1-44", "PV1-45", "OBR-7", "DG1-5"]) {
      expect(manifest.find((m) => m.locus === locus)?.disposition).toBe("retained");
    }
    // No newly classified locus is kept: each is shifted or blocked, never `retained`.
    for (const l of DATE_LOCI) {
      const entry = manifest.find((m) => m.locus === l.locus);
      expect(entry?.disposition).not.toBe("retained");
      expect(entry?.transform).not.toBe("retain");
    }
  });

  it("AC-3b: naming both retention classes still keeps no newly classified locus", () => {
    const shift = defineDeidPolicy({ name: "research", transforms: { [C.DATES]: "date-shift" } });
    const { manifest } = deidentifyHl7(parseHL7(loadFixture("orm-o01-retained-dates")), {
      policy: shift,
      context: ctx,
      retainedLoci: [
        RETAINED_LOCUS_CLASSES.ENCOUNTER_DATES,
        RETAINED_LOCUS_CLASSES.ENCOUNTER_IDENTIFIERS,
      ],
    });
    // Exactly the loci the carve-out already kept before this change, and not one more: every newly
    // classified date locus is acted on by the configured policy transform whatever is retained.
    const kept = manifest.filter((m) => m.disposition === "retained").map((m) => m.locus);
    expect(kept.sort()).toEqual([
      "DG1-5",
      "DG1[1]-5",
      "OBR-2",
      "OBR-3",
      "OBR-7",
      "ORC-2",
      "ORC-3",
      "PV1-19[0]",
      "PV1-44",
      "PV1-45",
    ]);
  });

  it("AC-19: the reserved name with a non-empty retention set is the existing fatal", () => {
    expect(() =>
      deidentifyHl7(parseHL7(loadFixture("orm-o01-retained-dates")), {
        policy: "safe-harbor",
        context: ctx,
        retainedLoci: [RETAINED_LOCUS_CLASSES.ENCOUNTER_DATES],
      }),
    ).toThrowError(expect.objectContaining({ code: FATAL_CODES.DEID_POLICY_INVALID }));
  });

  it("a policy whose transform table reaches none of these loci still blocks and records them", () => {
    // A hand-built policy object with an empty transform table: no rule reaches category (C). The
    // engine has no fourth outcome, so the locus fails closed and is recorded blocked.
    const bare = { name: "bare", transforms: {} } as unknown as DeidPolicy;
    const { document, manifest } = deidentifyHl7(
      parseHL7([MSH, "EVN|A01|20240315103000"].join("\r")),
      { policy: bare, context: ctx },
    );
    expect(document.get("EVN.2")).toBeUndefined();
    const entry = manifest.find((m) => m.locus === "EVN-2[0]");
    expect(entry?.disposition).toBe("blocked");
    expect(entry?.code).toBe(D.DEID_LOCUS_BLOCKED);
  });
});

describe("AC-5: byte-identical output AND manifest, in document order", () => {
  it("two runs of the same input produce byte-identical output and manifest", () => {
    const a = deidentifyHl7(
      parseHL7(loadFixture("orm-o01-retained-dates")),
      profileOptions(SAFE_HARBOR_PROFILE, ctx),
    );
    const b = deidentifyHl7(
      parseHL7(loadFixture("orm-o01-retained-dates")),
      profileOptions(SAFE_HARBOR_PROFILE, ctx),
    );
    expect(a.document.toString()).toBe(b.document.toString());
    expect(JSON.stringify(a.manifest)).toBe(JSON.stringify(b.manifest));
  });

  it("entries appear in one total order derived from the position of the locus in the document", () => {
    const { manifest } = deidentifyHl7(
      parseHL7(loadFixture("orm-o01-retained-dates")),
      profileOptions(SAFE_HARBOR_PROFILE, ctx),
    );
    const order = manifest.map((m) => m.locus);
    // Segment order first, then ascending field / repetition / component inside a segment.
    expect(order.indexOf("MSH-7[0]")).toBeLessThan(order.indexOf("EVN-2[0]"));
    expect(order.indexOf("EVN-2[0]")).toBeLessThan(order.indexOf("EVN-3[0]"));
    expect(order.indexOf("PV1-19[0]")).toBeLessThan(order.indexOf("PV1-37[0].2"));
    expect(order.indexOf("PV1-37[0].2")).toBeLessThan(order.indexOf("PV1-44"));
    expect(order.indexOf("SPM-17[0].1")).toBeLessThan(order.indexOf("SPM-17[0].2"));
    expect(order.indexOf("DG1-19[0]")).toBeLessThan(order.indexOf("DG1[1]-5"));
  });

  it("an aggregated entry sits at the position of its first contributing occurrence", () => {
    // Two identical blocked date loci in one segment aggregate into one entry, which keeps the
    // position of the first: the entry for the LATER field still follows it.
    const msg = parseHL7([MSH, "EVN|A01|GARBLED|GARBLED|", "PV2||||||||20240309120000"].join("\r"));
    const { manifest } = deidentifyHl7(msg, profileOptions(SAFE_HARBOR_PROFILE, ctx));
    const order = manifest.map((m) => m.locus);
    expect(order.indexOf("EVN-2[0]")).toBeLessThan(order.indexOf("PV2-8[0]"));
  });
});

describe("AC-12: the transformed message must round-trip through its parser", () => {
  it("the whole fixture round-trips under both profiles", () => {
    for (const options of [
      profileOptions(SAFE_HARBOR_PROFILE, ctx),
      profileOptions(LIMITED_DATA_SET_PROFILE, ctx),
    ]) {
      const { document } = deidentifyHl7(parseHL7(loadFixture("orm-o01-retained-dates")), options);
      const wire = document.toString();
      expect(parseHL7(wire).toString()).toBe(wire);
    }
  });

  it("a message that cannot be re-parsed is a typed fatal, and no document is returned", () => {
    // A hand-built message with no MSH envelope: it serializes, but the parser refuses the result,
    // so the pass fails closed instead of handing back a partially transformed document.
    const msg = new Hl7Message({
      segments: [
        {
          name: "EVN",
          fields: [
            { repetitions: [{ components: [{ subcomponents: ["EVN"] }] }], isNull: false },
            { repetitions: [{ components: [{ subcomponents: ["A01"] }] }], isNull: false },
            {
              repetitions: [{ components: [{ subcomponents: ["20240315103000"] }] }],
              isNull: false,
            },
          ],
        },
      ],
      encodingCharacters: DEFAULT_ENCODING_CHARACTERS,
      version: "2.5.1",
      warnings: [],
    });
    expect(() => deidentifyHl7(msg, profileOptions(SAFE_HARBOR_PROFILE, ctx))).toThrowError(
      expect.objectContaining({ code: FATAL_CODES.DEID_OUTPUT_INVALID }),
    );
  });
});

describe("AC-7: the new loci reach the Expert-Determination support report", () => {
  it("they appear in the category coverage and in the retained-quasi-identifier inventory", () => {
    const { manifest } = deidentifyHl7(
      parseHL7(loadFixture("orm-o01-retained-dates")),
      profileOptions(SAFE_HARBOR_PROFILE, ctx),
    );
    const report = buildExpertDeterminationSupportReport(manifest, { policy: "safe-harbor" });
    const dates = report.categoryCoverage.find((c) => c.category === C.DATES);
    expect(dates?.actedOn).toBe(true);
    expect(dates?.residualRetained).toBe(true);
    expect(dates?.totalCount).toBeGreaterThanOrEqual(DATE_LOCI.length);
    const inventory = report.retainedQuasiIdentifiers.map((r) => r.locus);
    for (const locus of ["ORC-9[0]", "ORC-15[0]", "SPM-17[0].1", "OBX[3]-5[0].2"]) {
      expect(inventory).toContain(locus);
    }
  });
});
