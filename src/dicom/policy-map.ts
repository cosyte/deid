/**
 * The unified-policy → **PS3.15 Annex E option** mapping for the DICOM adapter.
 *
 * DICOM is the one format `deid` **delegates rather than reimplements**: `@cosyte/dicom` already ships the
 * PS3.15 **Basic Application Level Confidentiality Profile** and the metadata-affecting Annex E Options.
 * This module resolves the unified {@link DeidOptions} into a `@cosyte/dicom` `DeidentifyOptions`, and it
 * does so **fail-closed**: with no option named, the run applies the **full Basic Profile with no
 * Retain/Clean deviations** (maximal removal), so every private tag is removed and every UID is
 * consistently remapped. There is no per-category auto-derivation, on purpose: the Annex E option model
 * is coarser than the 18-category Safe Harbor model, so auto-relaxing it from a policy would risk
 * *under*-removal. An option is applied only when the caller names it in `annexEOptions`, only from the
 * closed set `./annex-e-options.ts` offers, and an option that keeps what Safe Harbor removes is refused
 * under the reserved `safe-harbor` label.
 *
 @packageDocumentation
 */

import { resolvePolicy } from "../policy.js";

import { resolveAnnexEOptions, type DicomAnnexEOption } from "./annex-e-options.js";
import {
  BASIC_PROFILE_CODE_VALUE,
  resolveMethodDeclaration,
  type MethodDeclaration,
} from "./method-codes.js";
import type { DicomDeidOptions } from "./types.js";

/**
 * The subset of `@cosyte/dicom`'s `DeidentifyOptions` this adapter produces. Typed structurally (not by
 * importing the parser's type) so the core stays decoupled; the `/dicom` subpath is where the real
 * `@cosyte/dicom` types are used.
 *
 * @internal
 */
export interface ResolvedDicomOptions {
  /**
   * Annex E Retain/Clean options to activate, in CID 7050 order. Empty unless the caller named one in
   * `annexEOptions`; empty is the full Basic Profile.
   */
  readonly retain: readonly DicomAnnexEOption[];
  /**
   * The coded declaration of the run: the CID 7050 terms for `(0012,0064)`, the profile first and then
   * each applied option in table order, and every option declared applied or withheld.
   */
  readonly declaration: MethodDeclaration;
  /** Root for generated replacement UIDs (Annex E action `U`); undefined → `@cosyte/dicom` default. */
  readonly uidRoot?: string;
  /** Caller-owned source→replacement UID cache for cross-file consistency. */
  readonly uidMap?: Map<string, string>;
  /**
   * The de-identification method text written to `(0012,0063)`: several `LO` Values joined by the
   * DICOM value delimiter `\`, each at most 64 characters. See {@link deidentificationMethodText}.
   */
  readonly deidentificationMethod: string;
}

/**
 * Resolve the unified de-id options into the concrete `@cosyte/dicom` de-identification options: the
 * Basic Profile plus the Annex E options the caller named (none by default), consistent UID remapping,
 * and a De-identification Method string naming the profile, each option and the policy. The `context` (HMAC key) is intentionally unused: Annex E dummying and
 * content-derived UID remapping do not consume the keyed-transform key; it is accepted only for API
 * uniformity with the other adapters.
 *
 * @param options - The unified de-id options (policy + optional UID cache/root).
 * @returns The fail-closed `@cosyte/dicom` de-identification options.
 * @throws {@link DeidError} `DEID_POLICY_INVALID` for an option the adapter does not offer, or for one
 *   that keeps what Safe Harbor removes under the reserved `safe-harbor` label.
 * @internal
 */
export function resolveDicomOptions(options: DicomDeidOptions): ResolvedDicomOptions {
  const policy = resolvePolicy(options.policy);
  const retain = resolveAnnexEOptions(options.annexEOptions, policy.name);
  // Resolved here, before anything is delegated: a profile or option the vocabulary cannot name
  // refuses the pass with no dataset and no bytes produced.
  const declaration = resolveMethodDeclaration(BASIC_PROFILE_CODE_VALUE, retain);
  const optionMeanings = declaration.appliedTerms.slice(1).map((term) => term.codeMeaning);
  const base: ResolvedDicomOptions = {
    retain,
    declaration,
    deidentificationMethod: deidentificationMethodText(policy.name, optionMeanings),
  };
  return {
    ...base,
    ...(options.uidRoot !== undefined ? { uidRoot: options.uidRoot } : {}),
    ...(options.uidMap !== undefined ? { uidMap: options.uidMap } : {}),
  };
}

/** PS3.5 Table 6.2-1, `LO` row: 64 characters maximum, per Value. */
const LO_VALUE_MAX_CHARS = 64;

/** The DICOM value delimiter (5CH) between the Values of a multi-valued string VR. */
const VALUE_DELIMITER = "\\";

/** What a policy name too long for one Value is cut to end with, inside its closing quote. */
const ELLIPSIS = "...";

/** What a backslash in a policy name is written as, since 5CH is the delimiter. */
const DELIMITER_STAND_IN = "/";

/** What any other character an `LO` Value cannot carry is written as. */
const UNWRITABLE_STAND_IN = "?";

/** The first and last printable ASCII characters, SPACE (20H) and TILDE (7EH). */
const FIRST_PRINTABLE_ASCII = 0x20;
const LAST_PRINTABLE_ASCII = 0x7e;

/**
 * Map one character of a policy name to what its `LO` Value can carry.
 *
 * Only printable ASCII (U+0020 to U+007E) is kept. The method text reaches the wire one byte per
 * UTF-16 code unit (latin1), so a character above U+00FF would land as its low byte: U+015C as 5CH,
 * the delimiter, and U+0100 as NUL. PS3.5 6.2 allows no control character in an `LO` Value. And a
 * byte from A0H to FFH is a letter only under a Specific Character Set (0008,0005) that declares it,
 * which this pass neither checks nor sets: in the default repertoire (PS3.5 6.1.2.1) it is invalid.
 * So every character outside printable ASCII, a character outside the BMP as one, becomes `?`; a
 * backslash becomes `/`.
 */
function loCharacter(character: string): string {
  if (character === VALUE_DELIMITER) return DELIMITER_STAND_IN;
  // The first UTF-16 code unit decides: a character outside the BMP starts with a surrogate.
  const unit = character.charCodeAt(0);
  return unit >= FIRST_PRINTABLE_ASCII && unit <= LAST_PRINTABLE_ASCII
    ? character
    : UNWRITABLE_STAND_IN;
}

/**
 * The fixed Values of the method text: the library, the profile it applies, and that only metadata is
 * touched. Each is inside the `LO` maximum on its own.
 */
const METHOD_LIBRARY_VALUE = "Cosyte @cosyte/deid";
const METHOD_PROFILE_VALUE = "PS3.15 Basic Application Level Confidentiality Profile";
const METHOD_SCOPE_VALUE = "metadata only";

/**
 * Compose the De-identification Method `(0012,0063)` text for a run under the named policy.
 *
 * PS3.6 gives `(0012,0063)` the VR `LO` with value multiplicity `1-n`, and PS3.5 Table 6.2-1 caps an
 * `LO` at 64 characters per Value, so the method is written as several Values rather than one long
 * one: the library, the profile, the CID 7050 Code Meaning of each applied option, "metadata only",
 * and `policy "<name>"`. PS3.15 E.1.1 asks for "a
 * text string describing the method used", and the Values together still say exactly that.
 *
 * The policy name is the caller's, so its Value is the only one that can be long or hold a character
 * an `LO` Value cannot. A backslash in it is written as `/`, because 5CH is the delimiter and is never
 * part of an `LO` Value; any other character outside printable ASCII is written as `?`. The
 * length is measured after that mapping, and a name that would take its Value past 64 characters is
 * cut to fit and ends in `...` inside the quotes.
 *
 * @param policyName - The resolved policy's name.
 * @param optionMeanings - The Code Meaning of each applied Annex E option, in table order. Each is a
 *   CID 7050 Code Meaning, so each is at most 64 characters and holds only printable ASCII.
 * @returns The Values joined by `\`, each at most 64 characters.
 * @internal
 */
export function deidentificationMethodText(
  policyName: string,
  optionMeanings: readonly string[],
): string {
  const name = Array.from(policyName, loCharacter).join("");
  const whole = `policy "${name}"`;
  const policyValue =
    whole.length <= LO_VALUE_MAX_CHARS
      ? whole
      : `policy "${name.slice(0, LO_VALUE_MAX_CHARS - 'policy ""'.length - ELLIPSIS.length)}${ELLIPSIS}"`;
  return [
    METHOD_LIBRARY_VALUE,
    METHOD_PROFILE_VALUE,
    ...optionMeanings,
    METHOD_SCOPE_VALUE,
    policyValue,
  ].join(VALUE_DELIMITER);
}
