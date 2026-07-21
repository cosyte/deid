/**
 * DICOM de-identification adapter tests (`@cosyte/deid/dicom`, roadmap §Phase 6).
 *
 * The two headline gates: the **leak test** (every seeded sentinel is gone from the serialized output —
 * zero survivors) and the **over-scrub test** (clinical/technical values survive byte-identical). Plus:
 * consistent UID remapping, private-tag removal, the burned-in-pixel hazard, the value-free manifest, and
 * immutability. Everything is synthetic and built in memory (see `helpers/fixtures`).
 *
 * @module
 */

import { Buffer } from "node:buffer";

import { serializeDicom } from "@cosyte/dicom";
import { describe, expect, it } from "vitest";

import { SAFE_HARBOR_CATEGORIES } from "../../src/index.js";
import {
  BURNED_IN_ANNOTATION_CODE,
  deidentifyDicom,
  deidentifyDicomBuffer,
} from "../../src/dicom/index.js";
import { classifyDicomCategory } from "../../src/dicom/fold.js";
import {
  ALL_SENTINELS,
  buildPhiDataset,
  CLINICAL,
  pad,
  SENTINEL,
  TS_EXPLICIT_LE,
  UID,
} from "./helpers/fixtures.js";
import { buildDicom } from "./helpers/build-dicom.js";

/** Serialize a de-identified dataset to a latin1 string for the whole-output byte sweep. */
function deidToText(ds: ReturnType<typeof buildPhiDataset>): string {
  const { dataset } = deidentifyDicom(ds);
  return serializeDicom(dataset).toString("latin1");
}

describe("the leak test — every sentinel is gone (zero survivors)", () => {
  it("removes every seeded PHI sentinel from the serialized metadata", () => {
    const out = deidToText(buildPhiDataset());
    for (const sentinel of ALL_SENTINELS) {
      expect(out.includes(sentinel), `sentinel survived: ${sentinel}`).toBe(false);
    }
  });

  it("removes the private tag value (fail-closed: private tags go unless known-safe)", () => {
    const out = deidToText(buildPhiDataset());
    expect(out.includes(SENTINEL.privateValue)).toBe(false);
  });

  it("removes the original Study/Series/SOP-Instance UIDs (they are remapped, not retained)", () => {
    const out = deidToText(buildPhiDataset());
    expect(out.includes(UID.sop)).toBe(false);
    expect(out.includes(UID.study)).toBe(false);
    expect(out.includes(UID.series)).toBe(false);
  });

  it("also removes sentinels through the buffer convenience entry (parse → deid → serialize)", () => {
    const src = serializeDicom(buildPhiDataset());
    const { bytes } = deidentifyDicomBuffer(src);
    const out = bytes.toString("latin1");
    for (const sentinel of ALL_SENTINELS) {
      expect(out.includes(sentinel), `sentinel survived buffer path: ${sentinel}`).toBe(false);
    }
  });
});

describe("the over-scrub test — clinical/technical values survive byte-identical", () => {
  it("retains modality, photometric interpretation, and the SOP Class UID byte-identical", () => {
    const { dataset } = deidentifyDicom(buildPhiDataset());
    // Assert on the actual element values (not a whole-stream substring), so a short value like
    // Modality "CT" cannot pass spuriously by matching bytes elsewhere.
    const value = (tag: string) =>
      dataset
        .get(tag)
        ?.rawBytes.toString("latin1")
        .replace(/[\0 ]+$/, "");
    expect(value("00080060")).toBe(CLINICAL.modality); // Modality
    expect(value("00280004")).toBe(CLINICAL.photometric); // Photometric Interpretation
    expect(value("00080016")).toBe(CLINICAL.sopClassUid); // SOP Class UID (object type, not instance)
  });

  it("retains pixel bytes when Pixel Data is present (metadata-only never touches pixels)", () => {
    const { dataset } = deidentifyDicom(buildPhiDataset({ pixelData: true, burnedInFlag: "NO" }));
    const pixel = dataset.get("7FE00010");
    expect(pixel).toBeDefined();
    expect(pixel?.rawBytes.length).toBe(64);
  });
});

describe("consistent UID remapping — relationships survive", () => {
  it("maps the same source UID to the same replacement across two files (shared cache)", () => {
    const uidMap = new Map<string, string>();
    const a = deidentifyDicom(buildPhiDataset(), { uidMap });
    const b = deidentifyDicom(buildPhiDataset(), { uidMap });
    const studyA = a.dataset.get("0020000D")?.rawBytes.toString("latin1");
    const studyB = b.dataset.get("0020000D")?.rawBytes.toString("latin1");
    expect(studyA).toBeDefined();
    expect(studyA).toBe(studyB); // same original study UID → same replacement everywhere
    expect(studyA).not.toContain(UID.study); // and it is not the original
  });

  it("is content-derived: two runs without a shared cache still agree", () => {
    const a = deidentifyDicom(buildPhiDataset());
    const b = deidentifyDicom(buildPhiDataset());
    const seriesA = a.dataset.get("0020000E")?.rawBytes.toString("latin1");
    const seriesB = b.dataset.get("0020000E")?.rawBytes.toString("latin1");
    expect(seriesA).toBe(seriesB);
  });

  it("gives distinct Study vs Series replacements (does not collapse the hierarchy)", () => {
    const { dataset } = deidentifyDicom(buildPhiDataset());
    const study = dataset.get("0020000D")?.rawBytes.toString("latin1");
    const series = dataset.get("0020000E")?.rawBytes.toString("latin1");
    expect(study).not.toBe(series);
  });

  it("never surfaces a source→replacement UID map in the value-free result", () => {
    const result = deidentifyDicom(buildPhiDataset());
    // Only the documented fields; no `uidMap`, no `report`, nothing carrying original UIDs.
    expect(Object.keys(result).sort()).toEqual(
      [
        "burnedInAnnotationHazard",
        "dataset",
        "manifest",
        "metadataOnly",
        "retained",
        "warnings",
      ].sort(),
    );
    expect(JSON.stringify(result.manifest)).not.toContain(UID.study);
  });
});

describe("the burned-in-annotation pixel hazard — flagged, never cleaned", () => {
  it("flags the hazard when Pixel Data is present and not marked annotation-free", () => {
    const result = deidentifyDicom(buildPhiDataset({ pixelData: true }));
    expect(result.metadataOnly).toBe(true);
    expect(result.burnedInAnnotationHazard).toBe(true);
    expect(result.warnings.map((w) => w.code)).toContain(BURNED_IN_ANNOTATION_CODE);
  });

  it("does not flag the hazard when Burned In Annotation is affirmatively NO", () => {
    const result = deidentifyDicom(buildPhiDataset({ pixelData: true, burnedInFlag: "NO" }));
    expect(result.burnedInAnnotationHazard).toBe(false);
  });

  it("does not flag the hazard for a metadata-only object with no Pixel Data", () => {
    const result = deidentifyDicom(buildPhiDataset());
    expect(result.burnedInAnnotationHazard).toBe(false);
    expect(result.metadataOnly).toBe(true);
  });

  it("propagates the hazard through the buffer entry", () => {
    const src = serializeDicom(buildPhiDataset({ pixelData: true }));
    const result = deidentifyDicomBuffer(src);
    expect(result.burnedInAnnotationHazard).toBe(true);
    expect(result.metadataOnly).toBe(true);
  });
});

describe("the value-free manifest", () => {
  it("records the acted-on loci with category + locus, never a value", () => {
    const { manifest } = deidentifyDicom(buildPhiDataset());
    const flat = JSON.stringify(manifest);
    for (const sentinel of ALL_SENTINELS) {
      expect(flat.includes(sentinel), `manifest leaked a value: ${sentinel}`).toBe(false);
    }
    // A representative set of loci is present.
    const loci = manifest.map((e) => e.locus);
    expect(loci.some((l) => l.includes("Patient's Name"))).toBe(true);
    expect(loci.some((l) => l.includes("PrivateTag"))).toBe(true);
  });

  it("classifies the obvious categories and folds the Annex E actions", () => {
    const { manifest } = deidentifyDicom(buildPhiDataset());
    const by = (needle: string) => manifest.find((e) => e.locus.includes(needle));
    expect(by("Patient's Name")?.category).toBe(SAFE_HARBOR_CATEGORIES.NAMES);
    expect(by("Patient ID")?.category).toBe(SAFE_HARBOR_CATEGORIES.MRN);
    expect(by("Study Date")?.category).toBe(SAFE_HARBOR_CATEGORIES.DATES);
    expect(by("Institution Name")?.category).toBe(SAFE_HARBOR_CATEGORIES.GEOGRAPHIC);
    expect(by("Study Instance UID")?.category).toBe(SAFE_HARBOR_CATEGORIES.OTHER_UNIQUE_ID);
    expect(by("Study Instance UID")?.disposition).toBe("transformed");
    expect(by("Study Instance UID")?.transform).toBe("pseudonymize");
    expect(by("Patient's Name")?.disposition).toBe("removed");
  });

  it("labels every DICOM run as metadata-only with no retained deviations by default", () => {
    const result = deidentifyDicom(buildPhiDataset());
    expect(result.metadataOnly).toBe(true);
    expect(result.retained).toEqual([]);
  });
});

describe("the category classifier (coarse audit label, fail-closed to (R))", () => {
  it("maps the well-known DICOM PHI attributes to their obvious category", () => {
    expect(classifyDicomCategory("Patient's Name", "removed")).toBe(SAFE_HARBOR_CATEGORIES.NAMES);
    expect(classifyDicomCategory("Referring Physician's Name", "removed")).toBe(
      SAFE_HARBOR_CATEGORIES.NAMES,
    );
    expect(classifyDicomCategory("Patient ID", "removed")).toBe(SAFE_HARBOR_CATEGORIES.MRN);
    expect(classifyDicomCategory("Institution Name", "removed")).toBe(
      SAFE_HARBOR_CATEGORIES.GEOGRAPHIC,
    );
    expect(classifyDicomCategory("Patient's Telephone Numbers", "removed")).toBe(
      SAFE_HARBOR_CATEGORIES.PHONE,
    );
    expect(classifyDicomCategory("Patient's Birth Date", "removed")).toBe(
      SAFE_HARBOR_CATEGORIES.DATES,
    );
  });

  it("does not mistake equipment '…Name' elements for person names", () => {
    expect(classifyDicomCategory("Station Name", "removed")).not.toBe(SAFE_HARBOR_CATEGORIES.NAMES);
    expect(classifyDicomCategory("Manufacturer's Model Name", "removed")).not.toBe(
      SAFE_HARBOR_CATEGORIES.NAMES,
    );
  });

  it("falls closed to (R) for anything it cannot positively classify", () => {
    expect(classifyDicomCategory("Some Unknown Attribute", "removed")).toBe(
      SAFE_HARBOR_CATEGORIES.OTHER_UNIQUE_ID,
    );
    expect(classifyDicomCategory("Accession Number", "removed")).toBe(
      SAFE_HARBOR_CATEGORIES.OTHER_UNIQUE_ID,
    );
    // A UID always folds to the catch-all, regardless of keyword.
    expect(classifyDicomCategory("Series Instance UID", "uid-remapped")).toBe(
      SAFE_HARBOR_CATEGORIES.OTHER_UNIQUE_ID,
    );
  });
});

describe("immutability and provenance metadata", () => {
  it("never mutates the input dataset", () => {
    const ds = buildPhiDataset();
    const before = ds.get("00100010")?.rawBytes.toString("latin1");
    deidentifyDicom(ds);
    const after = ds.get("00100010")?.rawBytes.toString("latin1");
    expect(after).toBe(before);
    expect(after).toContain("ZZSENTINELNAME");
  });

  it("inserts the Patient Identity Removed = YES marker on the output", () => {
    const { dataset } = deidentifyDicom(buildPhiDataset());
    const flag = dataset.get("00120062")?.rawBytes.toString("latin1").trim();
    expect(flag).toBe("YES");
  });

  it("freezes the result object", () => {
    const result = deidentifyDicom(buildPhiDataset());
    expect(Object.isFrozen(result)).toBe(true);
  });
});

describe("fail-safe on minimal / odd input", () => {
  it("handles an empty dataset without throwing (nothing to act on)", () => {
    const empty = buildDicom({ transferSyntax: TS_EXPLICIT_LE, elements: [] });
    // parseDicom of a bare file-meta-only stream, then de-id.
    const result = deidentifyDicomBuffer(empty);
    expect(result.metadataOnly).toBe(true);
    expect(Buffer.isBuffer(result.bytes)).toBe(true);
  });

  it("removes an unknown private tag it cannot classify (fail-closed)", () => {
    const ds = buildPhiDataset({
      extra: [{ tag: "00431099", vr: "LO", value: pad("ZZSENTINELUNKNOWNPRIV") }],
    });
    const out = serializeDicom(deidentifyDicom(ds).dataset).toString("latin1");
    expect(out.includes("ZZSENTINELUNKNOWNPRIV")).toBe(false);
  });
});
