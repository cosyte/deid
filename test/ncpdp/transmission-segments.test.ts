/**
 * **NCPDP Telecom: transmission-level segments are de-identified, and no untransformed copy of them
 * reaches the serializer.**
 *
 * In a Telecom request the segments ahead of the first Group Separator (Patient, Insurance and the
 * like) belong to the transmission, and `@cosyte/ncpdp` keeps them on `transmissionSegments` as well
 * as at the head of `segments`. The adapter de-identifies `segments`; the model it hands to
 * `serializeTelecom` must carry the de-identified copy on `transmissionSegments` too, and only the
 * transaction's own segments on `transactions[0]`, so no field of the original rides along in it
 * whichever of those fields a serializer reads.
 *
 * Every value is a synthetic, ZZ-tagged sentinel from the committed fixture.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import * as ncpdpTelecom from "@cosyte/ncpdp/telecom";
import { parseTelecom, type TelecomTransaction } from "@cosyte/ncpdp/telecom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createDeidContext } from "../../src/index.js";
import { deidentifyTelecom, deidentifyTelecomString } from "../../src/ncpdp/index.js";

vi.mock("@cosyte/ncpdp/telecom", async (importOriginal) => {
  const actual = await importOriginal<typeof ncpdpTelecom>();
  return { ...actual, serializeTelecom: vi.fn(actual.serializeTelecom) };
});

const ctx = createDeidContext({ key: "transmission-segments-key", patientId: "p-shared" });
const ONE = readFileSync(
  join(import.meta.dirname, "..", "fixtures", "ncpdp", "telecom-b1.ncpdp"),
  "latin1",
);

/** Where the claim segment starts, its Segment Separator in front of it. */
const CLAIM_AT = ONE.indexOf("\x1eAM07");

/**
 * The committed claim with a Group Separator in front of its claim segment: the Patient, Prescriber,
 * Insurance and COB segments ahead of it are transmission-level, and one transaction follows.
 */
const SHARED = ONE.slice(0, CLAIM_AT) + "\x1d" + ONE.slice(CLAIM_AT + 1);

const SENTINELS = ["ZZPATFIRST", "ZZPATLAST", "ZZPATIENTID", "ZZCARDHOLDER", "ZZPRESCRIBERID"];

afterEach(() => {
  vi.mocked(ncpdpTelecom.serializeTelecom).mockClear();
});

describe("NCPDP Telecom: transmission-level segments", () => {
  it("the request decodes one transaction behind shared segments (non-vacuity)", () => {
    expect(CLAIM_AT).toBeGreaterThan(0);
    const tx = parseTelecom(SHARED);
    expect(tx.transmissionSegments.map((s) => s.segmentId)).toEqual(["01", "03", "04", "05"]);
    expect(tx.decodedTransactionCount).toBe(1);
    expect(tx.transactionCount).toBe("1");
    expect(tx.warnings.map((w) => w.code)).not.toContain(
      "NCPDP_TELECOM_TRANSACTION_COUNT_MISMATCH",
    );
  });

  it("is de-identified, with its Group Separator kept in place", () => {
    const { telecom, manifest } = deidentifyTelecomString(SHARED, { context: ctx });
    expect(manifest.length).toBeGreaterThan(0);
    for (const sentinel of SENTINELS) expect(telecom).not.toContain(sentinel);
    const again = parseTelecom(telecom);
    expect(again.transmissionSegments).toHaveLength(4);
    expect(again.decodedTransactionCount).toBe(1);
  });

  it("hands the serializer a model with no untransformed copy of the shared segments", () => {
    const parsed = parseTelecom(SHARED);
    deidentifyTelecom(parsed, { context: ctx });
    const serialize = vi.mocked(ncpdpTelecom.serializeTelecom);
    expect(serialize).toHaveBeenCalledTimes(1);
    const model = serialize.mock.calls[0]?.[0] as TelecomTransaction;
    const shared = JSON.stringify(model.transmissionSegments);
    for (const sentinel of SENTINELS) expect(shared).not.toContain(sentinel);
    expect(model.transmissionSegments).toEqual(
      model.segments.slice(0, parsed.transmissionSegments.length),
    );
    expect(model.transactions[0]?.segments).toEqual(
      model.segments.slice(parsed.transmissionSegments.length),
    );
  });

  it("a hand-built model with no transmissionSegments field is written as one transaction", () => {
    const { transmissionSegments: _dropped, ...rest } = parseTelecom(ONE);
    const model = rest as TelecomTransaction;
    expect(model.transmissionSegments).toBeUndefined();
    const { telecom } = deidentifyTelecom(model, { context: ctx });
    expect(telecom).toBe(deidentifyTelecomString(ONE, { context: ctx }).telecom);
    const handed = vi.mocked(ncpdpTelecom.serializeTelecom).mock
      .calls[0]?.[0] as TelecomTransaction;
    expect(handed.transmissionSegments).toEqual([]);
    expect(handed.transactions[0]?.segments).toEqual(handed.segments);
  });
});
