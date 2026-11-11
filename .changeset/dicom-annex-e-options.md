---
"@cosyte/deid": patch
---

The DICOM adapter now takes three PS3.15 Annex E options a caller can name: Clean Descriptors, Retain Patient Characteristics and Retain Device Identity.

- **What changed.** `deidentifyDicom` and `deidentifyDicomBuffer` take a new `annexEOptions` list. Each option named is applied by `@cosyte/dicom`, written to De-identification Method Code Sequence `(0012,0064)` by its CID 7050 term (`113105`, `113108`, `113109`), named in De-identification Method `(0012,0063)`, listed on `retained`, and marked `applied` in `optionDeclarations`. Every attribute a Retain option kept is now a `retained` manifest row with `DEID_RESIDUAL_RETAINED`. `DICOM_ANNEX_E_OPTIONS` and the `DicomAnnexEOption` type are exported from `@cosyte/deid/dicom`.
- **Fail closed.** Retain Patient Characteristics keeps an age over 89 and Retain Device Identity keeps device identifiers, so a run under a policy named `safe-harbor`, the default included, that names either throws `DEID_POLICY_INVALID` before anything is de-identified. Clean Descriptors keeps nothing and runs under any policy. Any other option name, or a value that is not a list of names, is refused with the same code rather than ignored. Pixel cleaning stays out: the two pixel options are always declared withheld.
- **What a caller changes.** Nothing, unless you want an option: with `annexEOptions` absent or empty, the output is byte for byte what it was. To keep patient characteristics or device identity, pass a policy with a name other than `safe-harbor`, for example `defineDeidPolicy({ name: "imaging-research" })`, and name the option.
