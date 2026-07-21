import { cosyteTsup } from "@cosyte/tsup-config";

/**
 * tsup build for @cosyte/deid — dual ESM + CJS + `.d.ts` from the shared @cosyte/tsup-config standard
 * (ES2023, Node platform, `.mjs`/`.cjs` out-extensions). Matches the `exports` map in package.json.
 *
 * Seven entries (the package's public subpaths): the format-agnostic core (`.`), the HL7 v2 adapter
 * (`./hl7`), the C-CDA adapter (`./ccda`), the FHIR R4 adapter (`./fhir`), the X12 EDI adapter (`./x12`),
 * the NCPDP adapter (`./ncpdp`), and the DICOM adapter (`./dicom`). Each parser is an **optional peer dep**
 * consumed only from its own subpath and marked `external` so it is never bundled — a consumer who only
 * de-identifies one format installs just that parser; the core stays third-party-dep-free. `@xmldom/xmldom`
 * is the C-CDA parser's own ratified XML substrate (ccda ADR 0001); the `/ccda` adapter uses only the DOM
 * objects `@cosyte/ccda` hands back (never a direct runtime import), and it is external here too. The
 * `/fhir`, `/x12`, `/ncpdp`, and `/dicom` adapters reach their data only through each parser's own exported
 * model/parse/serialize/deidentify surface — no direct third-party import. The `/dicom` adapter uniquely
 * **delegates** to `@cosyte/dicom`'s own PS3.15 Annex E `deidentify()` (it orchestrates, it does not
 * reimplement) and folds that parser's value-free report into the unified manifest.
 */
export default cosyteTsup({
  entry: {
    index: "src/index.ts",
    "hl7/index": "src/hl7/index.ts",
    "ccda/index": "src/ccda/index.ts",
    "fhir/index": "src/fhir/index.ts",
    "x12/index": "src/x12/index.ts",
    "ncpdp/index": "src/ncpdp/index.ts",
    "dicom/index": "src/dicom/index.ts",
  },
  external: [
    "@cosyte/hl7",
    "@cosyte/ccda",
    "@cosyte/fhir",
    "@cosyte/x12",
    "@cosyte/ncpdp",
    "@cosyte/dicom",
    "@xmldom/xmldom",
  ],
});
