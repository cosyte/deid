---
"@cosyte/deid": patch
---

DEID-10 — release hardening (roadmap §Phase 10), the final roadmap phase. The six format adapters, the
longitudinal layer, the free-text BYO interface, and the Expert-Determination report are unchanged; no
per-format leak or over-scrub guarantee is weakened.

**Policy profiles.** `SAFE_HARBOR_PROFILE` (the fail-closed default) and `LIMITED_DATA_SET_PROFILE` (a
longitudinal research preset that date-shifts dates rather than generalizing — deliberately less
protective, so it is NOT labelled `safe-harbor`, requires a keyed per-patient context, and is neither a
certified de-identification nor, on its own, a HIPAA §164.514(e) Limited Data Set). `defineDeidProfile()`
derives a per-site profile under a fail-closed **widen-never-narrow** contract (a category may only move
to an equal-or-stronger transform; a weakening override is a fatal `DEID_PROFILE_INVALID`).
`profileOptions()` composes a profile into adapter options. New surface: `SAFE_HARBOR_PROFILE`,
`LIMITED_DATA_SET_PROFILE`, `defineDeidProfile`, `profileOptions`, `DeidProfile`, `DeidProfileSpec`,
`DeidStandard`.

**Consolidated leak/over-scrub corpus + pipeline fuzz gating CI.** One suite runs the zero-leak and
clinical-survivor gates across all six formats, proven non-vacuous two ways (every sentinel is present
in the original wire; a re-injected sentinel is caught by the same sweep), plus a pipeline fuzz
(truncations never leak a full sentinel; byte-flips always terminate).

**Publish dry-run / release smoke (`pnpm smoke`).** Loads every published subpath from the built `dist/`
in both ESM and CJS and asserts no leak — a CI gate after `build`, alongside `attw`.

**tsup shared-core chunk fix (`splitting: true`).** The core is emitted as one shared chunk imported by
every subpath, so a single `DeidContext` registry is shared across all seven entries — mixing
`createDeidContext` with a per-format `deidentify*` across the built bundles no longer throws a
fail-closed `DEID_NO_KEY`.

**Two date-shift fixes.** ISO-datetime shifting is now timezone-independent (only the calendar date is
shifted; the time-of-day + zone are preserved verbatim). A `maxShiftDays` flooring to 0 now fails closed
with the new fatal `DEID_CONTEXT_INVALID` (a zero-bound shift is a guaranteed no-op — the original real
dates).

**Honesty docs.** A new `docs-content/limitations.md` (Known Limitations / honesty page) leads with the
fail-closed, never-certify posture and enumerates every non-goal (structured-core-only, free-text
block-by-default, DICOM metadata-only with the burned-in-pixel hazard flagged, NCPDP SCRIPT deferred, the
ED report makes no determination, the LDS profile is not certified).

Fatal codes are additions-only: `DEID_CONTEXT_INVALID`, `DEID_PROFILE_INVALID`. `npm publish` and the
public-repo flip remain the two standing human stops.
