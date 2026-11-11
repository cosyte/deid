---
"@cosyte/deid": patch
---

The NCPDP Telecom adapter now refuses a transaction with a repeated Patient or Claim segment, and the HL7 v2 adapter a message with more than one MSH segment.

A request that declares one transaction and carries a second patient's Patient and Claim segments with no Group Separator in front of them decodes as one transaction. It was de-identified, and the second patient's dates were shifted under the caller's one patient context, giving two people one date-shift offset. `deidentifyTelecom` and `deidentifyTelecomString` now refuse a transaction carrying more than one Patient (`01`) or Claim (`07`) segment with `DEID_FORMAT_UNSUPPORTED`, before anything is extracted. In the same way, HL7 v2 messages written one after another with no batch envelope parse as one message with a second `MSH`; `deidentifyHl7` and `deidentifyHl7String` now refuse that with `DEID_FORMAT_UNSUPPORTED`. A caller that sent either shape splits it and de-identifies each part with its own context; nothing else changes. X12 interchanges, which name several people by design, are handled as before, and the limitations page now says that one call shares one date-shift offset across everyone in it.
