/**
 * DICOM adapter on inputs the headline fixtures never send: a device serial number, a sequence
 * written at a tag the profile remaps as a UID, a caller-chosen UID root, a File Meta group carrying an
 * empty field, and datasets a JavaScript caller builds by hand around a File Meta tag in the body or a
 * malformed private tag. Each one is labelled, removed or counted, and the measurement never lists a
 * position the pass did decide about.
 *
 * Everything is synthetic and built in memory.
 */

import { Buffer } from "node:buffer";

import { Dataset, parseDicom, type Element } from "@cosyte/dicom";
import { describe, expect, it } from "vitest";

import { SAFE_HARBOR_CATEGORIES } from "../../src/index.js";
import { deidentifyDicom, deidentifyDicomBuffer } from "../../src/dicom/index.js";
import { buildDicom, type BuildDicomOptions } from "./helpers/build-dicom.js";
import { buildPhiDataset, pad, TS_EXPLICIT_LE, UID } from "./helpers/fixtures.js";

const C = SAFE_HARBOR_CATEGORIES;

function parse(elements: BuildDicomOptions["elements"], opts: Partial<BuildDicomOptions> = {}) {
  return parseDicom(buildDicom({ transferSyntax: TS_EXPLICIT_LE, elements, ...opts }));
}

/** One parsed element, to carry into a hand-built dataset. */
function element(tag: string, vr: "UI" | "LO", value: string): Element {
  const el = parse([{ tag, vr, value: pad(value) }]).get(tag);
  if (el === undefined) throw new Error(`fixture has no ${tag}`);
  return el;
}

/** A copy of an element that reports a different tag, as a hand-built element can. */
function retagged(el: Element, tag: string): Element {
  const copy = Object.create(
    Object.getPrototypeOf(el) as object,
    Object.getOwnPropertyDescriptors(el),
  ) as Element;
  Object.defineProperty(copy, "tag", { value: tag });
  return copy;
}

function residualLoci(result: { readonly unexaminedResiduals: readonly { locus: string }[] }) {
  return result.unexaminedResiduals.map((r) => r.locus);
}

describe("deidentifyDicom, attributes the headline fixtures never carry", () => {
  it("labels a removed device serial number as a device identifier", () => {
    const { manifest, bytes } = deidentifyDicomBuffer(
      buildDicom({
        transferSyntax: TS_EXPLICIT_LE,
        elements: [{ tag: "00181000", vr: "LO", value: pad("ZZSERIAL0001") }],
      }),
    );
    expect(bytes.toString("latin1")).not.toContain("ZZSERIAL0001");
    expect(manifest).toEqual([
      expect.objectContaining({
        locus: "(0018,1000) Device Serial Number",
        category: C.DEVICE,
        disposition: "removed",
      }),
    ]);
  });

  it("descends a sequence written at a UID tag, acting inside it and listing no row for the container", () => {
    const result = deidentifyDicomBuffer(
      buildDicom({
        transferSyntax: TS_EXPLICIT_LE,
        elements: [
          {
            tag: "00080018",
            items: [{ elements: [{ tag: "00100010", vr: "PN", value: pad("ZZNESTED^NAME") }] }],
          },
        ],
      }),
    );
    expect(result.bytes.toString("latin1")).not.toContain("ZZNESTED");
    // The container is kept, a decision the report records: no manifest row, and no residual either.
    expect(result.manifest.map((m) => m.locus)).toEqual(["00080018[0]/(0010,0010) Patient's Name"]);
    expect(residualLoci(result).some((l) => l.includes("(0008,0018)"))).toBe(false);
  });

  it("remaps UIDs under the root the caller passes", () => {
    const { dataset } = deidentifyDicom(buildPhiDataset(), { uidRoot: "2.25.4242" });
    const study = dataset.get("0020000D")?.rawBytes.toString("latin1").replace(/\0+$/, "");
    expect(study).toMatch(/^2\.25\.4242\./);
    expect(study).not.toContain(UID.study);
  });
});

describe("deidentifyDicom, the File Meta group", () => {
  const base = parse([{ tag: "00080060", vr: "CS", value: pad("CT") }]);
  const elements = new Map(base.elements().map((el) => [el.tag, el]));
  const transferSyntaxUID = base.fileMeta?.transferSyntaxUID ?? TS_EXPLICIT_LE;

  function withFileMeta(fileMeta: Dataset["fileMeta"]): Dataset {
    return new Dataset({ warnings: [], elements, ...(fileMeta === undefined ? {} : { fileMeta }) });
  }

  it("counts a populated SOP Class UID, and not an empty one or an empty version", () => {
    const populated = deidentifyDicom(
      withFileMeta({ transferSyntaxUID, mediaStorageSOPClassUID: "1.2.840.10008.5.1.4.1.1.2" }),
    );
    expect(residualLoci(populated)).toContain("(0002,0002)");
    const empty = deidentifyDicom(
      withFileMeta({
        transferSyntaxUID,
        mediaStorageSOPClassUID: "",
        fileMetaInformationVersion: Buffer.alloc(0),
      }),
    );
    expect(residualLoci(empty)).not.toContain("(0002,0002)");
    expect(residualLoci(empty)).not.toContain("(0002,0001)");
  });

  it("does not count a File Meta position the report accounts for, even when it was in the body", () => {
    const sop = retagged(element("00080018", "UI", "1.2.3.4"), "00020003");
    const result = deidentifyDicom(
      new Dataset({
        warnings: [],
        elements: new Map([...elements, ["00020003", sop]]),
        fileMeta: { transferSyntaxUID, mediaStorageSOPInstanceUID: "1.2.3.4" },
      }),
    );
    expect(result.manifest.map((m) => m.locus)).toEqual([
      "(0002,0003) Media Storage SOP Instance UID",
    ]);
    expect(residualLoci(result)).not.toContain("(0002,0003)");
  });
});

describe("deidentifyDicom, a tag a hand-built dataset spells out of shape", () => {
  it("removes a private element whose tag is not eight hex digits and prints the tag as given", () => {
    const priv = retagged(element("00091001", "LO", "ZZPRIVATEVALUE"), "0009100");
    const { manifest, dataset } = deidentifyDicom(
      new Dataset({
        warnings: [],
        elements: new Map([["0009100", priv]]),
        fileMeta: { transferSyntaxUID: TS_EXPLICIT_LE },
      }),
    );
    expect(dataset.has("0009100")).toBe(false);
    expect(manifest).toEqual([
      expect.objectContaining({ locus: "0009100 PrivateTag", disposition: "removed" }),
    ]);
  });
});
