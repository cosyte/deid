---
id: codes-and-categories
title: Codes and categories
sidebar_label: Codes and categories
description: "Every fatal code a pass throws, every disposition code a manifest entry carries, the transforms, and the 18 Safe Harbor categories with each preset's transform."
---

# Codes and categories

The stable values a caller branches on. Each is exported from `@cosyte/deid`; renaming or removing one
is a breaking change, and a later release may add to either code set. The package's test suite
checks each table on this page against the source: the two code tables and the categories exactly,
and the transforms for the keyed column and for every transform a preset assigns.

## Fatal codes

`FATAL_CODES`: a pass that meets one of these throws a `DeidError` carrying the code, and returns
nothing. Every message is a fixed sentence with no value, key or offset in it.

| Code                          | Thrown when                                                                                                                                                                                                                                                                                                                |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `EMPTY_INPUT`                 | the input model was null or undefined, or carried no locus list                                                                                                                                                                                                                                                            |
| `DEID_NO_KEY`                 | a keyed transform (`pseudonymize`, `hash`, `date-shift`) was required for a category in the model and no key was supplied (an empty key counts as none), or, for `date-shift`, no per-patient scope                                                                                                                        |
| `DEID_POLICY_INVALID`         | a policy or profile that claims the `safe-harbor` label assigns a category a transform whose output is derived from that category's own value, or a name that is not a published transform; or a DICOM run names an Annex E option the adapter does not offer, names one twice, or names one under the `safe-harbor` label |
| `DEID_CONTEXT_INVALID`        | a context was configured with a parameter that would silently weaken the pass, such as a `maxShiftDays` that floors to 0                                                                                                                                                                                                   |
| `DEID_PROFILE_INVALID`        | a derived profile would weaken its base (a weaker transform for a category, or a retention class the base does not keep), or a profile declaring the `limited-data-set` standard keeps a class §164.514(e)(2) does not permit                                                                                              |
| `DEID_OUTPUT_INVALID`         | the transformed document could not be re-serialized, or no longer round-trips through its own parser                                                                                                                                                                                                                       |
| `DEID_POSITIONS_UNENUMERABLE` | the value-bearing positions of a structure the pass would hand through could not be enumerated, so the count of unexamined positions could not be taken                                                                                                                                                                    |
| `DEID_DECLARATION_UNNAMEABLE` | a pass would apply a profile or option that its published coding vocabulary cannot name (the DICOM coded declaration)                                                                                                                                                                                                      |
| `DEID_FORMAT_UNSUPPORTED`     | an adapter was handed a format it refuses outright (NCPDP SCRIPT), or a shape of its format it refuses (an NCPDP Telecom message with more than one transaction, or a DICOM file whose Clean Descriptors run cleaned a sequence nested inside a kept one)                                                                  |
| `DEID_KEY_TOO_SHORT`          | an HMAC key or an explicit date-shift seed is shorter than 16 bytes (128 bits), counted on the bytes the HMAC uses                                                                                                                                                                                                         |

## Disposition codes

`DEID_DISPOSITION_CODES`: every manifest entry carries exactly one. Each describes the action and its
residual, never the value acted on.

| Code                              | Records                                                                                                                                                                                                                                                                        |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `DEID_CATEGORY_REMOVED`           | the value was removed outright                                                                                                                                                                                                                                                 |
| `DEID_CATEGORY_GENERALIZED`       | the value was generalized to a fully non-identifying form (a ZIP to `000`, a birth year that shows an age over 89 removed, an age over 89 held as a number removed, a caller-built `age` locus with no `ageUnit` over 89 to `90+`)                                             |
| `DEID_CATEGORY_PSEUDONYMIZED`     | the value was replaced by a consistent keyed surrogate                                                                                                                                                                                                                         |
| `DEID_CATEGORY_DATE_SHIFTED`      | a date was shifted by the patient's deterministic offset                                                                                                                                                                                                                       |
| `DEID_CATEGORY_HASHED`            | the value was replaced by a keyed one-way digest                                                                                                                                                                                                                               |
| `DEID_LOCUS_BLOCKED`              | fail closed: an unrecognized, un-locatable or uncertain locus was blocked, its value withheld                                                                                                                                                                                  |
| `DEID_FREETEXT_BLOCKED`           | fail closed: a free-text locus was blocked by default                                                                                                                                                                                                                          |
| `DEID_FREETEXT_CONSUMER_REDACTED` | a free-text locus was redacted by your redactor; consumer-asserted, never re-verified by the library                                                                                                                                                                           |
| `DEID_RESIDUAL_RETAINED`          | a residual of the individual's own identity was kept and recorded: a year, a safe three-digit ZIP prefix, or a whole value a retention class kept                                                                                                                              |
| `DEID_PARTY_ROLE_RETAINED`        | a party was left in place because its typed role puts it outside the scope clause; the entry names the role code it was classified on                                                                                                                                          |
| `DEID_POSITION_UNEXAMINED`        | a value-bearing position inside a structure the pass handed through that no locus rule names; a measurement, not an allegation                                                                                                                                                 |
| `DEID_EMBEDDED_CONTENT_RETAINED`  | embedded content the pass does not read (a FHIR `Attachment.data`, say) was kept, unread, because you named its kind in `keepEmbeddedContent`; category (R), no value                                                                                                          |
| `DEID_IDENTIFIER_SUBSTITUTED`     | an identifier other positions point at (a FHIR resource id, the id in a `fullUrl` or a reference) was removed and a per-call sequence number written in its place, the same one for the same identifier throughout the call; not derived from the value, not a keyed surrogate |

## Transforms

`TransformName`: the eight names a policy or a manifest entry uses. `KEYED_TRANSFORMS` holds the three
that need your key.

| Transform      | What it does                                                                                                                                                                                                                                               | Keyed |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| `redact`       | removes the value (an identifier other positions point at gets a per-call stand-in in its place)                                                                                                                                                           | no    |
| `generalize`   | reduces precision by the locus kind: a date to its year (a birth year that shows an age over 89 removed), a ZIP to its first three digits or `000`, an age over 89 held as a number removed, a caller-built `age` locus with no `ageUnit` over 89 to `90+` | no    |
| `date-shift`   | shifts every date of a patient by one deterministic offset, keeping intervals                                                                                                                                                                              | yes   |
| `pseudonymize` | replaces an identifier with a consistent keyed HMAC-SHA-256 surrogate                                                                                                                                                                                      | yes   |
| `hash`         | replaces a value with a keyed one-way digest                                                                                                                                                                                                               | yes   |
| `block`        | the fail-closed action: withholds the value (an identifier other positions point at gets a per-call stand-in)                                                                                                                                              | no    |
| `byo-redact`   | the manifest marker for a free-text locus your redactor redacted; assigned in a policy, it blocks                                                                                                                                                          | no    |
| `retain`       | the manifest marker for a locus a profile's retention set kept; assigned in a policy, it blocks                                                                                                                                                            | no    |

## The 18 Safe Harbor categories

`SAFE_HARBOR_CATEGORIES`, one per item of 45 CFR §164.514(b)(2)(i)(A) to (R), with the title
`SAFE_HARBOR_CATEGORY_META` gives each and the transform the two shipped presets assign it.

| Item | Category                  | Title                                                        | `SAFE_HARBOR_PROFILE` | `LIMITED_DATA_SET_PROFILE` |
| ---- | ------------------------- | ------------------------------------------------------------ | --------------------- | -------------------------- |
| (A)  | `NAMES`                   | Names                                                        | `redact`              | `redact`                   |
| (B)  | `GEOGRAPHIC`              | Geographic subdivisions smaller than a state                 | `generalize`          | `generalize`               |
| (C)  | `DATES`                   | Dates (except year) and ages over 89                         | `generalize`          | `date-shift`               |
| (D)  | `PHONE`                   | Telephone numbers                                            | `redact`              | `redact`                   |
| (E)  | `FAX`                     | Fax numbers                                                  | `redact`              | `redact`                   |
| (F)  | `EMAIL`                   | Email addresses                                              | `redact`              | `redact`                   |
| (G)  | `SSN`                     | Social Security numbers                                      | `redact`              | `redact`                   |
| (H)  | `MRN`                     | Medical record numbers                                       | `redact`              | `pseudonymize`             |
| (I)  | `HEALTH_PLAN_BENEFICIARY` | Health plan beneficiary numbers                              | `redact`              | `pseudonymize`             |
| (J)  | `ACCOUNT`                 | Account numbers                                              | `redact`              | `pseudonymize`             |
| (K)  | `CERTIFICATE_LICENSE`     | Certificate / license numbers                                | `redact`              | `redact`                   |
| (L)  | `VEHICLE`                 | Vehicle identifiers and serial numbers                       | `redact`              | `redact`                   |
| (M)  | `DEVICE`                  | Device identifiers and serial numbers                        | `redact`              | `redact`                   |
| (N)  | `URL`                     | Web URLs                                                     | `redact`              | `redact`                   |
| (O)  | `IP_ADDRESS`              | IP addresses                                                 | `redact`              | `redact`                   |
| (P)  | `BIOMETRIC`               | Biometric identifiers                                        | `redact`              | `redact`                   |
| (Q)  | `FULL_FACE_PHOTO`         | Full-face photographs and comparable images                  | `redact`              | `redact`                   |
| (R)  | `OTHER_UNIQUE_ID`         | Any other unique identifying number, characteristic, or code | `block`               | `block`                    |

The limited-data-set preset also keeps three retention classes unchanged and recorded, which no
column above shows: [Known limitations](./limitations.md#policy-profiles) lists them.

## See also

- [`FATAL_CODES`](./api/@cosyte/deid.md#fatal_codes), [`DeidError`](./api/@cosyte/deid.md#deiderror)
  and [`DEID_DISPOSITION_CODES`](./api/@cosyte/deid.md#deid_disposition_codes)
- [`TransformName`](./api/@cosyte/deid.md#transformname) and
  [`KEYED_TRANSFORMS`](./api/@cosyte/deid.md#keyed_transforms)
- [`SAFE_HARBOR_CATEGORIES`](./api/@cosyte/deid.md#safe_harbor_categories),
  [`SAFE_HARBOR_CATEGORY_META`](./api/@cosyte/deid.md#safe_harbor_category_meta),
  [`SAFE_HARBOR_PROFILE`](./api/@cosyte/deid.md#safe_harbor_profile) and
  [`LIMITED_DATA_SET_PROFILE`](./api/@cosyte/deid.md#limited_data_set_profile)
- [Troubleshooting](./troubleshooting.md): what to do about each fatal code
