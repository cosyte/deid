/**
 * The generated leak property for the **HL7 v2** adapter. The generator and the locus reading are
 * in `./hl7-cases.ts`, the rule in `./sweep.ts`.
 */

import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { build, caseArb, checkCase, pass } from "./hl7-cases.js";
import { runLeakProperty, tamper } from "./sweep.js";

describe("the generated leak property: HL7 v2", () => {
  it("every sentinel is removed, or named as an unexamined residual at its locus", () => {
    runLeakProperty("hl7", caseArb, checkCase);
  });

  it("the sweep has teeth: a sentinel put back into a real output, or the manifest, is caught", () => {
    const [sample] = fc.sample(caseArb, { seed: 7, numRuns: 1 });
    if (sample === undefined) throw new Error("no sample");
    const { raw, placed } = build(sample.msg, sample.stem, sample.placements);
    const caught = tamper(placed, pass(raw));
    expect(caught.inOutput).toContain("survives in the output");
    expect(caught.inManifest).toContain("is in the manifest");
  });
});
