---
"@cosyte/deid": patch
---

The FHIR adapter now removes and records a plain string sent where an Identifier or an Address belongs, or at `valueHumanName`, instead of passing it through to the output.

Before, a resource such as `{"resourceType":"Observation","identifier":"..."}`, a Patient whose `address` list held a string, or an Organization or Location whose `address` (or a contact's) was a string came out with that string unchanged, listed only as an unexamined position. The same held for a string at `locationAddress`, `valueAddress` or `valueHumanName`. Each such item, and a `null` or a number there, is now blocked under the catch-all category and removed, and its manifest row names where it was, at the same path an Identifier, Address or HumanName there would have. The two `address` elements R4 types as a url, an Endpoint's own and a CapabilityStatement messaging endpoint's, are kept as before, and so is a string at `name`. `AuditEvent.agent.network.address`, a string R4 uses for a machine name, an IP address or a phone number, is now blocked and recorded too, since it can identify the person behind an agent. Identifiers, addresses and names sent as objects are handled exactly as before.
