/**
 * The format FHIR R4 defines for each primitive type, read from the generated table
 * (`./generated/primitive-formats.js`): whether a primitive's value fits the type R4 gives its
 * position, and whether a code at an element R4 binds, required, to a value set it defines is one of
 * that set's codes. The extractor reads it to find a value that does not fit, which it blocks.
 *
 * A value fits its type when the whole of it matches the pattern R4's definition of the type carries
 * (`[A-Za-z0-9\-\.]{1,64}` for an `id`), and, for an integer kind, lies in the range the definition
 * gives (an `integer` from -2147483648 to 2147483647; a `positiveInt` and an `unsignedInt` take the
 * range of the `integer` they derive from, and their pattern admits no sign). A `string`, a
 * `markdown` and an `xhtml` are constrained no further than JSON does, so every string fits them.
 * A number is read by the exact text it arrived as, never through a JavaScript number.
 *
 * One element is held to more than its type: `SampledData.data`, a `string` that R4 defines in its
 * own words as decimal values, or `E`, `L` and `U`, separated by a single space. Its definition
 * carries no pattern, so the one here is written from those words, with R4's `decimal` pattern for
 * each value.
 *
 * @packageDocumentation
 * @internal
 */

import {
  FHIR_PRIMITIVE_FORMATS,
  FHIR_REQUIRED_BINDINGS,
  FHIR_REQUIRED_CODE_SETS,
} from "./generated/primitive-formats.js";

/** One primitive type's format, compiled: its whole-value pattern and, for an integer kind, its range. */
interface Format {
  readonly whole: RegExp;
  readonly min?: bigint;
  readonly max?: bigint;
}

/** Compile a pattern R4 writes for a whole value into one that must match all of it. */
function whole(pattern: string): RegExp {
  return new RegExp(`^(?:${pattern})$`);
}

/** Every primitive type R4 constrains further than a JSON string, by its type code. */
const FORMATS: ReadonlyMap<string | null, Format> = new Map(
  Object.entries(FHIR_PRIMITIVE_FORMATS).map(([type, f]) => [
    type,
    {
      whole: whole(f.pattern),
      ...(f.min === undefined ? {} : { min: BigInt(f.min) }),
      ...(f.max === undefined ? {} : { max: BigInt(f.max) }),
    },
  ]),
);

/** R4's `decimal` pattern. */
/* v8 ignore next -- the generated table always holds the decimal pattern */
// Stryker disable next-line OptionalChaining,StringLiteral,LogicalOperator: the generated table always holds the decimal pattern, so neither the chain nor the fallback is ever used
const DECIMAL = FHIR_PRIMITIVE_FORMATS["decimal"]?.pattern ?? "";

/** R4's `decimal` pattern, or one of the three special values, as one data point of `SampledData.data`. */
const SAMPLED_POINT = `(?:${DECIMAL}|E|L|U)`;

/**
 * The elements held to a format beyond their type's, by path: `SampledData.data`, decimal values or
 * `E`, `L` and `U`, separated by a single space (the R4 definition of the element).
 */
const ELEMENT_FORMATS: ReadonlyMap<string | undefined, RegExp> = new Map([
  ["SampledData.data", whole(`${SAMPLED_POINT}(?: ${SAMPLED_POINT})*`)],
]);

/**
 * The element paths R4 binds, required, to a value set the definitions carry, each mapped to the codes
 * of that set, read once when the module loads.
 */
const BINDINGS: ReadonlyMap<string | undefined, ReadonlySet<string>> = new Map(
  Object.entries(FHIR_REQUIRED_BINDINGS).map(([path, id]) => [
    path,
    // Stryker disable next-line OptionalChaining: every binding names a value set the generated table holds, so the chain never meets an undefined
    new Set(FHIR_REQUIRED_CODE_SETS[id]?.split(" ")),
  ]),
);

/**
 * `true` when a primitive's value, as the text it arrived as, fits the format R4 defines for its type
 * (`type`, as {@link "./element-names.js".fhirElementsOf} gives it: `null` for a string kind), and
 * the format of its element (`element`, `Structure.name`) where R4 defines one beyond its type; and,
 * where R4 binds the element, required, to a value set it defines and carries, the value is one of
 * that set's codes.
 *
 * @internal
 */
export function fitsFhirFormat(
  type: string | null,
  element: string | undefined,
  text: string,
): boolean {
  const format = FORMATS.get(type);
  if (format !== undefined) {
    if (!format.whole.test(text)) return false;
    // An integer kind's text is digits with at most a sign, so it reads as a whole number exactly.
    if (format.min !== undefined && BigInt(text) < format.min) return false;
    if (format.max !== undefined && BigInt(text) > format.max) return false;
  }
  const own = ELEMENT_FORMATS.get(element);
  if (own !== undefined && !own.test(text)) return false;
  const bound = BINDINGS.get(element);
  return bound === undefined || bound.has(text);
}
