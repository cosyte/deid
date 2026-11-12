/**
 * Regenerates the table of every element name FHIR R4 defines, by resource, datatype and backbone
 * element (`src/fhir/generated/element-names.ts`). The FHIR adapter reads it to tell a key R4 defines
 * from one it does not, which it blocks.
 *
 * Read from the published R4 (4.0.1) definitions at `https://hl7.org/fhir/R4/profiles-resources.json`
 * and `https://hl7.org/fhir/R4/profiles-types.json`: the snapshot of every resource and every complex
 * datatype. Each element is written under the resource, datatype or backbone element it belongs to,
 * by its name and, when it holds a structure, the type of that structure: a complex datatype, a
 * backbone element (by its path), the path another element's definition is reused from
 * (`contentReference`), or `Resource`, and whether it repeats (its `max` above 1), which JSON writes
 * as an array. A choice element is written under each concrete name
 * (`value[x]` as `valueQuantity`, `valueString`, ...). Only names and types are kept, never a
 * description. Nothing reads the network at build, test or run time: this script is run by hand
 * when the table is refreshed, and its output is reviewed and committed.
 *
 *     node scripts/fhir-element-names.ts && pnpm format
 */

import { writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const SOURCES = [
  "https://hl7.org/fhir/R4/profiles-types.json",
  "https://hl7.org/fhir/R4/profiles-resources.json",
];

/**
 * The element names a structure of each kind starts with, in the order the snapshots list them, each
 * written as one token: a `DomainResource`, a `Resource`, a backbone element and an element.
 */
const BASES: readonly (readonly [string, string])[] = [
  [
    "@D",
    "id meta:Meta implicitRules language text:Narrative contained:Resource* extension* modifierExtension*",
  ],
  ["@R", "id meta:Meta implicitRules language"],
  ["@B", "id extension* modifierExtension*"],
  ["@E", "id extension*"],
];

interface ElementDefinition {
  readonly path: string;
  readonly max?: string;
  readonly type?: readonly { readonly code: string }[];
  readonly contentReference?: string;
}

interface StructureDefinition {
  readonly resourceType: string;
  readonly id: string;
  readonly type?: string;
  readonly kind?: string;
  readonly derivation?: string;
  readonly snapshot?: { readonly element: readonly ElementDefinition[] };
}

interface DefinitionBundle {
  readonly entry: readonly { readonly resource: StructureDefinition }[];
}

async function load(source: string): Promise<StructureDefinition[]> {
  const response = await fetch(source, { signal: AbortSignal.timeout(240_000) });
  if (!response.ok) throw new Error(`${source}: HTTP ${String(response.status)}`);
  const bundle = (await response.json()) as DefinitionBundle;
  return bundle.entry
    .map((e) => e.resource)
    .filter((s) => s.resourceType === "StructureDefinition");
}

async function main(): Promise<void> {
  const definitions = (await Promise.all(SOURCES.map(load))).flat();
  // The structures a key can sit in: every complex datatype and every resource, abstract or not,
  // each under its own name. A constraint on a datatype (`SimpleQuantity`) is written as the type it
  // constrains, so it is not a structure of its own.
  const structures = definitions.filter(
    (s) =>
      (s.kind === "complex-type" || s.kind === "resource") &&
      s.derivation !== "constraint" &&
      s.snapshot !== undefined,
  );
  const complexTypes = new Set(structures.map((s) => s.id));

  const table = new Map<string, string[]>();
  for (const s of structures) {
    const elements = s.snapshot?.element ?? [];
    // A path with elements below it is a backbone element: a structure of its own, under its path.
    const containers = new Set<string>();
    for (const e of elements) {
      const cut = e.path.lastIndexOf(".");
      if (cut > 0) containers.add(e.path.slice(0, cut));
    }
    for (const e of elements) {
      const cut = e.path.lastIndexOf(".");
      if (cut === -1) continue;
      const owner = e.path.slice(0, cut);
      const name = e.path.slice(cut + 1);
      const entries = table.get(owner) ?? [];
      table.set(owner, entries);
      // An element that repeats is held in a JSON array, and one that does not as a single value.
      const many = e.max !== undefined && e.max !== "1" && e.max !== "0" ? "*" : "";
      if (e.contentReference !== undefined) {
        entries.push(`${name}:${e.contentReference.replace(/^.*#/, "")}${many}`);
        continue;
      }
      const types = (e.type ?? []).map((t) => t.code);
      const typeOf = (code: string): string | undefined => {
        // A backbone element is written as `.`, its own path, which is the owner's path and its name.
        if (containers.has(e.path)) return ".";
        // An extension is decided by its own rule, which reads no table, so it is written as a name.
        if (code === "Extension") return undefined;
        if (code === "Resource") return "Resource";
        return complexTypes.has(code) ? code : undefined;
      };
      if (name.endsWith("[x]")) {
        const base = name.slice(0, -3);
        for (const code of types) {
          const concrete = `${base}${code.charAt(0).toUpperCase()}${code.slice(1)}`;
          const type = typeOf(code);
          entries.push(type === undefined ? `${concrete}${many}` : `${concrete}:${type}${many}`);
        }
        continue;
      }
      const type = typeOf(types[0] ?? "");
      entries.push(type === undefined ? `${name}${many}` : `${name}:${type}${many}`);
    }
  }

  const keys = [...table.keys()].sort();
  const lines = keys.map((key) => {
    let entry = ` ${table.get(key)?.join(" ") ?? ""} `;
    // The element names every structure of a kind starts with, written once as a token.
    for (const [token, names] of BASES) entry = entry.replace(` ${names} `, ` ${token} `);
    return `  ${JSON.stringify(key)}: ${JSON.stringify(entry.trim())},`;
  });
  const bases = BASES.map(
    ([token, names]) => `  ${JSON.stringify(token)}: ${JSON.stringify(names)},`,
  );
  const out = `/**
 * Every element name FHIR R4 defines, by the resource, datatype or backbone element it belongs to, as
 * the R4 (4.0.1) definitions publish them (retrieved from \`${SOURCES.join("` and `")}\`).
 * Each entry is a space-separated list: a name alone holds a primitive or an extension, and
 * \`name:Type\` holds a structure, named by its datatype, by \`.\` for a backbone element (its own
 * path), by the backbone path whose definition it reuses, or by \`Resource\` (any resource, read by
 * its own \`resourceType\`). A trailing \`*\` marks an element that repeats, which JSON writes as an
 * array; every other element is written as a single value. A choice element is listed under each
 * concrete name it is written as. A token (\`@D\`) stands for the names every structure of a kind
 * starts with ({@link FHIR_ELEMENT_BASES}).
 *
 * Generated by \`scripts/fhir-element-names.ts\` and then formatted; refresh by running it, never by hand.
 *
 * @packageDocumentation
 * @internal
 */

/** The element names of each R4 structure, keyed by its type or backbone path. @internal */
export const FHIR_ELEMENT_NAMES: Readonly<Record<string, string>> = {
${lines.join("\n")}
};

/**
 * The names each token in {@link FHIR_ELEMENT_NAMES} stands for: those every \`DomainResource\`
 * (\`@D\`), \`Resource\` (\`@R\`), backbone element (\`@B\`) and element (\`@E\`) starts with.
 * @internal
 */
export const FHIR_ELEMENT_BASES: Readonly<Record<string, string>> = {
${bases.join("\n")}
};
`;
  writeFileSync(join(ROOT, "src/fhir/generated/element-names.ts"), out);
  process.stdout.write(`${String(keys.length)} structures\n`);
}

await main();
