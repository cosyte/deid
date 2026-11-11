/**
 * **NCPDP Telecom: one transaction that carries two patients is refused, typed.**
 *
 * A request can declare one transaction, carry no Group Separator, and still hold a second patient's
 * Patient and Claim segments after the first's. The parser decodes one transaction with repeated
 * segments in it. Every segment is de-identified, so nothing leaks, but the second patient's values
 * would be transformed under the caller's single patient context, which links two people's records
 * (one date-shift offset). Both entry points now refuse a transaction that
 * carries a repeated Patient or Claim segment, before anything is extracted.
 *
 * Every value is a synthetic, ZZ-tagged sentinel from the committed fixture or this file.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseTelecom } from "@cosyte/ncpdp/telecom";
import { createDeidContext, DeidError, FATAL_CODES } from "../../src/index.js";
import { deidentifyTelecom, deidentifyTelecomString } from "../../src/ncpdp/index.js";
import { REPEATED_SEGMENT_REFUSAL_MESSAGE } from "../../src/ncpdp/multi-transaction-refusal.js";

const ctx = createDeidContext({ key: "repeated-segment-key", patientId: "p-repeated" });
const ONE = readFileSync(
  join(import.meta.dirname, "..", "fixtures", "ncpdp", "telecom-b1.ncpdp"),
  "latin1",
);

/** A second patient's Patient and Claim segments, appended to the one declared transaction. */
const TWO_PATIENTS =
  ONE +
  "\x1eAM01\x1cCAZZSECONDFIRST\x1cCBZZSECONDLAST\x1cC419700101\x1cCYZZSECONDPATID" +
  "\x1eAM07\x1cD2RX0000002\x1cE103\x1cD700071015527";

/** One Patient segment and two Claim segments. */
const TWO_CLAIMS = ONE + "\x1eAM07\x1cD2RX0000003\x1cE103\x1cD700071015527";

/** Two Patient segments and one Claim segment. */
const TWO_PATIENT_SEGMENTS = ONE + "\x1eAM01\x1cCAZZSECONDFIRST\x1cCBZZSECONDLAST\x1cC51";

/** The telecom code of the declared count disagreeing with the decode. */
const COUNT_MISMATCH = "NCPDP_TELECOM_TRANSACTION_COUNT_MISMATCH";

/** Run `call` and return what it threw, or fail when it returned. */
function thrownBy(call: () => unknown): unknown {
  try {
    call();
  } catch (err) {
    return err;
  }
  throw new Error("expected a refusal, and the call returned");
}

function countOf(raw: string, segmentId: string): number {
  return parseTelecom(raw).segments.filter((s) => s.segmentId === segmentId).length;
}

describe("NCPDP Telecom: a transaction with two patients is refused, typed", () => {
  it("the shape really decodes as one transaction with repeated segments (non-vacuity)", () => {
    const tx = parseTelecom(TWO_PATIENTS);
    expect(tx.transactionCount).toBe("1");
    expect(tx.decodedTransactionCount).toBe(1);
    expect(tx.warnings.map((w) => w.code)).not.toContain(COUNT_MISMATCH);
    expect(countOf(TWO_PATIENTS, "01")).toBe(2);
    expect(countOf(TWO_PATIENTS, "07")).toBe(2);
  });

  it("both entry points refuse a repeated Patient and Claim segment pair", () => {
    for (const call of [
      () => deidentifyTelecom(parseTelecom(TWO_PATIENTS), { context: ctx }),
      () => deidentifyTelecomString(TWO_PATIENTS, { context: ctx }),
    ]) {
      const err = thrownBy(call);
      expect(err).toBeInstanceOf(DeidError);
      expect((err as DeidError).code).toBe(FATAL_CODES.DEID_FORMAT_UNSUPPORTED);
      expect((err as DeidError).message).toBe(REPEATED_SEGMENT_REFUSAL_MESSAGE);
      const text = `${(err as Error).message} ${String((err as Error).stack)}`;
      for (const sentinel of ["ZZSECONDFIRST", "ZZSECONDLAST", "ZZSECONDPATID", "RX0000002"]) {
        expect(text).not.toContain(sentinel);
      }
    }
  });

  it("a repeated Claim segment alone is refused", () => {
    expect(countOf(TWO_CLAIMS, "01")).toBe(1);
    expect(countOf(TWO_CLAIMS, "07")).toBe(2);
    const err = thrownBy(() => deidentifyTelecomString(TWO_CLAIMS, { context: ctx }));
    expect((err as DeidError).code).toBe(FATAL_CODES.DEID_FORMAT_UNSUPPORTED);
  });

  it("a repeated Patient segment alone is refused", () => {
    expect(countOf(TWO_PATIENT_SEGMENTS, "01")).toBe(2);
    expect(countOf(TWO_PATIENT_SEGMENTS, "07")).toBe(1);
    const err = thrownBy(() => deidentifyTelecomString(TWO_PATIENT_SEGMENTS, { context: ctx }));
    expect((err as DeidError).code).toBe(FATAL_CODES.DEID_FORMAT_UNSUPPORTED);
  });

  it("CONTROL: one Patient and one Claim segment is still de-identified", () => {
    expect(countOf(ONE, "01")).toBe(1);
    expect(countOf(ONE, "07")).toBe(1);
    const { telecom, manifest } = deidentifyTelecomString(ONE, { context: ctx });
    expect(manifest.length).toBeGreaterThan(0);
    expect(telecom).not.toContain("ZZPATLAST");
  });
});
