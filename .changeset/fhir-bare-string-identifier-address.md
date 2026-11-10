---
"@cosyte/deid": patch
---

The FHIR adapter now removes and records a plain string sent where an Identifier or an Address belongs, instead of passing it through to the output.

Before, a resource such as `{"resourceType":"Observation","identifier":"..."}` or a Patient whose `address` list held a string came out with that string unchanged, listed only as an unexamined position. Each such item is now blocked under the catch-all category and removed, and its manifest row names where it was, at the same path an Identifier or Address there would have. Identifiers and addresses sent as objects are handled exactly as before.
