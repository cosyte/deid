---
id: choose-a-policy
title: Choose a policy and read the manifest
sidebar_label: Choose a policy
description: "Pick the built-in Safe Harbor policy or a preset, derive your own without forgetting a category, and read what the manifest records."
---

# Choose a policy and read the manifest

Every pass runs under one policy: a transform for each of the 18 Safe Harbor categories. This guide
picks one, derives a site policy from it, and reads the manifest the pass returns. The same options
work for the core `deidentify` and for the HL7 v2, C-CDA, FHIR, X12 and NCPDP adapters; the DICOM
adapter takes the policy and its own UID options.

## Use the built-in default

`safe-harbor` is the built-in default: pass no policy and you get it. Under it a name or an
identifier is removed, a date keeps its year, a ZIP keeps a safe three-digit prefix (or `000`), and the (R)
catch-all is blocked. It uses no keyed transform, so it needs no key.

```ts runnable
import { deidentify, SAFE_HARBOR_POLICY, SAFE_HARBOR_CATEGORIES } from "@cosyte/deid";

SAFE_HARBOR_POLICY.name; // => "safe-harbor"
SAFE_HARBOR_POLICY.transforms[SAFE_HARBOR_CATEGORIES.MRN]; // => "redact"
SAFE_HARBOR_POLICY.transforms[SAFE_HARBOR_CATEGORIES.OTHER_UNIQUE_ID]; // => "block"

const { manifest } = deidentify(
  { loci: [{ path: "PID-11.5", kind: "zip", category: SAFE_HARBOR_CATEGORIES.GEOGRAPHIC, value: "90210" }] },
  {},
);
manifest[0]?.transform; // => "generalize"
```

[Codes and categories](./codes-and-categories.md#the-18-safe-harbor-categories) lists the transform
each preset assigns to every category.

## Derive a policy of your own

Derive a custom policy with `defineDeidPolicy`: you can only ever _deviate_ from the safe default,
never forget a category, because every category you do not name keeps its Safe Harbor transform.

```ts runnable
import { defineDeidPolicy, SAFE_HARBOR_CATEGORIES } from "@cosyte/deid";

// A research policy that date-shifts instead of generalizing (Expert-Determination-supporting).
const research = defineDeidPolicy({
  name: "research",
  transforms: { [SAFE_HARBOR_CATEGORIES.DATES]: "date-shift" },
});

research.transforms[SAFE_HARBOR_CATEGORIES.DATES]; // => "date-shift"
research.transforms[SAFE_HARBOR_CATEGORIES.NAMES]; // => "redact"
```

A policy that keeps the `safe-harbor` name may not assign a transform whose output is derived from
the value (`date-shift`, `pseudonymize`, `hash`, or `generalize` outside geography and dates): it is
refused with `DEID_POLICY_INVALID`. Name a policy like the one above distinctly.

## Use a profile

A profile is a named, reusable preset: a policy plus the retention classes it may keep, a default
redactor, and the standard it declares. Two ship with the library:

- `SAFE_HARBOR_PROFILE`: the fail-closed default, with no keyed transform and nothing retained.
- `LIMITED_DATA_SET_PROFILE`: a research preset that date-shifts dates and keeps a consistent keyed
  surrogate for the medical record, health plan beneficiary, and account numbers. It is **not**
  Safe Harbor, it requires a key, and it does not on its own make a Limited Data Set.
  [Known limitations](./limitations.md#policy-profiles) states exactly what it keeps.

Pass a profile through `profileOptions`, which is what carries its retention set; options built by
hand from `profile.policy` alone retain nothing. Derive a site profile with `defineDeidProfile`. Its
contract is **widen, never narrow**: a site may move a category to an equal-or-stronger transform,
never a weaker one.

```ts runnable
import {
  defineDeidProfile,
  profileOptions,
  SAFE_HARBOR_PROFILE,
  SAFE_HARBOR_CATEGORIES,
} from "@cosyte/deid";

// generalize -> redact removes more, so it is allowed.
const strict = defineDeidProfile({
  name: "site-strict",
  transforms: { [SAFE_HARBOR_CATEGORIES.GEOGRAPHIC]: "redact" },
});
strict.policy.transforms[SAFE_HARBOR_CATEGORIES.GEOGRAPHIC]; // => "redact"

profileOptions(SAFE_HARBOR_PROFILE).policy === SAFE_HARBOR_PROFILE.policy; // => true
```

```ts runnable throws
import { defineDeidProfile, SAFE_HARBOR_CATEGORIES } from "@cosyte/deid";

// redact -> generalize would keep part of a name: DEID_PROFILE_INVALID.
defineDeidProfile({
  name: "site-loose",
  transforms: { [SAFE_HARBOR_CATEGORIES.NAMES]: "generalize" },
});
```

## Keep records linkable without leaking

Pseudonymize identifiers with a consumer-held key so the same MRN maps to the same surrogate
everywhere, without the surrogate being reversible. **This is not Safe Harbor**: a surrogate derived
from the individual's own value is a re-identification code §164.514(c)(1) does not permit, so the
built-in Safe Harbor policy removes those identifiers instead, and keyed surrogates live behind a
preset that does not claim the label. [Keep a patient linkable across documents](./guides-longitudinal.md)
shows how.

## Read the manifest

Every action is recorded value-free. Watch for `DEID_LOCUS_BLOCKED` / `DEID_FREETEXT_BLOCKED` (the
fail-closed decisions), `DEID_RESIDUAL_RETAINED` (a kept year or safe 3-digit ZIP), and
`reidentificationCode: true` (a keyed surrogate): the residuals you surface to a human for the
§164.514(b)(2)(ii) actual-knowledge test and for an Expert Determination.

```ts runnable
import { deidentify, SAFE_HARBOR_CATEGORIES } from "@cosyte/deid";

const { manifest } = deidentify(
  {
    loci: [
      { path: "PID-7", kind: "date", category: SAFE_HARBOR_CATEGORIES.DATES, value: "1985-07-02" },
      { path: "ZPI-1", kind: "unknown", value: "ZZVENDORVALUE" },
    ],
  },
  {},
);

manifest.map((entry) => `${entry.locus} ${entry.disposition} ${entry.code}`); // => ["PID-7 transformed DEID_RESIDUAL_RETAINED", "ZPI-1 blocked DEID_LOCUS_BLOCKED"]
```

[Codes and categories](./codes-and-categories.md#disposition-codes) lists every disposition code. To
hand the residuals to a qualified expert, [build a support report](./guides-expert-determination.md).

## Find the guide for your format

- [De-identify an HL7 v2 message](./guides-hl7.md)
- [De-identify a C-CDA document](./guides-ccda.md)
- [De-identify a FHIR resource](./guides-fhir.md)
- [De-identify an X12 interchange](./guides-x12.md)
- [De-identify an NCPDP Telecom transaction](./guides-ncpdp.md)
- [De-identify a DICOM file](./guides-dicom.md)

## Reference

- [`deidentify`](./api/@cosyte/deid.md#deidentify), [`DeidOptions`](./api/@cosyte/deid.md#deidoptions)
  and [`DeidManifestEntry`](./api/@cosyte/deid.md#deidmanifestentry)
- [`defineDeidPolicy`](./api/@cosyte/deid.md#definedeidpolicy) and
  [`SAFE_HARBOR_POLICY`](./api/@cosyte/deid.md#safe_harbor_policy)
- [`defineDeidProfile`](./api/@cosyte/deid.md#definedeidprofile),
  [`profileOptions`](./api/@cosyte/deid.md#profileoptions),
  [`SAFE_HARBOR_PROFILE`](./api/@cosyte/deid.md#safe_harbor_profile) and
  [`LIMITED_DATA_SET_PROFILE`](./api/@cosyte/deid.md#limited_data_set_profile)
