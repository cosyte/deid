# Trademarks

`@cosyte/deid` is an independent open-source project. Cosyte is **not affiliated with, endorsed by,
or sponsored by** any standards body or company named in this repository or its documentation.

## Why these names appear

This package transforms documents in published healthcare data standards, and it cannot say which
formats it handles without naming them.

Every reference is **descriptive**: it identifies a standard or a code system, and nothing more.
Naming a standard is the only way to say whether a library works with it.

## Names referenced

| Name                  | Owner                                           | Where it appears                                               |
| --------------------- | ----------------------------------------------- | -------------------------------------------------------------- |
| HL7, FHIR, CDA, C-CDA | Health Level Seven International                | Formats the `./hl7`, `./fhir`, and `./ccda` subpaths transform |
| X12                   | X12 (Accredited Standards Committee X12)        | The format the `./x12` subpath transforms                      |
| NCPDP                 | National Council for Prescription Drug Programs | The format the `./ncpdp` subpath transforms                    |
| DICOM                 | National Electrical Manufacturers Association   | The format the `./dicom` subpath transforms                    |
| LOINC                 | Regenstrief Institute                           | Named in the docs as a code system whose codes are kept        |

All product names, logos, and brands are the property of their respective owners. Use of a name here
does not imply any affiliation with, or endorsement by, its owner. If you own one of these marks and
would like a reference changed, please open an issue.
