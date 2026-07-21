/**
 * Synthetic DICOM fixtures for the `@cosyte/deid/dicom` tests. **Everything is synthetic and built in
 * memory** by the vendored `build-dicom` Part 10 encoder — the repo ships zero `.dcm` files and no real
 * (or de-identified-real) study. The `ZZSENTINEL*` values are obviously-fake, tagged sentinels whose only
 * purpose is to prove they are *gone* from the de-identified output; they are declared synthetic in
 * `scripts/phi-allow-list.txt`.
 *
 * @module
 */

import { Buffer } from "node:buffer";

import { parseDicom } from "@cosyte/dicom";

import { buildDicom, type BuildDicomOptions } from "./build-dicom.js";

/** Even-pad a text value (space) so the fixture builder gets a legal length. */
export function pad(s: string): Buffer {
  const b = Buffer.from(s, "latin1");
  return b.length % 2 === 0 ? b : Buffer.concat([b, Buffer.from([0x20])]);
}

export const TS_EXPLICIT_LE = "1.2.840.10008.1.2.1";

/** Obviously-synthetic, tagged PHI sentinels — each must be absent from the de-identified output. */
export const SENTINEL = {
  patientName: "ZZSENTINELNAME^SYNTH",
  patientId: "ZZ-SENTINEL-MRN-0001",
  birthDate: "19000101",
  studyDate: "19000202",
  accession: "ZZSENTACC01",
  referring: "ZZSENTINELREF^SYNTH",
  institution: "ZZ SENTINEL INSTITUTION",
  otherPatientId: "ZZ-SENTINEL-OTHER-9",
  privateValue: "ZZSENTINELPRIVATE",
} as const;

/** Original UIDs (synthetic) that must be **remapped** (Study/Series/SOP-Instance), preserving relationships. */
export const UID = {
  sop: "1.2.826.0.1.3680043.8.498.111",
  study: "1.2.826.0.1.3680043.8.498.222",
  series: "1.2.826.0.1.3680043.8.498.333",
} as const;

/** Clinical/technical values that must **survive** byte-identical (the over-scrub guard). */
export const CLINICAL = {
  sopClassUid: "1.2.840.10008.5.1.4.1.1.2", // CT Image Storage — identifies the object type, not the instance
  modality: "CT",
  photometric: "MONOCHROME2",
} as const;

/**
 * Build a PHI-laden synthetic dataset spanning the enumerated Annex E loci plus clinical survivors and a
 * private tag. `opts.pixelData` adds Pixel Data (to exercise the burned-in hazard); `opts.burnedInFlag`
 * sets `(0028,0301) Burned In Annotation`.
 */
export function buildPhiDataset(
  opts: {
    readonly pixelData?: boolean;
    readonly burnedInFlag?: "YES" | "NO";
    readonly extra?: BuildDicomOptions["elements"];
  } = {},
): ReturnType<typeof parseDicom> {
  const elements: BuildDicomOptions["elements"] = [
    { tag: "00080016", vr: "UI", value: pad(CLINICAL.sopClassUid) }, // SOP Class UID (survive)
    { tag: "00080018", vr: "UI", value: pad(UID.sop) }, // SOP Instance UID (remap)
    { tag: "00080020", vr: "DA", value: pad(SENTINEL.studyDate) }, // Study Date
    { tag: "00080050", vr: "SH", value: pad(SENTINEL.accession) }, // Accession Number
    { tag: "00080060", vr: "CS", value: pad(CLINICAL.modality) }, // Modality (survive)
    { tag: "00080080", vr: "LO", value: pad(SENTINEL.institution) }, // Institution Name
    { tag: "00080090", vr: "PN", value: pad(SENTINEL.referring) }, // Referring Physician's Name
    { tag: "00100010", vr: "PN", value: pad(SENTINEL.patientName) }, // Patient's Name
    { tag: "00100020", vr: "LO", value: pad(SENTINEL.patientId) }, // Patient ID
    { tag: "00100030", vr: "DA", value: pad(SENTINEL.birthDate) }, // Patient's Birth Date
    { tag: "00101000", vr: "LO", value: pad(SENTINEL.otherPatientId) }, // Other Patient IDs
    { tag: "00280004", vr: "CS", value: pad(CLINICAL.photometric) }, // Photometric Interpretation (survive)
    { tag: "00280010", vr: "US", value: Buffer.from([0x08, 0x00]) }, // Rows = 8 (survive)
    { tag: "00280011", vr: "US", value: Buffer.from([0x08, 0x00]) }, // Columns = 8 (survive)
    { tag: "00091001", vr: "LO", value: pad(SENTINEL.privateValue) }, // private tag (odd group → removed)
    { tag: "0020000D", vr: "UI", value: pad(UID.study) }, // Study Instance UID (remap)
    { tag: "0020000E", vr: "UI", value: pad(UID.series) }, // Series Instance UID (remap)
    // `(0028,0301) Burned In Annotation`, when the caller sets a flag.
    ...(opts.burnedInFlag !== undefined
      ? [{ tag: "00280301", vr: "CS", value: pad(opts.burnedInFlag) }]
      : []),
    // Pixel Data (8x8 monochrome, 1 byte/pixel = 64 bytes) to exercise the burned-in hazard.
    ...(opts.pixelData === true
      ? [
          { tag: "00280100", vr: "US", value: Buffer.from([0x08, 0x00]) }, // BitsAllocated
          { tag: "7FE00010", vr: "OB", value: Buffer.alloc(64, 0x00) }, // Pixel Data
        ]
      : []),
    ...(opts.extra ?? []),
  ];

  return parseDicom(
    buildDicom({
      transferSyntax: TS_EXPLICIT_LE,
      mediaStorageSOPInstanceUID: UID.sop,
      elements,
    }),
  );
}

/** Every sentinel string in one array — for the whole-output leak sweep. */
export const ALL_SENTINELS: readonly string[] = Object.freeze(Object.values(SENTINEL));
