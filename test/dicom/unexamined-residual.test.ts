/**
 * **DICOM: the attributes the delegated Annex E report does not account for.** This adapter holds no
 * position map of its own, so the measurement is a *derivation*: an attribute present in the dataset the
 * PS3.15 Annex E pass returned that its report never mentions is one no rule reached, and it is counted
 * and located here. Nested sequence items included, because a sequence is exactly where an unaccounted
 * attribute hides.
 *
 * The negative control is the load-bearing half: an attribute the report DOES account for, whether it was
 * removed, remapped, or **kept** (the profile's `K` is a decision, not a silence), may never appear here.
 * Two more negative controls sit beside it, both from the definition of a **value-bearing** position: an
 * attribute sent empty carries no value, and a sequence container is a structure rather than a position.
 *
 * Everything is synthetic and built in memory; the sentinels are declared in `scripts/phi-allow-list.txt`.
 */

import { Buffer } from "node:buffer";

import { describe, expect, it } from "vitest";
import { parseDicom } from "@cosyte/dicom";

import { DeidError, DEID_DISPOSITION_CODES, FATAL_CODES } from "../../src/index.js";
import { deidentifyDicom } from "../../src/dicom/index.js";
import {
  deriveUnexaminedResiduals,
  type EnumerableDataset,
  type FoldableReport,
} from "../../src/dicom/fold.js";
import { buildDicom } from "./helpers/build-dicom.js";
import { buildPhiDataset, pad, SENTINEL, TS_EXPLICIT_LE, UID } from "./helpers/fixtures.js";

/** An empty Annex E report: nothing accounted for, so every element of a dataset is unaccounted. */
const EMPTY_REPORT: FoldableReport = {
  attributes: [],
  removedPrivateTags: [],
  warnings: [],
  retained: [],
};

/**
 * A dataset carrying a **sequence the Basic Profile keeps** (`(0028,3010)` VOI LUT Sequence, which
 * Table E.1-1 does not name), holding one attribute the report never mentions and one it acts on at the
 * root. Without the nested walk the first is invisible to the measurement, which is the gap the DICOM
 * enumeration exists to close.
 */
function datasetWithSequence(): ReturnType<typeof buildPhiDataset> {
  return buildPhiDataset({
    extra: [
      {
        tag: "00283010", // VOI LUT Sequence: kept by the profile, so its items reach the output
        items: [
          {
            elements: [
              { tag: "00283002", vr: "US", value: Buffer.from([0x08, 0x00]) }, // LUT Descriptor
              { tag: "00204000", vr: "LT", value: pad("ZZSEQCOMMENT") }, // Image Comments, nested
            ],
          },
        ],
      },
    ],
  });
}

describe("DICOM unexamined residual positions", () => {
  const { manifest, unexaminedResiduals } = deidentifyDicom(buildPhiDataset());
  const loci = new Set(unexaminedResiduals.map((r) => r.locus));

  it("the unaccounted attributes really carry values in the fixture (non-vacuity)", () => {
    const original = buildPhiDataset();
    expect(original.get("00080060")).toBeDefined(); // Modality
    expect(original.get("00280004")).toBeDefined(); // Photometric Interpretation
  });

  it("lists the attributes the delegated report never accounts for", () => {
    expect(loci.has("(0008,0060)")).toBe(true); // Modality
    expect(loci.has("(0028,0004)")).toBe(true); // Photometric Interpretation
    expect(loci.has("(0028,0010)")).toBe(true); // Rows
  });

  it("NEGATIVE CONTROL: never an attribute the report accounts for", () => {
    for (const accounted of [
      "(0010,0010) Patient's Name",
      "(0010,0020) Patient ID",
      "(0010,0030) Patient's Birth Date",
      "(0008,0050) Accession Number",
      "(0008,0090) Referring Physician's Name",
      "(0020,000d) Study Instance UID",
      "(0009,1001) PrivateTag",
    ]) {
      expect(loci.has(accounted)).toBe(false);
    }
    for (const entry of manifest) expect(loci.has(entry.locus)).toBe(false);
    // Nor under a bare tag: the acted-on tags must be absent however the locus is spelled.
    for (const tag of ["(0010,0010)", "(0010,0020)", "(0008,0050)", "(0020,000d)"]) {
      expect(loci.has(tag)).toBe(false);
    }
  });

  it("descends into sequence items: a nested unaccounted attribute is measured, in context", () => {
    const nested = deidentifyDicom(datasetWithSequence());
    const nestedLoci = nested.unexaminedResiduals.map((r) => r.locus);
    // Non-vacuity: the sequence really does survive the pass, so there is something to descend into.
    expect(nested.dataset.get("00283010")).toBeDefined();
    const inSequence = nestedLoci.filter((locus) => locus.includes("(0028,3010)[0]/"));
    expect(inSequence).toEqual(["(0028,3010)[0]/(0028,3002)"]);
    // The locus names the sequence and the item ordinal, which are positions, never the item's value.
    expect(JSON.stringify(nested.unexaminedResiduals)).not.toContain("ZZSEQCOMMENT");
  });

  it("and a nested attribute the report DOES account for stays out of the measurement", () => {
    // `(0020,4000)` Image Comments is acted on by the profile. Matching by tag treats it as reached
    // wherever it occurs, which is the conservative direction: it under-counts rather than reporting a
    // position the pass did decide about.
    const nested = deidentifyDicom(datasetWithSequence());
    const nestedLoci = nested.unexaminedResiduals.map((r) => r.locus);
    expect(nestedLoci.some((locus) => locus.includes("(0020,4000)"))).toBe(false);
  });

  it("NEGATIVE CONTROL: an attribute sent EMPTY is not a residual and is not counted", () => {
    // A Type 2 attribute sent zero-length is routine in DICOM, and an empty position carries no value.
    const withEmpty = buildPhiDataset({
      extra: [{ tag: "00280002", vr: "US", value: Buffer.alloc(0) }], // Samples per Pixel, sent empty
    });
    const result = deidentifyDicom(withEmpty);
    // Non-vacuity: the attribute really did survive the pass, and really carries no value.
    const survivor = result.dataset.get("00280002");
    expect(survivor).toBeDefined();
    expect(survivor?.length).toBe(0);
    expect(survivor?.rawBytes.length).toBe(0);
    // Nor is the exclusion vacuous the other way: the same attribute IS counted when it carries a value.
    const withValue = deidentifyDicom(
      buildPhiDataset({ extra: [{ tag: "00280002", vr: "US", value: Buffer.from([0x01, 0x00]) }] }),
    );
    expect(withValue.unexaminedResiduals.map((r) => r.locus)).toContain("(0028,0002)");
    expect(result.unexaminedResiduals.map((r) => r.locus)).not.toContain("(0028,0002)");
  });

  it("NEGATIVE CONTROL: a sequence CONTAINER is a structure, never a value-bearing position", () => {
    const nested = deidentifyDicom(datasetWithSequence());
    const nestedLoci = nested.unexaminedResiduals.map((r) => r.locus);
    // Non-vacuity: the container really is present in the returned dataset, really is an SQ, and the
    // walk really does reach the position inside it - so its absence below is an exclusion, not a miss.
    const container = nested.dataset.get("00283010");
    expect(container?.vr).toBe("SQ");
    expect(container?.items?.length).toBe(1);
    expect(nestedLoci).toContain("(0028,3010)[0]/(0028,3002)");
    expect(nestedLoci).not.toContain("(0028,3010)");
  });

  it("but carrying items is NOT what excludes it: encapsulated Pixel Data is still counted", () => {
    // Encapsulated Pixel Data is `VR=OB` with fragment items, and it is a real value-bearing position.
    // Excluding a container by the presence of items rather than by its VR would drop the one
    // attribute this metadata-only adapter is least able to speak for.
    const encapsulated = buildPhiDataset({
      extra: [
        {
          tag: "7FE00010",
          items: [],
          undefinedLength: true,
          encapsulatedPixelData: true,
          encapsulatedFragments: [Buffer.alloc(0), Buffer.alloc(8, 0x41)],
        },
      ],
    });
    const result = deidentifyDicom(encapsulated);
    // Non-vacuity: it really is an items-carrying element, and its VR really is not SQ.
    const pixels = result.dataset.get("7FE00010");
    expect(pixels?.vr).toBe("OB");
    expect(pixels?.items?.length).toBe(2);
    expect(result.unexaminedResiduals.map((r) => r.locus)).toContain("(7fe0,0010)");
  });

  it("every record is value-free and carries the unexamined code", () => {
    expect(unexaminedResiduals.length).toBeGreaterThan(0);
    for (const residual of unexaminedResiduals) {
      expect(residual.code).toBe(DEID_DISPOSITION_CODES.DEID_POSITION_UNEXAMINED);
      expect(residual.examined).toBe(false);
      expect(residual.count).toBeGreaterThanOrEqual(1);
    }
    const serialized = JSON.stringify(unexaminedResiduals);
    for (const sentinel of Object.values(SENTINEL)) {
      expect(serialized).not.toContain(sentinel);
    }
    // Nothing binary rides along either: the record is a locus, a count and two booleans.
    expect(serialized).not.toContain(Buffer.alloc(2, 0x08).toString("latin1"));
  });
});

/**
 * **The Part 10 File Meta group `(0002,xxxx)`.** It is outside `Dataset.elements()`, which is the peer
 * modelling PS3.10 faithfully, and it rides on the dataset the Annex E pass returns straight into the
 * bytes a serializer writes. Nothing in the delegated report accounts for a single position in it, so
 * every one of them is handed through and the derivation counts them like the interchange envelope of an
 * X12 pass or an HL7 `MSH`.
 */
describe("DICOM File Meta positions are enumerated with the rest", () => {
  /** A Part 10 file whose File Meta group carries a modeled AE title and a non-modeled extra element. */
  const withFileMetaExtras = (): ReturnType<typeof parseDicom> =>
    parseDicom(
      buildDicom({
        transferSyntax: TS_EXPLICIT_LE,
        mediaStorageSOPInstanceUID: UID.sop,
        implementationVersionName: "ZZIMPLVER01",
        fileMetaExtraElements: [
          { tag: "00020016", vr: "AE", value: pad("ZZSENDAE") }, // Source Application Entity Title
          { tag: "00020100", vr: "UI", value: pad("1.2.826.0.1.3680043.8.498.99") }, // non-modeled
        ],
        elements: [
          { tag: "00080018", vr: "UI", value: pad(UID.sop) }, // SOP Instance UID (remapped)
          { tag: "00080060", vr: "CS", value: pad("CT") }, // Modality (survives, unaccounted)
        ],
      }),
    );

  it("the File Meta positions really reach the returned dataset (non-vacuity)", () => {
    const { dataset } = deidentifyDicom(withFileMetaExtras());
    expect(dataset.fileMeta?.transferSyntaxUID).toBe(TS_EXPLICIT_LE);
    expect(dataset.fileMeta?.sourceApplicationEntityTitle).toBeDefined();
    expect(dataset.fileMeta?.extraElements?.length).toBe(1);
    // And none of them is in `Dataset.elements()`, which is why the dataset walk alone cannot see them.
    expect(dataset.elements().some((e) => e.tag.startsWith("0002"))).toBe(false);
  });

  it("lists the modeled, the non-modeled and the transfer-syntax positions", () => {
    const loci = deidentifyDicom(withFileMetaExtras()).unexaminedResiduals.map((r) => r.locus);
    expect(loci).toContain("(0002,0010)"); // Transfer Syntax UID
    expect(loci).toContain("(0002,0013)"); // Implementation Version Name
    expect(loci).toContain("(0002,0016)"); // Source Application Entity Title: names the sender
    expect(loci).toContain("(0002,0100)"); // a `(0002,xxxx)` the typed view does not model
    // Ordered ahead of the Data Set, because that is the order the bytes carry them in.
    expect(loci.indexOf("(0002,0010)")).toBeLessThan(loci.indexOf("(0008,0060)"));
  });

  it("NEGATIVE CONTROL: a File Meta field the document did not carry is not a position", () => {
    // A serializer substitutes its own File Meta Information Version and Implementation Class UID when
    // the model carries none. A constant this library composes is not a value the document handed
    // through, so an absent field contributes nothing - and the exclusion is not vacuous either way,
    // since the same group's populated fields above ARE listed.
    const { dataset, unexaminedResiduals } = deidentifyDicom(withFileMetaExtras());
    expect(dataset.fileMeta?.fileMetaInformationVersion).toBeUndefined();
    expect(dataset.fileMeta?.mediaStorageSOPClassUID).toBeUndefined();
    const loci = unexaminedResiduals.map((r) => r.locus);
    expect(loci).not.toContain("(0002,0001)");
    expect(loci).not.toContain("(0002,0002)");
  });

  it("DELIBERATE: the UID the delegated pass rebuilds with no report entry IS listed", () => {
    // `(0002,0003)` mirrors the SOP Instance UID, and the Annex E pass remaps it without auditing that.
    // The derivation stays literal rather than keeping a table of File-Meta-to-Data-Set mirrors: what
    // the record claims is exactly what is true, that the pass's audit says nothing at this position.
    const { manifest, unexaminedResiduals } = deidentifyDicom(withFileMetaExtras());
    expect(manifest.some((e) => e.locus.startsWith("(0008,0018)"))).toBe(true);
    expect(manifest.some((e) => e.locus.startsWith("(0002,0003)"))).toBe(false);
    expect(unexaminedResiduals.map((r) => r.locus)).toContain("(0002,0003)");
  });

  it("a dataset with no File Meta group at all enumerates cleanly", () => {
    const rootOnly: EnumerableDataset = {
      elements: () => [
        { tag: "00080060", vr: "CS", length: 2, rawBytes: { length: 2 }, items: undefined },
      ],
    };
    expect(deriveUnexaminedResiduals(rootOnly, EMPTY_REPORT).map((r) => r.locus)).toEqual([
      "(0008,0060)",
    ]);
  });

  it("every File Meta record is value-free: a locus, a count and the fact", () => {
    const { unexaminedResiduals } = deidentifyDicom(withFileMetaExtras());
    const serialized = JSON.stringify(unexaminedResiduals);
    for (const value of [UID.sop, TS_EXPLICIT_LE, "ZZSENDAE", "ZZIMPLVER01"]) {
      expect(serialized).not.toContain(value);
    }
  });

  it("the File Meta enumeration runs under the same fail-safe: a hostile group fails the pass", () => {
    const hostile: EnumerableDataset = {
      elements: () => [],
      get fileMeta(): never {
        throw new TypeError("the File Meta group would not yield its positions");
      },
    };
    let thrown: unknown;
    try {
      deriveUnexaminedResiduals(hostile, EMPTY_REPORT);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(DeidError);
    expect((thrown as DeidError).code).toBe(FATAL_CODES.DEID_POSITIONS_UNENUMERABLE);
    expect((thrown as DeidError).message).toContain("(0002,xxxx)");
    expect((thrown as DeidError).message).not.toContain("would not yield");
  });
});

describe("DICOM enumeration fail-safe: a dataset that will not yield its elements fails the pass", () => {
  it("a root dataset that refuses becomes the typed, value-free fatal naming the structure", () => {
    const hostile: EnumerableDataset = {
      elements(): never {
        throw new TypeError("the dataset would not yield its elements");
      },
    };
    let thrown: unknown;
    try {
      deriveUnexaminedResiduals(hostile, EMPTY_REPORT);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(DeidError);
    expect((thrown as DeidError).code).toBe(FATAL_CODES.DEID_POSITIONS_UNENUMERABLE);
    expect((thrown as DeidError).message).toContain("dataset");
    // Value-free: the peer's own message never rides out on the fatal.
    expect((thrown as DeidError).message).not.toContain("would not yield");
  });

  it("a sequence ITEM that refuses names the item, not the root: the innermost structure raises", () => {
    const hostileItem: EnumerableDataset = {
      elements(): never {
        throw new TypeError("the item would not yield its elements");
      },
    };
    const root: EnumerableDataset = {
      elements: () => [
        { tag: "00283010", vr: "SQ", length: 8, rawBytes: { length: 8 }, items: [hostileItem] },
      ],
    };
    let thrown: unknown;
    try {
      deriveUnexaminedResiduals(root, EMPTY_REPORT);
    } catch (err) {
      thrown = err;
    }
    expect((thrown as DeidError).code).toBe(FATAL_CODES.DEID_POSITIONS_UNENUMERABLE);
    expect((thrown as DeidError).message).toContain("(0028,3010)[0]");
  });

  it("the same shape enumerates cleanly when it does yield: the fatal is not vacuous", () => {
    const root: EnumerableDataset = {
      elements: () => [
        {
          tag: "00283010",
          vr: "SQ",
          length: 8,
          rawBytes: { length: 8 },
          items: [
            {
              elements: () => [
                { tag: "00283002", vr: "US", length: 2, rawBytes: { length: 2 }, items: undefined },
              ],
            },
          ],
        },
      ],
    };
    expect(deriveUnexaminedResiduals(root, EMPTY_REPORT).map((r) => r.locus)).toEqual([
      "(0028,3010)[0]/(0028,3002)",
    ]);
  });
});
