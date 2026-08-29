/**
 * **The employer is the individual's, not an unrelated organisation** (HL7 v2 half).
 *
 * `RETAIN_SEGMENTS` gates whole segments and a non-mapped field inside a mapped segment is left
 * untouched, so before this change an employer name at `GT1-16`, an employer address at `GT1-17` or an
 * employer phone at `IN2-64` rode through a retained guarantor or insurance segment untouched **and
 * unrecorded**, while §164.514(b)(2)(i) puts the individual's employer inside the removal list. This
 * suite pins the closure and its mirror control:
 *
 * - **AC4** every newly named employer position is acted on under the Safe Harbor category its v2.5.1
 *   data type carries, and recorded with its structural locus;
 * - **AC5** `IN2-70`, which the standard types as an organisation, goes through the same party-role
 *   test the X12 adapter applies, and fails closed because an employer is never outside the clause;
 * - **AC6** the coded employment status (`GT1-20`) and the **insurer's own** company name, address and
 *   phone (`IN1-3/4/5/7`) are unchanged: closing an under-removal gap opens no over-removal one.
 *
 * Field numbering and data types are the v2.5.1 chapter 6 segment definitions. Every seeded value is a
 * synthetic, tagged sentinel; the fixture is declared synthetic in `scripts/phi-allow-list.txt`.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import { parseHL7 } from "@cosyte/hl7";

import {
  DEID_DISPOSITION_CODES,
  SAFE_HARBOR_CATEGORIES,
  classifyPartyRole,
  createDeidContext,
} from "../../src/index.js";
import {
  HL7_LOCUS_MAP,
  HL7_ORGANISATION_PARTY_RULES,
  HL7_PARTY_ROLES,
  HL7_PARTY_ROLE_TABLE,
  deidentifyHl7,
} from "../../src/hl7/index.js";

const C = SAFE_HARBOR_CATEGORIES;
const D = DEID_DISPOSITION_CODES;
const FIXTURES = join(import.meta.dirname, "..", "fixtures", "hl7");

const ctx = createDeidContext({ key: "hl7-employer-key", patientId: "patient-hl7-emp" });

/** Load a fixture and normalize its line endings to HL7 `\r` segment separators. */
function loadFixture(name: string): string {
  return readFileSync(join(FIXTURES, `${name}.hl7`), "utf8")
    .trim()
    .split(/\r?\n/)
    .join("\r");
}

const RAW = loadFixture("adt-a01");
const pass = (): ReturnType<typeof deidentifyHl7> => deidentifyHl7(parseHL7(RAW), { context: ctx });

/**
 * The nine positions AC4 names, with the category each one's v2.5.1 data type carries, the locus the
 * manifest records it at, and the sentinel the fixture seeds there.
 */
const EMPLOYER_POSITIONS: readonly {
  readonly position: string;
  readonly locus: string;
  readonly category: string;
  readonly sentinel: string;
}[] = [
  // GT1-16 Guarantor Employer Name (XPN)
  { position: "GT1-16", locus: "GT1-16", category: C.NAMES, sentinel: "ZZGTEMPFAMILY" },
  // GT1-17 Guarantor Employer Address (XAD): one locus per repetition
  { position: "GT1-17", locus: "GT1-17[0]", category: C.GEOGRAPHIC, sentinel: "ZZGTEMPSTREET" },
  // GT1-18 Guarantor Employer Phone Number (XTN)
  { position: "GT1-18", locus: "GT1-18", category: C.PHONE, sentinel: "5550000007" },
  // GT1-29 Guarantor Employer ID Number (CX): an identifier, reached by the (R) catch-all
  { position: "GT1-29", locus: "GT1-29[0]", category: C.OTHER_UNIQUE_ID, sentinel: "ZZGTEMPEIN" },
  // IN1-10 Insured's Group Emp. ID (CX)
  {
    position: "IN1-10",
    locus: "IN1-10[0]",
    category: C.OTHER_UNIQUE_ID,
    sentinel: "ZZINSGRPEMPID",
  },
  // IN1-11 Insured's Group Emp Name (XON)
  { position: "IN1-11", locus: "IN1-11", category: C.NAMES, sentinel: "ZZINSGRPEMPNAME" },
  // IN2-49 Employer Contact Person Name (XPN)
  { position: "IN2-49", locus: "IN2-49", category: C.NAMES, sentinel: "ZZEMPCONTACTFAM" },
  // IN2-50 Employer Contact Person Phone Number (XTN)
  { position: "IN2-50", locus: "IN2-50", category: C.PHONE, sentinel: "5550000008" },
  // IN2-64 Insured's Employer Phone Number (XTN)
  { position: "IN2-64", locus: "IN2-64", category: C.PHONE, sentinel: "5550000009" },
];

describe("AC4: every employer position is acted on and recorded", () => {
  for (const { position, locus, category, sentinel } of EMPLOYER_POSITIONS) {
    it(`${position}: the seeded value is present before the pass and gone after it`, () => {
      // Non-vacuity: a sentinel the fixture never carried would make its absence meaningless.
      expect(RAW).toContain(sentinel);
      expect(pass().document.toString()).not.toContain(sentinel);
    });

    it(`${position}: recorded at ${locus} under its v2.5.1 category`, () => {
      const entry = pass().manifest.find((e) => e.locus === locus);
      expect(entry, `no manifest entry at ${locus}`).toBeDefined();
      expect(entry?.category).toBe(category);
      // "acted on", never "handed through unrecorded": removal, generalization or a fail-closed block.
      expect(["removed", "transformed", "blocked"]).toContain(entry?.disposition);
    });
  }

  it("generalizes the employer address to the safe 3-digit ZIP and drops every finer component", () => {
    const { document } = pass();
    expect(document.get("GT1.17.5")).toBe("112"); // 11201 -> 112
    expect(document.get("GT1.17.1")).toBe(""); // street dropped
    expect(document.get("GT1.17.3")).toBe(""); // city dropped
  });

  it("names all nine positions in the shipped locus map, not just in this test", () => {
    const mapped = (segment: string): readonly number[] =>
      (HL7_LOCUS_MAP[segment] ?? []).map((r) => r.field);
    expect(mapped("GT1")).toEqual(expect.arrayContaining([16, 17, 18, 19, 29]));
    expect(mapped("IN1")).toEqual(expect.arrayContaining([10, 11]));
    expect(mapped("IN2")).toEqual(expect.arrayContaining([3, 49, 50, 64]));
  });
});

describe("AC5: IN2-70 is decided by the party-role test, and fails closed", () => {
  it("applies the same role test the X12 adapter applies to an organisation party", () => {
    const rule = HL7_ORGANISATION_PARTY_RULES["IN2"]?.[0];
    expect(rule?.field).toBe(70);
    expect(rule?.role).toBe(HL7_PARTY_ROLES.INSURED_EMPLOYER);
    // The employer is inside the clause, so the role can never be established as outside it.
    expect(classifyPartyRole(rule?.role ?? "", HL7_PARTY_ROLE_TABLE).scope).toBe(
      "safe-harbor-subject",
    );
    // And a role this table does not know fails closed rather than defaulting to retention.
    expect(classifyPartyRole("SOME_OTHER_PARTY", HL7_PARTY_ROLE_TABLE).scope).toBe("unknown");
  });

  it("blocks the organisation's NAME and its IDENTIFIER, and records the block with its locus", () => {
    expect(RAW).toContain("ZZEMPORGNAME");
    expect(RAW).toContain("ZZEMPORGID");
    const { document, manifest } = pass();
    const wire = document.toString();
    expect(wire).not.toContain("ZZEMPORGNAME"); // XON.1 organization name
    expect(wire).not.toContain("ZZEMPORGID"); // XON.10 organization identifier
    const entry = manifest.find((e) => e.locus === "IN2-70");
    expect(entry?.disposition).toBe("blocked");
    expect(entry?.code).toBe(D.DEID_LOCUS_BLOCKED);
    expect(entry?.category).toBe(C.OTHER_UNIQUE_ID);
    // It is a block, never a retained party: an employer is not outside the clause.
    expect(entry?.partyRole).toBeUndefined();
    expect(manifest.some((e) => e.code === D.DEID_PARTY_ROLE_RETAINED)).toBe(false);
  });

  it("empties the field cleanly rather than leaving component residue behind", () => {
    // A blocked field's repetitions drop to `[]`: it serializes as an empty field, never as `^^^`
    // residue that would still say how many components the organisation's entry had.
    const { document } = pass();
    expect(document.get("IN2.70.1")).toBeUndefined();
    expect(document.toString()).not.toContain("^^^^^^^^^");
  });
});

describe("AC6: closing the under-removal gap opens no over-removal one", () => {
  it("leaves the coded employment status at GT1-20 unchanged", () => {
    const original = parseHL7(RAW);
    const { document, manifest } = pass();
    expect(document.get("GT1.20")).toBe(original.get("GT1.20"));
    expect(document.get("GT1.20")).toBe("FT");
    // Not acted on at all: a coded status is not an identifier, so it earns no manifest row either.
    expect(manifest.some((e) => e.locus.startsWith("GT1-20"))).toBe(false);
  });

  it("leaves the insurer's own company id, name, address and phone unchanged", () => {
    const original = parseHL7(RAW);
    const { document, manifest } = pass();
    for (const path of ["IN1.3", "IN1.4", "IN1.5", "IN1.7"]) {
      expect(document.get(path), path).toBe(original.get(path));
    }
    // The insurer's address keeps its street and city: it is not the individual's geography.
    expect(document.get("IN1.5.1")).toBe("ORGADDR");
    expect(document.get("IN1.5.3")).toBe("ORGCITY");
    expect(document.get("IN1.5.5")).toBe("02101");
    for (const locus of ["IN1-3", "IN1-4", "IN1-5", "IN1-7"]) {
      expect(manifest.some((e) => e.locus.startsWith(`${locus}[`) || e.locus === locus)).toBe(
        false,
      );
    }
  });

  it("keeps the insurer values present in the serialized wire", () => {
    const wire = pass().document.toString();
    for (const value of ["INSCO001", "SYNTH INSURANCE CO", "ORGADDR", "ORGCITY", "5559990000"]) {
      expect(wire).toContain(value);
    }
  });
});
