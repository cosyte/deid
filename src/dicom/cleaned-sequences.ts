/**
 * Remove every **sequence the delegated pass cleaned**, so an Annex E Clean option keeps no text.
 *
 * Table E.1-1 gives Clean Descriptors a `C` on sequences as well as on text: the diagnosis code
 * sequences `(0008,1084)` and `(0008,1301)` to `(0008,1304)`, Reason for Visit Code Sequence
 * `(0032,1067)`, Request Attributes Sequence `(0040,0275)`, Reason for Requested Procedure Code
 * Sequence `(0040,100A)` and Prescription Notes Sequence `(3010,0081)`. `@cosyte/dicom` cleans a text
 * value by emptying it, but it cleans a sequence by keeping it and walking its items, and an attribute
 * no row of the table names is kept inside them: Code Value `(0008,0100)`, Coding Scheme Designator
 * `(0008,0102)` and the free-text Code Meaning `(0008,0104)`. It then reports the sequence as
 * `cleaned`. Left alone, a caller would get the text of a diagnosis in output whose manifest says the
 * list was cleaned.
 *
 * **So this module removes each such sequence from the returned dataset, and says so.** A `C` cannot
 * make a similar-meaning substitute for a coded list here, so removal is the only honest clean. The
 * report is rewritten to match: the sequence's own row becomes `removed`, and every row for a position
 * inside it is dropped, because that position is no longer in the output. The rule keys on what the pass
 * did (a `cleaned` row whose element is an `SQ`), not on a list of tags, so a sequence the peer's table
 * gains a `C` for is removed the day the peer ships it.
 *
 * **Only at the top level.** The peer's writer passes an Explicit VR sequence through as its on-wire
 * bytes, so removing an element inside an item would mean re-encoding every sequence around it. This
 * module does not do that. A cleaned sequence inside a sequence the pass kept refuses the whole pass with
 * `DEID_FORMAT_UNSUPPORTED`, and no dataset or bytes are returned. A cleaned sequence inside another
 * cleaned sequence goes with its parent. A position this module cannot find in the output refuses the
 * pass the same way, because it cannot show that position holds no text.
 *
 * @packageDocumentation
 */

import { Dataset, type Element } from "@cosyte/dicom";

import { DeidError, FATAL_CODES } from "../codes.js";

/** The fields of a report row this module reads. */
interface CleanableAttribute {
  readonly tag: string;
  readonly applied: string;
  readonly contextPath?: readonly string[];
}

/** A report this module rewrites: only its rows change. */
interface CleanableReport<A extends CleanableAttribute> {
  readonly attributes: readonly A[];
}

/** One sequence-context segment the peer composes: an eight-digit tag and an item index. */
const SEGMENT = /^([0-9A-F]{8})\[(\d+)\]$/;

/**
 * Format a tag `"00081084"` as `"(0008,1084)"`, for a refusal message. A `cleaned` row's tag is always
 * one Table E.1-1 names, since only a row of the table carries a `C`, so it is never document text.
 */
function formatTag(tag: string): string {
  return `(${tag.slice(0, 4).toLowerCase()},${tag.slice(4, 8).toLowerCase()})`;
}

/** The typed, value-free refusal for a cleaned sequence this module cannot remove. */
function refuseNested(tag: string): never {
  throw new DeidError(
    FATAL_CODES.DEID_FORMAT_UNSUPPORTED,
    `Clean Descriptors cleaned the sequence ${formatTag(tag)} inside a sequence this pass keeps, and ` +
      "the delegated pass keeps a cleaned sequence's items, Code Meaning text included; this adapter " +
      "removes a cleaned sequence only at the top level, so nothing was de-identified. Run without " +
      "CleanDescriptors to remove the sequence under the Basic Profile.",
  );
}

/**
 * Find the element a nested report row names, walking the output by its context path. `undefined`
 * when a segment does not parse or does not lead to an item.
 */
function findNested(
  dataset: Dataset,
  contextPath: readonly string[],
  tag: string,
): Element | undefined {
  let scope: Dataset = dataset;
  for (const segment of contextPath) {
    const match = SEGMENT.exec(segment);
    if (match === null) return undefined;
    const item = scope.get(match[1] ?? "")?.items?.[Number(match[2])];
    if (item === undefined) return undefined;
    scope = item;
  }
  return scope.get(tag);
}

/** Whether a report row is at the top level of the dataset: the peer omits the path there. */
function isTopLevel(row: CleanableAttribute): boolean {
  return (row.contextPath ?? []).length === 0;
}

/** Whether a row's context path starts inside one of the removed top-level sequences. */
function insideRemoved(row: CleanableAttribute, removed: ReadonlySet<string>): boolean {
  const first = SEGMENT.exec(row.contextPath?.[0] ?? "");
  return first !== null && removed.has(first[1] ?? "");
}

/**
 * Remove every sequence the delegated pass reported `cleaned`, and rewrite its report to match.
 *
 * @param dataset - The dataset the delegated pass returned.
 * @param report - The report it returned with it.
 * @returns A fresh dataset without those sequences, and the report with each one `removed` and every
 *   row inside one dropped. Both are the inputs, unchanged, when the pass cleaned no sequence.
 * @throws {@link DeidError} `DEID_FORMAT_UNSUPPORTED` when a cleaned sequence sits inside a sequence
 *   the pass kept, or a cleaned position cannot be found in the output.
 * @internal
 */
export function removeCleanedSequences<A extends CleanableAttribute, R extends CleanableReport<A>>(
  dataset: Dataset,
  report: R,
): { readonly dataset: Dataset; readonly report: R } {
  const cleaned = report.attributes.filter((row) => row.applied === "cleaned");
  const removed = new Set(
    cleaned
      .filter((row) => isTopLevel(row) && dataset.get(row.tag)?.vr === "SQ")
      .map((row) => row.tag),
  );
  for (const row of cleaned) {
    if (isTopLevel(row) || insideRemoved(row, removed)) continue;
    const element = findNested(dataset, row.contextPath ?? [], row.tag);
    if (element === undefined || element.vr === "SQ") refuseNested(row.tag);
  }
  if (removed.size === 0) return { dataset, report };

  const attributes = report.attributes.flatMap((row): A[] => {
    if (insideRemoved(row, removed)) return [];
    return isTopLevel(row) && removed.has(row.tag) ? [{ ...row, applied: "removed" }] : [row];
  });
  return {
    dataset: new Dataset({
      warnings: [],
      elements: new Map(
        dataset
          .elements()
          .filter((element) => !removed.has(element.tag))
          .map((element) => [element.tag, element]),
      ),
      ...(dataset.fileMeta !== undefined ? { fileMeta: dataset.fileMeta } : {}),
    }),
    report: { ...report, attributes },
  };
}
