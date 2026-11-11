/**
 * **DICOM: Clean Descriptors and the coded lists in its column.**
 *
 * Table E.1-1 gives Clean Descriptors a `C` on several sequences as well as on text descriptors: the
 * diagnosis code sequences, Reason for Visit, Request Attributes, Reason for Requested Procedure and
 * Prescription Notes. `@cosyte/dicom` cleans a text descriptor by emptying it, but it cleans a sequence
 * by keeping it and walking its items, and an item's Code Value and free-text Code Meaning are kept.
 * So this adapter does the rest itself, and every test here is on a synthetic file built in memory:
 *
 * - Clean Descriptors keeps the coded lists' items, so a run under the reserved `safe-harbor` label that
 *   names it is refused, like the two Retain options;
 * - under any other policy every sequence the pass cleaned at the top level is removed, and its Code
 *   Meaning is gone from the output bytes; the manifest records it removed, never cleaned;
 * - a cleaned sequence nested inside a sequence the pass keeps cannot be removed here, so the pass is
 *   refused rather than release its text.
 */

import { serializeDicom, type parseDicom } from "@cosyte/dicom";
import { describe, expect, it } from "vitest";

import { DeidError, defineDeidPolicy, FATAL_CODES } from "../../src/index.js";
import {
  deidentifyDicom,
  deidentifyDicomBuffer,
  type DicomAnnexEOption,
} from "../../src/dicom/index.js";
import { foldReport } from "../../src/dicom/fold.js";
import { buildPhiDataset, pad } from "./helpers/fixtures.js";
import type { BuildDicomSqElement } from "./helpers/build-dicom.js";

/** A policy that does not claim the reserved label. */
const RESEARCH = defineDeidPolicy({ name: "synthetic-imaging-research" });

/** Plainly fake coded entries: no code system holds these. */
const FAKE = {
  admittingMeaning: "FAKE TESTPATIENT ZZTOP",
  admittingCode: "ZZFAKE01",
  reasonMeaning: "ZZSYNTH FAKE REASON",
  reasonCode: "ZZFAKE02",
  nestedMeaning: "ZZSYNTH NESTED MEANING",
} as const;

/** One synthetic code item: Code Value, Coding Scheme Designator and Code Meaning. */
function codeItem(code: string, meaning: string): BuildDicomSqElement["items"][number] {
  return {
    elements: [
      { tag: "00080100", vr: "SH", value: pad(code) }, // Code Value
      { tag: "00080102", vr: "SH", value: pad("99ZZSYN") }, // Coding Scheme Designator
      { tag: "00080104", vr: "LO", value: pad(meaning) }, // Code Meaning
    ],
  };
}

/**
 * The fixture with an Admitting Diagnoses Code Sequence at the top level, and a Request Attributes
 * Sequence whose item holds a Reason for Requested Procedure Code Sequence.
 */
function codedListDataset(): ReturnType<typeof parseDicom> {
  return buildPhiDataset({
    extra: [
      // Admitting Diagnoses Code Sequence
      { tag: "00081084", items: [codeItem(FAKE.admittingCode, FAKE.admittingMeaning)] },
      // Request Attributes Sequence > Reason for Requested Procedure Code Sequence
      {
        tag: "00400275",
        items: [
          {
            elements: [{ tag: "0040100A", items: [codeItem(FAKE.reasonCode, FAKE.reasonMeaning)] }],
          },
        ],
      },
    ],
  });
}

/** A coded list nested inside VOI LUT Sequence, which the Basic Profile keeps and walks. */
function nestedCodedListDataset(): ReturnType<typeof parseDicom> {
  return buildPhiDataset({
    extra: [
      {
        tag: "00283010",
        items: [
          {
            elements: [
              { tag: "00283002", vr: "US", value: Buffer.from([0x08, 0x00]) }, // LUT Descriptor
              { tag: "00081084", items: [codeItem(FAKE.admittingCode, FAKE.nestedMeaning)] },
            ],
          },
        ],
      },
    ],
  });
}

/** Capture what a call throws, so a test can assert on the typed refusal. */
function thrownBy(call: () => unknown): unknown {
  try {
    call();
  } catch (err) {
    return err;
  }
  return undefined;
}

/** Every fake value a coded list in the top-level fixture carries. */
const CODED_TEXT = [FAKE.admittingMeaning, FAKE.admittingCode, FAKE.reasonMeaning, FAKE.reasonCode];

describe("Clean Descriptors under the safe-harbor label", () => {
  it("is refused under the default policy, because the peer keeps coded list items", () => {
    const thrown = thrownBy(() =>
      deidentifyDicom(codedListDataset(), { annexEOptions: ["CleanDescriptors"] }),
    );
    expect(thrown).toBeInstanceOf(DeidError);
    expect((thrown as DeidError).code).toBe(FATAL_CODES.DEID_POLICY_INVALID);
    expect((thrown as DeidError).message).toBe(
      'a run under the reserved "safe-harbor" label must not apply the Annex E option ' +
        "CleanDescriptors: it keeps the items of coded lists such as diagnosis codes, whose Code " +
        "Meaning is free text. Name the policy distinctly to retain it.",
    );
  });

  it("is refused under an explicit safe-harbor string and policy object", () => {
    for (const policy of ["safe-harbor", defineDeidPolicy({ name: "safe-harbor" })] as const) {
      const thrown = thrownBy(() =>
        deidentifyDicomBuffer(serializeDicom(codedListDataset()), {
          policy,
          annexEOptions: ["CleanDescriptors"],
        }),
      );
      expect((thrown as DeidError).code).toBe(FATAL_CODES.DEID_POLICY_INVALID);
    }
  });
});

describe("Clean Descriptors under another policy removes the coded lists it cleans", () => {
  it("no Code Meaning or Code Value of a cleaned coded list reaches the bytes", () => {
    const options = { policy: RESEARCH, annexEOptions: ["CleanDescriptors"] as const };
    const fromDataset = serializeDicom(
      deidentifyDicom(codedListDataset(), options).dataset,
    ).toString("latin1");
    const fromBuffer = deidentifyDicomBuffer(serializeDicom(codedListDataset()), options).bytes;
    for (const latin1 of [fromDataset, fromBuffer.toString("latin1")]) {
      for (const value of CODED_TEXT) {
        expect(latin1.includes(value), `survived: ${value}`).toBe(false);
      }
    }
  });

  it("removes the sequences themselves, not only their text", () => {
    const { dataset } = deidentifyDicom(codedListDataset(), {
      policy: RESEARCH,
      annexEOptions: ["CleanDescriptors"],
    });
    expect(dataset.has("00081084")).toBe(false);
    expect(dataset.has("00400275")).toBe(false);
  });

  it("records each removed sequence as removed, never as cleaned, and nothing inside it", () => {
    const { manifest } = deidentifyDicom(codedListDataset(), {
      policy: RESEARCH,
      annexEOptions: ["CleanDescriptors"],
    });
    for (const locus of [
      "(0008,1084) Admitting Diagnoses Code Sequence",
      "(0040,0275) Request Attributes Sequence",
    ]) {
      const row = manifest.find((entry) => entry.locus === locus);
      expect(row, locus).toBeDefined();
      expect(row?.disposition).toBe("removed");
      expect(row?.code).toBe("DEID_CATEGORY_REMOVED");
    }
    // No sequence is recorded as cleaned (blocked) while its items could still hold text.
    expect(
      manifest.filter((entry) => entry.disposition === "blocked" && /Sequence$/.test(entry.locus)),
    ).toEqual([]);
    // And no row describes a position inside a sequence that is no longer there.
    expect(manifest.some((entry) => /^(00081084|00400275)\[/.test(entry.locus))).toBe(false);
  });

  it("no position inside a removed sequence is left as an unexamined residual", () => {
    const { unexaminedResiduals } = deidentifyDicom(codedListDataset(), {
      policy: RESEARCH,
      annexEOptions: ["CleanDescriptors"],
    });
    // Code Meaning (0008,0104) is still a residual, but only inside the run's own (0012,0064).
    const codeMeanings = unexaminedResiduals.filter((r) => r.locus.includes("(0008,0104)"));
    expect(codeMeanings.length).toBeGreaterThan(0);
    for (const residual of codeMeanings) expect(residual.locus).toMatch(/^\(0012,0064\)/);
    expect(unexaminedResiduals.some((r) => /1084|0275|100a/i.test(r.locus))).toBe(false);
  });

  it("with no option named, the same lists are removed by the Basic Profile, as before", () => {
    const { bytes } = deidentifyDicomBuffer(serializeDicom(codedListDataset()));
    const latin1 = bytes.toString("latin1");
    for (const value of CODED_TEXT) expect(latin1.includes(value), value).toBe(false);
  });
});

describe("a cleaned coded list nested inside a kept sequence", () => {
  it("is refused, with no output, rather than released with its text", () => {
    const thrown = thrownBy(() =>
      deidentifyDicomBuffer(serializeDicom(nestedCodedListDataset()), {
        policy: RESEARCH,
        annexEOptions: ["CleanDescriptors"],
      }),
    );
    expect(thrown).toBeInstanceOf(DeidError);
    expect((thrown as DeidError).code).toBe(FATAL_CODES.DEID_FORMAT_UNSUPPORTED);
    expect((thrown as DeidError).message).toBe(
      "Clean Descriptors cleaned the sequence (0008,1084) inside a sequence this pass keeps, and " +
        "the delegated pass keeps a cleaned sequence's items, Code Meaning text included; this " +
        "adapter removes a cleaned sequence only at the top level, so nothing was de-identified. " +
        "Run without CleanDescriptors to remove the sequence under the Basic Profile.",
    );
    expect((thrown as DeidError).message.includes(FAKE.nestedMeaning)).toBe(false);
  });

  it("is removed by the Basic Profile when no option is named", () => {
    const { bytes } = deidentifyDicomBuffer(serializeDicom(nestedCodedListDataset()));
    expect(bytes.toString("latin1").includes(FAKE.nestedMeaning)).toBe(false);
  });
});

describe("a repeated option name", () => {
  it("is refused rather than applied once", () => {
    const thrown = thrownBy(() =>
      deidentifyDicom(codedListDataset(), {
        policy: RESEARCH,
        annexEOptions: ["RetainDeviceIdentity", "RetainDeviceIdentity"] as DicomAnnexEOption[],
      }),
    );
    expect((thrown as DeidError).code).toBe(FATAL_CODES.DEID_POLICY_INVALID);
    expect((thrown as DeidError).message).toBe(
      "annexEOptions[1] names an option already named; nothing was de-identified. Name each " +
        "option once.",
    );
  });
});

describe("Patient's Age is filed under dates, as the other adapters file an age", () => {
  it("a kept age is a retained row in category DATES", () => {
    const manifest = foldReport({
      attributes: [{ tag: "00101010", keyword: "Patient's Age", action: "K", applied: "kept" }],
      removedPrivateTags: [],
      warnings: [],
      retained: ["RetainPatientCharacteristics"],
    });
    expect(manifest.map((entry) => entry.category)).toEqual(["DATES"]);
  });
});
