/**
 * The **18 HIPAA Safe Harbor identifier categories** — 45 CFR §164.514(b)(2)(i)(A)–(R) — modelled as
 * typed categories, including the open-ended catch-all (R).
 *
 * These are the categories of identifiers that Safe Harbor de-identification requires be removed or
 * transformed out, **of the individual and of the individual's relatives, employers, and household
 * members**. The list is enumerated firsthand from the regulation text; category (R) — "any other
 * unique identifying number, characteristic, or code" — is why de-identification must **fail closed**
 * (an allow-list of 17 concrete types can never satisfy an open-ended (R)).
 *
 * @packageDocumentation
 */

/**
 * The stable registry of the 18 Safe Harbor identifier categories. `key === value` so the set
 * survives an `Object.values(...)` snapshot into a stability tripwire. Renaming a category is a
 * **breaking change** — consumers branch on these in policies and manifests.
 *
 * @example
 * ```ts
 * import { SAFE_HARBOR_CATEGORIES } from "@cosyte/deid";
 *
 * SAFE_HARBOR_CATEGORIES.MRN; // => "MRN"
 * ```
 */
export const SAFE_HARBOR_CATEGORIES = {
  /** (A) Names — patient, relatives, employers, household members. */
  NAMES: "NAMES",
  /** (B) All geographic subdivisions smaller than a state — street, city, county, precinct, ZIP, geocodes. */
  GEOGRAPHIC: "GEOGRAPHIC",
  /** (C) All elements of dates (except year) directly related to the individual, and all ages > 89. */
  DATES: "DATES",
  /** (D) Telephone numbers. */
  PHONE: "PHONE",
  /** (E) Fax numbers. */
  FAX: "FAX",
  /** (F) Email addresses. */
  EMAIL: "EMAIL",
  /** (G) Social Security numbers. */
  SSN: "SSN",
  /** (H) Medical record numbers. */
  MRN: "MRN",
  /** (I) Health plan beneficiary numbers. */
  HEALTH_PLAN_BENEFICIARY: "HEALTH_PLAN_BENEFICIARY",
  /** (J) Account numbers. */
  ACCOUNT: "ACCOUNT",
  /** (K) Certificate / license numbers. */
  CERTIFICATE_LICENSE: "CERTIFICATE_LICENSE",
  /** (L) Vehicle identifiers and serial numbers, including license plates. */
  VEHICLE: "VEHICLE",
  /** (M) Device identifiers and serial numbers. */
  DEVICE: "DEVICE",
  /** (N) Web URLs. */
  URL: "URL",
  /** (O) IP addresses. */
  IP_ADDRESS: "IP_ADDRESS",
  /** (P) Biometric identifiers, including finger and voice prints. */
  BIOMETRIC: "BIOMETRIC",
  /** (Q) Full-face photographs and any comparable images. */
  FULL_FACE_PHOTO: "FULL_FACE_PHOTO",
  /** (R) Any other unique identifying number, characteristic, or code — the open-ended catch-all. */
  OTHER_UNIQUE_ID: "OTHER_UNIQUE_ID",
} as const;

/**
 * A value from {@link SAFE_HARBOR_CATEGORIES} — the type a policy and a manifest entry carry.
 *
 * @example
 * ```ts
 * import { SAFE_HARBOR_CATEGORIES, type SafeHarborCategory } from "@cosyte/deid";
 *
 * const c: SafeHarborCategory = SAFE_HARBOR_CATEGORIES.SSN;
 * ```
 */
export type SafeHarborCategory =
  (typeof SAFE_HARBOR_CATEGORIES)[keyof typeof SAFE_HARBOR_CATEGORIES];

/**
 * Per-category regulatory metadata: the §164.514(b)(2)(i) sub-paragraph letter (A–R), the ordinal
 * number (1–18), and a short human title. Grounded firsthand in the regulation text; contains no PHI.
 *
 * @example
 * ```ts
 * import { SAFE_HARBOR_CATEGORY_META, SAFE_HARBOR_CATEGORIES } from "@cosyte/deid";
 *
 * SAFE_HARBOR_CATEGORY_META[SAFE_HARBOR_CATEGORIES.GEOGRAPHIC].letter; // => "B"
 * ```
 */
export const SAFE_HARBOR_CATEGORY_META: Readonly<
  Record<
    SafeHarborCategory,
    { readonly letter: string; readonly number: number; readonly title: string }
  >
> = Object.freeze({
  NAMES: { letter: "A", number: 1, title: "Names" },
  GEOGRAPHIC: { letter: "B", number: 2, title: "Geographic subdivisions smaller than a state" },
  DATES: { letter: "C", number: 3, title: "Dates (except year) and ages over 89" },
  PHONE: { letter: "D", number: 4, title: "Telephone numbers" },
  FAX: { letter: "E", number: 5, title: "Fax numbers" },
  EMAIL: { letter: "F", number: 6, title: "Email addresses" },
  SSN: { letter: "G", number: 7, title: "Social Security numbers" },
  MRN: { letter: "H", number: 8, title: "Medical record numbers" },
  HEALTH_PLAN_BENEFICIARY: { letter: "I", number: 9, title: "Health plan beneficiary numbers" },
  ACCOUNT: { letter: "J", number: 10, title: "Account numbers" },
  CERTIFICATE_LICENSE: { letter: "K", number: 11, title: "Certificate / license numbers" },
  VEHICLE: { letter: "L", number: 12, title: "Vehicle identifiers and serial numbers" },
  DEVICE: { letter: "M", number: 13, title: "Device identifiers and serial numbers" },
  URL: { letter: "N", number: 14, title: "Web URLs" },
  IP_ADDRESS: { letter: "O", number: 15, title: "IP addresses" },
  BIOMETRIC: { letter: "P", number: 16, title: "Biometric identifiers" },
  FULL_FACE_PHOTO: {
    letter: "Q",
    number: 17,
    title: "Full-face photographs and comparable images",
  },
  OTHER_UNIQUE_ID: {
    letter: "R",
    number: 18,
    title: "Any other unique identifying number, characteristic, or code",
  },
});
