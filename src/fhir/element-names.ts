/**
 * The element names FHIR R4 defines, read from the generated table (`./generated/element-names.js`):
 * which keys a resource, a datatype or a backbone element may carry, and what each one holds. The
 * extractor reads it to find a key R4 does not define, which it blocks at any depth.
 *
 * A structure is named by its type (`Observation`, `Coding`) or, for a backbone element, by its path
 * (`Observation.component`). What an element holds is a structure name, or `null` for a primitive or
 * an extension (an extension is decided by its own rule, which reads no table).
 *
 * @packageDocumentation
 * @internal
 */

import { FHIR_ELEMENT_BASES, FHIR_ELEMENT_NAMES } from "./generated/element-names.js";

/** The structure a resource of an unknown type is read as: the elements every resource may carry. */
const UNKNOWN_RESOURCE_STRUCTURE = "DomainResource";

/** The structure name that stands for any resource, read by its own `resourceType`. @internal */
export const ANY_RESOURCE = "Resource";

/** Read one entry of the generated table into a map from element name to what it holds. */
function readStructure(structure: string, entry: string): ReadonlyMap<string, string | null> {
  const elements = new Map<string, string | null>();
  for (const token of entry.split(" ")) {
    for (const word of (FHIR_ELEMENT_BASES[token] ?? token).split(" ")) {
      const cut = word.indexOf(":");
      const name = cut === -1 ? word : word.slice(0, cut);
      const type = word.slice(cut + 1);
      elements.set(name, cut === -1 ? null : type === "." ? `${structure}.${name}` : type);
    }
  }
  return elements;
}

/** Every structure of the table, read once when the module loads. */
const STRUCTURES: ReadonlyMap<string | null, ReadonlyMap<string, string | null>> = new Map(
  Object.entries(FHIR_ELEMENT_NAMES).map(([structure, entry]) => [
    structure,
    readStructure(structure, entry),
  ]),
);

/**
 * The resource types R4 defines, each mapped to itself: every structure that starts with what every
 * resource carries.
 */
const RESOURCE_TYPES: ReadonlyMap<string | undefined, string> = new Map(
  Object.entries(FHIR_ELEMENT_NAMES)
    .filter(([, entry]) => entry.startsWith("@D") || entry.startsWith("@R"))
    .map(([structure]) => [structure, structure]),
);

/** No element at all: what a structure R4 does not define, or a primitive, carries. */
const NO_ELEMENTS: ReadonlyMap<string, string | null> = new Map();

/**
 * The elements of one structure, by name, each mapped to the structure it holds (`null` for a
 * primitive or an extension). A structure R4 does not define, and `null` (a primitive, which holds
 * no key), has none.
 *
 * @internal
 */
export function fhirElementsOf(structure: string | null): ReadonlyMap<string, string | null> {
  return STRUCTURES.get(structure) ?? NO_ELEMENTS;
}

/**
 * The structure a resource of this `resourceType` is read as: its own when R4 defines it as a
 * resource, and `DomainResource` otherwise (an unknown type, a datatype's name, a backbone path, or
 * no type at all), so only the elements every resource carries are kept.
 *
 * @internal
 */
export function fhirResourceStructure(type: string | undefined): string {
  return RESOURCE_TYPES.get(type) ?? UNKNOWN_RESOURCE_STRUCTURE;
}
