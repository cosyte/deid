/**
 * **DICOM: the Annex E options a caller can name.**
 *
 * The adapter offers three PS3.15 Annex E options as an input, `annexEOptions`: Clean Descriptors
 * (`113105`), Retain Patient Characteristics (`113108`) and Retain Device Identity (`113109`). Each is
 * handed to the delegated pass, declared in De-identification Method Code Sequence `(0012,0064)` by its
 * CID 7050 term, named in De-identification Method `(0012,0063)`, and listed on `retained`.
 *
 * Every test here is on a synthetic file built in memory, and the fail-closed half is the one that
 * matters most:
 *
 * - the two Retain options keep what Safe Harbor removes (an age over 89, a device serial number), so a
 *   run under the reserved `safe-harbor` label that names one is refused before anything is delegated;
 * - an option the adapter does not offer, Retain UIDs or Retain Safe Private among them, is refused;
 * - an attribute an option keeps is a `retained` row of the manifest, never a silent survivor;
 * - and the identifiers no option keeps are gone from the output bytes with every option named.
 */

import { serializeDicom, type parseDicom } from "@cosyte/dicom";
import { describe, expect, it } from "vitest";

import { DeidError, defineDeidPolicy, FATAL_CODES } from "../../src/index.js";
import {
  DICOM_ANNEX_E_OPTIONS,
  deidentifyDicom,
  deidentifyDicomBuffer,
  type DicomAnnexEOption,
  type DicomDeidOptions,
} from "../../src/dicom/index.js";
import { foldReport } from "../../src/dicom/fold.js";
import { ALL_SENTINELS, buildPhiDataset, pad } from "./helpers/fixtures.js";

/** A policy that does not claim the reserved label, so the two Retain options may run under it. */
const RESEARCH = defineDeidPolicy({ name: "synthetic-imaging-research" });

/** Obviously synthetic values in the attributes each option decides. */
const SYNTH = {
  patientAge: "093Y",
  patientWeight: "77.5",
  patientSex: "O",
  deviceSerial: "ZZ-SYNTH-DEVSN-0001",
  stationName: "ZZSYNTHSTATION",
  studyDescription: "ZZSYNTHDESC CT SYNTH",
  patientComments: "ZZSYNTHCOMMENT",
} as const;

/** The PHI-laden fixture plus one attribute per option column this suite reads. */
function optionDataset(): ReturnType<typeof parseDicom> {
  return buildPhiDataset({
    extra: [
      { tag: "00081010", vr: "SH", value: pad(SYNTH.stationName) }, // Station Name
      { tag: "00081030", vr: "LO", value: pad(SYNTH.studyDescription) }, // Study Description
      { tag: "00100040", vr: "CS", value: pad(SYNTH.patientSex) }, // Patient's Sex
      { tag: "00101010", vr: "AS", value: pad(SYNTH.patientAge) }, // Patient's Age
      { tag: "00101030", vr: "DS", value: pad(SYNTH.patientWeight) }, // Patient's Weight
      { tag: "00104000", vr: "LT", value: pad(SYNTH.patientComments) }, // Patient Comments
      { tag: "00181000", vr: "LO", value: pad(SYNTH.deviceSerial) }, // Device Serial Number
    ],
  });
}

/** The text the de-identified dataset carries at a tag, or `undefined` when absent or empty. */
function text(dataset: ReturnType<typeof parseDicom>, tag: string): string | undefined {
  const raw = dataset.get(tag)?.rawBytes.toString("latin1").trim();
  return raw !== undefined && raw.length > 0 ? raw : undefined;
}

/** Run once and return the result plus its serialized bytes as latin1, for byte-level leak checks. */
function run(options: DicomDeidOptions): {
  readonly result: ReturnType<typeof deidentifyDicom>;
  readonly bytes: string;
} {
  const result = deidentifyDicom(optionDataset(), options);
  return { result, bytes: serializeDicom(result.dataset).toString("latin1") };
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

/** The identifiers no offered option keeps: every one must be gone whatever is named. */
const NEVER_KEPT = [...ALL_SENTINELS, SYNTH.studyDescription, SYNTH.patientComments];

describe("the offered set", () => {
  it("is exactly the three options this adapter can apply honestly, in CID 7050 order", () => {
    expect(DICOM_ANNEX_E_OPTIONS).toEqual([
      "CleanDescriptors",
      "RetainPatientCharacteristics",
      "RetainDeviceIdentity",
    ]);
    expect(Object.isFrozen(DICOM_ANNEX_E_OPTIONS)).toBe(true);
  });
});

describe("Retain Patient Characteristics (113108)", () => {
  const { result, bytes } = run({
    policy: RESEARCH,
    annexEOptions: ["RetainPatientCharacteristics"],
  });

  it("keeps age, sex and weight, which the Basic Profile removes", () => {
    expect(text(result.dataset, "00101010")).toBe(SYNTH.patientAge);
    expect(text(result.dataset, "00100040")).toBe(SYNTH.patientSex);
    expect(text(result.dataset, "00101030")).toBe(SYNTH.patientWeight);
  });

  it("is declared: applied in (0012,0064), named in (0012,0063), listed on retained", () => {
    expect(result.deidentificationMethodCodes.map((t) => t.codeValue)).toEqual([
      "113100",
      "113108",
    ]);
    expect(result.dataset.get("00120064")?.items).toHaveLength(2);
    expect(result.optionDeclarations.find((d) => d.term.codeValue === "113108")?.status).toBe(
      "applied",
    );
    expect(result.optionDeclarations.filter((d) => d.status === "applied")).toHaveLength(1);
    expect(text(result.dataset, "00120063")).toBe(
      [
        "Cosyte @cosyte/deid",
        "PS3.15 Basic Application Level Confidentiality Profile",
        "Retain Patient Characteristics Option",
        "metadata only",
        'policy "synthetic-imaging-research"',
      ].join("\\"),
    );
    expect(result.retained).toEqual(["RetainPatientCharacteristics"]);
  });

  it("records every attribute it kept as a retained manifest row, never silently", () => {
    const retained = result.manifest.filter((e) => e.disposition === "retained");
    expect(retained.map((e) => e.locus).sort()).toEqual([
      "(0010,0040) Patient's Sex",
      "(0010,1010) Patient's Age",
      "(0010,1030) Patient's Weight",
    ]);
    for (const entry of retained) {
      expect(entry.transform).toBe("retain");
      expect(entry.code).toBe("DEID_RESIDUAL_RETAINED");
      expect(entry.reidentificationCode).toBe(false);
    }
  });

  it("keeps nothing else: every identifier the option does not name is gone from the bytes", () => {
    for (const value of [...NEVER_KEPT, SYNTH.deviceSerial, SYNTH.stationName]) {
      expect(bytes.includes(value), `survived: ${value}`).toBe(false);
    }
  });
});

describe("Retain Device Identity (113109)", () => {
  const { result, bytes } = run({ policy: RESEARCH, annexEOptions: ["RetainDeviceIdentity"] });

  it("keeps the device serial number and station name, which the Basic Profile removes", () => {
    expect(text(result.dataset, "00181000")).toBe(SYNTH.deviceSerial);
    expect(text(result.dataset, "00081010")).toBe(SYNTH.stationName);
  });

  it("is declared: applied in (0012,0064), named in (0012,0063), listed on retained", () => {
    expect(result.deidentificationMethodCodes.map((t) => t.codeValue)).toEqual([
      "113100",
      "113109",
    ]);
    expect(text(result.dataset, "00120063")).toContain("Retain Device Identity Option");
    expect(result.retained).toEqual(["RetainDeviceIdentity"]);
  });

  it("records the kept device attributes as retained rows", () => {
    const retained = result.manifest.filter((e) => e.disposition === "retained");
    expect(retained.map((e) => e.locus).sort()).toEqual([
      "(0008,1010) Station Name",
      "(0018,1000) Device Serial Number",
    ]);
    expect(retained.find((e) => e.locus.includes("Device Serial"))?.category).toBe("DEVICE");
  });

  it("keeps nothing else: patient characteristics and identifiers are gone from the bytes", () => {
    for (const value of [...NEVER_KEPT, SYNTH.patientAge, SYNTH.patientWeight]) {
      expect(bytes.includes(value), `survived: ${value}`).toBe(false);
    }
    expect(text(result.dataset, "00100040")).toBeUndefined();
  });
});

describe("Clean Descriptors (113105)", () => {
  // Removes rather than keeps: a cleaned descriptor is emptied, so the label may stand.
  const { result, bytes } = run({ annexEOptions: ["CleanDescriptors"] });

  it("runs under the default safe-harbor policy, because it keeps nothing Safe Harbor removes", () => {
    expect(result.retained).toEqual(["CleanDescriptors"]);
    expect(result.deidentificationMethodCodes.map((t) => t.codeValue)).toEqual([
      "113100",
      "113105",
    ]);
    expect(text(result.dataset, "00120063")).toContain("Clean Descriptors Option");
  });

  it("empties the descriptors: no text a descriptor carried reaches the bytes", () => {
    expect(text(result.dataset, "00081030")).toBeUndefined();
    expect(text(result.dataset, "00104000")).toBeUndefined();
    for (const value of NEVER_KEPT) {
      expect(bytes.includes(value), `survived: ${value}`).toBe(false);
    }
  });

  it("keeps nothing, so it adds no retained row", () => {
    expect(result.manifest.filter((e) => e.disposition === "retained")).toEqual([]);
  });
});

describe("all three at once", () => {
  it("applies each, declares each in table order, and still removes every identifier none names", () => {
    const { bytes, deidentificationMethodCodes, retained } = deidentifyDicomBuffer(
      serializeDicom(optionDataset()),
      {
        policy: RESEARCH,
        // Out of table order and with a repeat: the declaration is in CID 7050 order, once each.
        annexEOptions: [
          "RetainDeviceIdentity",
          "CleanDescriptors",
          "RetainPatientCharacteristics",
          "RetainDeviceIdentity",
        ],
      },
    );
    expect(deidentificationMethodCodes.map((t) => t.codeValue)).toEqual([
      "113100",
      "113105",
      "113108",
      "113109",
    ]);
    expect([...retained].sort()).toEqual([
      "CleanDescriptors",
      "RetainDeviceIdentity",
      "RetainPatientCharacteristics",
    ]);
    const latin1 = bytes.toString("latin1");
    for (const value of NEVER_KEPT) {
      expect(latin1.includes(value), `survived: ${value}`).toBe(false);
    }
    expect(latin1.includes(SYNTH.deviceSerial)).toBe(true);
    expect(latin1.includes(SYNTH.patientAge)).toBe(true);
  });
});

describe("fail closed: the safe-harbor label is refused for an option that keeps what it removes", () => {
  const refused: readonly DicomAnnexEOption[] = [
    "RetainPatientCharacteristics",
    "RetainDeviceIdentity",
  ];

  for (const option of refused) {
    it(`refuses ${option} under the default policy, before anything is delegated`, () => {
      const thrown = thrownBy(() => deidentifyDicom(optionDataset(), { annexEOptions: [option] }));
      expect(thrown).toBeInstanceOf(DeidError);
      expect((thrown as DeidError).code).toBe(FATAL_CODES.DEID_POLICY_INVALID);
      expect((thrown as DeidError).message).toContain(option);
      expect((thrown as DeidError).message).toContain("safe-harbor");
    });

    it(`refuses ${option} under an explicit "safe-harbor" policy string and object`, () => {
      for (const policy of ["safe-harbor", defineDeidPolicy({ name: "safe-harbor" })] as const) {
        const thrown = thrownBy(() =>
          deidentifyDicomBuffer(serializeDicom(optionDataset()), {
            policy,
            annexEOptions: ["CleanDescriptors", option],
          }),
        );
        expect((thrown as DeidError).code).toBe(FATAL_CODES.DEID_POLICY_INVALID);
      }
    });
  }

  it("the refusal carries no value from the document", () => {
    const thrown = thrownBy(() =>
      deidentifyDicom(optionDataset(), { annexEOptions: ["RetainPatientCharacteristics"] }),
    );
    const message = (thrown as DeidError).message;
    for (const value of [...ALL_SENTINELS, ...Object.values(SYNTH)]) {
      expect(message.includes(value)).toBe(false);
    }
  });
});

describe("fail closed: an option the adapter does not offer is refused, never ignored", () => {
  const notOffered = [
    "RetainUIDs",
    "RetainSafePrivate",
    "RetainInstitutionIdentity",
    "RetainLongitudinalTemporal",
    "RetainLongitudinalTemporalModifiedDates",
    "CleanGraphics",
    "CleanStructuredContent",
    "CleanPixelData",
    "CleanRecognizableVisual",
    "constructor",
    "",
  ];

  for (const option of notOffered) {
    it(`refuses ${JSON.stringify(option)}, even under a research policy`, () => {
      const thrown = thrownBy(() =>
        deidentifyDicom(optionDataset(), {
          policy: RESEARCH,
          annexEOptions: [option as DicomAnnexEOption],
        }),
      );
      expect(thrown).toBeInstanceOf(DeidError);
      expect((thrown as DeidError).code).toBe(FATAL_CODES.DEID_POLICY_INVALID);
    });
  }

  it("refuses an entry that is not a string, and an option list that is not an array", () => {
    for (const annexEOptions of [[42], [null], "RetainDeviceIdentity", { 0: "CleanDescriptors" }]) {
      const thrown = thrownBy(() =>
        deidentifyDicom(optionDataset(), {
          policy: RESEARCH,
          annexEOptions: annexEOptions as unknown as readonly DicomAnnexEOption[],
        }),
      );
      expect((thrown as DeidError).code).toBe(FATAL_CODES.DEID_POLICY_INVALID);
    }
  });

  it("does not echo a caller's unrecognized entry into the message", () => {
    const thrown = thrownBy(() =>
      deidentifyDicom(optionDataset(), {
        policy: RESEARCH,
        annexEOptions: ["ZZSYNTH-NOT-AN-OPTION" as DicomAnnexEOption],
      }),
    );
    expect((thrown as DeidError).message.includes("ZZSYNTH-NOT-AN-OPTION")).toBe(false);
  });
});

describe("no option named is the full Basic Profile, as before", () => {
  it("an empty list and an absent one give the same output and declare nothing applied", () => {
    const absent = deidentifyDicomBuffer(serializeDicom(optionDataset()));
    const empty = deidentifyDicomBuffer(serializeDicom(optionDataset()), { annexEOptions: [] });
    expect(empty.bytes.equals(absent.bytes)).toBe(true);
    expect(empty.retained).toEqual([]);
    expect(empty.deidentificationMethodCodes.map((t) => t.codeValue)).toEqual(["113100"]);
    const latin1 = absent.bytes.toString("latin1");
    for (const value of [...NEVER_KEPT, ...Object.values(SYNTH).filter((v) => v.length > 2)]) {
      expect(latin1.includes(value), `survived: ${value}`).toBe(false);
    }
    expect(absent.manifest.filter((e) => e.disposition === "retained")).toEqual([]);
  });
});

describe("the fold records a kept attribute by the action that kept it", () => {
  it("a K the pass kept is a retained row; a sequence kept only to walk its items is not", () => {
    const manifest = foldReport({
      attributes: [
        { tag: "00101010", keyword: "Patient's Age", action: "K", applied: "kept" },
        // A Study Instance UID the wire sends as SQ: kept so its items are walked, and they are
        // reported on their own, so the carrier adds no row.
        { tag: "0020000D", keyword: "Study Instance UID", action: "U", applied: "kept" },
      ],
      removedPrivateTags: [],
      warnings: [],
      retained: ["RetainPatientCharacteristics"],
    });
    expect(manifest).toEqual([
      {
        category: "OTHER_UNIQUE_ID",
        transform: "retain",
        locus: "(0010,1010) Patient's Age",
        count: 1,
        disposition: "retained",
        code: "DEID_RESIDUAL_RETAINED",
        reidentificationCode: false,
      },
    ]);
  });
});

describe("each refusal says what was refused and why, in a fixed sentence", () => {
  const offered = "CleanDescriptors, RetainPatientCharacteristics, RetainDeviceIdentity";

  it("a list that is not an array", () => {
    const thrown = thrownBy(() =>
      deidentifyDicom(optionDataset(), {
        policy: RESEARCH,
        annexEOptions: "CleanDescriptors" as unknown as readonly DicomAnnexEOption[],
      }),
    );
    expect((thrown as DeidError).message).toBe(
      "annexEOptions must be an array of option names; nothing was de-identified. " +
        `Name only options from DICOM_ANNEX_E_OPTIONS: ${offered}.`,
    );
  });

  it("an entry that is not offered, named by its position and never echoed", () => {
    const thrown = thrownBy(() =>
      deidentifyDicom(optionDataset(), {
        policy: RESEARCH,
        annexEOptions: ["CleanDescriptors", "RetainUIDs" as DicomAnnexEOption],
      }),
    );
    expect((thrown as DeidError).message).toBe(
      "annexEOptions[1] is not an Annex E option this adapter offers; nothing was de-identified, " +
        "because ignoring it would release output made under a different option set than the one " +
        `named. Offered: ${offered}.`,
    );
  });

  it("each Retain option under the safe-harbor label, naming what it keeps", () => {
    const expected: Readonly<Record<string, string>> = {
      RetainPatientCharacteristics: "an age over 89, which is category (C)",
      RetainDeviceIdentity: "device identifiers and serial numbers, which are category (M)",
    };
    for (const [option, keeps] of Object.entries(expected)) {
      const thrown = thrownBy(() =>
        deidentifyDicom(optionDataset(), { annexEOptions: [option as DicomAnnexEOption] }),
      );
      expect((thrown as DeidError).message).toBe(
        `a run under the reserved "safe-harbor" label must not apply the Annex E option ${option}: ` +
          `it keeps ${keeps}. Name the policy distinctly to retain it.`,
      );
    }
  });
});
