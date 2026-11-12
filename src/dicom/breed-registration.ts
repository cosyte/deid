/**
 * Remove the **breed registration** of a non-human patient, which PS3.15 Table E.1-1 does not list.
 *
 * PS3.3 C.7.1.1 gives a veterinary patient a Breed Registration Sequence `(0010,2294)`, whose items
 * carry a Breed Registration Number `(0010,2295)` and the Breed Registry Code Sequence `(0010,2296)`
 * that issued it. Table E.1-1 names none of the three, so the delegated Annex E pass keeps them. But a
 * registration number names one animal, and the registry that issued it holds the owner's name and
 * address: the same link to a person that the table removes Responsible Person `(0010,2297)` and
 * Responsible Organization `(0010,2299)` for. So this adapter removes both attributes itself, records
 * each removal in the report it folds, and returns a warning that names the removal as going beyond
 * Table E.1-1, so a reader comparing the output against the table knows why the two are gone.
 *
 * Species and breed are not removed: they describe a kind of animal, not one animal.
 *
 * **Only at the top level**, for the reason `./cleaned-sequences.ts` gives: removing an element inside
 * an item would mean re-encoding every sequence around it. The Patient Module puts both attributes at
 * the top level. Either one found inside a sequence the pass kept refuses the whole pass with
 * `DEID_FORMAT_UNSUPPORTED`, and no dataset or bytes are returned.
 *
 * @packageDocumentation
 */

import type { Dataset, DeidentifiedAttribute, DeidentifyReport } from "@cosyte/dicom";

import { DeidError, FATAL_CODES } from "../codes.js";

/** Breed Registration Sequence. */
const TAG_BREED_REGISTRATION_SEQUENCE = "00102294";
/** Breed Registration Number. */
const TAG_BREED_REGISTRATION_NUMBER = "00102295";

/**
 * The warning code returned when a run removed a breed registration, which PS3.15 Table E.1-1 does
 * not list. Exported from `@cosyte/deid/dicom` so a caller can branch on it.
 *
 * @example
 * ```ts
 * import { BREED_REGISTRATION_REMOVED_CODE, deidentifyDicom } from "@cosyte/deid/dicom";
 *
 * const { warnings } = deidentifyDicom(dataset);
 * warnings.some((w) => w.code === BREED_REGISTRATION_REMOVED_CODE);
 * ```
 */
export const BREED_REGISTRATION_REMOVED_CODE = "DICOM_BREED_REGISTRATION_REMOVED";

/**
 * The warning for a removed breed registration. A **constant**: it carries nothing read from the input.
 *
 * @internal
 */
export const BREED_REGISTRATION_REMOVED_WARNING = Object.freeze({
  code: BREED_REGISTRATION_REMOVED_CODE,
  message:
    "Breed Registration Sequence (0010,2294) and Breed Registration Number (0010,2295) were removed, " +
    "beyond PS3.15 Table E.1-1, which lists neither: a registration number names one animal, and its " +
    "registry holds the owner's name and address",
});

/**
 * Whether a tag is one of the two this module removes. Both are all digits, so the case a tag is
 * written in does not matter.
 */
function isBreedRegistration(tag: string): boolean {
  return tag === TAG_BREED_REGISTRATION_SEQUENCE || tag === TAG_BREED_REGISTRATION_NUMBER;
}

/** The typed, value-free refusal for a breed registration this module cannot remove. */
function refuseNested(tag: string): never {
  throw new DeidError(
    FATAL_CODES.DEID_FORMAT_UNSUPPORTED,
    `a breed registration attribute (${tag.slice(0, 4)},${tag.slice(4, 8)}) was found inside a ` +
      "sequence this pass keeps; this adapter removes a breed registration only at the top level, " +
      "where the Patient Module puts it, so nothing was de-identified.",
  );
}

/**
 * Walk the dataset and refuse a breed registration attribute inside any item of a kept sequence. At
 * the top level one is removed, so the walk does not descend into it.
 */
function refuseNestedIn(dataset: Dataset, topLevel: boolean): void {
  for (const element of dataset.elements()) {
    if (isBreedRegistration(element.tag)) {
      if (topLevel) continue;
      refuseNested(element.tag);
    }
    for (const item of element.items ?? []) refuseNestedIn(item, false);
  }
}

/** Whether a row's context path starts inside the removed Breed Registration Sequence. */
function insideSequence(row: DeidentifiedAttribute): boolean {
  return row.contextPath?.[0]?.startsWith(`${TAG_BREED_REGISTRATION_SEQUENCE}[`) === true;
}

/** Whether a row names one of the removed attributes at the top level. */
function isTopLevelRemoved(row: DeidentifiedAttribute, removed: ReadonlySet<string>): boolean {
  return row.contextPath === undefined && removed.has(row.tag);
}

/**
 * One `removed` row in the peer's own shape, under the attribute name the peer's report uses, so it
 * reads like one of its own rows. Table E.1-1 has no row for either attribute, so the
 * action is the `X` this adapter applied; the peer omits `contextPath` at the top level, and so does
 * this.
 */
function removedRow(tag: string): DeidentifiedAttribute {
  return {
    tag,
    keyword:
      tag === TAG_BREED_REGISTRATION_SEQUENCE
        ? "Breed Registration Sequence"
        : "Breed Registration Number",
    action: "X",
    applied: "removed",
  };
}

/**
 * Find the breed registration the delegated pass kept, and rewrite its report to say it was removed.
 *
 * The dataset is not rebuilt here: the tags come back so the one rebuild of the root that attaches
 * `(0012,0064)` drops them, as it drops a cleaned sequence.
 *
 * @param dataset - The dataset the delegated pass returned.
 * @param report - The report it returned with it.
 * @returns The top-level tags to remove, and the report with a `removed` row for each, one for each
 *   Breed Registration Number inside the removed sequence, and no other row at or inside them.
 * @throws {@link DeidError} `DEID_FORMAT_UNSUPPORTED` when a breed registration attribute sits inside
 *   a sequence the pass kept.
 * @internal
 */
export function removeBreedRegistration(
  dataset: Dataset,
  report: DeidentifyReport,
): { readonly removed: ReadonlySet<string>; readonly report: DeidentifyReport } {
  refuseNestedIn(dataset, true);
  const removed = new Set(
    dataset
      .elements()
      .map((element) => element.tag)
      .filter(isBreedRegistration),
  );
  const added = [...removed].map(removedRow);
  dataset.get(TAG_BREED_REGISTRATION_SEQUENCE)?.items?.forEach((item, index) => {
    if (item.has(TAG_BREED_REGISTRATION_NUMBER)) {
      added.push({
        ...removedRow(TAG_BREED_REGISTRATION_NUMBER),
        contextPath: [`${TAG_BREED_REGISTRATION_SEQUENCE}[${String(index)}]`],
      });
    }
  });
  const attributes = [
    ...report.attributes.filter((row) => !insideSequence(row) && !isTopLevelRemoved(row, removed)),
    ...added,
  ];
  return { removed, report: { ...report, attributes } };
}
