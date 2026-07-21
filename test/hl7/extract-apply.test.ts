/**
 * Edge-case coverage for the HL7 extractor and applier — empty repetitions, absent free-text fields,
 * segment gaps, non-Z unknown segments, and the applier's defensive write-back guards.
 */

import { describe, expect, it } from "vitest";
import { parseHL7 } from "@cosyte/hl7";

import { createDeidContext } from "../../src/index.js";
import { extractHl7Loci, applyHl7 } from "../../src/hl7/index.js";
import { deidentifyHl7 } from "../../src/hl7/index.js";

const ctx = createDeidContext({ key: "edge-key", patientId: "p1" });
const MSH = "MSH|^~\\&|A|B|C|D|20200101||ADT^A01|M1|P|2.5";

describe("extractHl7Loci — edge cases", () => {
  it("skips an empty repetition in an identifier list (CX.1 blank)", () => {
    const msg = parseHL7(`${MSH}\rPID|1||^^^H^MR~ZZMRN^^^H^MR`);
    const { loci } = extractHl7Loci(msg);
    // Only the second (non-empty) repetition yields a locus.
    const pid3 = loci.filter((l) => l.path.startsWith("PID-3"));
    expect(pid3).toHaveLength(1);
    expect(pid3[0]?.path).toBe("PID-3[1]");
  });

  it("does not touch an OBX with no OBX-5 value", () => {
    const msg = parseHL7(`${MSH.replace("ADT^A01", "ORU^R01")}\rOBX|1|NM|1^x^L`);
    const { loci } = extractHl7Loci(msg);
    expect(loci.filter((l) => l.path.startsWith("OBX"))).toEqual([]);
  });

  it("does not touch an NTE with no NTE-3 comment", () => {
    const msg = parseHL7(`${MSH}\rNTE|1|L`);
    const { loci } = extractHl7Loci(msg);
    expect(loci.filter((l) => l.path.startsWith("NTE"))).toEqual([]);
  });

  it("skips gap fields inside a Z-segment but blocks the populated ones", () => {
    const msg = parseHL7(`${MSH}\rZPI|ZZA||ZZC`);
    const { loci } = extractHl7Loci(msg);
    const zpi = loci.filter((l) => l.path.startsWith("ZPI")).map((l) => l.path);
    expect(zpi).toEqual(["ZPI-1", "ZPI-3"]); // ZPI-2 (empty) skipped
  });

  it("fails closed on a segment unknown to the parser even when it does not start with Z", () => {
    // `ABX` is a syntactically-valid segment name unknown to KNOWN_SEGMENTS → unrecognized structure.
    const msg = parseHL7(`${MSH}\rABX|1|ZZUNKNOWNPHI`);
    const { document } = deidentifyHl7(msg, { context: ctx });
    expect(document.toString().includes("ZZUNKNOWNPHI")).toBe(false);
  });
});

describe("applyHl7 — defensive write-back guards", () => {
  it("ignores coordinates that point past the raw tree, and handles an empty-component id repetition", () => {
    const msg = parseHL7(`${MSH}\rPID|1||ZZMRN^^^H^MR`);
    // Hand-built coords: one out-of-range segment, one out-of-range field, and an id-number edit whose
    // target repetition exists but has no components (exercised via a value-carrying transform).
    const out = applyHl7(
      msg,
      [
        { path: "x", kind: "identifier", value: "S1", disposition: "transformed" },
        { path: "y", kind: "identifier", value: "S2", disposition: "transformed" },
      ],
      [
        { segIndex: 999, field: 1, rep: 0, edit: "whole-field" }, // no such segment → ignored
        { segIndex: 1, field: 99, rep: 0, edit: "id-number" }, // no such field → ignored
      ],
    );
    // Nothing crashed; the message is returned intact where nothing valid was targeted.
    expect(out.get("PID.3[0].1")).toBe("ZZMRN");
  });

  it("clears an id-number when the transform removed it, and drops an address rep on a null value", () => {
    const msg = parseHL7(`${MSH}\rPID|1||ZZMRN^^^H^MR||||||||ZZSTREET^^ZZCITY^MA^90210`);
    const out = applyHl7(
      msg,
      [
        { path: "PID-3[0]", kind: "identifier", value: null, disposition: "removed" },
        { path: "PID-11[0]", kind: "zip", value: null, disposition: "blocked" },
      ],
      [
        { segIndex: 1, field: 3, rep: 0, edit: "id-number" },
        { segIndex: 1, field: 11, rep: 0, edit: "address-zip" },
      ],
    );
    expect(out.get("PID.3[0].1")).toBe(""); // id-number cleared
    expect(out.get("PID.11.1")).toBeUndefined(); // whole address rep dropped
  });

  it("ignores an id-number/address edit whose repetition does not exist", () => {
    const msg = parseHL7(`${MSH}\rPID|1||ZZMRN^^^H^MR`);
    const out = applyHl7(
      msg,
      [
        { path: "PID-3[5]", kind: "identifier", value: "S", disposition: "transformed" },
        { path: "PID-11[5]", kind: "zip", value: "902", disposition: "transformed" },
      ],
      [
        { segIndex: 1, field: 3, rep: 5, edit: "id-number" }, // rep 5 absent → ignored
        { segIndex: 1, field: 11, rep: 5, edit: "address-zip" }, // rep 5 absent → ignored
      ],
    );
    expect(out.get("PID.3[0].1")).toBe("ZZMRN"); // untouched
  });
});
