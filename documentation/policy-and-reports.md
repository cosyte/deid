## Keyed transforms

Pseudonymization and keyed hashing use a **keyed HMAC-SHA-256**; the key is the consumer's and never
leaves the process. The **built-in Safe Harbor policy uses none of them**: a surrogate derived from
the individual's own value is a re-identification code §164.514(c)(1) does not permit, so medical
record, health plan beneficiary and account numbers are **removed** and the profile needs **no key at
all**. Keyed surrogates live behind a preset that does not claim Safe Harbor:

```ts
import {
  deidentify,
  createDeidContext,
  profileOptions,
  LIMITED_DATA_SET_PROFILE,
} from "@cosyte/deid";

const context = createDeidContext({ key: process.env.DEID_KEY!, patientId: "patient-1" });
deidentify(model, profileOptions(LIMITED_DATA_SET_PROFILE, context));
// Under THAT preset the MRN becomes a consistent, non-reversible surrogate; the key never appears in
// the output or manifest, the locus carries `reidentificationCode: true`, and the support report
// lists it in the keyed-surrogate residual inventory an expert must reason about.
```

A policy carrying the `safe-harbor` label that assigns a category a transform whose output is
**derived from that category's own value** is refused with a typed `DEID_POLICY_INVALID` fatal naming
the category and the transform, at mint time and at the point of use alike. A policy that does not
claim the label keeps its keyed surrogate: nothing is silently strengthened behind the caller's back.

## Keep a longitudinal record linkable

For research and analytics, the same patient must stay linkable across a whole corpus after de-id. A
**registry** (`createDeidRegistry`) holds your key and keeps the same patient's dates shifting by the
same offset, intervals preserved, and the same identifier mapping to the same pseudonym, across every
document and every run.

```ts
import {
  createDeidRegistry,
  deidentify,
  defineDeidPolicy,
  SAFE_HARBOR_CATEGORIES,
} from "@cosyte/deid";

const registry = createDeidRegistry({ key: process.env.DEID_KEY! });
const research = defineDeidPolicy({
  name: "research", // date-shift may NOT wear the "safe-harbor" label, it is Expert-Determination
  transforms: { [SAFE_HARBOR_CATEGORIES.DATES]: "date-shift" },
});

const ctx = registry.forPatient("patient-1"); // reuse for every document of this patient
deidentify(model, { policy: research, context: ctx }); // dates shift consistently, intervals intact
registry.pseudonym("MRN-1"); // same MRN → same surrogate corpus-wide
```

**The key contract.** You supply the key; there is **no weak default** (an absent key is a fatal
`DEID_NO_KEY`, never a silent fallback). Rotating the key is **intentional linkage breakage**: a new
key un-links a corpus from records made under the old one. The library holds no persistent key store.
Date-shift retains dates in shifted form, and a keyed surrogate is derived from the individual's own
value, so both are Expert-Determination-supporting, **not** Safe Harbor. The library rejects any
policy claiming the `safe-harbor` label that carries either (`DEID_POLICY_INVALID`), naming the
offending category and transform.

## Expert-Determination support, never certification

HIPAA has two routes to de-identification: **Safe Harbor** (mechanical, implemented here) and **Expert
Determination** (§164.514(b)(1), a qualified statistician's risk judgment). `@cosyte/deid` **supports**
the latter and **never renders** it. `buildExpertDeterminationSupportReport(manifest)` structures the
value-free manifest into what an expert reasons about: per-locus dispositions, coverage across all 18
categories, and **two residual inventories**, then hands it over. The
**retained-quasi-identifier inventory** holds pieces of the original value that survived (year-only
dates, safe 3-digit ZIP prefixes, exact ages ≤ 89, and any whole value a profile's retention set
kept). The **keyed-surrogate residual inventory** is its sibling and holds every locus flagged
`reidentificationCode`: a replacement **derived** from the value under your key, where no plaintext
survives but the linkage does. They are kept apart on purpose, because a determiner reasons about the
two very differently.

```ts
import { buildExpertDeterminationSupportReport } from "@cosyte/deid";

const { manifest } = deidentifyHl7(parseHL7(raw), { context });
const report = buildExpertDeterminationSupportReport(manifest, { policy: "safe-harbor" });
report.determination; // => null: the library never renders one
```

**The hard boundary.** The report **never** says the output "is de-identified", **never** computes or
fabricates a re-identification **risk score**, and reaches no conclusion: `determination` is always
`null` and a prominent disclaimer leads. It is value-free (loci / categories / dispositions / counts,
never a value). The one quasi-identifier statistic it can surface (the smallest equivalence-class size,
a **k-anonymity indicator**) is computed **only** over class sizes _you_ supply (the library has no view
of quasi-identifier values) and is stamped a descriptive input, never a verdict.
`formatExpertDeterminationSupportReport(report)` renders the same facts as Markdown for a statistician.

## Policy profiles: reusable presets, widen-never-narrow

Two named presets ship, and `defineDeidProfile()` derives a per-site profile that can only ever
**tighten** the base, never loosen it.

```ts
import {
  SAFE_HARBOR_PROFILE,
  LIMITED_DATA_SET_PROFILE,
  defineDeidProfile,
  profileOptions,
  SAFE_HARBOR_CATEGORIES,
  createDeidContext,
} from "@cosyte/deid";

// The fail-closed default (dates → year, MRN/beneficiary/account REMOVED, the (R) catch-all blocked).
// It uses no keyed transform, so it needs no key.
SAFE_HARBOR_PROFILE.standard; // => "safe-harbor"

// A longitudinal research preset: dates are DATE-SHIFTED, not generalized, and MRN / beneficiary /
// account keep a CONSISTENT KEYED SURROGATE so linkage survives. It also keeps the postal address
// parts §164.514(e)(2)(ii) NAMES (town or city, State, the WHOLE zip code) under the HL7 v2 pass, with
// the street and every other geographic component removed and each kept part recorded. On DATES it is
// deliberately STRICTER than §164.514(e)(2), which names no date at all: it shifts them by choice.
// Deliberately less protective than Safe Harbor → NOT labelled "safe-harbor", requires a keyed
// per-patient context, and is NOT a certified de-identification (nor, on its own, a §164.514(e)
// Limited Data Set; that needs a Data Use Agreement, which is yours, and which this library neither
// holds nor checks).
LIMITED_DATA_SET_PROFILE.requiresContext; // => true

// A per-site profile may only move a category to an equal-or-STRONGER transform; a weakening override
// is a fatal DEID_PROFILE_INVALID.
const strict = defineDeidProfile({
  name: "site-strict",
  transforms: { [SAFE_HARBOR_CATEGORIES.GEOGRAPHIC]: "redact" }, // generalize → redact (stronger): OK
});

const ctx = createDeidContext({ key: process.env.DEID_KEY! });
const opts = profileOptions(strict, ctx); // pass straight to any adapter
```
