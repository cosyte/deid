/**
 * Engine tests for the **BYO (bring-your-own) free-text redaction interface** (roadmap §Phase 8).
 *
 * The library ships the interface and the orchestration, never a detector. These tests pin the
 * fail-closed contract (no redactor / throw / nothing → block, never a leak), the consumer-asserted
 * disposition (`DEID_FREETEXT_CONSUMER_REDACTED`), that a redactor touches only free-text loci (the
 * structural PHI removal is unchanged), that the input is never mutated, and that the manifest stays
 * value-free even on the redacted path.
 *
 * All values are synthetic tagged sentinels.
 */

import { describe, expect, it } from "vitest";
import fc from "fast-check";

import {
  DEID_DISPOSITION_CODES,
  SAFE_HARBOR_CATEGORIES,
  createDeidContext,
  deidentify,
  type FreeTextRedactor,
  type GenericLocus,
  type SafeHarborCategory,
} from "../src/index.js";

const C = SAFE_HARBOR_CATEGORIES;
const D = DEID_DISPOSITION_CODES;

/** A free-text locus carrying a sentinel the leak sweep looks for. */
function freetext(value: string, category: SafeHarborCategory = C.OTHER_UNIQUE_ID): GenericLocus {
  return { path: "OBX-5", kind: "freetext", category, value };
}

/** A redactor that removes the sentinel token — the "handled" case. */
const scrub: FreeTextRedactor = ({ text }) => ({
  text: text.replace(/SENTINEL_\w+/g, "[REDACTED]"),
});

describe("BYO free-text redactor — fail-closed contract", () => {
  it("blocks free text when no redactor is supplied (the safe default is unchanged)", () => {
    const out = deidentify({ loci: [freetext("note SENTINEL_NAME")] }, {});
    expect(out.document.loci[0]?.value).toBeNull();
    expect(out.document.loci[0]?.disposition).toBe("blocked");
    expect(out.manifest[0]?.code).toBe(D.DEID_FREETEXT_BLOCKED);
  });

  it("blocks (never leaks) when the redactor throws", () => {
    const boom: FreeTextRedactor = () => {
      throw new Error("redactor exploded");
    };
    const out = deidentify({ loci: [freetext("note SENTINEL_NAME")] }, { redactor: boom });
    expect(out.document.loci[0]?.value).toBeNull();
    expect(out.document.loci[0]?.disposition).toBe("blocked");
    expect(out.manifest[0]?.code).toBe(D.DEID_FREETEXT_BLOCKED);
  });

  it("blocks when the redactor returns nothing (null / undefined / bad shape)", () => {
    const returnsNull: FreeTextRedactor = () => null;
    const returnsUndef: FreeTextRedactor = () => undefined;
    // A redactor that lies about its return type is still failed closed (defensive, not trusting).
    const returnsBadShape = (() => ({ notText: 1 })) as unknown as FreeTextRedactor;
    const returnsNonObject = (() => "raw string") as unknown as FreeTextRedactor;
    for (const redactor of [returnsNull, returnsUndef, returnsBadShape, returnsNonObject]) {
      const out = deidentify({ loci: [freetext("note SENTINEL_NAME")] }, { redactor });
      expect(out.document.loci[0]?.value).toBeNull();
      expect(out.manifest[0]?.code).toBe(D.DEID_FREETEXT_BLOCKED);
    }
  });
});

describe("BYO free-text redactor — redacted-in-place path", () => {
  it("writes the redactor's prose back in place and records it as consumer-asserted", () => {
    const out = deidentify({ loci: [freetext("note SENTINEL_NAME here")] }, { redactor: scrub });
    expect(out.document.loci[0]?.value).toBe("note [REDACTED] here");
    expect(out.document.loci[0]?.disposition).toBe("transformed");
    expect(out.manifest[0]).toMatchObject({
      transform: "byo-redact",
      disposition: "transformed",
      code: D.DEID_FREETEXT_CONSUMER_REDACTED,
      locus: "OBX-5",
      category: C.OTHER_UNIQUE_ID,
    });
  });

  it("accepts an empty-string redaction (all prose removed is a valid redaction, not a block)", () => {
    const eraser: FreeTextRedactor = () => ({ text: "" });
    const out = deidentify({ loci: [freetext("note SENTINEL_NAME")] }, { redactor: eraser });
    expect(out.document.loci[0]?.value).toBe("");
    expect(out.document.loci[0]?.disposition).toBe("transformed");
    expect(out.manifest[0]?.code).toBe(D.DEID_FREETEXT_CONSUMER_REDACTED);
  });

  it("hands the redactor the value, the value-free locus path, and the category", () => {
    const seen: { text?: string; locus?: string; category?: SafeHarborCategory } = {};
    const spy: FreeTextRedactor = (req) => {
      seen.text = req.text;
      seen.locus = req.locus;
      if (req.category !== undefined) seen.category = req.category;
      return { text: "clean" };
    };
    deidentify({ loci: [freetext("note SENTINEL_NAME", C.NAMES)] }, { redactor: spy });
    expect(seen).toEqual({ text: "note SENTINEL_NAME", locus: "OBX-5", category: C.NAMES });
  });
});

describe("BYO free-text redactor — scope and safety invariants", () => {
  const ctx = createDeidContext({ key: "k", patientId: "p1" });

  it("touches ONLY free-text loci — structural removal and the clinical guard are unchanged", () => {
    // A redactor that would emit its input verbatim (an under-redactor) must not affect non-free-text.
    const passthrough: FreeTextRedactor = ({ text }) => ({ text });
    const out = deidentify(
      {
        loci: [
          { path: "PID-5", kind: "identifier", category: C.NAMES, value: "SENTINEL_NAME" },
          { path: "PID-3", kind: "identifier", category: C.MRN, value: "SENTINEL_MRN" },
          { path: "OBX-5-num", kind: "clinical", value: "5.4" },
          freetext("note SENTINEL_TEXT"),
        ],
      },
      { context: ctx, redactor: passthrough },
    );
    // Name still removed structurally; MRN still pseudonymized; clinical value survives untouched.
    expect(out.document.loci[0]).toMatchObject({ value: null, disposition: "removed" });
    expect(out.document.loci[1]?.value).toMatch(/^[0-9a-f]{64}$/);
    expect(out.document.loci[2]).toMatchObject({ value: "5.4", disposition: "retained" });
    // Only the free-text locus went through the redactor.
    expect(out.document.loci[3]?.disposition).toBe("transformed");
    expect(out.manifest.filter((e) => e.transform === "byo-redact")).toHaveLength(1);
  });

  it("never mutates the input model and is deterministic", () => {
    const model = { loci: [freetext("note SENTINEL_NAME")] };
    const frozen = JSON.stringify(model);
    const a = deidentify(model, { redactor: scrub });
    const b = deidentify(model, { redactor: scrub });
    expect(JSON.stringify(model)).toBe(frozen); // input untouched
    expect(a.document.loci[0]?.value).toBe(b.document.loci[0]?.value); // deterministic
  });

  it("keeps the manifest value-free on the redacted path (no input or output prose in the audit)", () => {
    const out = deidentify({ loci: [freetext("note SENTINEL_NAME here")] }, { redactor: scrub });
    const audit = JSON.stringify(out.manifest);
    expect(audit).not.toContain("SENTINEL_NAME"); // input value absent
    expect(audit).not.toContain("[REDACTED]"); // redacted output absent
    expect(audit).not.toContain("note"); // no prose at all
  });
});

describe("BYO free-text redactor — properties", () => {
  it("a declining/throwing redactor always blocks (never a value survives)", () => {
    fc.assert(
      fc.property(fc.string(), fc.boolean(), (value, doThrow) => {
        const redactor: FreeTextRedactor = doThrow
          ? () => {
              throw new Error("no");
            }
          : () => null;
        const out = deidentify({ loci: [freetext(`x${value}`)] }, { redactor });
        expect(out.document.loci[0]?.value).toBeNull();
        expect(out.document.loci[0]?.disposition).toBe("blocked");
      }),
    );
  });

  it("block-only default leaves no free-text value in the document for arbitrary prose", () => {
    fc.assert(
      fc.property(fc.string(), (value) => {
        const out = deidentify({ loci: [freetext(`SENTINEL_${value}`)] }, {});
        expect(out.document.loci[0]?.value).toBeNull();
      }),
    );
  });
});
