---
"@cosyte/deid": patch
---

The FHIR adapter now removes a Device's serial and lot numbers, identifiers and UDI carrier values as device identifiers, category (M), under Safe Harbor and the Limited Data Set.

- **What changed in the default output, on purpose.** On a `Device`, alone, contained in another resource or in a `Bundle` entry, these elements are now removed under both presets, each with a `DEID_CATEGORY_REMOVED` row (category (M), transform `redact`) at its locus that carries no value:
  - `serialNumber`, `lotNumber`, `distinctIdentifier`, and the UDI carrier's `deviceIdentifier` and `carrierHRF`. Before, each was kept verbatim under both presets, with no manifest row, counted only in `unexaminedResiduals`.
  - the UDI carrier's `carrierAIDC`. Before, it was removed as embedded content (category (R), `DEID_LOCUS_BLOCKED`), and naming `base64-binary` in `keepEmbeddedContent` kept it. Now it is removed as category (M) whatever kind is kept.
  - every `Device.identifier` value. Before, it was read as a medical record number: removed under Safe Harbor (category (H)), and given a keyed surrogate under the Limited Data Set. Now it is category (M) and removed under both. An identifier under the Social Security number system is still category (G).
- **What stays the same.** What describes the kind of device is kept: `deviceName`, `modelNumber`, `partNumber`, `type`, `status`, `manufacturer`, and the UDI's `issuer`, `jurisdiction` and `entryType`. A `DeviceDefinition` is not read this way, and an identifier that names a device from another resource (`Observation.device.identifier`) is still read as a medical record number. The same element names on another resource (`Medication.batch.lotNumber`) are not touched.
- **What a caller changes.** Nothing is required. A caller who relied on a device's serial or lot number, or on a keyed surrogate of a `Device.identifier` under the Limited Data Set, no longer gets one; a custom policy can assign category (M) another transform, which these elements then take. A caller that counts rows by category sees category (M) where it saw (H) for a `Device.identifier` and (R) for a `carrierAIDC`.
