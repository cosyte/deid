---
"@cosyte/deid": patch
---

Count and locate every value-bearing position a pass hands through without examining it, so an empty residual inventory can be told apart from an unmeasured one.

The library fails closed on _structures_: an unrecognized segment, resource, loop or extension is blocked. It has never failed closed on _positions inside a structure it hands through_, and until now such a position was passed through untouched and recorded nowhere at all. The pass-through is a stated limitation a consumer can filter for; the silence was not, because an Expert-Determination support report whose residual inventories are empty reads the same whether the pass found nothing or measured nothing, and a determiner acts on that emptiness.

Every de-identification result now carries a second value-free list, `unexaminedResiduals`, beside its manifest. Each record names the position's structural locus, how many values sat there, and the fact that no rule examined it: never a value, never a key, never a date-shift offset. All six format bindings produce it, from the unmapped fields of a retained HL7 v2 segment and the entry dates inside a retained C-CDA clinical body to every DICOM attribute the delegated Annex E report does not account for, nested sequence items included.

The support report gains the matching inventory as a sibling of the retained quasi-identifiers, the count in its disposition roll-up, and a rendering that states in terms whether an empty inventory was **measured and empty** or **not measured at all**.

**Counting is not removal.** Nothing is scrubbed, generalized, blocked or otherwise transformed on account of the measurement, and every transformed document is byte-identical to what the same input and policy produced before it. A position no rule examined also has no established Safe Harbor category, so it is attributed to none of the 18 and moves no category total: a clinical code, a dose unit and an order status all sit at positions like these.

Two fail-safes ride with it. A position whose structural locus cannot be expressed is still counted, under a withheld locus token, so losing the "where" never also loses the "how many". And a structure whose value-bearing positions cannot be enumerated fails the pass with a new typed `DEID_POSITIONS_UNENUMERABLE` fatal naming the structure, rather than emitting a zero or a partial count a reader would take for a clearance.

Both code registries are additions-only: `DEID_POSITION_UNEXAMINED` and `DEID_POSITIONS_UNENUMERABLE` are new, and `DEID_RESIDUAL_RETAINED` still means exactly what it did, the residual of a value the pass examined.
