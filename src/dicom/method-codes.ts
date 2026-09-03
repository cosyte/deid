/**
 * The **CID 7050 "De-identification Method"** vocabulary, transcribed verbatim from the published
 * context group, and the resolution of a run's profile and Annex E options into the coded terms that
 * describe it.
 *
 * **Why a coded declaration at all.** PS3.15 E.1.1 requires that Patient Identity Removed `(0012,0062)`
 * be set to `YES` and that, additionally, "one or more codes from CID 7050 'De-identification Method'
 * corresponding to the Profile and Options used shall be added to De-identification Method Code Sequence
 * `(0012,0064)`, and/or a text string describing the method used shall be inserted in or added to
 * De-identification Method `(0012,0063)`". The `and/or` is why the existing `(0012,0063)` text is left
 * exactly as it is; the coded terms are added beside it, so a receiving archive can branch on a code
 * instead of parsing an English sentence.
 *
 * **The word "used" is the load-bearing one.** The codes written into `(0012,0064)` correspond to the
 * Profile and Options *used*, so a **withheld** option may never appear there: writing one would tell an
 * archive the opposite of the truth. A withheld option is declared on the returned result instead, where
 * it says what it means.
 *
 * **The table below is closed and verbatim.** Every Code Value, Code Meaning and Coding Scheme
 * Designator is reproduced from the published context group and nothing is composed, abbreviated or
 * paraphrased here; two of the meanings read a little oddly (`113106` / `113107` name the option without
 * the word "with" that a reader expects) and they are transcribed exactly as published anyway, because a
 * Code Meaning is the vocabulary's text and not this library's to improve. Nothing outside these
 * thirteen rows may ever be emitted as a coded term.
 *
 * **The adapter refuses to declare rather than declare wrongly.** A coded term naming a profile or an
 * option that was not applied is read by a downstream archive as a property of the study and acted on
 * without a human, and a study released on a false coded claim cannot be un-released. So a profile or an
 * option in play that no row of this table uniquely names aborts the pass with a typed fatal rather than
 * reaching for an approximate code.
 *
 * @packageDocumentation
 */

import { DeidError, FATAL_CODES } from "../codes.js";

/**
 * One coded term of CID 7050: the triplet a `(0012,0064)` item carries, and the same triplet as it is
 * surfaced on a result. Every field is reproduced verbatim from the published context group.
 *
 * @example
 * ```ts
 * import { deidentifyDicom, type DicomCodedTerm } from "@cosyte/deid/dicom";
 *
 * const { deidentificationMethodCodes } = deidentifyDicom(dataset);
 * deidentificationMethodCodes.forEach((term: DicomCodedTerm) => {
 *   term.codeValue; // => "113100"
 *   term.codingSchemeDesignator; // => "DCM"
 * });
 * ```
 */
export interface DicomCodedTerm {
  /** The Code Value `(0008,0100)`, verbatim from CID 7050. */
  readonly codeValue: string;
  /** The Coding Scheme Designator `(0008,0102)`. `DCM` on every row of CID 7050. */
  readonly codingSchemeDesignator: "DCM";
  /** The Code Meaning `(0008,0104)`, verbatim from CID 7050. */
  readonly codeMeaning: string;
}

/**
 * The context group UID of CID 7050, recorded beside the table as its provenance so a reader can check
 * the transcription against the published vocabulary rather than against this file.
 *
 * @example
 * ```ts
 * import { CID_7050_CONTEXT_GROUP_UID } from "@cosyte/deid/dicom";
 *
 * CID_7050_CONTEXT_GROUP_UID; // => "1.2.840.10008.6.1.925"
 * ```
 */
export const CID_7050_CONTEXT_GROUP_UID = "1.2.840.10008.6.1.925";

/**
 * The version of the CID 7050 context group these rows were transcribed from. Recorded for the same
 * reason as the UID: it names the edition a reader should compare against.
 *
 * @example
 * ```ts
 * import { CID_7050_VERSION } from "@cosyte/deid/dicom";
 *
 * CID_7050_VERSION; // => "20170914"
 * ```
 */
export const CID_7050_VERSION = "20170914";

/** Build one frozen row of the table. Local, so the thirteen rows below read as data. */
function term(codeValue: string, codeMeaning: string): DicomCodedTerm {
  return Object.freeze({ codeValue, codingSchemeDesignator: "DCM", codeMeaning } as const);
}

/**
 * **Table CID 7050, verbatim.** Thirteen rows, Coding Scheme Designator `DCM` on every one, Code Values
 * `113100` through `113112`. This is the closed set: a term outside it is never emitted, into the
 * dataset or onto a result.
 *
 * @example
 * ```ts
 * import { CID_7050 } from "@cosyte/deid/dicom";
 *
 * CID_7050.length; // => 13
 * CID_7050[0]?.codeMeaning; // => "Basic Application Confidentiality Profile"
 * ```
 */
export const CID_7050: readonly DicomCodedTerm[] = Object.freeze([
  term("113100", "Basic Application Confidentiality Profile"),
  term("113101", "Clean Pixel Data Option"),
  term("113102", "Clean Recognizable Visual Features Option"),
  term("113103", "Clean Graphics Option"),
  term("113104", "Clean Structured Content Option"),
  term("113105", "Clean Descriptors Option"),
  term("113106", "Retain Longitudinal Temporal Information Full Dates Option"),
  term("113107", "Retain Longitudinal Temporal Information Modified Dates Option"),
  term("113108", "Retain Patient Characteristics Option"),
  term("113109", "Retain Device Identity Option"),
  term("113110", "Retain UIDs Option"),
  term("113111", "Retain Safe Private Option"),
  term("113112", "Retain Institution Identity Option"),
]);

/** Index the table by Code Value so a lookup can never compose a term that is not in it. */
const BY_CODE_VALUE: ReadonlyMap<string, DicomCodedTerm> = new Map(
  CID_7050.map((row) => [row.codeValue, row]),
);

/**
 * The Code Value of the profile this adapter applies. The delegated Annex E pass always applies the
 * Basic Application Level Confidentiality Profile in full, and `113100` is the row that names it.
 *
 * @internal
 */
export const BASIC_PROFILE_CODE_VALUE = "113100";

/**
 * The **option rows** of CID 7050: every row except the profile row. This is the set the adapter
 * declares over, so that each one carries exactly one of applied or withheld and none is left
 * undeclared.
 *
 * The two pixel options `113101` and `113102` are in this set deliberately. They describe work a
 * metadata-only pass does not do, so they are **never** applied, and saying so in the vocabulary's own
 * terms is the machine-readable form of the burned-in-pixel hazard this adapter already flags in prose:
 * a reader who asks "was the pixel data cleaned" gets an answer instead of a silence.
 *
 * @internal
 */
export const OPTION_CODE_VALUES: readonly string[] = Object.freeze(
  CID_7050.filter((row) => row.codeValue !== BASIC_PROFILE_CODE_VALUE).map((row) => row.codeValue),
);

/**
 * Which CID 7050 option rows a delegated Annex E option name would activate.
 *
 * Nine of the eleven Annex E option sets are metadata-affecting and are the ones the delegated pass
 * honours; each maps to exactly one row. `RetainLongitudinalTemporal` is the exception and it maps to
 * **two**: the vocabulary distinguishes retaining full dates (`113106`) from retaining modified dates
 * (`113107`), and the delegated pass's single option name does not say which. A name that resolves to
 * two rows therefore names neither, and {@link resolveMethodDeclaration} refuses the pass rather than
 * picking one - guessing there would publish a claim about the dates in a study that the run cannot
 * support.
 *
 * The two pixel options are absent from this map on purpose: the delegated pass excludes them from its
 * option model entirely, so no run can activate one, and they are always declared withheld.
 */
const ROWS_ACTIVATED_BY: Readonly<Record<string, readonly string[]>> = Object.freeze({
  CleanGraphics: ["113103"],
  CleanStructuredContent: ["113104"],
  CleanDescriptors: ["113105"],
  RetainLongitudinalTemporal: ["113106", "113107"],
  RetainPatientCharacteristics: ["113108"],
  RetainDeviceIdentity: ["113109"],
  RetainUIDs: ["113110"],
  RetainSafePrivate: ["113111"],
  RetainInstitutionIdentity: ["113112"],
});

/**
 * Whether an Annex E option was applied by the run or deliberately withheld from it.
 *
 * @example
 * ```ts
 * import { deidentifyDicom, type DicomOptionStatus } from "@cosyte/deid/dicom";
 *
 * const { optionDeclarations } = deidentifyDicom(dataset);
 * const status: DicomOptionStatus | undefined = optionDeclarations[0]?.status;
 * status; // => "withheld"
 * ```
 */
export type DicomOptionStatus = "applied" | "withheld";

/**
 * One Annex E option, declared by its CID 7050 coded term and by whether this run applied it.
 *
 * A **withheld** declaration is only ever readable here: it is never written into De-identification
 * Method Code Sequence `(0012,0064)`, because that sequence carries the codes corresponding to the
 * Profile and Options *used*, and a withheld term there would say the opposite of the truth.
 *
 * @example
 * ```ts
 * import { deidentifyDicom, type DicomOptionDeclaration } from "@cosyte/deid/dicom";
 *
 * const { optionDeclarations } = deidentifyDicom(dataset);
 * const retainUids: DicomOptionDeclaration | undefined = optionDeclarations.find(
 *   (d) => d.term.codeValue === "113110",
 * );
 * retainUids?.status; // => "withheld": UIDs are remapped, never retained
 * ```
 */
export interface DicomOptionDeclaration {
  /** The CID 7050 coded term naming this option, verbatim from the table. */
  readonly term: DicomCodedTerm;
  /** Whether the run applied this option or deliberately withheld it. */
  readonly status: DicomOptionStatus;
}

/**
 * The coded declaration of one run: the terms that go into `(0012,0064)` and the applied/withheld
 * declaration that goes onto the result.
 *
 * @internal
 */
export interface MethodDeclaration {
  /**
   * The terms corresponding to the Profile and Options **used**, in the order they are written to
   * `(0012,0064)`: the profile first, then each applied option in table order.
   */
  readonly appliedTerms: readonly DicomCodedTerm[];
  /** Every option row of the table, each with exactly one of applied or withheld. */
  readonly optionDeclarations: readonly DicomOptionDeclaration[];
}

/**
 * Look a Code Value up in the closed table, or raise the typed fatal naming what could not be named.
 *
 * The `subject` is a bounded structural token composed by this adapter (a profile Code Value it holds,
 * or an Annex E option name from the delegated pass's own closed option list). Neither is document
 * derived, so no byte of an input can reach the message: the same contract the folded locus states for
 * the peer's report strings, and the reason no shape bound is applied to it here.
 */
function requireTerm(codeValue: string, subject: string): DicomCodedTerm {
  const found = BY_CODE_VALUE.get(codeValue);
  if (found === undefined) {
    throw new DeidError(
      FATAL_CODES.DEID_DECLARATION_UNNAMEABLE,
      `No CID 7050 term names ${subject}; refusing to write a coded de-identification method rather than declare an approximate one.`,
    );
  }
  return found;
}

/**
 * Resolve a run's profile and active Annex E options into the coded declaration.
 *
 * **This is the fail-safe.** The pass declares only what CID 7050 can name, and it names it exactly:
 *
 * - A **profile** whose Code Value is not a row of the table aborts the pass.
 * - An **option** the delegated pass reports as active that no row names, or that more than one row
 *   names so that no single term identifies it, aborts the pass.
 *
 * Both abort with `DEID_DECLARATION_UNNAMEABLE` naming the profile or option, and both abort *before*
 * anything is composed or attached, so a refused run returns neither a de-identified dataset nor
 * de-identified bytes. Declaring the wrong code is worse than declaring none: an archive reads a coded
 * term as a property of the study and acts on it without a human.
 *
 * @param profileCodeValue - The CID 7050 Code Value of the profile this run applies.
 * @param activeOptions - The Annex E options the run hands the delegated pass, by the peer's own option
 *   names. Empty for the full Basic Profile, which is what this adapter always resolves. Typed as
 *   strings rather than as the peer's option union on purpose: the whole point of the guard is to catch
 *   a name that union does not contain, and narrowing the parameter would make that unexpressible.
 * @returns The applied terms for `(0012,0064)` and the applied/withheld declaration for the result.
 * @throws {@link DeidError} `DEID_DECLARATION_UNNAMEABLE` when a profile or an option in play has no
 *   single naming term in the carried table.
 * @internal
 */
export function resolveMethodDeclaration(
  profileCodeValue: string,
  activeOptions: readonly string[],
): MethodDeclaration {
  const profileTerm = requireTerm(profileCodeValue, `profile "${profileCodeValue}"`);

  const appliedCodeValues = new Set<string>();
  for (const option of activeOptions) {
    const rows = ROWS_ACTIVATED_BY[option];
    if (rows === undefined || rows.length !== 1) {
      throw new DeidError(
        FATAL_CODES.DEID_DECLARATION_UNNAMEABLE,
        `No single CID 7050 term names Annex E option "${option}"; refusing to write a coded de-identification method rather than declare an approximate one.`,
      );
    }
    // Unreachable via a table row that is not in the closed set, but the lookup goes through the same
    // gate anyway: nothing composes a term, everything looks one up.
    appliedCodeValues.add(requireTerm(rows[0] ?? "", `Annex E option "${option}"`).codeValue);
  }

  const optionDeclarations = OPTION_CODE_VALUES.map((codeValue) =>
    Object.freeze({
      term: requireTerm(codeValue, `option code "${codeValue}"`),
      status: appliedCodeValues.has(codeValue) ? ("applied" as const) : ("withheld" as const),
    }),
  );

  const appliedTerms = [
    profileTerm,
    ...OPTION_CODE_VALUES.filter((codeValue) => appliedCodeValues.has(codeValue)).map((codeValue) =>
      requireTerm(codeValue, `option code "${codeValue}"`),
    ),
  ];

  return Object.freeze({
    appliedTerms: Object.freeze(appliedTerms),
    optionDeclarations: Object.freeze(optionDeclarations),
  });
}
