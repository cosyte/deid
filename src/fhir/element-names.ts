/**
 * The element names FHIR R4 defines, read from the generated table (`./generated/element-names.js`):
 * which keys a resource, a datatype or a backbone element may carry, and what each one holds. The
 * extractor reads it to find a key R4 does not define, which it blocks at any depth.
 *
 * A structure is named by its type (`Observation`, `Coding`) or, for a backbone element, by its path
 * (`Observation.component`). What an element holds is a structure name, or `null` for a primitive or
 * an extension (an extension is decided by its own rule, which reads no table), and an element either
 * repeats (JSON writes it as an array) or does not (a single value).
 *
 * @packageDocumentation
 * @internal
 */

import { FHIR_ELEMENT_BASES, FHIR_ELEMENT_NAMES } from "./generated/element-names.js";

/** The structure name that stands for any resource, read by its own `resourceType`. @internal */
export const ANY_RESOURCE = "Resource";

/** One structure of the table: what each element holds, and which elements repeat. */
interface Structure {
  readonly elements: ReadonlyMap<string, string | null>;
  readonly repeating: ReadonlySet<string>;
}

/** Read one entry of the generated table: what each element holds, and which elements repeat. */
function readStructure(structure: string, entry: string): Structure {
  const elements = new Map<string, string | null>();
  const repeating = new Set<string>();
  for (const token of entry.split(" ")) {
    for (const marked of (FHIR_ELEMENT_BASES[token] ?? token).split(" ")) {
      const many = marked.endsWith("*");
      const word = many ? marked.slice(0, -1) : marked;
      const cut = word.indexOf(":");
      const name = cut === -1 ? word : word.slice(0, cut);
      const type = word.slice(cut + 1);
      elements.set(name, cut === -1 ? null : type === "." ? `${structure}.${name}` : type);
      if (many) repeating.add(name);
    }
  }
  return { elements, repeating };
}

/** Every structure of the table, read once when the module loads. */
const STRUCTURES: ReadonlyMap<string | null, Structure> = new Map(
  Object.entries(FHIR_ELEMENT_NAMES).map(([structure, entry]) => [
    structure,
    readStructure(structure, entry),
  ]),
);

/**
 * The two abstract resources every other resource derives from. R4 defines no instance of either, so
 * neither is a type a resource can carry.
 */
const ABSTRACT_RESOURCES: ReadonlySet<string> = new Set(["Resource", "DomainResource"]);

/**
 * The resource types R4 defines, each mapped to itself: every structure that starts with what every
 * resource carries, bar the two abstract ones.
 */
const RESOURCE_TYPES: ReadonlyMap<string | undefined, string> = new Map(
  Object.entries(FHIR_ELEMENT_NAMES)
    .filter(([, entry]) => entry.startsWith("@D") || entry.startsWith("@R"))
    .filter(([structure]) => !ABSTRACT_RESOURCES.has(structure))
    .map(([structure]) => [structure, structure]),
);

/** No element at all: what a structure R4 does not define, or a primitive, carries. */
const NO_ELEMENTS: ReadonlyMap<string, string | null> = new Map();

/** No element repeats: what a structure R4 does not define, or a primitive, carries. */
const NONE_REPEATING: ReadonlySet<string> = new Set();

/**
 * The elements of one structure, by name, each mapped to the structure it holds (`null` for a
 * primitive or an extension). A structure R4 does not define, and `null` (a primitive, which holds
 * no key), has none.
 *
 * @internal
 */
export function fhirElementsOf(structure: string | null): ReadonlyMap<string, string | null> {
  return STRUCTURES.get(structure)?.elements ?? NO_ELEMENTS;
}

/**
 * The elements of one structure that repeat, which JSON writes as an array; every other element of
 * it is written as a single value. A structure R4 does not define, and `null`, has none.
 *
 * @internal
 */
export function fhirRepeatingElementsOf(structure: string | null): ReadonlySet<string> {
  return STRUCTURES.get(structure)?.repeating ?? NONE_REPEATING;
}

/**
 * The structure a resource of this `resourceType` is read as: its own when R4 defines it as a
 * resource, and `undefined` otherwise (an unknown type, an abstract one, a datatype's name, a
 * backbone path, or no type at all), for a resource that is removed whole.
 *
 * @internal
 */
export function fhirResourceStructure(type: string | undefined): string | undefined {
  return RESOURCE_TYPES.get(type);
}
