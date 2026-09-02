---
id: guides-expert-determination
title: Expert-Determination support (never certification)
sidebar_position: 10
---

# Expert-Determination support (never certification)

HIPAA gives two routes to de-identification (45 CFR §164.514(b)). `@cosyte/deid` **implements** Safe
Harbor (the mechanical 18-category method) and **supports**, but can **never render**, the other one:
**Expert Determination** (§164.514(b)(1)), a qualified statistician's judgment that the re-identification
risk for a specific dataset and recipient is "very small".

The support report structures the value-free manifest into the facts an expert reasons about (**what was
done, and what remains**), and hands them over. It is descriptive input, never a verdict.

## The hard boundary: the library makes NO determination

This is the load-bearing discipline. The report:

- **never** says the output "is de-identified" or "meets Expert Determination";
- **never** computes or fabricates a re-identification **risk score**: it reaches no conclusion;
- carries `determination: null` and leads with a prominent non-certification disclaimer.

```ts runnable
import { buildExpertDeterminationSupportReport, SAFE_HARBOR_CATEGORIES } from "@cosyte/deid";

const report = buildExpertDeterminationSupportReport(
  [
    {
      category: SAFE_HARBOR_CATEGORIES.NAMES,
      transform: "redact",
      locus: "PID-5",
      count: 1,
      disposition: "removed",
      code: "DEID_CATEGORY_REMOVED",
      reidentificationCode: false,
    },
  ],
  { policy: "safe-harbor" },
);

report.determination; // => null
report.disclaimer.includes("NOT a determination"); // => true
```

"The risk is very small" is a judgment about a dataset _and_ its recipient _and_ the other data
reasonably available to that recipient. This library sees none of those three. Over-claiming here
would be a real compliance harm, so the report is deliberately descriptive.

## What the report contains

Feed it the manifest from any adapter (or an array of manifests for a corpus). You get: per-locus
dispositions, coverage across all 18 Safe Harbor categories, a disposition roll-up, and **three
residual inventories** - the retained-quasi-identifier one, the keyed-surrogate one, and the
unexamined-position one. Pass `unexaminedResiduals` from the same pass to fill the third.

```ts runnable
import { buildExpertDeterminationSupportReport, SAFE_HARBOR_CATEGORIES } from "@cosyte/deid";

const report = buildExpertDeterminationSupportReport([
  {
    category: SAFE_HARBOR_CATEGORIES.NAMES,
    transform: "redact",
    locus: "PID-5",
    count: 1,
    disposition: "removed",
    code: "DEID_CATEGORY_REMOVED",
    reidentificationCode: false,
  },
  {
    category: SAFE_HARBOR_CATEGORIES.DATES,
    transform: "generalize",
    locus: "PID-7",
    count: 1,
    disposition: "transformed",
    code: "DEID_RESIDUAL_RETAINED",
    reidentificationCode: false,
  },
]);

report.categoryCoverage.length; // => 18
report.totals.categoriesActedOn; // => 2
report.retainedQuasiIdentifiers[0].locus; // => "PID-7"
```

The **retained-quasi-identifier inventory** is the residual an expert cares about most: the identifying
elements the pass kept for utility and **recorded** as `DEID_RESIDUAL_RETAINED`. Two kinds land there: a
coarse residual left by a generalization (a year-only date, a safe 3-digit ZIP prefix, an exact age
≤ 89), and a **whole unreduced value** a profile's retention set kept, such as the admission, discharge
and service dates and the encounter and order numbers a limited-data-set preset carries. The second kind
is the stronger residual, and it is inventoried here rather than left to a footnote. These are the
§164.514(b)(2)(ii) actual-knowledge considerations.

Clinical values retained untouched by the over-scrub guard are not identifiers and are not enumerated
here. Neither is a position inside a retained structure that no locus rule reached: the pass examined no
value there, so it left no residual of one. Those have their own inventory, below.

## The unexamined-position inventory: what the pass never looked at

A **value-bearing position inside a structure the pass handed through that no locus rule names** is a
third fact, and it is neither of the two above: the pass did not act on it, did not block it, and did
not decide to keep it. Nothing reached it. Every adapter counts and locates those positions and returns
them on `result.unexaminedResiduals`; hand that list to the report and it becomes an inventory beside
the other two.

Each record carries the **structural locus**, a **count** and the fact of being unexamined, and never a
value, a key or an offset. It is deliberately not folded into the retained-quasi-identifier inventory:
that one holds residuals of values the pass **examined**, and admitting a position nothing looked at
would make a kept year and an unexamined field read as the same thing.

**A measured zero is not silence, and the report says which it is.** Supplying the list, even empty, is
what makes the inventory _measured_: the section then reads "measured, and empty". Omitting it leaves the
count `null` and the section says **NOT MEASURED** in terms, because an empty inventory a determiner
cannot tell apart from an unmeasured one is exactly the emptiness they would otherwise act on.

```ts runnable
import { buildExpertDeterminationSupportReport } from "@cosyte/deid";

// Measured, and empty: the pass enumerated what it handed through and a rule reached every position.
const measured = buildExpertDeterminationSupportReport([], { unexaminedResiduals: [] });
measured.unexaminedResidualsMeasured; // => true
measured.dispositionSummary.unexaminedResidualPositions; // => 0

// Not measured at all: the report refuses to print a zero a reader would take for a clearance.
const unmeasured = buildExpertDeterminationSupportReport([]);
unmeasured.unexaminedResidualsMeasured; // => false
unmeasured.dispositionSummary.unexaminedResidualPositions; // => null
```

**Counting is not removal.** Nothing is scrubbed or generalized because it was counted, and a position
no rule examined has **no established Safe Harbor category**: it is credited to none of the 18 and moves
no category total. A clinical code, a dose unit and an order status all sit at positions like these, so
read the number as the size of what went unexamined, never as a count of PHI.

**What the number is a count of.** The set of positions is derived from what each parser's model can
actually carry, not from the places a value usually sits, so it includes carriers a reader might not
think to ask about: XML character data that arrived as a CDATA section rather than as text, the comments
and processing instructions a document is re-serialized with, a FHIR primitive's `_`-sibling element id,
and whatever a partly rewritten structure keeps (a generalized address re-emits its state and country
exactly as they arrived, along with anything riding inside them). The mirror also holds and matters as
much for reading the number: a position the pass **removed** is not counted, because the inventory
measures what left the pass untouched. The two edges of the count are stated in
[Limitations](./limitations.md).

## The keyed-surrogate residual inventory: a different residual, kept apart

A **keyed surrogate** is not a retained quasi-identifier and never joins that list. A retained
quasi-identifier is a piece of the original value that survived; a keyed surrogate is a _replacement_
**derived** from the value under your key (`pseudonymize`, `hash`, `date-shift`). No plaintext
survives, but the **linkage** does: anyone holding the key can re-link the records, which is why
§164.514(c)(1) does not permit such a code under Safe Harbor and why the built-in Safe Harbor policy
emits none. Folding the two together would tell a determiner that a re-identification code is the
same kind of residual as a kept year, so each has its own section.

Every locus the pass surrogated carries `reidentificationCode: true` in the manifest, and
`report.keyedSurrogateResiduals` is built from that flag, carrying the locus, the category, the count
and the transform that produced it - never a value, never the key, never the shift offset. An empty
inventory means the pass emitted no keyed surrogate, never that one went unmeasured.

```ts runnable
import { buildExpertDeterminationSupportReport, SAFE_HARBOR_CATEGORIES } from "@cosyte/deid";

const report = buildExpertDeterminationSupportReport([
  {
    category: SAFE_HARBOR_CATEGORIES.MRN,
    transform: "pseudonymize",
    locus: "PID-3",
    count: 1,
    disposition: "transformed",
    code: "DEID_CATEGORY_PSEUDONYMIZED",
    reidentificationCode: true,
  },
]);

report.keyedSurrogateResiduals[0].transform; // => "pseudonymize"
report.keyedSurrogateResiduals[0].locus; // => "PID-3"
report.retainedQuasiIdentifiers.length; // => 0
```

## The optional k-anonymity indicator: caller-supplied, descriptive only

An expert often documents a k-anonymity indicator (the smallest equivalence-class size over a chosen
quasi-identifier set). The library has no view of quasi-identifier **values**, so it never derives this
itself. If _you_ group your records and supply the class sizes, the report echoes the arithmetic, and
stamps it plainly as a descriptive input, **not** a risk score, **not** a determination, **not** a
threshold the library evaluates.

```ts runnable
import { buildExpertDeterminationSupportReport } from "@cosyte/deid";

const report = buildExpertDeterminationSupportReport([], {
  quasiIdentifiers: {
    quasiIdentifierSet: "3-digit ZIP × birth year × sex",
    equivalenceClassSizes: [40, 33, 20, 5, 1, 1],
  },
});

report.quasiIdentifierStatistics?.minimumEquivalenceClassSize; // => 1
report.quasiIdentifierStatistics?.uniqueRecords; // => 2
report.quasiIdentifierStatistics?.note.includes("NOT a re-identification risk score"); // => true
```

With no class sizes supplied, there is no statistic: the library never invents a risk number from the
manifest alone:

```ts runnable
import { buildExpertDeterminationSupportReport } from "@cosyte/deid";

buildExpertDeterminationSupportReport([]).quasiIdentifierStatistics; // => null
```

## Human-readable rendering

For a document to hand a statistician, `formatExpertDeterminationSupportReport` renders the same
value-free facts as Markdown, led by the non-certification banner.

```ts runnable
import {
  buildExpertDeterminationSupportReport,
  formatExpertDeterminationSupportReport,
} from "@cosyte/deid";

const md = formatExpertDeterminationSupportReport(buildExpertDeterminationSupportReport([]));
md.startsWith("# Expert-Determination support report"); // => true
md.includes("NOT A DETERMINATION"); // => true
```

The library's promise stays narrow and honest: it **transforms per a policy** and **evidences what it
did and what remains** in a value-free report, so a qualified expert can make the determination the
library cannot.
