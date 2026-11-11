/**
 * The HL7 v2 round-trip check reads and writes the transformed message **once** each, and hands back
 * the wire it wrote, so text in, text out reads every message twice (the caller's parse and the
 * check's) and writes it twice (the output and the check's write back), where it used to read it
 * three times and write it four. The fixed-point rule the check enforces is unchanged: a wire one
 * canonicalization step from the parser's own form is still read and written a second time, and a
 * wire that does not settle is still refused.
 *
 * Every message is synthetic.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import * as hl7 from "@cosyte/hl7";
import { Hl7Message } from "@cosyte/hl7";

import { createDeidContext, profileOptions, SAFE_HARBOR_PROFILE } from "../../src/index.js";
import { deidentifyHl7, deidentifyHl7String } from "../../src/hl7/index.js";
import { hl7Message } from "../../bench/shapes.mjs";

vi.mock("@cosyte/hl7", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@cosyte/hl7")>();
  return { ...actual, parseHL7: vi.fn(actual.parseHL7) };
});

const ctx = createDeidContext({ key: "round-trip-cost-key", patientId: "p-cost" });

afterEach(() => {
  vi.restoreAllMocks();
  vi.mocked(hl7.parseHL7).mockClear();
});

describe("the HL7 v2 round-trip check reads and writes the message once", () => {
  it("reads the transformed message once and writes it once beside the output", () => {
    const msg = hl7.parseHL7(hl7Message(3));
    vi.mocked(hl7.parseHL7).mockClear();
    const writes = vi.spyOn(Hl7Message.prototype, "toString");
    const result = deidentifyHl7(msg, profileOptions(SAFE_HARBOR_PROFILE, ctx));
    expect(vi.mocked(hl7.parseHL7)).toHaveBeenCalledTimes(1);
    // One write is the output itself, the other the check writing back what it read.
    expect(writes).toHaveBeenCalledTimes(2);
    writes.mockRestore();
    expect(result.hl7).toBe(result.document.toString());
  });

  it("the string entry point is the parse and the adapter, with the same result", () => {
    const raw = hl7Message(5);
    const fromString = deidentifyHl7String(raw, profileOptions(SAFE_HARBOR_PROFILE, ctx));
    const fromModel = deidentifyHl7(hl7.parseHL7(raw), profileOptions(SAFE_HARBOR_PROFILE, ctx));
    expect(fromString.hl7).toBe(fromModel.hl7);
    expect(fromString.manifest).toEqual(fromModel.manifest);
    expect(fromString.unexaminedResiduals).toEqual(fromModel.unexaminedResiduals);
  });

  it("a wire one canonicalization step away is read again, settles, and is returned as written", () => {
    // Read without trimming, a retained OBX value keeps its padding; the check's own read trims it,
    // so the first write back differs from the wire and the canonical form is read a second time.
    const raw = [
      "MSH|^~\\&|A|B|C|D|20240315103000||ORU^R01|M1|P|2.5.1",
      "PID|1||ZZMRN0001^^^HOSP^MR||ZZFAMILY^ZZGIVEN",
      "OBX|1|NM|2951-2^Sodium^LN||  140  |mmol/L",
    ].join("\r");
    const msg = hl7.parseHL7(raw, { trimFields: false });
    vi.mocked(hl7.parseHL7).mockClear();
    const result = deidentifyHl7(msg, profileOptions(SAFE_HARBOR_PROFILE, ctx));
    expect(vi.mocked(hl7.parseHL7)).toHaveBeenCalledTimes(2);
    expect(result.hl7).toContain("|  140  |");
    expect(result.hl7).toBe(result.document.toString());
    expect(result.hl7).not.toContain("ZZMRN0001");
    expect(result.hl7).not.toContain("ZZFAMILY");
  });
});
