/**
 * **NCPDP: the SCRIPT non-goal, turned from a paragraph into a behaviour.**
 *
 * `@cosyte/deid/ncpdp` has always documented ePrescribing SCRIPT as deferred: the parser surface
 * re-serializes only the modeled fields, so a round-trip drops every unmodeled element, and its patient
 * model carries no address, phone or patient identifier. Prose is not a refusal, though. Before this
 * suite existed, a caller who handed SCRIPT XML to a Telecom entry point got whatever the Telecom
 * parser made of those bytes, which is the false-safety outcome the deferral was written to prevent.
 *
 * So the refusal is pinned here from the caller's side: a typed `DEID_FORMAT_UNSUPPORTED` fatal, a
 * diagnostic that names the format and states the parser-surface reason and carries no byte of the
 * document, and **no** transformed document, manifest or partial output of any kind.
 *
 * The mirror half matters as much: a Telecom caller must not notice the guard exists. The last block
 * asserts that both Telecom entry points still return exactly what they returned, on a committed
 * fixture, and that a transaction with no segments at all is still de-identified rather than refused.
 *
 * Every value in the SCRIPT samples is a synthetic, ZZ-tagged sentinel.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import { parseTelecom } from "@cosyte/ncpdp/telecom";

import { createDeidContext, DeidError, FATAL_CODES } from "../../src/index.js";
import {
  deidentifyTelecom,
  deidentifyTelecomString,
  NCPDP_SCRIPT_REFUSAL_MESSAGE,
} from "../../src/ncpdp/index.js";
import { isScriptMessageModel, isXmlDocumentText } from "../../src/ncpdp/script-refusal.js";

const ctx = createDeidContext({ key: "script-refusal-key", patientId: "p-script" });

const TELECOM = readFileSync(
  join(import.meta.dirname, "..", "fixtures", "ncpdp", "telecom-b1.ncpdp"),
  "utf8",
);

/**
 * A SCRIPT NewRx, seeded with the very identifiers the SCRIPT patient model cannot express, so a pass
 * that half-handled this document would be handing them straight back.
 */
const SCRIPT_XML = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<Message xmlns="http://www.ncpdp.org/schema/SCRIPT" version="010" release="006">',
  "  <Header><To>ZZPHARMACY</To><From>ZZPRESCRIBER</From><MessageID>ZZMSGID</MessageID></Header>",
  "  <Body><NewRx><Patient><HumanPatient><Name>",
  "    <LastName>ZZSCRIPTFAM</LastName><FirstName>ZZSCRIPTGIV</FirstName>",
  "  </Name><DateOfBirth><Date>1985-03-02</Date></DateOfBirth>",
  "  <Identification><SocialSecurity>900000042</SocialSecurity></Identification>",
  "  </HumanPatient></Patient></NewRx></Body>",
  "</Message>",
].join("\n");

const SCRIPT_SENTINELS = [
  "ZZSCRIPTFAM",
  "ZZSCRIPTGIV",
  "ZZPHARMACY",
  "ZZPRESCRIBER",
  "ZZMSGID",
  "900000042",
  "1985-03-02",
];

/** Run a thunk and return the DeidError it threw, failing the test when it returns instead. */
function refusal(run: () => unknown): DeidError {
  let caught: unknown;
  let returned = false;
  try {
    run();
    returned = true;
  } catch (err) {
    caught = err;
  }
  expect(returned).toBe(false);
  expect(caught).toBeInstanceOf(DeidError);
  return caught as DeidError;
}

describe("an ePrescribing SCRIPT document handed to an NCPDP entry point is refused", () => {
  it("the raw-text entry point refuses with the typed fatal", () => {
    const err = refusal(() => deidentifyTelecomString(SCRIPT_XML, { context: ctx }));
    expect(err.code).toBe(FATAL_CODES.DEID_FORMAT_UNSUPPORTED);
  });

  it("the model entry point refuses a SCRIPT message the same way", () => {
    // The SCRIPT model's shape, structurally: a header and a typed transaction body, no segment list.
    const scriptMessage = {
      header: { to: "ZZPHARMACY", from: "ZZPRESCRIBER" },
      body: { newRx: { patient: { name: { last: "ZZSCRIPTFAM" } } } },
      warnings: [],
      asNewRx: () => undefined,
    };
    // A JavaScript caller can hand a model entry point anything, which is the whole reason the guard
    // is structural rather than a type: the cast is what a real mis-wired call looks like at runtime.
    const err = refusal(() => deidentifyTelecom(scriptMessage as never, { context: ctx }));
    expect(err.code).toBe(FATAL_CODES.DEID_FORMAT_UNSUPPORTED);
  });

  it("the diagnostic names SCRIPT and states the parser-surface reason", () => {
    const err = refusal(() => deidentifyTelecomString(SCRIPT_XML));
    expect(err.message).toBe(NCPDP_SCRIPT_REFUSAL_MESSAGE);
    expect(err.message).toContain("SCRIPT");
    expect(err.message).toContain("ePrescribing");
    // The reason, not just the verdict: what the parser surface cannot do, and what follows from it.
    expect(err.message).toContain("only the modeled fields");
    expect(err.message).toContain("no address, phone or patient identifier");
    expect(err.message).toContain("Telecommunication (vD.0)");
  });

  it("the diagnostic is value-free: nothing it says came out of the document", () => {
    const err = refusal(() => deidentifyTelecomString(SCRIPT_XML));
    for (const sentinel of SCRIPT_SENTINELS) expect(err.message).not.toContain(sentinel);
    expect(err.message).not.toContain("script-refusal-key");
  });

  it("returns no document, no manifest and no partial output of any kind", () => {
    let result: unknown = "not assigned";
    try {
      result = deidentifyTelecomString(SCRIPT_XML, { context: ctx });
    } catch {
      // the refusal, asserted above
    }
    expect(result).toBe("not assigned");
  });

  it("refuses before the Telecom parser is asked to read the bytes", () => {
    // A parse-then-refuse ordering would surface the peer parser's own error for at least some inputs.
    // Every one of these is our refusal instead, which is only possible if nothing parsed them.
    // Spelled from its code point rather than pasted: an invisible character in a source file is a
    // trap for the next reader, and this one is the whole point of the case.
    const bom = String.fromCharCode(0xfeff);
    for (const variant of [
      SCRIPT_XML,
      `${bom}${SCRIPT_XML}`, // a byte-order mark in front of the declaration
      `\n\n  ${SCRIPT_XML}`, // leading whitespace
      "<NewRx><Patient><Name><LastName>ZZSCRIPTFAM</LastName></Name></Patient></NewRx>", // no declaration
    ]) {
      const err = refusal(() => deidentifyTelecomString(variant));
      expect(err.code).toBe(FATAL_CODES.DEID_FORMAT_UNSUPPORTED);
      expect(err.name).toBe("DeidError");
    }
  });
});

describe("MIRROR: a Telecom caller does not notice the refusal exists", () => {
  it("the raw-text entry point still de-identifies the committed Telecom fixture", () => {
    const { telecom, manifest, unexaminedResiduals } = deidentifyTelecomString(TELECOM, {
      context: ctx,
    });
    expect(telecom.length).toBeGreaterThan(0);
    expect(manifest.length).toBeGreaterThan(0);
    expect(unexaminedResiduals.length).toBeGreaterThan(0);
    expect(telecom).not.toContain("ZZPATLAST");
  });

  it("the model entry point produces the identical result on the same fixture", () => {
    const viaString = deidentifyTelecomString(TELECOM, { context: ctx });
    const viaModel = deidentifyTelecom(parseTelecom(TELECOM), { context: ctx });
    expect(viaModel.telecom).toBe(viaString.telecom);
    expect(viaModel.manifest).toEqual(viaString.manifest);
  });

  it("the guard's decision table, one row at a time", () => {
    // A Telecom transaction is recognized by its `segments` array, negative-first, so ANY value
    // carrying one is accepted here whatever else it holds. Every row below is a way the guard could
    // catch a caller it must not, or miss one it must.
    expect(isScriptMessageModel({ segments: [] })).toBe(false);
    expect(isScriptMessageModel({ segments: [], body: {}, asNewRx: () => undefined })).toBe(false);
    expect(isScriptMessageModel({ body: { newRx: {} } })).toBe(true);
    expect(isScriptMessageModel({ asNewRx: () => undefined })).toBe(true);
    // Not a model at all: neither refused nor mistaken for one, so the ordinary path decides.
    expect(isScriptMessageModel(null)).toBe(false);
    expect(isScriptMessageModel(undefined)).toBe(false);
    expect(isScriptMessageModel(SCRIPT_XML)).toBe(false);
    expect(isScriptMessageModel({})).toBe(false);
    expect(isScriptMessageModel({ segments: "not an array" })).toBe(false);

    // And the text side: a Telecom transmission opens on its fixed header, never on a tag.
    expect(isXmlDocumentText(TELECOM)).toBe(false);
    expect(isXmlDocumentText("")).toBe(false);
    expect(isXmlDocumentText(SCRIPT_XML)).toBe(true);
  });

  it("a transaction whose segment list is EMPTY is de-identified, never refused", () => {
    // The guard's one negative-first clause: anything carrying a segments array is a Telecom
    // transaction whatever else it holds, so an empty one must not tip into the refusal.
    const tx = parseTelecom(TELECOM);
    const empty: Parameters<typeof deidentifyTelecom>[0] = { ...tx, segments: [] };
    expect(() => deidentifyTelecom(empty, { context: ctx })).not.toThrow();
  });
});
