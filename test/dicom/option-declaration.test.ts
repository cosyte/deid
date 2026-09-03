/**
 * **DICOM: declaring the Annex E options by coded term, applied and withheld alike.**
 *
 * PS3.15 E.1.1 asks for the codes "corresponding to the Profile and Options **used**", and the word
 * "used" is the load-bearing one: a withheld option may never appear in De-identification Method Code
 * Sequence `(0012,0064)`, because a coded term there is read by a downstream archive as a property of
 * the study. So the withheld half is declared on the returned result instead, where saying "this option
 * was not applied" is what the field means.
 *
 * The suite pins three things: that every option this adapter can name carries exactly one of applied or
 * withheld, that no withheld term reaches the dataset, and that a profile or option the vocabulary
 * cannot name refuses the pass instead of reaching for an approximate code.
 *
 * Everything is synthetic and built in memory.
 */

import { parseDicom, serializeDicom } from "@cosyte/dicom";
import { describe, expect, it } from "vitest";

import { DeidError, FATAL_CODES } from "../../src/index.js";
import { CID_7050, deidentifyDicom, deidentifyDicomBuffer } from "../../src/dicom/index.js";
import {
  BASIC_PROFILE_CODE_VALUE,
  resolveMethodDeclaration,
} from "../../src/dicom/method-codes.js";
import { resolveDicomOptions } from "../../src/dicom/policy-map.js";
import { buildPhiDataset } from "./helpers/fixtures.js";

/** The two pixel options: work a metadata-only pass does not do, so never applied. */
const PIXEL_OPTION_CODE_VALUES = ["113101", "113102"];

describe("every option the adapter can name is declared, exactly once, either way", () => {
  const { optionDeclarations } = deidentifyDicom(buildPhiDataset());

  it("declares every option row of the table and no other term", () => {
    const declared = optionDeclarations.map((d) => d.term.codeValue).sort();
    const optionRows = CID_7050.filter((row) => row.codeValue !== BASIC_PROFILE_CODE_VALUE)
      .map((row) => row.codeValue)
      .sort();
    expect(declared).toEqual(optionRows);
    // Twelve option rows: the thirteen of the table, less the one that names the profile.
    expect(declared).toHaveLength(12);
  });

  it("leaves no option undeclared and declares none of them twice", () => {
    for (const declaration of optionDeclarations) {
      expect(["applied", "withheld"]).toContain(declaration.status);
    }
    expect(new Set(optionDeclarations.map((d) => d.term.codeValue)).size).toBe(
      optionDeclarations.length,
    );
  });

  it("declares each option by its coded term rather than in prose", () => {
    for (const declaration of optionDeclarations) {
      expect(declaration.term.codingSchemeDesignator).toBe("DCM");
      expect(CID_7050).toContainEqual(declaration.term);
    }
  });

  it("withholds every option under the full Basic Profile, the two pixel options included", () => {
    // The default policy applies the Basic Profile with no Retain/Clean deviations, so every option is
    // withheld. The two pixel options are withheld structurally rather than by configuration: this is
    // a metadata-only pass and cannot do the work they describe.
    expect(optionDeclarations.every((d) => d.status === "withheld")).toBe(true);
    for (const codeValue of PIXEL_OPTION_CODE_VALUES) {
      expect(optionDeclarations.find((d) => d.term.codeValue === codeValue)?.status).toBe(
        "withheld",
      );
    }
  });

  it("agrees with the delegated pass's own account of what was retained", () => {
    const { retained } = deidentifyDicom(buildPhiDataset());
    expect(retained).toEqual([]);
    expect(optionDeclarations.filter((d) => d.status === "applied")).toEqual([]);
  });
});

describe("a withheld option is never written into (0012,0064)", () => {
  it("the sequence carries only what the run applied", () => {
    const { dataset, deidentificationMethodCodes, optionDeclarations } =
      deidentifyDicom(buildPhiDataset());
    // Only the profile term is applied, so only the profile term is in the sequence.
    expect(deidentificationMethodCodes.map((t) => t.codeValue)).toEqual([BASIC_PROFILE_CODE_VALUE]);
    expect(dataset.get("00120064")?.items).toHaveLength(1);

    // Non-vacuity: there really are withheld options, and their terms really are absent from the bytes.
    const withheld = optionDeclarations.filter((d) => d.status === "withheld");
    expect(withheld.length).toBe(12);
    const serialized = serializeDicom(dataset).toString("latin1");
    for (const declaration of withheld) {
      expect(
        serialized.includes(declaration.term.codeValue),
        `withheld term reached the bytes: ${declaration.term.codeValue}`,
      ).toBe(false);
      expect(serialized.includes(declaration.term.codeMeaning)).toBe(false);
    }
  });

  it("the same holds on the byte entry point, read back through the parser", () => {
    const { bytes, optionDeclarations } = deidentifyDicomBuffer(serializeDicom(buildPhiDataset()));
    const items = parseDicom(bytes).get("00120064")?.items ?? [];
    expect(items).toHaveLength(1);
    // And the withheld declarations are still readable, on the result rather than in the sequence.
    expect(optionDeclarations.filter((d) => d.status === "withheld")).toHaveLength(12);
  });
});

describe("fail closed: what the vocabulary cannot name is refused, never approximated", () => {
  it("refuses a profile no row of the table names", () => {
    let thrown: unknown;
    try {
      resolveMethodDeclaration("999999", []);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(DeidError);
    expect((thrown as DeidError).code).toBe(FATAL_CODES.DEID_DECLARATION_UNNAMEABLE);
    expect((thrown as DeidError).message).toContain("999999");
  });

  it("refuses an option no row of the table names", () => {
    let thrown: unknown;
    try {
      resolveMethodDeclaration(BASIC_PROFILE_CODE_VALUE, ["RetainSomethingUnpublished"]);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(DeidError);
    expect((thrown as DeidError).code).toBe(FATAL_CODES.DEID_DECLARATION_UNNAMEABLE);
    expect((thrown as DeidError).message).toContain("RetainSomethingUnpublished");
  });

  it("refuses an option that NO SINGLE row names, rather than picking one of two", () => {
    // The vocabulary distinguishes retaining full dates (113106) from retaining modified dates
    // (113107); the delegated pass's single `RetainLongitudinalTemporal` option name does not say
    // which. Guessing would publish a claim about the dates in a study that the run cannot support.
    let thrown: unknown;
    try {
      resolveMethodDeclaration(BASIC_PROFILE_CODE_VALUE, ["RetainLongitudinalTemporal"]);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(DeidError);
    expect((thrown as DeidError).code).toBe(FATAL_CODES.DEID_DECLARATION_UNNAMEABLE);
    expect((thrown as DeidError).message).toContain("RetainLongitudinalTemporal");
  });

  it("NEGATIVE CONTROL: an option the table does name resolves, so the refusal is not blanket", () => {
    const declaration = resolveMethodDeclaration(BASIC_PROFILE_CODE_VALUE, ["RetainUIDs"]);
    expect(declaration.appliedTerms.map((t) => t.codeValue)).toEqual([
      BASIC_PROFILE_CODE_VALUE,
      "113110",
    ]);
    expect(declaration.optionDeclarations.find((d) => d.term.codeValue === "113110")?.status).toBe(
      "applied",
    );
    // And every other option is still declared, still withheld.
    expect(declaration.optionDeclarations.filter((d) => d.status === "withheld")).toHaveLength(11);
  });

  it("the refusal carries no value, no key and no offset", () => {
    let thrown: unknown;
    try {
      resolveMethodDeclaration("999999", []);
    } catch (err) {
      thrown = err;
    }
    const message = (thrown as DeidError).message;
    expect(message).toContain("CID 7050");
    // The subject is a bounded token from this adapter's own configuration, never a document byte.
    expect(message).not.toContain("ZZSENTINEL");
  });

  it("WHY the end-to-end refusal cannot fire today, pinned rather than assumed", () => {
    // The adapter resolves the full Basic Profile with no Annex E deviations, so the option list handed
    // to the guard is always empty and the profile is always a row of the table. That is the reason the
    // fatal is unreachable through the public entry points, and it is asserted here so that a change
    // which starts passing an option has to face the guard rather than quietly slip past it.
    expect(resolveDicomOptions({}).retain).toEqual([]);
    expect(resolveMethodDeclaration(BASIC_PROFILE_CODE_VALUE, []).appliedTerms).toHaveLength(1);
  });
});
