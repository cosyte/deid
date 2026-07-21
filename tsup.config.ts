import { cosyteTsup } from "@cosyte/tsup-config";

/**
 * tsup build for @cosyte/deid — dual ESM + CJS + `.d.ts` from the shared @cosyte/tsup-config standard
 * (ES2023, Node platform, `.mjs`/`.cjs` out-extensions). Matches the `exports` map in package.json.
 *
 * Two entries (the package's two public subpaths): the format-agnostic core (`.`) and the HL7 v2
 * adapter (`./hl7`). `@cosyte/hl7` is an **optional peer dep** consumed only from the `/hl7` subpath
 * and is marked `external` so it is never bundled — a consumer who only de-identifies HL7 installs it
 * alongside `@cosyte/deid`; the core stays dependency-free.
 */
export default cosyteTsup({
  entry: { index: "src/index.ts", "hl7/index": "src/hl7/index.ts" },
  external: ["@cosyte/hl7"],
});
