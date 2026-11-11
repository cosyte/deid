---
"@cosyte/deid": patch
---

The NCPDP Telecom adapter now refuses a transmission whose declared transaction count is above 1 or disagrees with what decoded.

A Group Separator starts each Telecom transaction, and what precedes the first belongs to the transmission. Since `@cosyte/ncpdp` 0.1.6 reads it that way, a request that declares two transactions but leaves out the Group Separator in front of the first decodes as one transaction behind transmission-level segments, and the refusal, which counted decoded transactions only, let it through. `deidentifyTelecom` and `deidentifyTelecomString` now also refuse, with `DEID_FORMAT_UNSUPPORTED` and the same message, a transmission whose header declares more than one transaction or whose decode carries `NCPDP_TELECOM_TRANSACTION_COUNT_MISMATCH`.

The model handed to `serializeTelecom` now carries the de-identified transmission-level segments on `transmissionSegments`, not the parsed ones, and the transaction keeps only its own segments. The serialized output is unchanged. The peer range for `@cosyte/ncpdp` stays `^0.1.0`.
