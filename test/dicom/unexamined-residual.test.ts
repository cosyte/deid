/**
 * **DICOM: the attributes the delegated Annex E report does not account for.** This adapter holds no
 * position map of its own, so the measurement is a *derivation*: an attribute present in the dataset the
 * PS3.15 Annex E pass returned that its report never mentions is one no rule reached, and it is counted
 * and located here. Nested sequence items included, because a sequence is exactly where an unaccounted
 * attribute hides.
 *
 * The negative control is the load-bearing half: an attribute the report DOES account for, whether it was
 * removed, remapped, or **kept** (the profile's `K` is a decision, not a silence), may never appear here.
 *
 * Everything is synthetic and built in memory; the sentinels are declared in `scripts/phi-allow-list.txt`.
 */

import { Buffer } from "node:buffer";

import { describe, expect, it } from "vitest";

import { DEID_DISPOSITION_CODES } from "../../src/index.js";
import { deidentifyDicom } from "../../src/dicom/index.js";
import { buildPhiDataset, pad, SENTINEL } from "./helpers/fixtures.js";

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
