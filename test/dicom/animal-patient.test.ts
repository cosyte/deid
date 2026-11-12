/**
 * **DICOM: a non-human patient.**
 *
 * PS3.3 C.7.1.1 gives the Patient Module attributes for a veterinary patient: species, breed, the
 * neutered status, the breed registration, and the responsible person and organization (the owner).
 * Table E.1-1 of PS3.15 names three of them: Patient's Sex Neutered `(0010,2203)` (`X/Z`, kept by
 * Retain Patient Characteristics), Responsible Person `(0010,2297)` and Responsible Organization
 * `(0010,2299)` (both `X`). It names no species, breed or breed registration attribute, so the
 * delegated pass keeps them.
 *
 * Species and breed describe the animal, not one animal, and are kept. A breed registration number
 * names one animal, and the registry that issued it holds the owner's name and address, so this adapter
 * removes Breed Registration Sequence `(0010,2294)` and Breed Registration Number `(0010,2295)` itself,
 * records each removal, and names the removal as going beyond Table E.1-1 in a warning.
 *
 * Every value is plainly fake and built in memory, the way the other DICOM tests build theirs.
 */

import { Buffer } from "node:buffer";

import { serializeDicom, type DeidentifyReport, type parseDicom } from "@cosyte/dicom";
import { describe, expect, it } from "vitest";

import {
  DEID_DISPOSITION_CODES,
  DeidError,
  defineDeidPolicy,
  FATAL_CODES,
} from "../../src/index.js";
import {
  BREED_REGISTRATION_REMOVED_CODE,
  deidentifyDicom,
  deidentifyDicomBuffer,
  type DicomDeidOptions,
} from "../../src/dicom/index.js";
import { removeBreedRegistration } from "../../src/dicom/breed-registration.js";
import { buildPhiDataset, pad } from "./helpers/fixtures.js";
import type { BuildDicomSqElement } from "./helpers/build-dicom.js";

/** Plainly fake values: no registry, owner or code system holds any of them. */
const FAKE = {
  speciesText: "ZZSYNTH SPECIES CANINE",
  speciesCode: "ZZSPC01",
  breedText: "ZZSYNTH BREED BEAGLE",
  breedCode: "ZZBRD01",
  neutered: "ALTERED",
  registrationNumber: "ZZREGNUM-000001",
  registryCode: "ZZREGISTRY01",
  registryMeaning: "ZZSYNTH KENNEL REGISTRY",
  strayRegistrationNumber: "ZZREGNUM-STRAY-02",
  owner: "ZZOWNERFAMILY^ZZOWNERGIVEN",
  ownerRole: "OWNER",
  ownerOrganization: "ZZSYNTH OWNER ORGANIZATION",
} as const;

/** One fake code item: Code Value, Coding Scheme Designator and Code Meaning. */
function codeItem(code: string, meaning: string): BuildDicomSqElement["items"][number] {
  return {
    elements: [
      { tag: "00080100", vr: "SH", value: pad(code) }, // Code Value
      { tag: "00080102", vr: "SH", value: pad("99ZZSYN") }, // Coding Scheme Designator
      { tag: "00080104", vr: "LO", value: pad(meaning) }, // Code Meaning
    ],
  };
}

/** The Breed Registration Sequence with one item: the number and the registry that issued it. */
const BREED_REGISTRATION: BuildDicomSqElement = {
  tag: "00102294",
  items: [
    {
      elements: [
        { tag: "00102295", vr: "LO", value: pad(FAKE.registrationNumber) }, // Breed Registration Number
        { tag: "00102296", items: [codeItem(FAKE.registryCode, FAKE.registryMeaning)] }, // Breed Registry Code Sequence
      ],
    },
    // A second registration whose number was not sent: it gets no number row.
    { elements: [{ tag: "00102296", items: [codeItem(FAKE.registryCode, FAKE.registryMeaning)] }] },
  ],
};

/** The shared fixture plus the veterinary Patient Module attributes, in tag order. */
function animalDataset(
  extra: NonNullable<Parameters<typeof buildPhiDataset>[0]>["extra"] = [],
): ReturnType<typeof parseDicom> {
  return buildPhiDataset({
    extra: [
      { tag: "00102201", vr: "LO", value: pad(FAKE.speciesText) }, // Patient Species Description
      { tag: "00102202", items: [codeItem(FAKE.speciesCode, FAKE.speciesText)] }, // Patient Species Code Sequence
      { tag: "00102203", vr: "CS", value: pad(FAKE.neutered) }, // Patient's Sex Neutered
      { tag: "00102292", vr: "LO", value: pad(FAKE.breedText) }, // Patient Breed Description
      { tag: "00102293", items: [codeItem(FAKE.breedCode, FAKE.breedText)] }, // Patient Breed Code Sequence
      BREED_REGISTRATION,
      { tag: "00102297", vr: "PN", value: pad(FAKE.owner) }, // Responsible Person
      { tag: "00102298", vr: "CS", value: pad(FAKE.ownerRole) }, // Responsible Person Role
      { tag: "00102299", vr: "LO", value: pad(FAKE.ownerOrganization) }, // Responsible Organization
      ...(extra ?? []),
    ],
  });
}

/** A policy that does not claim the reserved label, so a Retain option may be named. */
const RESEARCH = defineDeidPolicy({ name: "synthetic-veterinary-research" });

/** Run the pass and return the result with its serialized output as latin1 text. */
function run(
  dataset: ReturnType<typeof parseDicom>,
  options: DicomDeidOptions = {},
): ReturnType<typeof deidentifyDicom> & { readonly text: string } {
  const result = deidentifyDicom(dataset, options);
  return { ...result, text: serializeDicom(result.dataset).toString("latin1") };
}

/** The trimmed text of a top-level attribute in the output, or undefined when it is absent. */
function valueOf(result: ReturnType<typeof deidentifyDicom>, tag: string): string | undefined {
  return result.dataset
    .get(tag)
    ?.rawBytes.toString("latin1")
    .replace(/[\0 ]+$/, "");
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

describe("species and breed describe the animal, and are kept", () => {
  it("keeps the species and breed descriptions byte-identical", () => {
    const result = run(animalDataset());
    expect(valueOf(result, "00102201")).toBe(FAKE.speciesText);
    expect(valueOf(result, "00102292")).toBe(FAKE.breedText);
  });

  it("keeps the species and breed code sequences and their codes", () => {
    const result = run(animalDataset());
    expect(result.dataset.get("00102202")?.items).toHaveLength(1);
    expect(result.dataset.get("00102293")?.items).toHaveLength(1);
    expect(result.text).toContain(FAKE.speciesCode);
    expect(result.text).toContain(FAKE.breedCode);
  });

  it("writes no manifest row for them, and counts them as positions no rule reached", () => {
    const result = run(animalDataset());
    const loci = result.manifest.map((e) => e.locus);
    for (const tag of ["(0010,2201)", "(0010,2202)", "(0010,2292)", "(0010,2293)"]) {
      expect(loci.some((l) => l.includes(tag))).toBe(false);
    }
    const residuals = result.unexaminedResiduals.map((r) => r.locus);
    expect(residuals).toContain("(0010,2201)");
    expect(residuals).toContain("(0010,2292)");
  });
});

describe("the neutered status is a patient characteristic", () => {
  it("is removed and recorded under the Basic Profile", () => {
    const result = run(animalDataset());
    expect(result.dataset.has("00102203")).toBe(false);
    const row = result.manifest.find((e) => e.locus.startsWith("(0010,2203)"));
    expect(row?.disposition).toBe("removed");
  });

  it("is kept and recorded retained under Retain Patient Characteristics", () => {
    const result = run(animalDataset(), {
      policy: RESEARCH,
      annexEOptions: ["RetainPatientCharacteristics"],
    });
    expect(valueOf(result, "00102203")).toBe(FAKE.neutered);
    const row = result.manifest.find((e) => e.locus.startsWith("(0010,2203)"));
    expect(row?.disposition).toBe("retained");
    expect(row?.code).toBe(DEID_DISPOSITION_CODES.DEID_RESIDUAL_RETAINED);
  });
});

describe("the owner is removed", () => {
  it("removes Responsible Person and Responsible Organization and records both", () => {
    const result = run(animalDataset());
    expect(result.dataset.has("00102297")).toBe(false);
    expect(result.dataset.has("00102299")).toBe(false);
    expect(result.text).not.toContain("ZZOWNERFAMILY");
    expect(result.text).not.toContain(FAKE.ownerOrganization);
    for (const tag of ["(0010,2297)", "(0010,2299)"]) {
      const row = result.manifest.find((e) => e.locus.startsWith(tag));
      expect(row?.disposition, `no removal recorded at ${tag}`).toBe("removed");
    }
  });

  it("keeps the coded Responsible Person Role, which names a role and not a person", () => {
    expect(valueOf(run(animalDataset()), "00102298")).toBe(FAKE.ownerRole);
  });
});

describe("the breed registration goes beyond Table E.1-1 and is removed", () => {
  it("carries the registration in the input, so its absence below means something", () => {
    const input = serializeDicom(animalDataset()).toString("latin1");
    expect(input).toContain(FAKE.registrationNumber);
    expect(input).toContain(FAKE.registryMeaning);
  });

  it("removes Breed Registration Sequence and every value inside it from the output bytes", () => {
    const result = run(animalDataset());
    expect(result.dataset.has("00102294")).toBe(false);
    expect(result.text).not.toContain(FAKE.registrationNumber);
    expect(result.text).not.toContain(FAKE.registryCode);
    expect(result.text).not.toContain(FAKE.registryMeaning);
  });

  it("removes it from the bytes of the buffer entry point too", () => {
    const { bytes } = deidentifyDicomBuffer(serializeDicom(animalDataset()));
    const text = Buffer.from(bytes).toString("latin1");
    expect(text).not.toContain(FAKE.registrationNumber);
    expect(text).not.toContain(FAKE.registryMeaning);
  });

  it("records the sequence and the number inside it as removed, under category (R)", () => {
    const { manifest } = run(animalDataset());
    const sequence = manifest.find((e) => e.locus === "(0010,2294) Breed Registration Sequence");
    const number = manifest.find(
      (e) => e.locus === "00102294[0]/(0010,2295) Breed Registration Number",
    );
    for (const row of [sequence, number]) {
      expect(row?.disposition).toBe("removed");
      expect(row?.category).toBe("OTHER_UNIQUE_ID");
      expect(row?.code).toBe(DEID_DISPOSITION_CODES.DEID_CATEGORY_REMOVED);
    }
    // The registry code item went with its sequence, so no row points inside it.
    expect(manifest.some((e) => e.locus.includes("(0010,2296)"))).toBe(false);
    // The second item sent no number, so it gets no row.
    expect(manifest.some((e) => e.locus.startsWith("00102294[1]"))).toBe(false);
  });

  it("leaves no position inside the removed sequence among the unexamined residuals", () => {
    const { unexaminedResiduals } = run(animalDataset());
    expect(unexaminedResiduals.some((r) => r.locus?.includes("00102294") === true)).toBe(false);
  });

  it("names the removal as going beyond Table E.1-1 in a value-free warning", () => {
    const { warnings } = run(animalDataset());
    const warning = warnings.find((w) => w.code === BREED_REGISTRATION_REMOVED_CODE);
    expect(BREED_REGISTRATION_REMOVED_CODE).toBe("DICOM_BREED_REGISTRATION_REMOVED");
    expect(warning?.message).toBe(
      "Breed Registration Sequence (0010,2294) and Breed Registration Number (0010,2295) were " +
        "removed, beyond PS3.15 Table E.1-1, which lists neither: a registration number names one " +
        "animal, and its registry holds the owner's name and address",
    );
    expect(warning?.message).not.toContain(FAKE.registrationNumber);
  });

  it("removes a Breed Registration Number sent at the top level, outside its sequence", () => {
    const stray = { tag: "00102295", vr: "LO", value: pad(FAKE.strayRegistrationNumber) };
    const result = run(animalDataset([stray]));
    expect(result.dataset.has("00102295")).toBe(false);
    expect(result.text).not.toContain(FAKE.strayRegistrationNumber);
    const row = result.manifest.find((e) => e.locus === "(0010,2295) Breed Registration Number");
    expect(row?.disposition).toBe("removed");
  });

  it("removes it under a Retain option as well, since no option keeps it", () => {
    const result = run(animalDataset(), {
      policy: RESEARCH,
      annexEOptions: ["RetainPatientCharacteristics"],
    });
    expect(result.text).not.toContain(FAKE.registrationNumber);
  });

  it("raises no warning for a dataset that carries no breed registration", () => {
    const { warnings } = run(buildPhiDataset());
    expect(warnings.some((w) => w.code === BREED_REGISTRATION_REMOVED_CODE)).toBe(false);
  });

  it("refuses a breed registration nested inside a sequence the pass keeps", () => {
    const nested = buildPhiDataset({
      extra: [
        {
          tag: "00283010", // VOI LUT Sequence, kept and walked by the Basic Profile
          items: [
            {
              elements: [
                { tag: "00283002", vr: "US", value: Buffer.from([0x08, 0x00]) }, // LUT Descriptor
                { tag: "00102295", vr: "LO", value: pad(FAKE.registrationNumber) },
              ],
            },
          ],
        },
      ],
    });
    const thrown = thrownBy(() => deidentifyDicom(nested));
    expect(thrown).toBeInstanceOf(DeidError);
    expect((thrown as DeidError).code).toBe(FATAL_CODES.DEID_FORMAT_UNSUPPORTED);
    expect((thrown as DeidError).message).toBe(
      "a breed registration attribute (0010,2295) was found inside a sequence this pass keeps; " +
        "this adapter removes a breed registration only at the top level, where the Patient " +
        "Module puts it, so nothing was de-identified.",
    );
    expect((thrown as DeidError).message).not.toContain(FAKE.registrationNumber);
  });
});

describe("the report rewrite", () => {
  /** Every field of a peer report but the rows, empty: this module reads and writes only the rows. */
  const emptyReport = {
    attributes: [],
    removedPrivateTags: [],
    embeddedAttributes: [],
    unauditableSequences: [],
    unenumerablePrivateRemovals: [],
    undefinedVrElements: [],
    fileMetaElementsDropped: [],
    fileMetaElementsDroppedCount: 0,
    group0004Removals: [],
    group0004RemovalCount: 0,
    unregisteredElementRemovals: [],
    unregisteredElementRemovalCount: 0,
    uidMap: new Map<string, string>(),
    warnings: [],
    retained: [],
  } satisfies DeidentifyReport;

  /** A report holding only the rows a test hands in. */
  function reportOf(attributes: DeidentifyReport["attributes"]): DeidentifyReport {
    return { ...emptyReport, attributes };
  }

  it("drops a row inside the removed sequence and a row at a removed attribute, keeps the rest", () => {
    const stray = { tag: "00102295", vr: "LO", value: pad(FAKE.strayRegistrationNumber) };
    const report = reportOf([
      // A row the pass wrote inside the registration item: that position is gone with it.
      {
        tag: "00100010",
        keyword: "Patient's Name",
        action: "X",
        applied: "removed",
        contextPath: ["00102294[0]"],
      },
      // A row the pass wrote at a top-level attribute this module removes: replaced by its own.
      { tag: "00102295", keyword: "Breed Registration Number", action: "Z", applied: "emptied" },
      // A row at the same tag inside another sequence is not at the top level, and is kept.
      {
        tag: "00102295",
        keyword: "Breed Registration Number",
        action: "Z",
        applied: "emptied",
        contextPath: ["00283010[0]"],
      },
      // A row elsewhere is kept.
      { tag: "00102297", keyword: "Responsible Person", action: "X", applied: "removed" },
    ]);
    const { removed, report: rewritten } = removeBreedRegistration(animalDataset([stray]), report);
    expect([...removed].sort()).toEqual(["00102294", "00102295"]);
    expect(rewritten.attributes).toEqual([
      {
        tag: "00102295",
        keyword: "Breed Registration Number",
        action: "Z",
        applied: "emptied",
        contextPath: ["00283010[0]"],
      },
      { tag: "00102297", keyword: "Responsible Person", action: "X", applied: "removed" },
      { tag: "00102294", keyword: "Breed Registration Sequence", action: "X", applied: "removed" },
      { tag: "00102295", keyword: "Breed Registration Number", action: "X", applied: "removed" },
      {
        tag: "00102295",
        keyword: "Breed Registration Number",
        action: "X",
        applied: "removed",
        contextPath: ["00102294[0]"],
      },
    ]);
  });

  it("removes nothing and keeps every row when the dataset carries no breed registration", () => {
    const row = {
      tag: "00102297",
      keyword: "Responsible Person",
      action: "X",
      applied: "removed",
    } as const;
    const { removed, report } = removeBreedRegistration(buildPhiDataset(), reportOf([row]));
    expect(removed.size).toBe(0);
    expect(report.attributes).toEqual([row]);
  });
});
