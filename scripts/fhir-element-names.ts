/**
 * Regenerates the table of every element name FHIR R4 defines, by resource, datatype and backbone
 * element (`src/fhir/generated/element-names.ts`), and the table of the format R4 defines for each
 * primitive type and the code sets of its required bindings (`src/fhir/generated/primitive-formats.ts`).
 * The FHIR adapter reads the first to tell a key R4 defines from one it does not, and the second to
 * tell a primitive that fits its type from one that does not; it blocks the key or the primitive that
 * does not.
 *
 * Read from the published R4 (4.0.1) definitions at `https://hl7.org/fhir/R4/profiles-resources.json`,
 * `https://hl7.org/fhir/R4/profiles-types.json` and `https://hl7.org/fhir/R4/valuesets.json`: the
 * snapshot of every resource and every complex datatype, the definition of every primitive type, and
 * every value set and code system R4 publishes. Each element is written under the resource, datatype
 * or backbone element it belongs to, by its name and, when it holds a structure, the type of that
 * structure: a complex datatype, a backbone element (by its path), the path another element's
 * definition is reused from (`contentReference`), or `Resource`; when it holds a primitive, the R4
 * type of that primitive (`code`, `dateTime`, `integer`, ...), bar a `string`, a `markdown` and an
 * `xhtml`, which R4 constrains no further than JSON does and which are written as a name alone; and
 * whether it repeats (its `max` above 1), which JSON writes as an array. An element the snapshots type
 * as a FHIRPath system type (`http://hl7.org/fhirpath/System.String`: every element and resource `id`,
 * an extension's `url`) is read by the R4 type the snapshot names beside it. A choice element is
 * written under each concrete name (`value[x]` as `valueQuantity`, `valueString`, ...). Only names,
 * types, patterns, ranges and codes are kept, never a description. Nothing reads the network at
 * build, test or run time: this script is run by hand when the tables are refreshed, and its output
 * is reviewed and committed.
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
const VALUE_SETS = "https://hl7.org/fhir/R4/valuesets.json";

/**
 * The element names a structure of each kind starts with, in the order the snapshots list them, each
 * written as one token: a `DomainResource`, a `Resource`, a backbone element and an element.
 */
const BASES: readonly (readonly [string, string])[] = [
  [
    "@D",
    "id meta:Meta implicitRules:uri language:code text:Narrative contained:Resource* extension* modifierExtension*",
  ],
  ["@R", "id meta:Meta implicitRules:uri language:code"],
  ["@B", "id extension* modifierExtension*"],
  ["@E", "id extension*"],
];

/**
 * The primitive types R4 constrains no further than a JSON string: a `string` and a `markdown`, whose
 * pattern admits any text but an empty one, and an `xhtml`, which has none. An element of one is
 * written as a name alone, as an extension is.
 */
const STRING_TYPES: ReadonlySet<string> = new Set(["string", "markdown", "xhtml"]);

/** The extension a FHIRPath system type carries in the snapshots, naming the R4 type it stands for. */
const FHIR_TYPE_URL = "http://hl7.org/fhir/StructureDefinition/structuredefinition-fhir-type";

/** The extension that carries a primitive type's pattern in its definition. */
const REGEX_URL = "http://hl7.org/fhir/StructureDefinition/regex";

/** The prefix of every value set R4 itself defines. */
const R4_VALUE_SET = "http://hl7.org/fhir/ValueSet/";

interface TypeRef {
  readonly code: string;
  readonly extension?: readonly {
    readonly url: string;
    readonly valueUrl?: string;
    readonly valueString?: string;
  }[];
}

interface ElementDefinition {
  readonly path: string;
  readonly max?: string;
  readonly type?: readonly TypeRef[];
  readonly contentReference?: string;
  readonly minValueInteger?: number;
  readonly maxValueInteger?: number;
  readonly binding?: { readonly strength: string; readonly valueSet?: string };
}

interface StructureDefinition {
  readonly resourceType: string;
  readonly id: string;
  readonly type?: string;
  readonly kind?: string;
  readonly derivation?: string;
  readonly baseDefinition?: string;
  readonly snapshot?: { readonly element: readonly ElementDefinition[] };
}

interface Concept {
  readonly code: string;
  readonly concept?: readonly Concept[];
}

interface ValueSet {
  readonly resourceType: "ValueSet";
  readonly url: string;
  readonly compose?: {
    readonly include: readonly {
      readonly system?: string;
      readonly concept?: readonly Concept[];
      readonly filter?: readonly unknown[];
      readonly valueSet?: readonly string[];
    }[];
    readonly exclude?: readonly unknown[];
  };
}

interface CodeSystem {
  readonly resourceType: "CodeSystem";
  readonly url: string;
  readonly content?: string;
  readonly concept?: readonly Concept[];
}

interface DefinitionBundle<T> {
  readonly entry: readonly { readonly resource: T }[];
}

async function fetchBundle<T>(source: string): Promise<T[]> {
  const response = await fetch(source, { signal: AbortSignal.timeout(240_000) });
  if (!response.ok) throw new Error(`${source}: HTTP ${String(response.status)}`);
  const bundle = (await response.json()) as DefinitionBundle<T>;
  return bundle.entry.map((e) => e.resource);
}

/** The R4 type a type reference names: its code, or for a FHIRPath system type the R4 type beside it. */
function r4Type(type: TypeRef): string {
  if (!type.code.startsWith("http://hl7.org/fhirpath/")) return type.code;
  return type.extension?.find((x) => x.url === FHIR_TYPE_URL)?.valueUrl ?? "string";
}

/** The format of one primitive type: its pattern, and the range of an integer kind. */
interface PrimitiveFormat {
  readonly pattern: string;
  readonly min?: number;
  readonly max?: number;
}

/**
 * The format of every primitive type R4 defines that it constrains further than a JSON string: the
 * pattern its definition carries on its `value`, and, for an integer kind, the range its definition
 * or the definition it derives from gives (`positiveInt` and `unsignedInt` derive from `integer`).
 */
function primitiveFormats(
  definitions: readonly StructureDefinition[],
): Map<string, PrimitiveFormat> {
  const primitives = new Map(
    definitions.filter((s) => s.kind === "primitive-type").map((s) => [s.id, s] as const),
  );
  const valueOf = (s: StructureDefinition): ElementDefinition | undefined =>
    s.snapshot?.element.find((e) => e.path === `${s.id}.value`);
  const range = (s: StructureDefinition | undefined, end: "min" | "max"): number | undefined => {
    if (s === undefined) return undefined;
    const value = valueOf(s);
    const own = end === "min" ? value?.minValueInteger : value?.maxValueInteger;
    if (own !== undefined) return own;
    return range(primitives.get(s.baseDefinition?.replace(/^.*\//, "") ?? ""), end);
  };
  const formats = new Map<string, PrimitiveFormat>();
  for (const [id, s] of [...primitives].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    if (STRING_TYPES.has(id)) continue;
    const pattern = valueOf(s)
      ?.type?.flatMap((t) => t.extension ?? [])
      .find((x) => x.url === REGEX_URL)?.valueString;
    if (pattern === undefined) throw new Error(`${id}: no pattern`);
    const min = range(s, "min");
    const max = range(s, "max");
    formats.set(id, {
      pattern,
      ...(min === undefined ? {} : { min }),
      ...(max === undefined ? {} : { max }),
    });
  }
  return formats;
}

/**
 * Every code a value set R4 defines holds, when the published definitions carry all of it: each
 * `include` names concepts, a whole code system R4 publishes in full, or another value set that
 * resolves the same way. A value set that filters, excludes, or draws on a code system or value set
 * the definitions do not carry (MIME types, ISO 4217 currencies, a terminology.hl7.org value set)
 * is not carried, and gives the reason instead.
 */
function expandValueSet(
  url: string,
  valueSets: ReadonlyMap<string, ValueSet>,
  codeSystems: ReadonlyMap<string, CodeSystem>,
): { readonly codes: ReadonlySet<string> } | { readonly missing: string } {
  const bare = url.replace(/\|.*$/, "");
  const vs = valueSets.get(bare);
  if (vs?.compose === undefined) return { missing: bare };
  if (vs.compose.exclude !== undefined) return { missing: bare };
  const codes = new Set<string>();
  const walk = (concepts: readonly Concept[]): void => {
    for (const c of concepts) {
      codes.add(c.code);
      walk(c.concept ?? []);
    }
  };
  for (const include of vs.compose.include) {
    if (include.filter !== undefined) return { missing: bare };
    for (const imported of include.valueSet ?? []) {
      const nested = expandValueSet(imported, valueSets, codeSystems);
      if ("missing" in nested) return nested;
      for (const code of nested.codes) codes.add(code);
    }
    if (include.concept !== undefined) {
      for (const c of include.concept) codes.add(c.code);
      continue;
    }
    if (include.system === undefined) continue;
    const system = codeSystems.get(include.system);
    if (system?.content !== "complete") return { missing: include.system };
    walk(system.concept ?? []);
  }
  return { codes };
}

async function main(): Promise<void> {
  const definitions = (await Promise.all(SOURCES.map((s) => fetchBundle<StructureDefinition>(s))))
    .flat()
    .filter((s) => s.resourceType === "StructureDefinition");
  const terminology = await fetchBundle<ValueSet | CodeSystem>(VALUE_SETS);
  const valueSets = new Map<string, ValueSet>();
  const codeSystems = new Map<string, CodeSystem>();
  for (const r of terminology) {
    if (r.resourceType === "ValueSet") valueSets.set(r.url, r);
    else if (r.resourceType === "CodeSystem") codeSystems.set(r.url, r);
  }
  const formats = primitiveFormats(definitions);

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
  // Each element of type `code` R4 binds, required, to a value set: the set it resolves to, or the
  // value set the definitions do not carry all of.
  const bindings = new Map<string, string>();
  const uncarried = new Map<string, string>();
  const codeSets = new Map<string, readonly string[]>();
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
      const types = (e.type ?? []).map(r4Type);
      const typeOf = (code: string): string | undefined => {
        // A backbone element is written as `.`, its own path, which is the owner's path and its name.
        if (containers.has(e.path)) return ".";
        // An extension is decided by its own rule, which reads no table, so it is written as a name.
        if (code === "Extension") return undefined;
        if (code === "Resource") return "Resource";
        if (complexTypes.has(code)) return code;
        // A primitive is written by its R4 type, bar the ones R4 constrains no further than JSON.
        return STRING_TYPES.has(code) ? undefined : code;
      };
      const bind = (concrete: string): void => {
        if (e.binding?.strength !== "required" || e.binding.valueSet === undefined) return;
        const key = `${owner}.${concrete}`;
        const url = e.binding.valueSet;
        const expanded = url.startsWith(R4_VALUE_SET)
          ? expandValueSet(url, valueSets, codeSystems)
          : { missing: url.replace(/\|.*$/, "") };
        if ("missing" in expanded) {
          uncarried.set(key, url.replace(/\|.*$/, ""));
          return;
        }
        const id = url.replace(/\|.*$/, "").slice(R4_VALUE_SET.length);
        codeSets.set(id, [...expanded.codes].sort());
        bindings.set(key, id);
      };
      if (name.endsWith("[x]")) {
        const base = name.slice(0, -3);
        for (const code of types) {
          const concrete = `${base}${code.charAt(0).toUpperCase()}${code.slice(1)}`;
          const type = typeOf(code);
          entries.push(type === undefined ? `${concrete}${many}` : `${concrete}:${type}${many}`);
          if (code === "code") bind(concrete);
        }
        continue;
      }
      const type = typeOf(types[0] ?? "");
      entries.push(type === undefined ? `${name}${many}` : `${name}:${type}${many}`);
      if (types[0] === "code") bind(name);
    }
  }

  writeElementNames(table);
  writePrimitiveFormats(formats, bindings, codeSets, uncarried);
  process.stdout.write(
    `${String(table.size)} structures, ${String(formats.size)} primitive formats, ` +
      `${String(bindings.size)} required bindings to ${String(codeSets.size)} value sets, ` +
      `${String(uncarried.size)} not carried\n`,
  );
}

/** Sort strings by code unit, as the tables are written. */
function byCodeUnit(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function writeElementNames(table: ReadonlyMap<string, readonly string[]>): void {
  const keys = [...table.keys()].sort(byCodeUnit);
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
 * Each entry is a space-separated list: a name alone holds a primitive R4 constrains no further than
 * a JSON string (a \`string\`, a \`markdown\`, an \`xhtml\`), or an extension; \`name:type\`, with a
 * type that starts with a small letter, holds a primitive of that R4 type (\`code\`, \`dateTime\`,
 * \`boolean\`, \`integer\`, ...); and \`name:Type\` holds a structure, named by its datatype, by \`.\`
 * for a backbone element (its own path), by the backbone path whose definition it reuses, or by
 * \`Resource\` (any resource, read by its own \`resourceType\`). A trailing \`*\` marks an element
 * that repeats, which JSON writes as an array; every other element is written as a single value. A
 * choice element is listed under each concrete name it is written as. A token (\`@D\`) stands for
 * the names every structure of a kind starts with ({@link FHIR_ELEMENT_BASES}).
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
}

function writePrimitiveFormats(
  formats: ReadonlyMap<string, PrimitiveFormat>,
  bindings: ReadonlyMap<string, string>,
  codeSets: ReadonlyMap<string, readonly string[]>,
  uncarried: ReadonlyMap<string, string>,
): void {
  for (const [id, codes] of codeSets) {
    // The codes are written space-separated, so none may hold a space.
    if (codes.some((c) => /\s/.test(c))) throw new Error(`${id}: a code holds a space`);
  }
  const formatLines = [...formats].map(
    ([id, f]) =>
      `  ${JSON.stringify(id)}: { pattern: ${JSON.stringify(f.pattern)}${
        f.min === undefined ? "" : `, min: ${String(f.min)}`
      }${f.max === undefined ? "" : `, max: ${String(f.max)}`} },`,
  );
  const setLines = [...codeSets.keys()]
    .sort(byCodeUnit)
    .map((id) => `  ${JSON.stringify(id)}: ${JSON.stringify(codeSets.get(id)?.join(" ") ?? "")},`);
  const bindingLines = [...bindings.keys()]
    .sort(byCodeUnit)
    .map((path) => `  ${JSON.stringify(path)}: ${JSON.stringify(bindings.get(path) ?? "")},`);
  const uncarriedLines = [...uncarried.keys()]
    .sort(byCodeUnit)
    .map((path) => `  ${JSON.stringify(path)}: ${JSON.stringify(uncarried.get(path) ?? "")},`);
  const out = `/**
 * The format FHIR R4 defines for each primitive type it constrains further than a JSON string, and
 * the codes of every required binding of an element of type \`code\` to a value set R4 defines, as the
 * R4 (4.0.1) definitions publish them (retrieved from \`${[...SOURCES, VALUE_SETS].join("`, `")}\`).
 *
 * Generated by \`scripts/fhir-element-names.ts\` and then formatted; refresh by running it, never by hand.
 *
 * @packageDocumentation
 * @internal
 */

/** Every primitive type R4 constrains further than a JSON string. @internal */
export type FhirFormattedPrimitive =
${[...formats.keys()].map((id) => `  | ${JSON.stringify(id)}`).join("\n")};

/**
 * The format of each primitive type: the pattern its definition carries on its \`value\` (matched
 * against the whole value), and for an integer kind the range its definition, or the \`integer\` it
 * derives from, gives. @internal
 */
export const FHIR_PRIMITIVE_FORMATS: Readonly<
  Record<
    FhirFormattedPrimitive,
    { readonly pattern: string; readonly min?: number; readonly max?: number }
  >
> = {
${formatLines.join("\n")}
};

/** The codes of each value set a required binding names, space-separated, by the value set's id. @internal */
export const FHIR_REQUIRED_CODE_SETS: Readonly<Record<string, string>> = {
${setLines.join("\n")}
};

/**
 * Each element of type \`code\` that R4 binds, required, to a value set the definitions carry, by its
 * path in {@link FHIR_PRIMITIVE_FORMATS}'s sibling table of element names (\`Encounter.status\`, a
 * choice element by its concrete name), mapped to the value set's id. @internal
 */
export const FHIR_REQUIRED_BINDINGS: Readonly<Record<string, string>> = {
${bindingLines.join("\n")}
};

/**
 * Each element of type \`code\` that R4 binds, required, to a value set the published definitions do
 * not carry all of, mapped to what is missing: the value set, or the code system it draws on. Such a
 * code is held to the \`code\` format alone. @internal
 */
export const FHIR_UNCARRIED_REQUIRED_BINDINGS: Readonly<Record<string, string>> = {
${uncarriedLines.join("\n")}
};
`;
  writeFileSync(join(ROOT, "src/fhir/generated/primitive-formats.ts"), out);
}

await main();
