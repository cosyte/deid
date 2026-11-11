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

import { Dataset, Element, Item, parseDicom } from "@cosyte/dicom";
import { describe, expect, it } from "vitest";

import { DeidError, FATAL_CODES, SAFE_HARBOR_CATEGORIES } from "../../src/index.js";
import { WITHHELD_LOCUS_TOKEN } from "../../src/derived-token.js";
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

/**
 * A copy of an element that reports a different tag, as a hand-built element can. It is built through
 * the `Element` constructor from the parsed element's own fields: from `@cosyte/dicom` 0.1.12 on,
 * `rawBytes` is an accessor over private state, which a copy of the own properties does not carry.
 */
function retagged(el: Element, tag: string): Element {
  return new Element({
    tag,
    vr: el.vr,
    vm: el.vm,
    length: el.length,
    rawBytes: el.rawBytes,
    byteOffset: el.byteOffset,
    littleEndian: el.littleEndian,
    ...(el.privateCreator === undefined ? {} : { privateCreator: el.privateCreator }),
    ...(el.specificCharacterSet === undefined
      ? {}
      : { specificCharacterSet: el.specificCharacterSet }),
  });
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

describe("deidentifyDicom, an element copied by spreading", () => {
  /**
   * A copy of an element made with object spread. From `@cosyte/dicom` 0.1.12 on, `rawBytes` is an
   * accessor over private state, so the copy carries every structural field but no value bytes, and
   * the delegated Annex E pass would fail on it with a bare `TypeError` from inside the peer.
   */
  function spread(el: Element): Element {
    return { ...el } as unknown as Element;
  }

  function refusal(run: () => unknown): DeidError {
    try {
      run();
    } catch (err) {
      if (err instanceof DeidError) return err;
      throw err;
    }
    throw new Error("the pass returned instead of refusing");
  }

  const fileMeta = { transferSyntaxUID: TS_EXPLICIT_LE };

  it("refuses a body element with no value bytes, naming its tag and no value", () => {
    const modality = element("00080060", "LO", "ZZMODALITY");
    const err = refusal(() =>
      deidentifyDicom(
        new Dataset({
          warnings: [],
          elements: new Map([["00080060", spread(modality)]]),
          fileMeta,
        }),
      ),
    );
    expect(err.code).toBe(FATAL_CODES.DEID_POSITIONS_UNENUMERABLE);
    expect(err.message).toContain("(0008,0060)");
    expect(err.message).not.toContain("ZZMODALITY");
  });

  it("refuses one the profile would remove, too: the pass never decides on bytes it cannot read", () => {
    const name = element("00100010", "LO", "ZZDOE^ZZJANE");
    const err = refusal(() =>
      deidentifyDicom(
        new Dataset({ warnings: [], elements: new Map([["00100010", spread(name)]]), fileMeta }),
      ),
    );
    expect(err.code).toBe(FATAL_CODES.DEID_POSITIONS_UNENUMERABLE);
    expect(err.message).toContain("(0010,0010)");
    expect(err.message).not.toContain("ZZDOE");
  });

  it("refuses one inside a sequence item, naming the item it sits in", () => {
    const inner = element("00080060", "LO", "ZZMODALITY");
    const item = new Item({
      index: 0,
      warnings: [],
      elements: new Map([["00080060", spread(inner)]]),
    });
    const sequence = new Element({
      tag: "00081110",
      vr: "SQ",
      vm: 1,
      length: 0,
      rawBytes: Buffer.alloc(0),
      byteOffset: 0,
      littleEndian: true,
      items: [item],
    });
    const err = refusal(() =>
      deidentifyDicom(
        new Dataset({ warnings: [], elements: new Map([["00081110", sequence]]), fileMeta }),
      ),
    );
    expect(err.code).toBe(FATAL_CODES.DEID_POSITIONS_UNENUMERABLE);
    expect(err.message).toContain("(0008,1110)[0]/(0008,0060)");
  });

  it("withholds a tag that is not eight hex digits rather than print it", () => {
    const priv = { ...spread(element("00091001", "LO", "ZZPRIVATEVALUE")), tag: "ZZTAG" };
    const err = refusal(() =>
      deidentifyDicom(
        new Dataset({
          warnings: [],
          elements: new Map([["ZZTAG", priv as unknown as Element]]),
          fileMeta,
        }),
      ),
    );
    expect(err.code).toBe(FATAL_CODES.DEID_POSITIONS_UNENUMERABLE);
    expect(err.message).toContain(WITHHELD_LOCUS_TOKEN);
    expect(err.message).not.toContain("ZZTAG");
  });

  it("passes the same element when it is the parsed one", () => {
    const parsed = element("00080060", "LO", "CT");
    expect(() =>
      deidentifyDicom(
        new Dataset({ warnings: [], elements: new Map([["00080060", parsed]]), fileMeta }),
      ),
    ).not.toThrow();
  });
});
