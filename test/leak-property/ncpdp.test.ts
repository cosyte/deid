/**
 * The generated leak property for the **NCPDP Telecom** adapter. The generator and the locus reading are
 * in `./ncpdp-cases.ts`, the rule in `./sweep.ts`.
 */

import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { build, caseArb, checkCase, pass } from "./ncpdp-cases.js";
import { runLeakProperty, tamper } from "./sweep.js";

describe("the generated leak property: NCPDP Telecom", () => {
  it("every sentinel is removed, or named as an unexamined residual at its locus", () => {
    runLeakProperty("ncpdp", caseArb, checkCase);
  });

  it("the sweep has teeth: a sentinel put back into a real output, or the manifest, is caught", () => {
    const [sample] = fc.sample(caseArb, { seed: 7, numRuns: 1 });
    if (sample === undefined) throw new Error("no sample");
    const { raw, placed, at } = build(sample.fill, sample.stem, sample.placements);
    const caught = tamper(placed, pass(raw, at));
    expect(caught.inOutput).toContain("survives in the output");
    expect(caught.inManifest).toContain("is in the manifest");
  });
});
