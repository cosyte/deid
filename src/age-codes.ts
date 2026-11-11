/**
 * The **observation codes that say a value is an age or a date of birth**, shared by the HL7 v2,
 * FHIR and C-CDA adapters. An observation's own code is how a document says what its value is: a
 * numeric result coded as an age holds an age, and §164.514(b)(2)(i)(C) aggregates every age over
 * 89. A date result coded as a birth date holds one, and a year that shows such an age goes with it.
 *
 * The sets are explicit enumerations, never a pattern over a display name. Each adapter reads the
 * code system its own way (an HL7 v2 coding-system mnemonic, a FHIR system URI, a CDA OID) and
 * names it here as one of {@link ObservationCodeSystem}.
 *
 * @packageDocumentation
 */

/**
 * The code systems an age or birth-date code is recognized in. `unstated` is an observation code with
 * no system at all: the code is matched against both lists, because a value the document does not
 * place in a system is still the code it spells.
 *
 * @internal
 */
export type ObservationCodeSystem = "loinc" | "snomed" | "other" | "unstated";

/**
 * LOINC codes whose value is an age: `30525-0` Age, `21612-7` Age - Reported, `29553-5` Age
 * calculated, `21611-9` Age - estimated, `63900-5` Current age or age at death.
 */
const LOINC_AGE_CODES: ReadonlySet<string> = new Set([
  "30525-0",
  "21612-7",
  "29553-5",
  "21611-9",
  "63900-5",
]);

/**
 * SNOMED CT codes whose value is an age: `445518008` Age at onset of clinical finding (the code the
 * C-CDA Age Observation template fixes) and `397659008` Age.
 */
const SNOMED_AGE_CODES: ReadonlySet<string> = new Set(["445518008", "397659008"]);

/** LOINC codes whose value is a date of birth: `21112-8` Birth date. */
const LOINC_BIRTH_DATE_CODES: ReadonlySet<string> = new Set(["21112-8"]);

/**
 * `true` when an observation code names an **age**.
 *
 * @param system - The code system, as the adapter read it.
 * @param code - The code.
 * @internal
 */
export function isAgeCode(system: ObservationCodeSystem, code: string): boolean {
  if (system === "loinc") return LOINC_AGE_CODES.has(code);
  if (system === "snomed") return SNOMED_AGE_CODES.has(code);
  if (system === "unstated") return LOINC_AGE_CODES.has(code) || SNOMED_AGE_CODES.has(code);
  return false;
}

/**
 * `true` when an observation code names a **date of birth**.
 *
 * @param system - The code system, as the adapter read it.
 * @param code - The code.
 * @internal
 */
export function isBirthDateCode(system: ObservationCodeSystem, code: string): boolean {
  return (system === "loinc" || system === "unstated") && LOINC_BIRTH_DATE_CODES.has(code);
}
