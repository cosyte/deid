/**
 * **DICOM: removing the sequences the delegated pass cleaned**, unit by unit.
 *
 * `removeCleanedSequences` reads the peer's report and the dataset it returned. These tests hand it
 * synthetic reports over a synthetic dataset so each rule is pinned on its own: which rows are acted on,
 * what is removed, what the rewritten report says, and when the pass is refused instead.
 */

import { Dataset, type parseDicom } from "@cosyte/dicom";
import { describe, expect, it } from "vitest";

import { DeidError, FATAL_CODES } from "../../src/index.js";
import { removeCleanedSequences } from "../../src/dicom/cleaned-sequences.js";
import { buildPhiDataset, pad } from "./helpers/fixtures.js";

/**
 * A dataset with one top-level coded list, and one kept sequence of eleven items: the first holds a
 * text and two coded lists, the last a text, so a two-digit item index is read too.
 */
function dataset(): ReturnType<typeof parseDicom> {
  const code = {
    elements: [{ tag: "00080104", vr: "LO", value: pad("ZZSYNTH FAKE MEANING") }],
  } as const;
  const lut = { tag: "00283002", vr: "US", value: Buffer.from([0x08, 0x00]) } as const;
  const text = { tag: "00081030", vr: "LO", value: Buffer.alloc(0) } as const;
  return buildPhiDataset({
    extra: [
      { tag: "00081084", items: [code] },
      {
        tag: "00283010",
        items: [
          {
            elements: [
              text,
              { tag: "00081301", items: [code] },
              { tag: "0040100A", items: [code] },
            ],
          },
          ...Array.from({ length: 9 }, () => ({ elements: [lut] })),
          { elements: [lut, text] },
        ],
      },
    ],
  });
}

type Row = {
  readonly tag: string;
  readonly applied: string;
  readonly contextPath?: readonly string[];
};

function rows(...attributes: Row[]): { readonly attributes: readonly Row[] } {
  return { attributes };
}

function refusal(call: () => unknown): DeidError | undefined {
  try {
    call();
  } catch (err) {
    return err as DeidError;
  }
  return undefined;
}

describe("removeCleanedSequences", () => {
  it("returns the inputs themselves when no sequence was cleaned", () => {
    const input = dataset();
    const report = rows(
      { tag: "00081030", applied: "cleaned" }, // a cleaned scalar is not a sequence
      { tag: "00081030", applied: "cleaned", contextPath: ["00283010[0]"] }, // nor nested
      { tag: "00081030", applied: "cleaned", contextPath: ["00283010[10]"] }, // in item ten
      { tag: "00081084", applied: "kept" },
    );
    const out = removeCleanedSequences(input, report);
    expect(out.dataset).toBe(input);
    expect(out.report).toBe(report);
  });

  it("removes a cleaned top-level sequence, a row with an empty path counting as top level", () => {
    const input = dataset();
    const out = removeCleanedSequences(
      input,
      rows(
        { tag: "00081084", applied: "cleaned", contextPath: [] },
        { tag: "00080104", applied: "kept", contextPath: ["00081084[0]"] },
        { tag: "00283010", applied: "kept" },
        // The same tag inside a kept sequence, not cleaned there: left as it is.
        { tag: "00081084", applied: "kept", contextPath: ["00283010[0]"] },
      ),
    );
    expect(out.dataset.has("00081084")).toBe(false);
    expect(out.dataset.has("00283010")).toBe(true);
    expect(out.dataset.fileMeta).toBe(input.fileMeta);
    expect(out.dataset.warnings).toEqual([]);
    expect(out.report.attributes).toEqual([
      { tag: "00081084", applied: "removed", contextPath: [] },
      { tag: "00283010", applied: "kept" },
      { tag: "00081084", applied: "kept", contextPath: ["00283010[0]"] },
    ]);
  });

  it("keeps a dataset with no File Meta without one", () => {
    const bare = new Dataset({
      warnings: [],
      elements: new Map(
        dataset()
          .elements()
          .map((element) => [element.tag, element]),
      ),
    });
    const out = removeCleanedSequences(bare, rows({ tag: "00081084", applied: "cleaned" }));
    expect(out.dataset.fileMeta).toBeUndefined();
    expect(out.dataset.has("00081084")).toBe(false);
  });

  it("refuses a cleaned sequence nested inside a kept one, naming its tag", () => {
    for (const [tag, named] of [
      ["00081301", "(0008,1301)"],
      ["0040100A", "(0040,100a)"],
    ] as const) {
      const thrown = refusal(() =>
        removeCleanedSequences(
          dataset(),
          rows({ tag, applied: "cleaned", contextPath: ["00283010[0]"] }),
        ),
      );
      expect(thrown?.code).toBe(FATAL_CODES.DEID_FORMAT_UNSUPPORTED);
      expect(thrown?.message).toContain(` ${named} `);
    }
  });

  it("refuses a cleaned position it cannot find: a bad segment, a missing item or tag", () => {
    for (const contextPath of [
      ["00283010"],
      ["00283010[1]"],
      ["00289999[0]"],
      ["x00283010[0]"], // a segment is read whole, never found inside a longer string
      ["00283010[0]x"],
      ["00283010[1x]"],
      ["0028301a[0]"],
      ["00080060[0]"], // a scalar, which has no items
      ["00283010[0]", "x"],
    ]) {
      const thrown = refusal(() =>
        removeCleanedSequences(
          dataset(),
          rows({ tag: "00081030", applied: "cleaned", contextPath }),
        ),
      );
      expect(thrown, contextPath.join("/")).toBeInstanceOf(DeidError);
    }
    const missing = refusal(() =>
      removeCleanedSequences(
        dataset(),
        rows({ tag: "00081040", applied: "cleaned", contextPath: ["00283010[0]"] }),
      ),
    );
    expect(missing?.code).toBe(FATAL_CODES.DEID_FORMAT_UNSUPPORTED);
  });

  it("does not refuse a cleaned sequence inside one it removes, and drops its row", () => {
    const out = removeCleanedSequences(
      dataset(),
      rows(
        { tag: "00081084", applied: "cleaned" },
        { tag: "00081301", applied: "cleaned", contextPath: ["00081084[0]"] },
      ),
    );
    expect(out.report.attributes).toEqual([{ tag: "00081084", applied: "removed" }]);
  });
});
