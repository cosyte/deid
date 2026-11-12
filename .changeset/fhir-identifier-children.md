---
"@cosyte/deid": patch
---

The FHIR adapter now removes an identifier's assigner name, decides every other child of an identifier by its datatype's rule, and no longer writes an emptied element as `{}`.

- **What changed in the default output, on purpose.** At every `identifier` on every resource, alone, contained in another resource or in a `Bundle` entry, under Safe Harbor and the Limited Data Set:
  - the `assigner`'s `display` is blocked, with a `DEID_LOCUS_BLOCKED` row at its locus that carries no value, as every `Reference.display` is. Before, it was kept verbatim and counted only in `unexaminedResiduals`.
  - the logical id in the `assigner`'s `reference` is replaced, as in every reference; the `assigner`'s own `identifier` goes through the identifier rule (its `value` removed under Safe Harbor, a keyed surrogate under the Limited Data Set, its own `assigner` decided the same way); and the `period` dates are generalized to the year. Before, each was kept verbatim and counted only in `unexaminedResiduals`.
  - the `use`, the `type`, the `system` and the `assigner`'s `type` are kept and counted in `unexaminedResiduals`, as before.
  - a structure or a list the pass left with nothing in it is removed rather than written as `{}`, which R4 does not allow: `udiCarrier: [{}]`, a `Reference` whose only field was its `display`, an extension whose `url` was blocked. An element that arrived empty is removed the same way. With `transformLabels`, a Data Absent Reason still stands in its place where R4 requires the element.
- **Manifest and residual loci.** The rows and residuals for an identifier's children carry the list index (`Patient.identifier[0].assigner.display`), as every list item's do. The `value` row of a one-item `identifier` list keeps its locus without the index (`Patient.identifier.value`), as before.
- **What stays the same.** An `Identifier` R4 names other than `identifier` (`masterIdentifier`, `accessionIdentifier`, `preAdmissionIdentifier`, a `valueIdentifier` on a `Task` or a `Parameters`) keeps its `value`, counted in `unexaminedResiduals`; its `assigner.display` was already blocked and its dates already generalized.
- **What a caller changes.** Nothing is required. A caller who read an assigner's name, an identifier's `period` dates or the assigner's reference id from the output no longer gets them as they arrived. A caller who matched an empty object in the output (`"subject": {}`, `"contact": [{}]`) now finds the element absent. A caller that counts unexamined residuals sees fewer, and sees the new rows in the manifest instead.
