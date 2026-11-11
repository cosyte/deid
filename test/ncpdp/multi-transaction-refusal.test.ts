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
 * The refusal reads the header as well as the decode. A Group Separator starts each transaction and
 * what precedes the first belongs to the transmission, so a sender who leaves out the first one has
 * its first transaction decoded as transmission-level segments: one transaction decodes where two
 * were declared. Such a request is refused too, as is any whose declared count is above 1 or whose
 * decode carries the count-mismatch warning.
 *
 * Every value is a synthetic, ZZ-tagged sentinel from the committed fixture.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseTelecom, type TelecomTransaction } from "@cosyte/ncpdp/telecom";
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

/** The D.0 request header is 56 bytes; the body, its first segment first, follows. */
const HEADER_LENGTH = 56;

/** The fixture with its declared transaction count replaced by `count`. */
function declaring(count: string): string {
  return ONE.slice(0, COUNT_OFFSET) + count + ONE.slice(COUNT_OFFSET + 1);
}

/** A second transaction, its Group Separator in front of it. */
const SECOND = "\x1d\x1eAM07\x1cD2RX0000002\x1cE103\x1cD700071015527";

/** Declaring two and carrying two, a Group Separator in front of each. */
const TWO =
  declaring("2").slice(0, HEADER_LENGTH) + "\x1d" + declaring("2").slice(HEADER_LENGTH) + SECOND;

/**
 * Declaring two and carrying two, with a Group Separator in front of the second only: the first
 * transaction decodes as transmission-level segments and one transaction decodes.
 */
const FIRST_SEPARATOR_MISSING = declaring("2") + SECOND;

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

describe("NCPDP Telecom: more than one transaction is refused, typed", () => {
  it("the fixture really decodes to two transactions (non-vacuity)", () => {
    expect(ONE.slice(COUNT_OFFSET, COUNT_OFFSET + 1)).toBe("1");
    expect(ONE.slice(HEADER_LENGTH, HEADER_LENGTH + 4)).toBe("AM01");
    const tx = parseTelecom(TWO);
    expect(tx.transmissionSegments).toHaveLength(0);
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

  it("a request missing its first Group Separator decodes one transaction of two (non-vacuity)", () => {
    const tx = parseTelecom(FIRST_SEPARATOR_MISSING);
    expect(tx.transactionCount).toBe("2");
    expect(tx.decodedTransactionCount).toBe(1);
    expect(tx.transmissionSegments.length).toBeGreaterThan(0);
    expect(tx.warnings.map((w) => w.code)).toContain(COUNT_MISMATCH);
  });

  it("a request missing its first Group Separator is refused by both entry points", () => {
    for (const call of [
      () => deidentifyTelecom(parseTelecom(FIRST_SEPARATOR_MISSING), { context: ctx }),
      () => deidentifyTelecomString(FIRST_SEPARATOR_MISSING, { context: ctx }),
    ]) {
      const err = thrownBy(call);
      expect(err).toBeInstanceOf(DeidError);
      expect((err as DeidError).code).toBe(FATAL_CODES.DEID_FORMAT_UNSUPPORTED);
      expect((err as DeidError).message).toContain(NCPDP_MULTI_TRANSACTION_REFUSAL_MESSAGE);
      const text = `${(err as Error).message} ${String((err as Error).stack)}`;
      for (const sentinel of ["ZZPATFIRST", "ZZPATLAST", "RX0000001", "RX0000002"]) {
        expect(text).not.toContain(sentinel);
      }
    }
  });

  it("a declared count above 1 is refused even when the decode carries no warning", () => {
    const parsed = parseTelecom(ONE);
    for (const transactionCount of ["2", "9"]) {
      const model: TelecomTransaction = { ...parsed, transactionCount, warnings: [] };
      const err = thrownBy(() => deidentifyTelecom(model, { context: ctx }));
      expect((err as DeidError).code).toBe(FATAL_CODES.DEID_FORMAT_UNSUPPORTED);
    }
  });

  it("a declared count of 3 on one transaction is refused", () => {
    const err = thrownBy(() => deidentifyTelecomString(declaring("3"), { context: ctx }));
    expect((err as DeidError).code).toBe(FATAL_CODES.DEID_FORMAT_UNSUPPORTED);
  });

  it("a count-mismatch warning is refused even when the declared count is not above 1", () => {
    const zero = declaring("0");
    const parsed = parseTelecom(zero);
    expect(parsed.decodedTransactionCount).toBe(1);
    expect(parsed.warnings.map((w) => w.code)).toContain(COUNT_MISMATCH);
    const err = thrownBy(() => deidentifyTelecomString(zero, { context: ctx }));
    expect((err as DeidError).code).toBe(FATAL_CODES.DEID_FORMAT_UNSUPPORTED);
  });

  it("CONTROL: a hand-built model with no declared count and no warnings is not refused", () => {
    const { transactionCount: _count, warnings: _warnings, ...rest } = parseTelecom(ONE);
    const model = rest as TelecomTransaction;
    expect(model.transactionCount).toBeUndefined();
    expect(model.warnings).toBeUndefined();
    const { telecom } = deidentifyTelecom(model, { context: ctx });
    expect(telecom).toBe(deidentifyTelecomString(ONE, { context: ctx }).telecom);
  });

  it("CONTROL: a one-transaction transmission is still de-identified", () => {
    const { telecom, manifest } = deidentifyTelecomString(ONE, { context: ctx });
    expect(manifest.length).toBeGreaterThan(0);
    expect(telecom).not.toContain("ZZPATLAST");
    expect(parseTelecom(telecom).decodedTransactionCount).toBe(1);
  });
});
