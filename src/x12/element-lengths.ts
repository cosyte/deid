/**
 * The **maximum lengths** of the X12 element positions a locus rule writes a value into, so a value the
 * engine writes there (a keyed surrogate above all, which is 64 characters with no bound) fits its
 * field. The engine reads the bound from `GenericLocus.maxLength`; see `../field-length.js` for how a
 * keyed surrogate is cut and when it is blocked instead.
 *
 * Each row gives the data element's maximum in 005010 and in 004010, from the X12 data element
 * dictionary. Two elements grew in 005010: element 127 (Reference Identification) from 30 to 50, and
 * the person-name elements 1035 and 1036 from 35 to 60 and from 25 to 35; element 364 (Communication
 * Number) grew from 80 to 256. A functional group whose `GS-08` names 005010 or a later version takes
 * the 005010 maxima; any other group, one that names an earlier version or one whose version cannot be
 * read, takes the 004010 ones, the shorter of the two, so the value fits either way.
 *
 * A date position is bounded by the date as written instead: the format the segment declares fixes a
 * date's length (`D8` is 8 characters), and a value of any other length is not a date in that format.
 *
 * @packageDocumentation
 * @internal
 */

/** One position's maximum length: in 005010 and later, and in 004010 and earlier. */
interface X12ElementMax {
  readonly v5010: number;
  readonly v4010: number;
}

/**
 * The maximum length of each element position a locus rule writes a value into, keyed
 * `SEGMENT-element` (`REF-2`). A position not listed here declares a maximum of `0`, so the engine
 * blocks every value it would write there: a rule added without a row fails closed.
 *
 * @internal
 */
export const X12_ELEMENT_MAX_LENGTHS: ReadonlyMap<string, X12ElementMax> = new Map([
  ["NM1-3", { v5010: 60, v4010: 35 }], // 1035 Name Last or Organization Name
  ["NM1-4", { v5010: 35, v4010: 25 }], // 1036 Name First
  ["NM1-5", { v5010: 25, v4010: 25 }], // 1037 Name Middle
  ["NM1-6", { v5010: 10, v4010: 10 }], // 1038 Name Prefix
  ["NM1-7", { v5010: 10, v4010: 10 }], // 1039 Name Suffix
  ["NM1-9", { v5010: 80, v4010: 80 }], // 67 Identification Code
  ["N1-2", { v5010: 60, v4010: 60 }], // 93 Name
  ["N1-4", { v5010: 80, v4010: 80 }], // 67 Identification Code
  ["REF-2", { v5010: 50, v4010: 30 }], // 127 Reference Identification
  ["TRN-2", { v5010: 50, v4010: 30 }], // 127 Reference Identification
  ["SBR-3", { v5010: 50, v4010: 30 }], // 127 Reference Identification
  ["SBR-4", { v5010: 60, v4010: 60 }], // 93 Name
  ["CLM-1", { v5010: 38, v4010: 38 }], // 1028 Claim Submitter's Identifier
  ["CLP-1", { v5010: 38, v4010: 38 }], // 1028 Claim Submitter's Identifier
  ["PER-2", { v5010: 60, v4010: 60 }], // 93 Name
  ["PER-4", { v5010: 256, v4010: 80 }], // 364 Communication Number
  ["PER-6", { v5010: 256, v4010: 80 }], // 364 Communication Number
  ["PER-8", { v5010: 256, v4010: 80 }], // 364 Communication Number
  ["N4-3", { v5010: 15, v4010: 15 }], // 116 Postal Code
  // The free-text positions: what a caller's redactor writes back must fit them too.
  ["MSG-1", { v5010: 264, v4010: 264 }], // 933 Free-Form Message Text
  ["III-4", { v5010: 264, v4010: 264 }], // 933 Free-Form Message Text
  ["K3-1", { v5010: 80, v4010: 80 }], // 449 Fixed Format Information
  ["NTE-2", { v5010: 80, v4010: 80 }], // 352 Description
]);

/**
 * `true` when a functional group's version (`GS-08`, e.g. `005010X222A1`) names 005010 or later: six
 * digits at its start that read as 005010 or more. Anything else, an absent `GS-08` included, reads as
 * earlier.
 *
 * @internal
 */
export function isX12Version5010OrLater(gs08: string | undefined): boolean {
  if (gs08 === undefined) return false;
  const release = /^(\d{6})/.exec(gs08)?.[1];
  return release !== undefined && Number(release) >= 5010;
}

/**
 * The maximum length of a value written across these elements of one segment: the shortest of their
 * maxima, because the applier writes the same value into each. `0` when any of them has no row.
 *
 * @internal
 */
export function x12MaxLength(
  segId: string,
  elements: readonly number[],
  version5010: boolean,
): number {
  let shortest = Number.POSITIVE_INFINITY;
  for (const element of elements) {
    const row = X12_ELEMENT_MAX_LENGTHS.get(`${segId}-${String(element)}`);
    if (row === undefined) return 0;
    shortest = Math.min(shortest, version5010 ? row.v5010 : row.v4010);
  }
  return Number.isFinite(shortest) ? shortest : 0;
}
