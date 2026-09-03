/**
 * **DICOM: the coded de-identification method written to `(0012,0064)`.**
 *
 * PS3.15 E.1.1 asks for Patient Identity Removed `(0012,0062) = YES` plus, additionally, "one or more
 * codes from CID 7050 'De-identification Method' corresponding to the Profile and Options used" in
 * De-identification Method Code Sequence `(0012,0064)`, "and/or a text string describing the method
 * used" in De-identification Method `(0012,0063)`. This suite pins the coded half: that it is written,
 * that every term in it is one of the thirteen published rows reproduced verbatim, that the text half is
 * left exactly as the delegated pass produces it, and that it survives the round trip through this
 * library's own writer and reader on both entry points.
 *
 * The fail-closed half is the load-bearing one. A coded term is read by a downstream archive as a
 * property of the study and is acted on without a human, and a study released on a false coded claim
 * cannot be un-released, so the pass returns **nothing** rather than output it cannot vouch for.
 *
 * Everything is synthetic and built in memory.
 */

import { Buffer } from "node:buffer";

import {
  Dataset,
  deidentify as dicomDeidentify,
  parseDicom,
  readCode,
  serializeDicom,
  type Item,
} from "@cosyte/dicom";
import { describe, expect, it } from "vitest";

import { DeidError, FATAL_CODES } from "../../src/index.js";
import {
  CID_7050,
  CID_7050_CONTEXT_GROUP_UID,
  CID_7050_VERSION,
  deidentifyDicom,
  deidentifyDicomBuffer,
  INPUT_METHOD_CODE_SEQUENCE_DROPPED_CODE,
  type DicomCodedTerm,
} from "../../src/dicom/index.js";
import { resolveDicomOptions } from "../../src/dicom/policy-map.js";
import { buildDicom, type BuildDicomOptions } from "./helpers/build-dicom.js";
import { buildPhiDataset, pad, TS_EXPLICIT_LE, UID } from "./helpers/fixtures.js";

const TAG_METHOD_CODE_SEQUENCE = "00120064";
const TAG_METHOD_TEXT = "00120063";
const TAG_IDENTITY_REMOVED = "00120062";

/** The Code Value of the Basic Application Confidentiality Profile row. */
const PROFILE_CODE_VALUE = "113100";

/**
 * The thirteen rows of CID 7050, transcribed here independently of `src/`, so that a change to the
 * shipped table has to be made twice and reviewed once. The two long meanings are the reason this
 * duplication earns its keep: `113106` and `113107` name the option WITHOUT the word "with" that a
 * reader (and more than one secondary rendering of the table) inserts, and the published Code Meaning
 * is the vocabulary's text rather than this library's to improve.
 */
const PUBLISHED_CID_7050: readonly (readonly [string, string])[] = [
  ["113100", "Basic Application Confidentiality Profile"],
  ["113101", "Clean Pixel Data Option"],
  ["113102", "Clean Recognizable Visual Features Option"],
  ["113103", "Clean Graphics Option"],
  ["113104", "Clean Structured Content Option"],
  ["113105", "Clean Descriptors Option"],
  ["113106", "Retain Longitudinal Temporal Information Full Dates Option"],
  ["113107", "Retain Longitudinal Temporal Information Modified Dates Option"],
  ["113108", "Retain Patient Characteristics Option"],
  ["113109", "Retain Device Identity Option"],
  ["113110", "Retain UIDs Option"],
  ["113111", "Retain Safe Private Option"],
  ["113112", "Retain Institution Identity Option"],
];

/** Read the coded triplets out of a dataset's `(0012,0064)`, in sequence order. */
function readMethodCodes(dataset: Dataset): readonly DicomCodedTerm[] {
  const items: readonly Item[] = dataset.get(TAG_METHOD_CODE_SEQUENCE)?.items ?? [];
  return items.map((item) => {
    const code = readCode(item);
    return {
      codeValue: code.codeValue ?? "",
      codingSchemeDesignator: (code.codingSchemeDesignator ?? "") as "DCM",
      codeMeaning: code.codeMeaning ?? "",
    };
  });
}

describe("the carried CID 7050 table is transcribed verbatim, and is the only source of terms", () => {
  it("carries the thirteen published rows, DCM on every one", () => {
    expect(CID_7050.map((row) => [row.codeValue, row.codeMeaning])).toEqual(
      PUBLISHED_CID_7050.map(([value, meaning]) => [value, meaning]),
    );
    expect(CID_7050.every((row) => row.codingSchemeDesignator === "DCM")).toBe(true);
  });

  it("records the context group's own provenance beside the table", () => {
    expect(CID_7050_CONTEXT_GROUP_UID).toBe("1.2.840.10008.6.1.925");
    expect(CID_7050_VERSION).toBe("20170914");
  });

  it("keeps the two longitudinal-temporal meanings exactly as published, without an inserted 'with'", () => {
    // Non-vacuity: the rows really are present, and really do not carry the word a secondary rendering
    // of this table inserts. Getting either wrong would publish a Code Meaning that is not the
    // vocabulary's, which is precisely a term of this library's own invention.
    const meanings = CID_7050.filter(
      (row) => row.codeValue === "113106" || row.codeValue === "113107",
    );
    expect(meanings).toHaveLength(2);
    for (const row of meanings) {
      expect(row.codeMeaning).toContain("Retain Longitudinal Temporal Information");
      expect(row.codeMeaning).not.toContain("Information with");
    }
  });

  it("emits no term of its own invention, into the dataset or onto the result", () => {
    const result = deidentifyDicom(buildPhiDataset());
    const emitted: readonly DicomCodedTerm[] = [
      ...result.deidentificationMethodCodes,
      ...result.optionDeclarations.map((declaration) => declaration.term),
      ...readMethodCodes(result.dataset),
    ];
    // Non-vacuity: there really are terms to check, from all three surfaces.
    expect(emitted.length).toBeGreaterThan(13);
    for (const term of emitted) {
      expect(PUBLISHED_CID_7050).toContainEqual([term.codeValue, term.codeMeaning]);
      expect(term.codingSchemeDesignator).toBe("DCM");
    }
  });
});

describe("the profile's coded term is written to (0012,0064) beside the existing method text", () => {
  it("writes the Basic Application Confidentiality Profile term into the sequence", () => {
    const { dataset, deidentificationMethodCodes } = deidentifyDicom(buildPhiDataset());
    expect(readMethodCodes(dataset)).toEqual([
      {
        codeValue: PROFILE_CODE_VALUE,
        codingSchemeDesignator: "DCM",
        codeMeaning: "Basic Application Confidentiality Profile",
      },
    ]);
    // The result says the same thing the dataset does.
    expect(deidentificationMethodCodes).toEqual(readMethodCodes(dataset));
  });

  it("leaves (0012,0063) and (0012,0062) exactly as the delegated pass produces them, byte for byte", () => {
    const input = buildPhiDataset();
    // The control: the same delegated call this adapter makes, with the coded sequence never attached.
    const resolved = resolveDicomOptions({});
    const { dataset: delegated } = dicomDeidentify(buildPhiDataset(), {
      retain: [],
      deidentificationMethod: resolved.deidentificationMethod,
    });
    const { dataset: declared } = deidentifyDicom(input);

    // Non-vacuity: both attributes really are present on both, and the text really is non-empty.
    expect(delegated.get(TAG_METHOD_TEXT)?.rawBytes.length).toBeGreaterThan(0);
    expect(declared.get(TAG_METHOD_CODE_SEQUENCE)).toBeDefined();

    for (const tag of [TAG_METHOD_TEXT, TAG_IDENTITY_REMOVED]) {
      const before = delegated.get(tag);
      const after = declared.get(tag);
      expect(after?.vr).toBe(before?.vr);
      expect(after?.length).toBe(before?.length);
      expect(after?.rawBytes.equals(before?.rawBytes ?? Buffer.alloc(0))).toBe(true);
    }
    expect(declared.get(TAG_IDENTITY_REMOVED)?.rawBytes.toString("latin1").trim()).toBe("YES");
  });
});

describe("the declaration survives this library's own writer and reader, on both entry points", () => {
  it("reads back the same terms in the same order from the dataset entry point", () => {
    const { dataset, deidentificationMethodCodes } = deidentifyDicom(buildPhiDataset());
    const reparsed = parseDicom(serializeDicom(dataset));
    expect(readMethodCodes(reparsed)).toEqual(deidentificationMethodCodes);
  });

  it("reads back the same terms in the same order from the byte-buffer entry point", () => {
    const part10 = serializeDicom(buildPhiDataset());
    const { bytes, deidentificationMethodCodes } = deidentifyDicomBuffer(part10);
    expect(readMethodCodes(parseDicom(bytes))).toEqual(deidentificationMethodCodes);
    expect(deidentificationMethodCodes[0]?.codeValue).toBe(PROFILE_CODE_VALUE);
  });

  it("survives every transfer syntax the writer supports, not only Explicit VR LE", () => {
    // The hand-built sequence element has to honour the writer's byte convention, and that convention
    // DIFFERS by encoding: value-only bytes under Implicit VR LE, the full on-wire span under either
    // Explicit encoding. An element built the wrong way serializes into something that does not read
    // back, so each syntax is exercised rather than assumed from the Explicit VR LE case.
    for (const transferSyntax of [
      "1.2.840.10008.1.2", // Implicit VR LE
      "1.2.840.10008.1.2.1", // Explicit VR LE
      "1.2.840.10008.1.2.2", // Explicit VR BE
      "1.2.840.10008.1.2.1.99", // Deflated Explicit VR LE
    ]) {
      const elements: BuildDicomOptions["elements"] = [
        { tag: "00080060", vr: "CS", value: pad("CT") },
        { tag: "00100010", vr: "PN", value: pad("ZZSENTINELNAME^SYNTH") },
        { tag: "00080018", vr: "UI", value: pad(UID.sop) },
      ];
      const { bytes, deidentificationMethodCodes } = deidentifyDicomBuffer(
        buildDicom({ transferSyntax, elements }),
      );
      const roundTripped = readMethodCodes(parseDicom(bytes));
      expect(roundTripped, `round trip failed for ${transferSyntax}`).toEqual(
        deidentificationMethodCodes,
      );
      expect(roundTripped[0]?.codeMeaning).toBe("Basic Application Confidentiality Profile");
    }
  });
});

describe("fail closed: a declaration this run cannot verify returns nothing at all", () => {
  it("aborts with the typed fatal rather than returning output it cannot vouch for", () => {
    // A dataset with no File Meta group carries no Transfer Syntax UID, so this run cannot serialize
    // it and therefore cannot read its own declaration back. Returning the in-memory dataset anyway
    // would hand back an artifact stamped Patient Identity Removed YES carrying a coded claim nothing
    // verified.
    const noFileMeta = new Dataset({ warnings: [], elements: new Map() });
    let thrown: unknown;
    let returned: unknown;
    try {
      returned = deidentifyDicom(noFileMeta);
    } catch (err) {
      thrown = err;
    }
    expect(returned).toBeUndefined();
    expect(thrown).toBeInstanceOf(DeidError);
    expect((thrown as DeidError).code).toBe(FATAL_CODES.DEID_OUTPUT_INVALID);
    // Value-free: the peer's own message never rides out on the fatal.
    expect((thrown as DeidError).message).not.toContain("MISSING_TRANSFER_SYNTAX");
  });

  it("the same shape succeeds once it carries a transfer syntax: the fatal is not vacuous", () => {
    const { dataset } = deidentifyDicom(
      parseDicom(buildDicom({ transferSyntax: TS_EXPLICIT_LE, elements: [] })),
    );
    expect(readMethodCodes(dataset)).toHaveLength(1);
  });

  it("unparseable input fails before any declaration is emitted", () => {
    const notDicom = Buffer.from("ZZNOTADICOMFILEATALL_0123456789", "latin1");
    let thrown: unknown;
    let returned: unknown;
    try {
      returned = deidentifyDicomBuffer(notDicom);
    } catch (err) {
      thrown = err;
    }
    // Nothing is returned, so no coded profile claim is made over a document that was never read.
    expect(returned).toBeUndefined();
    expect(thrown).toBeInstanceOf(Error);
    expect(thrown).not.toBeInstanceOf(DeidError);
  });
});

describe("a De-identification Method Code Sequence the INPUT carried is dropped, and said so", () => {
  /** A Part 10 file whose `(0012,0064)` already holds a coded term from some earlier, unknown pass. */
  function withPriorMethodCodes(): Buffer {
    return buildDicom({
      transferSyntax: TS_EXPLICIT_LE,
      elements: [
        { tag: "00080060", vr: "CS", value: pad("CT") },
        { tag: "00100010", vr: "PN", value: pad("ZZSENTINELNAME^SYNTH") },
        {
          tag: "00120064",
          items: [
            {
              elements: [
                { tag: "00080100", vr: "SH", value: pad("ZZPRIOR1") },
                { tag: "00080102", vr: "SH", value: pad("ZZPRIORSCHEME") },
                { tag: "00080104", vr: "LO", value: pad("ZZPRIORMETHODMEANING") },
              ],
            },
            {
              elements: [
                { tag: "00080100", vr: "SH", value: pad("ZZPRIOR2") },
                { tag: "00080102", vr: "SH", value: pad("ZZPRIORSCHEME") },
                { tag: "00080104", vr: "LO", value: pad("ZZPRIORMEANINGTWO") },
              ],
            },
          ],
        },
      ],
    });
  }

  const PRIOR_TEXT = [
    "ZZPRIOR1",
    "ZZPRIOR2",
    "ZZPRIORSCHEME",
    "ZZPRIORMETHODMEANING",
    "ZZPRIORMEANINGTWO",
  ];

  it("the prior sequence really reaches the pass (non-vacuity)", () => {
    const input = parseDicom(withPriorMethodCodes());
    expect(input.get(TAG_METHOD_CODE_SEQUENCE)?.items).toHaveLength(2);
    expect(readMethodCodes(input)[0]?.codeValue).toBe("ZZPRIOR1");
  });

  it("carries none of the prior sequence's items into the output", () => {
    const { bytes, deidentificationMethodCodes } = deidentifyDicomBuffer(withPriorMethodCodes());
    const out = parseDicom(bytes);
    expect(readMethodCodes(out)).toEqual(deidentificationMethodCodes);
    expect(readMethodCodes(out)).toHaveLength(1);
    expect(out.get(TAG_METHOD_CODE_SEQUENCE)?.items).toHaveLength(1);
    // No unaudited byte of the input reaches the sequence: not as a value, not anywhere in the bytes.
    const serialized = bytes.toString("latin1");
    for (const text of PRIOR_TEXT) {
      expect(serialized.includes(text), `prior method-code text survived: ${text}`).toBe(false);
    }
  });

  it("records the replacement as a value-free warning carrying nothing read from the input", () => {
    const { warnings } = deidentifyDicomBuffer(withPriorMethodCodes());
    const dropped = warnings.filter((w) => w.code === INPUT_METHOD_CODE_SEQUENCE_DROPPED_CODE);
    expect(dropped).toHaveLength(1);
    const message = dropped[0]?.message ?? "";
    expect(message.length).toBeGreaterThan(0);
    for (const text of PRIOR_TEXT) {
      expect(message.includes(text)).toBe(false);
    }
    // Nor a Code Value, a Code Meaning, or any other quantity read off the input: the message is a
    // constant, so it is identical for a different input carrying a different prior sequence.
    const other = deidentifyDicomBuffer(
      buildDicom({
        transferSyntax: TS_EXPLICIT_LE,
        elements: [
          {
            tag: "00120064",
            items: [
              {
                elements: [{ tag: "00080100", vr: "SH", value: pad("ZZOTHER") }],
              },
            ],
          },
        ],
      }),
    );
    expect(
      other.warnings.filter((w) => w.code === INPUT_METHOD_CODE_SEQUENCE_DROPPED_CODE),
    ).toEqual(dropped);
  });

  it("NEGATIVE CONTROL: an input carrying no such sequence raises no such warning", () => {
    const { warnings } = deidentifyDicomBuffer(serializeDicom(buildPhiDataset()));
    expect(warnings.some((w) => w.code === INPUT_METHOD_CODE_SEQUENCE_DROPPED_CODE)).toBe(false);
  });
});

describe("an untouched study is not indistinguishable from an undeclared one", () => {
  /** A well-formed dataset holding only clinical/technical attributes no Annex E rule acts on. */
  function untouchedStudy(): Buffer {
    return buildDicom({
      transferSyntax: TS_EXPLICIT_LE,
      elements: [
        { tag: "00080060", vr: "CS", value: pad("CT") }, // Modality
        { tag: "00280004", vr: "CS", value: pad("MONOCHROME2") }, // Photometric Interpretation
        { tag: "00280010", vr: "US", value: Buffer.from([0x08, 0x00]) }, // Rows
        { tag: "00280011", vr: "US", value: Buffer.from([0x08, 0x00]) }, // Columns
      ],
    });
  }

  it("nothing was removed, emptied, dummied or remapped (non-vacuity)", () => {
    const { manifest } = deidentifyDicomBuffer(untouchedStudy());
    expect(manifest).toEqual([]);
  });

  it("still writes the coded profile term and still declares the options and the UID scope", () => {
    const result = deidentifyDicomBuffer(untouchedStudy());
    expect(readMethodCodes(parseDicom(result.bytes))).toEqual([
      {
        codeValue: PROFILE_CODE_VALUE,
        codingSchemeDesignator: "DCM",
        codeMeaning: "Basic Application Confidentiality Profile",
      },
    ]);
    expect(result.optionDeclarations).toHaveLength(12);
    expect(result.uidReferentialIntegrity.scope).toBe("single-call");
  });
});
