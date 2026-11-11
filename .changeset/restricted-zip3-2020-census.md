---
"@cosyte/deid": patch
---

The restricted three-digit ZIP list now follows the 2020 Census, so six more prefixes become `000` under Safe Harbor.

- **Six prefixes added.** `202`, `204`, `205`, `369`, `753` and `772` each held 20,000 people or fewer in the 2020 Census (table P1 of the Demographic and Housing Characteristics File, by five-digit ZCTA, summed by the first three digits). A ZIP starting with one of them is now generalized to `000` where it kept its three digits before, and its manifest row is `DEID_CATEGORY_GENERALIZED` instead of `DEID_RESIDUAL_RETAINED`.
- **None removed.** The 17 prefixes the HHS guidance lists from the 2000 Census all stay, including the five (`063`, `790`, `830`, `831`, `890`) that are over 20,000 in 2020, so no ZIP that became `000` before keeps its prefix now. `RESTRICTED_ZIP3` holds 23 prefixes.
- **`RESTRICTED_ZIP3_SOURCE`.** `census` is now `"2020"` (it was `"2000"`), a new `dataset` field names the Census table, and `citation` names the regulation and the HHS guidance whose list is kept. A caller that compared `census` to `"2000"` must compare to `"2020"`.
- **What a caller sees.** Output changes only for a ZIP in one of the six added prefixes. The limitations page says where the list comes from and how it is rebuilt from a newer census.
