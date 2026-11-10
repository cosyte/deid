/**
 * The unified-policy → **PS3.15 Annex E option** mapping for the DICOM adapter.
 *
 * DICOM is the one format `deid` **delegates rather than reimplements**: `@cosyte/dicom` already ships the
 * PS3.15 **Basic Application Level Confidentiality Profile** and the metadata-affecting Annex E Options.
 * This module resolves the unified {@link DeidOptions} into a `@cosyte/dicom` `DeidentifyOptions`, and it
 * does so **fail-closed**: the default `safe-harbor` policy always applies the **full Basic Profile with no
 * Retain/Clean deviations** (maximal removal), so every private tag is removed and every UID is consistently
 * remapped. There is no per-category auto-derivation, on purpose: the Annex E option model is coarser than
 * the 18-category Safe Harbor model, so auto-relaxing it from a policy would risk *under*-removal. A
 * deviation that retains identifying metadata is an Expert-Determination choice this adapter does not
 * offer: it cannot be talked into keeping PHI.
 *
 * @packageDocumentation
 */

import { resolvePolicy } from "../policy.js";

import type { DicomDeidOptions } from "./types.js";

/**
 * The subset of `@cosyte/dicom`'s `DeidentifyOptions` this adapter produces. Typed structurally (not by
 * importing the parser's type) so the core stays decoupled; the `/dicom` subpath is where the real
 * `@cosyte/dicom` types are used.
 *
 * @internal
 */
export interface ResolvedDicomOptions {
  /** Annex E Retain/Clean options to activate. Always empty (full Basic Profile). */
  readonly retain: readonly never[];
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
 * full Basic Profile (no Retain/Clean options), consistent UID remapping, and a policy-named
 * De-identification Method string. The `context` (HMAC key) is intentionally unused: Annex E dummying and
 * content-derived UID remapping do not consume the keyed-transform key; it is accepted only for API
 * uniformity with the other adapters.
 *
 * @param options - The unified de-id options (policy + optional UID cache/root).
 * @returns The fail-closed `@cosyte/dicom` de-identification options.
 * @internal
 */
export function resolveDicomOptions(options: DicomDeidOptions): ResolvedDicomOptions {
  const policy = resolvePolicy(options.policy);
  const base: ResolvedDicomOptions = {
    retain: [],
    deidentificationMethod: deidentificationMethodText(policy.name),
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

/** The highest code point the method text's single-byte (latin1) encoding writes as itself. */
const MAX_SINGLE_BYTE_CODE_POINT = 0xff;

/**
 * Map one character of a policy name to what its `LO` Value can carry.
 *
 * The method text reaches the wire one byte per UTF-16 code unit (latin1), so a character above
 * U+00FF would land as its low byte: U+015C as 5CH, the delimiter, and U+0100 as NUL. PS3.5 6.2
 * allows no control character in an `LO` Value, so C0 (U+0000 to U+001F), DEL (U+007F) and C1
 * (U+0080 to U+009F) are out too. Each of those, and a whole character outside the BMP, becomes `?`;
 * a backslash becomes `/`.
 */
function loCharacter(character: string): string {
  if (character === VALUE_DELIMITER) return DELIMITER_STAND_IN;
  // The first UTF-16 code unit decides: a character outside the BMP starts with a surrogate, above U+00FF.
  const unit = character.charCodeAt(0);
  if (unit < 0x20 || (unit >= 0x7f && unit <= 0x9f)) return UNWRITABLE_STAND_IN;
  if (unit > MAX_SINGLE_BYTE_CODE_POINT) return UNWRITABLE_STAND_IN;
  return character;
}

/**
 * The fixed Values of the method text: the library, the profile it applies, and that only metadata is
 * touched. Each is inside the `LO` maximum on its own.
 */
const FIXED_METHOD_VALUES: readonly string[] = [
  "Cosyte @cosyte/deid",
  "PS3.15 Basic Application Level Confidentiality Profile",
  "metadata only",
];

/**
 * Compose the De-identification Method `(0012,0063)` text for a run under the named policy.
 *
 * PS3.6 gives `(0012,0063)` the VR `LO` with value multiplicity `1-n`, and PS3.5 Table 6.2-1 caps an
 * `LO` at 64 characters per Value, so the method is written as several Values rather than one long
 * one: the library, the profile, "metadata only", and `policy "<name>"`. PS3.15 E.1.1 asks for "a
 * text string describing the method used", and the Values together still say exactly that.
 *
 * The policy name is the caller's, so its Value is the only one that can be long or hold a character
 * an `LO` Value cannot. A backslash in it is written as `/`, because 5CH is the delimiter and is never
 * part of an `LO` Value; a control character or a character above U+00FF is written as `?`. The
 * length is measured after that mapping, and a name that would take its Value past 64 characters is
 * cut to fit and ends in `...` inside the quotes.
 *
 * @param policyName - The resolved policy's name.
 * @returns The Values joined by `\`, each at most 64 characters.
 * @internal
 */
export function deidentificationMethodText(policyName: string): string {
  const name = Array.from(policyName, loCharacter).join("");
  const whole = `policy "${name}"`;
  const policyValue =
    whole.length <= LO_VALUE_MAX_CHARS
      ? whole
      : `policy "${name.slice(0, LO_VALUE_MAX_CHARS - 'policy ""'.length - ELLIPSIS.length)}${ELLIPSIS}"`;
  return [...FIXED_METHOD_VALUES, policyValue].join(VALUE_DELIMITER);
}
