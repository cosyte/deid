/**
 * **HL7 v2: a non-human patient.**
 *
 * HL7 v2.5.1 chapter 3 gives PID four fields for an animal: Species Code (`PID-35`, CWE), Breed Code
 * (`PID-36`, CWE), Strain (`PID-37`, ST) and Production Class Code (`PID-38`, CWE). They describe a
 * kind of animal, not one animal, and the locus map does not name them, so they are kept untouched as
 * non-identifier fields. The animal's name sits at `PID-5`, its microchip number in the identifier list
 * at `PID-3` (identifier type `MCN`, Microchip Number, in HL7 Table 0203), and its owner in `NK1`, and
 * every one of those is removed or replaced and recorded, as for a human patient.
 *
 * Every value is plainly fake and built here in the test.
 */

import { describe, expect, it } from "vitest";
import { parseHL7 } from "@cosyte/hl7";

import { createDeidContext } from "../../src/index.js";
import { HL7_LOCUS_MAP, deidentifyHl7 } from "../../src/hl7/index.js";

/** Plainly fake values: no registry, owner or code system holds any of them. */
const FAKE = {
  microchip: "ZZCHIP000000001",
  petName: "ZZPETNAME",
  ownerFamily: "ZZOWNERFAMILY",
  ownerGiven: "ZZOWNERGIVEN",
  ownerStreet: "1 ZZOWNER ST",
  ownerCity: "ZZOWNERCITY",
  ownerPhone: "5550000011",
  species: "ZZSPC01^ZZSYNTH CANINE^99ZZSYN",
  breed: "ZZBRD01^ZZSYNTH BEAGLE^99ZZSYN",
  strain: "ZZSTRAIN01",
  productionClass: "ZZPC01^ZZSYNTH COMPANION^99ZZSYN",
} as const;

/** A PID segment with the given 1-based fields set and every other field empty. */
function pid(fields: Readonly<Record<number, string>>): string {
  const values = Array.from({ length: 38 }, (_, i) => fields[i + 1] ?? "");
  return ["PID", ...values].join("|");
}

/** One synthetic ADT^A04 for a dog: the animal in PID, its owner in NK1. */
const RAW = [
  "MSH|^~\\&|ZZVETAPP|ZZVETCLINIC|ZZRECVAPP|ZZRECVFAC|20260101120000||ADT^A04|ZZVETMSG001|P|2.5.1",
  "EVN|A04|20260101120000",
  pid({
    1: "1",
    3: `${FAKE.microchip}^^^ZZREGISTRY^MCN`,
    5: `${FAKE.ownerFamily}^${FAKE.petName}`,
    7: "20200315",
    8: "F",
    35: FAKE.species,
    36: FAKE.breed,
    37: FAKE.strain,
    38: FAKE.productionClass,
  }),
  `NK1|1|${FAKE.ownerFamily}^${FAKE.ownerGiven}|OWN^Owner^HL70063|${FAKE.ownerStreet}^^${FAKE.ownerCity}^NY^10001|${FAKE.ownerPhone}`,
].join("\r");

const ctx = createDeidContext({ key: "hl7-animal-patient-key", patientId: "animal-patient" });
const pass = (): ReturnType<typeof deidentifyHl7> => deidentifyHl7(parseHL7(RAW), { context: ctx });

describe("PID-35 to PID-38 describe the animal, and are kept", () => {
  it("parses the four fields at the positions the test sets", () => {
    const msg = parseHL7(RAW);
    expect(msg.get("PID.35.2")).toBe("ZZSYNTH CANINE");
    expect(msg.get("PID.36.2")).toBe("ZZSYNTH BEAGLE");
    expect(msg.get("PID.37")).toBe(FAKE.strain);
    expect(msg.get("PID.38.2")).toBe("ZZSYNTH COMPANION");
  });

  it("keeps each of them whole in the output wire", () => {
    const { hl7 } = pass();
    const out = hl7.split("\r").find((s) => s.startsWith("PID|")) ?? "";
    expect(out.split("|").slice(35, 39)).toEqual([
      FAKE.species,
      FAKE.breed,
      FAKE.strain,
      FAKE.productionClass,
    ]);
  });

  it("writes no manifest row for them, because the locus map names none of them", () => {
    const { manifest } = pass();
    for (const field of [35, 36, 37, 38]) {
      expect(manifest.some((e) => e.locus.startsWith(`PID-${String(field)}`))).toBe(false);
    }
    const mapped = (HL7_LOCUS_MAP["PID"] ?? []).map((r) => r.field);
    for (const field of [35, 36, 37, 38]) expect(mapped).not.toContain(field);
  });
});

describe("the animal's own identifiers are removed or replaced, and recorded", () => {
  it("carries every identifying value in the input, so its absence below means something", () => {
    for (const value of [
      FAKE.microchip,
      FAKE.petName,
      FAKE.ownerFamily,
      FAKE.ownerGiven,
      FAKE.ownerStreet,
      FAKE.ownerCity,
      FAKE.ownerPhone,
    ]) {
      expect(RAW).toContain(value);
    }
  });

  it("removes the pet name at PID-5 and records it", () => {
    const { hl7, manifest } = pass();
    expect(hl7).not.toContain(FAKE.petName);
    const row = manifest.find((e) => e.locus === "PID-5");
    expect(row?.category).toBe("NAMES");
    expect(["removed", "transformed"]).toContain(row?.disposition);
  });

  it("removes or replaces the microchip number in PID-3 and records it", () => {
    const { hl7, manifest } = pass();
    expect(hl7).not.toContain(FAKE.microchip);
    const row = manifest.find((e) => e.locus === "PID-3[0]");
    expect(row, "no manifest row at PID-3[0]").toBeDefined();
    expect(["removed", "transformed"]).toContain(row?.disposition);
  });

  it("removes the owner's name, street, city and phone in NK1 and records each", () => {
    const { hl7, manifest } = pass();
    for (const value of [
      FAKE.ownerFamily,
      FAKE.ownerGiven,
      FAKE.ownerStreet,
      FAKE.ownerCity,
      FAKE.ownerPhone,
    ]) {
      expect(hl7, `owner value survived: ${value}`).not.toContain(value);
    }
    for (const locus of ["NK1-2", "NK1-4[0]", "NK1-5"]) {
      const row = manifest.find((e) => e.locus === locus);
      expect(row, `no manifest row at ${locus}`).toBeDefined();
      expect(["removed", "transformed", "blocked"]).toContain(row?.disposition);
    }
  });

  it("puts no value of the message in the manifest", () => {
    const serialized = JSON.stringify(pass().manifest);
    for (const value of [FAKE.microchip, FAKE.petName, FAKE.ownerFamily, FAKE.strain]) {
      expect(serialized).not.toContain(value);
    }
  });
});
