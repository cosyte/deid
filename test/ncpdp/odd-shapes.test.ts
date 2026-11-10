/**
 * NCPDP Telecom adapter on models a JavaScript caller builds by hand rather than with `parseTelecom`:
 * one with no `transactions` list, a header carrying a property that is not a decoded string, and
 * write-back coordinates with holes in them. Each one is de-identified exactly as the parsed model is,
 * and none crashes the pass or puts a non-string into a locus.
 *
 * All values are synthetic.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { parseTelecom, type TelecomTransaction } from "@cosyte/ncpdp/telecom";
import { describe, expect, it } from "vitest";

import { createDeidContext, type TransformedLocus } from "../../src/index.js";
import {
  applyTelecom,
  deidentifyTelecom,
  extractTelecomLoci,
  type TelecomCoord,
} from "../../src/ncpdp/index.js";

const RAW = readFileSync(
  join(import.meta.dirname, "..", "fixtures", "ncpdp", "telecom-b1.ncpdp"),
  "utf8",
);
const ctx = createDeidContext({ key: "odd-shape-key-synthetic-hmac", patientId: "p" });

/** The parsed fixture with its `transactions` list left off, as a hand-built model may be. */
function withoutTransactions(): TelecomTransaction {
  const { transactions: _dropped, ...rest } = parseTelecom(RAW);
  return rest as TelecomTransaction;
}

describe("a hand-built model", () => {
  it("de-identifies a model with no transactions list exactly as the parsed one", () => {
    const handBuilt = withoutTransactions();
    expect(handBuilt.transactions).toBeUndefined();
    const fromHandBuilt = deidentifyTelecom(handBuilt, { context: ctx });
    const fromParsed = deidentifyTelecom(parseTelecom(RAW), { context: ctx });
    expect(fromHandBuilt.telecom).toBe(fromParsed.telecom);
    expect(fromHandBuilt.manifest).toEqual(fromParsed.manifest);
    expect(fromHandBuilt.unexaminedResiduals).toEqual(fromParsed.unexaminedResiduals);
  });

  it("enumerates only the string fields of a header, skipping a property that is not one", () => {
    const parsed = parseTelecom(RAW);
    const header = { ...parsed.header, softwareRevision: 7 } as unknown as typeof parsed.header;
    const { unexaminedResiduals } = extractTelecomLoci({ ...parsed, header });
    const loci = unexaminedResiduals.map((r) => r.locus);
    expect(loci).not.toContain("header/softwareRevision");
    expect(loci).toContain("header/binNumber");
  });
});

describe("applyTelecom, hand-built coordinates", () => {
  it("skips a coordinate with no transformed locus beside it, and a hole in the coordinate list", () => {
    const tx = parseTelecom(RAW);
    const shifted: TransformedLocus = {
      path: "header/dateOfService",
      kind: "date",
      value: "20200101",
      disposition: "transformed",
    };
    const coords: TelecomCoord[] = [];
    coords[1] = { target: "header-date-of-service" }; // index 0 is a hole
    coords[2] = { target: "header-date-of-service" }; // no transformed[2]
    const out = applyTelecom(tx, [shifted, shifted], coords);
    expect(parseTelecom(out).header.dateOfService).toBe("20200101");
    // Nothing else moved: only the header date differs from a pass that wrote nothing.
    const untouched = applyTelecom(tx, [], coords);
    expect(out.replace("20200101", tx.header.dateOfService)).toBe(untouched);
  });
});
