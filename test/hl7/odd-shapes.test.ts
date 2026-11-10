/**
 * HL7 v2 adapter on the shapes the headline fixtures never send, and on coordinates and messages a
 * JavaScript caller hands the public `applyHl7` / `extractHl7Loci` directly.
 *
 * The wire half: a limited-data-set address with no city, a visit number whose first repetition is
 * empty, a date-range observation with no end date, and an unexamined field that repeats. The
 * hand-built half: write-back coordinates naming a repetition or component the field does not have,
 * coordinate lists with holes, and a parsed message whose repetition and component lists a caller left
 * holes in. Each one writes nothing it was not asked to, counts what it hands through, and never
 * crashes the pass.
 *
 * All values are synthetic `ZZ` sentinels.
 */

import { parseHL7 } from "@cosyte/hl7";
import { describe, expect, it } from "vitest";

import {
  createDeidContext,
  LIMITED_DATA_SET_PROFILE,
  profileOptions,
  type DeidOptions,
  type TransformedLocus,
} from "../../src/index.js";
import { applyHl7, deidentifyHl7, extractHl7Loci, type Hl7Coord } from "../../src/hl7/index.js";

const ctx = createDeidContext({ key: "odd-shape-key-synthetic-hmac", patientId: "p" });
const MSH = "MSH|^~\\&|SENDAPP|SENDFAC|RECVAPP|RECVFAC|20200101||ADT^A01|SYNTHMSG1|P|2.5";

/**
 * A segment built from its fields. The id is JOINED rather than written as a literal prefix, so the
 * PHI scanner reading this module's string literals never sees a segment whose first field is the
 * template's own punctuation.
 */
function segment(id: string, fields: Record<number, string>): string {
  const highest = Math.max(...Object.keys(fields).map(Number));
  const out = new Array<string>(highest).fill("");
  for (const [n, value] of Object.entries(fields)) out[Number(n) - 1] = value;
  return [id, ...out].join("|");
}

function message(...segments: string[]): string {
  return [MSH, ...segments].join("\r");
}

function run(raw: string, options: DeidOptions = { context: ctx }) {
  const result = deidentifyHl7(parseHL7(raw), options);
  return {
    wire: result.document.toString(),
    get: (path: string) => result.document.get(path),
    rows: result.manifest.map((m) => `${m.locus} ${m.disposition}`),
    residuals: result.unexaminedResiduals.map((r) => r.locus),
  };
}

describe("deidentifyHl7, partial values on the wire", () => {
  it("keeps the named parts a limited-data-set address does carry when it has no city", () => {
    const out = run(
      message(segment("PID", { 1: "1", 11: "ZZSTREET^^^IL^62704" })),
      profileOptions(LIMITED_DATA_SET_PROFILE, ctx),
    );
    expect(out.wire).not.toContain("ZZSTREET");
    expect(out.get("PID.11.4")).toBe("IL");
    expect(out.get("PID.11.5")).toBe("62704");
    // No row for the city it never carried: a retained row is a part that was really kept.
    expect(out.rows.filter((r) => r.startsWith("PID-11"))).toEqual([
      "PID-11[0].4 retained",
      "PID-11[0].5 retained",
    ]);
  });

  it("acts on each populated repetition of a visit number and skips an empty one", () => {
    const out = run(message(segment("PV1", { 1: "1", 2: "I", 19: "~ZZVISITNUMBER^^^^VN" })));
    expect(out.wire).not.toContain("ZZVISITNUMBER");
    expect(out.rows.filter((r) => r.startsWith("PV1-19"))).toEqual(["PV1-19[1] blocked"]);
  });

  it("acts on the start of a date range whose end is empty, and emits nothing for the end", () => {
    const out = run(
      message(segment("OBX", { 1: "1", 2: "DR", 3: "1^x^L", 5: "20200101^" })).replace(
        "ADT^A01",
        "ORU^R01",
      ),
    );
    expect(out.rows.filter((r) => r.startsWith("OBX"))).toEqual(["OBX-5[0].1 transformed"]);
    expect(out.get("OBX.5.1")).toBe("2020");
  });

  it("locates an unexamined position in a repeating field by its repetition", () => {
    const out = run(
      message(segment("AL1", { 1: "1", 2: "DA", 3: "^ZZALLERGEN", 5: "HIVES~RASH" })),
    );
    expect(out.residuals).toContain("AL1-5[0]");
    expect(out.residuals).toContain("AL1-5[1]");
  });
});

describe("extractHl7Loci, a parsed message a caller left holes in", () => {
  it("skips a missing repetition or component rather than crashing or counting it", () => {
    const msg = parseHL7(message(segment("AL1", { 1: "1", 2: "DA", 4: "SV", 5: "HIVES~RASH" })));
    const al1 = msg.rawSegments[1];
    const severity = al1?.fields[4]?.repetitions[0];
    const reactions = al1?.fields[5]?.repetitions;
    if (severity === undefined || reactions === undefined) throw new Error("fixture shape");
    Reflect.deleteProperty(severity.components, 0);
    Reflect.deleteProperty(reactions, 0);
    const residuals = extractHl7Loci(msg).unexaminedResiduals.map((r) => r.locus);
    expect(residuals.filter((l) => l.startsWith("AL1"))).toEqual(["AL1-1", "AL1-2", "AL1-5[1]"]);
  });
});

describe("applyHl7, coordinates naming a repetition or component the field does not have", () => {
  const RAW = message(segment("PID", { 1: "1", 7: "19700101^Y", 11: "ZZSTREET^^ZZCITY^IL^62704" }));
  const shifted: TransformedLocus = {
    path: "x",
    kind: "date",
    value: "ZZWRITTEN",
    disposition: "transformed",
  };

  /** Apply one coordinate and return PID-7 and PID-11 as they come out. */
  function applyOne(coord: Hl7Coord): { dob: string; address: string } {
    const out = applyHl7(parseHL7(RAW), [shifted], [coord]);
    const pid = out.toString().split("\r")[1]?.split("|") ?? [];
    return { dob: out.get("PID.7") ?? "", address: pid[11] ?? "" };
  }

  const untouched = { dob: "19700101", address: "ZZSTREET^^ZZCITY^IL^62704" };

  it("leaves the field alone for a date edit on a repetition it does not have", () => {
    expect(applyOne({ segIndex: 1, field: 7, rep: 3, edit: "date-field" })).toEqual(untouched);
    expect(
      applyOne({ segIndex: 1, field: 7, rep: 3, edit: "date-component", component: 1 }),
    ).toEqual(untouched);
  });

  it("leaves the field alone for a date-component edit with no component or one out of range", () => {
    for (const component of [undefined, 0, 9]) {
      const coord: Hl7Coord = {
        segIndex: 1,
        field: 7,
        rep: 0,
        edit: "date-component",
        ...(component === undefined ? {} : { component }),
      };
      expect(applyOne(coord), `component ${String(component)}`).toEqual(untouched);
    }
  });

  it("leaves the address alone for a part or ZIP edit on a repetition it does not have", () => {
    expect(
      applyOne({ segIndex: 1, field: 11, rep: 3, edit: "address-part", component: 3 }),
    ).toEqual(untouched);
    expect(applyOne({ segIndex: 1, field: 11, rep: 0, edit: "address-part" })).toEqual(untouched);
    expect(applyOne({ segIndex: 1, field: 11, rep: 3, edit: "address-zip" })).toEqual(untouched);
  });

  it("still reduces the address, and writes nothing, for a part edit past the five kept slots", () => {
    const out = applyOne({ segIndex: 1, field: 11, rep: 0, edit: "address-part", component: 9 });
    expect(out.dob).toBe("19700101");
    // Reduced to its kept slots, every one empty, so the repetition is dropped outright.
    expect(out.address).toBe("");
  });

  it("skips a coordinate with no transformed locus beside it, and a hole in the coordinate list", () => {
    const coords: Hl7Coord[] = [];
    coords[1] = { segIndex: 1, field: 7, rep: 0, edit: "date-field" }; // index 0 is a hole
    coords[2] = { segIndex: 1, field: 11, rep: 0, edit: "address-zip" }; // no transformed[2]
    const out = applyHl7(parseHL7(RAW), [shifted, shifted], coords);
    expect(out.get("PID.7.1")).toBe("ZZWRITTEN");
    expect(out.get("PID.7.2")).toBe("Y");
    expect(out.toString()).toContain("ZZSTREET^^ZZCITY^IL^62704");
  });
});
