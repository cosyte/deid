---
"@cosyte/deid": patch
---

Documentation correctness on every surface a consumer reads: the README, the published guides, and
the API documentation that ships in `dist/*.d.ts` and renders on hover in an editor.

**Three published statements were wrong and are corrected.** The getting-started and troubleshooting
pages said no format adapter was wired yet and that the per-format adapters were still to come, in a
package that ships six of them (`@cosyte/deid/hl7`, `/ccda`, `/fhir`, `/x12`, `/ncpdp`, `/dicom`);
they now say where each one lives. The same pages said a bring-your-own free-text redaction interface
was not yet available; it is, via the `redactor` option.

**Two limitations are now stated exactly rather than as something pending.** The X12 guide said a
deployment that must suppress provider / organization identity could do so with a widening policy.
It cannot: provider retention is structural, in the extractor, and no policy or profile setting
changes it. The restricted-ZIP list documentation said a consumer needing a different Census vintage
could supply their own through a policy. They cannot: `RESTRICTED_ZIP3` is a fixed export, not a
policy option. Neither behaviour changed; both descriptions did.

No runtime behaviour, public API, policy, transform, disposition code or leak guarantee changes. The
one addition is a repository check, `pnpm check:no-internal-refs`, which fails the build when internal
project bookkeeping appears on a consumer-facing surface.
