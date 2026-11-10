---
"@cosyte/deid": patch
---

The FHIR adapter now removes and records a contact's name whatever shape it arrives in, instead of passing a plain string through to the output.

Before, a string, a number, a `null` or a list of strings at `Organization.contact.name` or `InsurancePlan.contact.name`, where R4 types a `HumanName`, came out unchanged and was listed only as an unexamined position. Each is now blocked and removed, and its manifest row names where it was. The `name` of a `ContactDetail` (the `contact` of every conformance and knowledge resource, the `author`, `editor`, `endorser` and `reviewer` of the knowledge resources, and the `ContactDetail` arms of an open `value[x]`, a `Contributor`'s contacts included) is a string R4 documents as the name of the individual to contact, so it is now removed and recorded as a name, and any other shape there is blocked. A contact sent as a bare string is blocked whole, and a string at `defaultValueHumanName`, `fixedHumanName` or `patternHumanName` is blocked as one at `valueHumanName` already was. An organisation's own `name` and every other plain-string `name` are kept as before.
