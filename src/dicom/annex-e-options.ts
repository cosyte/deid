/**
 * The **PS3.15 Annex E options a caller can name** for the DICOM adapter, and the fail-closed check
 * that resolves a caller's list into the options handed to the delegated pass.
 *
 * **Three options are offered, and the list is closed.** Each one is a column of Table E.1-1 that the
 * delegated `@cosyte/dicom` pass applies in full and that one CID 7050 term names exactly, so the run
 * can both do it and declare it:
 *
 * - **Clean Descriptors** (`113105`): descriptions and comments are cleaned rather than removed. The
 *   delegated pass cleans by emptying, so no text a descriptor carried survives, and the option keeps
 *   nothing Safe Harbor removes. It runs under any policy.
 * - **Retain Patient Characteristics** (`113108`): age, sex, size, weight, ethnic group, smoking and
 *   pregnancy status are kept. An age over 89 is a Safe Harbor identifier (category C), so a run that
 *   claims the reserved `safe-harbor` label may not name it.
 * - **Retain Device Identity** (`113109`): device serial numbers, station names, detector and gantry
 *   identifiers are kept. Those are Safe Harbor category M, so a run that claims the label may not name
 *   it either.
 *
 * **Everything else is refused, never ignored.** An option the adapter does not offer, an entry that is
 * not a string, or a list that is not an array aborts the pass with `DEID_POLICY_INVALID` before
 * anything is delegated. Ignoring an unrecognized name would release output the caller believes was
 * produced under a different option set. The two pixel options stay out because this pass never reads
 * a pixel; the remaining metadata options are named in the decision record on the docs site, with the
 * reason each one waits.
 *
 * @packageDocumentation
 */

import { DeidError, FATAL_CODES } from "../codes.js";

/**
 * An Annex E option a caller can name in `DicomDeidOptions.annexEOptions`, by the delegated
 * pass's own option name.
 *
 * @example
 * ```ts
 * import type { DicomAnnexEOption } from "@cosyte/deid/dicom";
 *
 * const option: DicomAnnexEOption = "RetainPatientCharacteristics";
 * ```
 */
export type DicomAnnexEOption =
  "CleanDescriptors" | "RetainPatientCharacteristics" | "RetainDeviceIdentity";

/**
 * Every Annex E option this adapter offers, in CID 7050 order (`113105`, `113108`, `113109`). The
 * declaration and the option list handed to the delegated pass follow this order whatever order the
 * caller named them in.
 *
 * @example
 * ```ts
 * import { DICOM_ANNEX_E_OPTIONS } from "@cosyte/deid/dicom";
 *
 * DICOM_ANNEX_E_OPTIONS; // => ["CleanDescriptors", "RetainPatientCharacteristics", "RetainDeviceIdentity"]
 * ```
 */
export const DICOM_ANNEX_E_OPTIONS: readonly DicomAnnexEOption[] = Object.freeze([
  "CleanDescriptors",
  "RetainPatientCharacteristics",
  "RetainDeviceIdentity",
]);

/**
 * The offered options that keep a value Safe Harbor removes, each with the Safe Harbor identifier it
 * keeps. A run under the reserved `safe-harbor` label that names one of these is refused.
 */
const KEEPS_WHAT_SAFE_HARBOR_REMOVES: Readonly<Partial<Record<DicomAnnexEOption, string>>> =
  Object.freeze({
    RetainPatientCharacteristics: "an age over 89, which is category (C)",
    RetainDeviceIdentity: "device identifiers and serial numbers, which are category (M)",
  });

/** The reserved label only a Safe-Harbor-conforming policy may carry. */
const SAFE_HARBOR_LABEL = "safe-harbor";

/** The typed refusal. The message is composed from this module's own text, never a caller entry. */
function refuse(message: string): never {
  throw new DeidError(FATAL_CODES.DEID_POLICY_INVALID, message);
}

/** Whether an entry is one of the offered option names: an exact match against the closed list. */
function isOffered(entry: unknown): entry is DicomAnnexEOption {
  return (DICOM_ANNEX_E_OPTIONS as readonly unknown[]).includes(entry);
}

/**
 * Resolve a caller's Annex E option list into the options the run applies, **failing closed**.
 *
 * - `undefined` or an empty list: no option, the full Basic Profile.
 * - A value that is not an array, or an entry that is not an offered option name: refused. The
 *   message names the entry by its position and never echoes it, so nothing a caller passed by
 *   mistake (a value pasted from a document, say) reaches an error log.
 * - An option that keeps what Safe Harbor removes, under a policy named exactly `safe-harbor`:
 *   refused, naming the option and the identifier it keeps.
 *
 * A repeat is applied once. The result is in {@link DICOM_ANNEX_E_OPTIONS} order and frozen.
 *
 * @param requested - The caller's `annexEOptions`, unchecked.
 * @param policyName - The resolved policy's name.
 * @returns The options to hand to the delegated pass and to declare.
 * @throws {@link DeidError} `DEID_POLICY_INVALID` as above, before anything is delegated.
 * @internal
 */
export function resolveAnnexEOptions(
  requested: unknown,
  policyName: string,
): readonly DicomAnnexEOption[] {
  if (requested === undefined) return Object.freeze([]);
  if (!Array.isArray(requested)) {
    refuse(
      "annexEOptions must be an array of option names; nothing was de-identified. " +
        `Name only options from DICOM_ANNEX_E_OPTIONS: ${DICOM_ANNEX_E_OPTIONS.join(", ")}.`,
    );
  }
  const named = new Set<DicomAnnexEOption>();
  for (const [index, entry] of (requested as readonly unknown[]).entries()) {
    if (!isOffered(entry)) {
      refuse(
        `annexEOptions[${String(index)}] is not an Annex E option this adapter offers; nothing was ` +
          "de-identified, because ignoring it would release output made under a different option " +
          `set than the one named. Offered: ${DICOM_ANNEX_E_OPTIONS.join(", ")}.`,
      );
    }
    named.add(entry);
  }
  if (policyName === SAFE_HARBOR_LABEL) {
    for (const option of DICOM_ANNEX_E_OPTIONS) {
      const keeps = KEEPS_WHAT_SAFE_HARBOR_REMOVES[option];
      if (named.has(option) && keeps !== undefined) {
        refuse(
          `a run under the reserved "${SAFE_HARBOR_LABEL}" label must not apply the Annex E ` +
            `option ${option}: it keeps ${keeps}. Name the policy distinctly to retain it.`,
        );
      }
    }
  }
  return Object.freeze(DICOM_ANNEX_E_OPTIONS.filter((option) => named.has(option)));
}
