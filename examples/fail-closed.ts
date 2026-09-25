/**
 * Fail closed: what `@cosyte/deid` does when it cannot be sure, shown case by case.
 *
 * A parser is liberal about what it accepts. A de-identifier is the opposite: anything it cannot
 * confidently handle is blocked or refused, never passed through as safe.
 *
 * - Free text is blocked by default. The library ships no NLP model and no regex scrub.
 * - A redactor you bring is used, and its output is recorded as consumer-asserted: the engine does
 *   not re-scan it. When it throws or returns nothing, the prose is blocked, never leaked.
 * - A keyed transform with no key is a fatal `DEID_NO_KEY`, never a silent unkeyed fallback.
 * - A policy that wears the `safe-harbor` label but derives its output from the value itself is
 *   refused with `DEID_POLICY_INVALID`.
 *
 * Run it after `pnpm build`:
 *
 *     pnpm tsx examples/fail-closed.ts
 */

import assert from "node:assert/strict";

import {
  DeidError,
  defineDeidPolicy,
  deidentify,
  type FreeTextRedactor,
  type LocusModel,
  SAFE_HARBOR_CATEGORIES,
} from "@cosyte/deid";

// Synthetic prose in the shape of the repository's own fixtures.
const note: LocusModel = {
  loci: [{ path: "NTE-3", kind: "freetext", value: "Reported by ZZLABFAMILY, call 5550000010." }],
};

/** One line: what happened to the single locus, the value left in place, and the manifest's code. */
function report(label: string, result: ReturnType<typeof deidentify>): void {
  const locus = result.document.loci[0];
  const entry = result.manifest[0];
  console.log(
    `${label.padEnd(24)} ${String(locus?.disposition)} ${JSON.stringify(locus?.value)} ${String(entry?.code)}`,
  );
}

// 1. No redactor: the prose is blocked.
const noRedactor = deidentify(note, {});
report("no redactor:", noRedactor);
assert.equal(noRedactor.document.loci[0]?.value, null);
assert.equal(noRedactor.manifest[0]?.code, "DEID_FREETEXT_BLOCKED");

// 2. A redactor that throws: still blocked.
const failing: FreeTextRedactor = () => {
  throw new Error("the redaction service is unavailable");
};
const afterThrow = deidentify(note, { redactor: failing });
report("redactor threw:", afterThrow);
assert.equal(afterThrow.document.loci[0]?.value, null);
assert.equal(afterThrow.manifest[0]?.code, "DEID_FREETEXT_BLOCKED");

// 3. A redactor that returns nothing: still blocked.
const afterNothing = deidentify(note, { redactor: () => undefined });
report("redactor returned none:", afterNothing);
assert.equal(afterNothing.document.loci[0]?.value, null);

// 4. A redactor that returns text: written back, and recorded as YOUR assertion, not verified here.
const yours: FreeTextRedactor = () => ({ text: "Reported by [NAME], call [PHONE]." });
const redacted = deidentify(note, { redactor: yours });
report("redactor returned text:", redacted);
assert.equal(redacted.document.loci[0]?.value, "Reported by [NAME], call [PHONE].");
assert.equal(redacted.manifest[0]?.code, "DEID_FREETEXT_CONSUMER_REDACTED");

// 5. A keyed transform with no key is fatal.
const research = defineDeidPolicy({
  name: "research",
  transforms: { [SAFE_HARBOR_CATEGORIES.MRN]: "pseudonymize" },
});
assert.throws(
  () =>
    deidentify(
      {
        loci: [
          {
            path: "PID-3",
            kind: "identifier",
            category: SAFE_HARBOR_CATEGORIES.MRN,
            value: "ZZMRN002",
          },
        ],
      },
      { policy: research },
    ),
  (error: unknown) => error instanceof DeidError && error.code === "DEID_NO_KEY",
);
console.log(`${"keyed transform, no key:".padEnd(24)} refused, DEID_NO_KEY`);

// 6. A safe-harbor-labelled policy that shifts dates is refused when it is defined.
assert.throws(
  () =>
    defineDeidPolicy({
      name: "safe-harbor",
      transforms: { [SAFE_HARBOR_CATEGORIES.DATES]: "date-shift" },
    }),
  (error: unknown) => error instanceof DeidError && error.code === "DEID_POLICY_INVALID",
);
console.log(`${"safe-harbor, date-shift:".padEnd(24)} refused, DEID_POLICY_INVALID`);
