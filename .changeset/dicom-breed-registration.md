---
"@cosyte/deid": patch
---

The DICOM adapter now removes an animal patient's Breed Registration Sequence and Breed Registration Number, which PS3.15 Table E.1-1 does not list.

- **What changed in output.** Before, Breed Registration Sequence `(0010,2294)` and Breed Registration Number `(0010,2295)` left the pass unchanged and were only counted as unexamined residuals, because the delegated Annex E pass keeps what Table E.1-1 does not name. A registration number names one animal, and its registry holds the owner's name and address. Now both are removed at the top level, each removal gets a manifest row (`removed`, category (R)), a number inside the sequence gets its own row, and the result carries a `DICOM_BREED_REGISTRATION_REMOVED` warning naming the removal as going beyond Table E.1-1.
- **New refusal.** A file that carries either attribute inside a sequence the pass keeps is refused with `DEID_FORMAT_UNSUPPORTED`, as a cleaned coded list nested in a kept sequence already is.
- **New export.** `BREED_REGISTRATION_REMOVED_CODE` from `@cosyte/deid/dicom`.
- **What a caller changes.** Nothing for a file with no breed registration. A reader that expected the registration in the output now finds it gone, and a check on the warnings or the manifest sees the new entries.
- **Documented.** Known limitations gains an "Animal patients" section: what the HL7 v2 and DICOM adapters do with each field only an animal record has.
