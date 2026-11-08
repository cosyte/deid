/**
 * **NCPDP Telecom: a transmission carrying more than one transaction is refused, typed.**
 *
 * `@cosyte/ncpdp` 0.1 decodes every group-separated transaction a transmission carries, and this
 * adapter de-identifies one. Before the refusal, a two-transaction transmission reached the
 * serializer and escaped as `@cosyte/ncpdp`'s own `NCPDP_TELECOM_BUILD_MULTI_TRANSACTION_EMIT`, an
 * error from outside this package's fatal set (and an older parser returned the first transaction
 * alone, the rest dropped). Both entry points now refuse first: a typed `DEID_FORMAT_UNSUPPORTED`, a
 * message that carries no byte of the document, and no transformed document, manifest or partial
 * output. The control half: a one-transaction transmission is de-identified exactly as before.
 *
 * Every value is a synthetic, ZZ-tagged sentinel from the committed fixture.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseTelecom } from "@cosyte/ncpdp/telecom";
import { createDeidContext, DeidError, FATAL_CODES } from "../../src/index.js";
import {
  deidentifyTelecom,
  deidentifyTelecomString,
  NCPDP_MULTI_TRANSACTION_REFUSAL_MESSAGE,
} from "../../src/ncpdp/index.js";

const ctx = createDeidContext({ key: "multi-transaction-key", patientId: "p-multi" });
const ONE = readFileSync(
  join(import.meta.dirname, "..", "fixtures", "ncpdp", "telecom-b1.ncpdp"),
  "latin1",
);

/** Byte 20 of the D.0 request header is 109-A9, the declared transaction count. */
const COUNT_OFFSET = 20;

/** The committed one-transaction claim, declaring two and carrying a second, group-separated one. */
const TWO =
  ONE.slice(0, COUNT_OFFSET) +
  "2" +
  ONE.slice(COUNT_OFFSET + 1) +
  "\x1d\x1eAM07\x1cD2RX0000002\x1cE103\x1cD700071015527";

/** Run `call` and return what it threw, or fail when it returned. */
function thrownBy(call: () => unknown): unknown {
  try {
    call();
  } catch (err) {
    return err;
  }
  throw new Error("expected a refusal, and the call returned");
}

describe("NCPDP Telecom: more than one transaction is refused, typed", () => {
  it("the fixture really decodes to two transactions (non-vacuity)", () => {
    expect(ONE.slice(COUNT_OFFSET, COUNT_OFFSET + 1)).toBe("1");
    const tx = parseTelecom(TWO);
    expect(tx.transactionCount).toBe("2");
    expect(tx.decodedTransactionCount).toBe(2);
  });

  it("deidentifyTelecom refuses with DEID_FORMAT_UNSUPPORTED and the fixed message", () => {
    const err = thrownBy(() => deidentifyTelecom(parseTelecom(TWO), { context: ctx }));
    expect(err).toBeInstanceOf(DeidError);
    expect((err as DeidError).code).toBe(FATAL_CODES.DEID_FORMAT_UNSUPPORTED);
    expect((err as DeidError).message).toContain(NCPDP_MULTI_TRANSACTION_REFUSAL_MESSAGE);
  });

  it("deidentifyTelecomString refuses the same way", () => {
    const err = thrownBy(() => deidentifyTelecomString(TWO, { context: ctx }));
    expect(err).toBeInstanceOf(DeidError);
    expect((err as DeidError).code).toBe(FATAL_CODES.DEID_FORMAT_UNSUPPORTED);
  });

  it("the refusal carries no byte of the document", () => {
    const err = thrownBy(() => deidentifyTelecomString(TWO, { context: ctx }));
    const text = `${(err as Error).message} ${String((err as Error).stack)}`;
    for (const sentinel of ["ZZPATFIRST", "ZZPATLAST", "ZZPATIENTID", "RX0000002", "PHARM123"]) {
      expect(text).not.toContain(sentinel);
    }
  });

  it("CONTROL: a one-transaction transmission is still de-identified", () => {
    const { telecom, manifest } = deidentifyTelecomString(ONE, { context: ctx });
    expect(manifest.length).toBeGreaterThan(0);
    expect(telecom).not.toContain("ZZPATLAST");
    expect(parseTelecom(telecom).decodedTransactionCount).toBe(1);
  });
});
