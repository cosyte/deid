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
 * **No pattern is compiled.** Every value checked here is the sender's text, and a backtracking
 * regular expression engine runs some of R4's patterns in time exponential in the value: the
 * `base64Binary` pattern, `(\s*([0-9a-zA-Z\+/=]){4}\s*)+`, can split each run of white space between
 * two groups in as many ways as the run is long, so a value of a hundred and fifty bytes that fails
 * at its end holds the pass for hours. So each type is checked by a scan written here from its
 * pattern, which reads each character of the value once, and never by the pattern itself. Each scan
 * accepts exactly the text its pattern accepts, as JavaScript reads the pattern (`\s` is every code
 * unit JavaScript's `\s` matches); the tests hold each scan to the pattern in the generated table on
 * every value one edit away from a valid one, and on random values, so a pattern R4 changes fails
 * them until its scan is changed to match.
 *
 * One element is held to more than its type: `SampledData.data`, a `string` that R4 defines in its
 * own words as decimal values, or `E`, `L` and `U`, separated by a single space. Its definition
 * carries no pattern, so its scan is written from those words, with R4's `decimal` format for each
 * value.
 *
 * @packageDocumentation
 * @internal
 */

import {
  FHIR_PRIMITIVE_FORMATS,
  FHIR_REQUIRED_BINDINGS,
  FHIR_REQUIRED_CODE_SETS,
  type FhirFormattedPrimitive,
} from "./generated/primitive-formats.js";

/** What a scan step returns when the text at its place does not fit it. */
const FAIL = -1;

/**
 * One step of a scan: given the text and a place in it, the place just after what the step reads
 * there, or {@link FAIL}. A step reads forward only and never returns to try another reading, so a
 * scan reads each character at most a fixed number of times.
 */
type Step = (text: string, at: number) => number;

/**
 * `true` for a UTF-16 code unit JavaScript's `\s` matches (white space and line terminators, as the
 * language defines them): tab to carriage return, space, no-break space, the Ogham space mark, the
 * en quad to the hair space, the line and paragraph separators, the narrow no-break space, the
 * medium mathematical space, the ideographic space and the byte order mark.
 *
 * @internal
 */
export function isFhirPatternSpace(unit: number): boolean {
  return (
    (unit >= 0x09 && unit <= 0x0d) ||
    unit === 0x20 ||
    unit === 0xa0 ||
    unit === 0x1680 ||
    (unit >= 0x2000 && unit <= 0x200a) ||
    unit === 0x2028 ||
    unit === 0x2029 ||
    unit === 0x202f ||
    unit === 0x205f ||
    unit === 0x3000 ||
    unit === 0xfeff
  );
}

/** A step that reads one code unit `test` accepts. */
function unit(test: (code: number) => boolean): Step {
  return (text, at) => (at < text.length && test(text.charCodeAt(at)) ? at + 1 : FAIL);
}

/** A test for a code unit from `low` to `high`, each given as a one-character string. */
function range(low: string, high: string): (code: number) => boolean {
  const lo = low.charCodeAt(0);
  const hi = high.charCodeAt(0);
  return (code) => code >= lo && code <= hi;
}

/** A step that reads one character from `low` to `high`. */
function within(low: string, high: string): Step {
  return unit(range(low, high));
}

/** A step that reads one of the characters of `chars`. */
function oneOf(chars: string): Step {
  return unit((code) => chars.includes(String.fromCharCode(code)));
}

/** A step that reads `literal`, exactly. */
function literal(literal: string): Step {
  return (text, at) => (text.startsWith(literal, at) ? at + literal.length : FAIL);
}

/** A step that reads each of `steps` in turn. */
function all(...steps: readonly Step[]): Step {
  return (text, at) => {
    let next = at;
    for (const step of steps) {
      next = step(text, next);
      if (next === FAIL) return FAIL;
    }
    return next;
  };
}

/**
 * A step that reads the first of `steps` that fits. Every choice made here is decided by the
 * character it starts at (or, for a zone's hour, the one after), so the first that fits is the only
 * one that could.
 */
function either(...steps: readonly Step[]): Step {
  return (text, at) => {
    for (const step of steps) {
      const next = step(text, at);
      if (next !== FAIL) return next;
    }
    return FAIL;
  };
}

/**
 * A step that reads `step` if it fits there, and nothing otherwise. A part that starts to fit and
 * then does not is read as absent, which leaves its first character for the scan's end check to
 * refuse: in every pattern here that character can start nothing that may follow the part.
 */
function optional(step: Step): Step {
  return (text, at) => {
    const next = step(text, at);
    return next === FAIL ? at : next;
  };
}

/**
 * A step that reads `step` as many times as it fits, at least `min` times and at most `max`, each
 * reading consuming at least one character, as every repeated step here does.
 */
function repeat(step: Step, min: number, max = Infinity): Step {
  return (text, at) => {
    let next = at;
    let count = 0;
    while (count < max) {
      const after = step(text, next);
      if (after === FAIL) break;
      next = after;
      count++;
    }
    return count < min ? FAIL : next;
  };
}

/** One digit, `[0-9]`. */
const DIGIT = within("0", "9");

/** One white space code unit, `\s`. */
const SPACE = unit(isFhirPatternSpace);

/** One code unit that is not white space, `[^\s]` (or `\S`). */
const NOT_SPACE = unit((code) => !isFhirPatternSpace(code));

/**
 * A step that reads two characters, the first from `rule[0]` to `rule[1]` and the second from
 * `rule[2]` to `rule[3]`, for one of `rules`: `"0019"` reads `0[1-9]`.
 */
function pair(...rules: readonly string[]): Step {
  return either(
    ...rules.map((r) => all(within(r.charAt(0), r.charAt(1)), within(r.charAt(2), r.charAt(3)))),
  );
}

/** Four digits. */
const FOUR_DIGITS = repeat(DIGIT, 4, 4);

/**
 * R4's year, `([0-9]([0-9]([0-9][1-9]|[1-9]0)|[1-9]00)|[1-9]000)`: four digits, but not `0000`
 * (the last digit that is not 0, whichever it is, is what each branch of the pattern requires).
 */
const YEAR: Step = (text, at) => (text.startsWith("0000", at) ? FAIL : FOUR_DIGITS(text, at));

/** `(0[1-9]|1[0-2])`. */
const MONTH = pair("0019", "1102");

/** `(0[1-9]|[1-2][0-9]|3[0-1])`. */
const DAY = pair("0019", "1209", "3301");

/** `[0-5][0-9]`. */
const MINUTE = pair("0509");

/** `([01][0-9]|2[0-3]):[0-5][0-9]:([0-5][0-9]|60)(\.[0-9]+)?`, R4's `time`. */
const CLOCK = all(
  pair("0109", "2203"),
  literal(":"),
  MINUTE,
  literal(":"),
  pair("0509", "6600"),
  optional(all(literal("."), repeat(DIGIT, 1))),
);

/** `(Z|(\+|-)((0[0-9]|1[0-3]):[0-5][0-9]|14:00))`, a zone. */
const ZONE = either(
  literal("Z"),
  all(oneOf("+-"), either(all(pair("0009", "1103"), literal(":"), MINUTE), literal("14:00"))),
);

/** `(0|[1-9][0-9]*)`, a whole number with no leading zero. */
const WHOLE = either(literal("0"), all(within("1", "9"), repeat(DIGIT, 0)));

/** `-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?`, R4's `decimal`. */
const DECIMAL = all(
  optional(literal("-")),
  WHOLE,
  optional(all(literal("."), repeat(DIGIT, 1))),
  optional(all(oneOf("eE"), optional(oneOf("+-")), repeat(DIGIT, 1))),
);

/** `[0-9a-f]`, a lower-case hexadecimal digit. */
const HEX = either(DIGIT, within("a", "f"));

/** `\S*`, R4's `uri`, `url` and `canonical`. */
const NO_SPACE = repeat(NOT_SPACE, 0);

/**
 * The scan for each primitive type R4 constrains further than a JSON string, each read from the
 * pattern of the type in the generated table (quoted beside it). The record is keyed by the table's
 * own type, so a type the table gains has no scan until one is written, and the build fails.
 */
const SCANS: Readonly<Record<FhirFormattedPrimitive, Step>> = {
  // `(\s*([0-9a-zA-Z\+/=]){4}\s*)+`: white space, then one or more groups of four characters of the
  // alphabet, each followed by white space. White space between two groups belongs to one of them,
  // whichever, so it is read once, after the group before it.
  base64Binary: all(
    repeat(SPACE, 0),
    repeat(
      all(
        repeat(either(DIGIT, within("a", "z"), within("A", "Z"), oneOf("+/=")), 4, 4),
        repeat(SPACE, 0),
      ),
      1,
    ),
  ),
  // `true|false`.
  boolean: either(literal("true"), literal("false")),
  // `\S*`.
  canonical: NO_SPACE,
  // `[^\s]+(\s[^\s]+)*`: words with no white space, one white space code unit between two.
  code: all(repeat(NOT_SPACE, 1), repeat(all(SPACE, repeat(NOT_SPACE, 1)), 0)),
  // `YEAR(-MONTH(-DAY)?)?`.
  date: all(YEAR, optional(all(literal("-"), MONTH, optional(all(literal("-"), DAY))))),
  // `YEAR(-MONTH(-DAY(Ttime ZONE)?)?)?`.
  dateTime: all(
    YEAR,
    optional(
      all(
        literal("-"),
        MONTH,
        optional(all(literal("-"), DAY, optional(all(literal("T"), CLOCK, ZONE)))),
      ),
    ),
  ),
  // `-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?`.
  decimal: DECIMAL,
  // `[A-Za-z0-9\-\.]{1,64}`.
  id: repeat(either(within("A", "Z"), within("a", "z"), DIGIT, oneOf("-.")), 1, 64),
  // `YEAR-MONTH-DAYTtime ZONE`.
  instant: all(YEAR, literal("-"), MONTH, literal("-"), DAY, literal("T"), CLOCK, ZONE),
  // `-?([0]|([1-9][0-9]*))`.
  integer: all(optional(literal("-")), WHOLE),
  // `urn:oid:[0-2](\.(0|[1-9][0-9]*))+`.
  oid: all(literal("urn:oid:"), within("0", "2"), repeat(all(literal("."), WHOLE), 1)),
  // `[1-9][0-9]*`.
  positiveInt: all(within("1", "9"), repeat(DIGIT, 0)),
  // `([01][0-9]|2[0-3]):[0-5][0-9]:([0-5][0-9]|60)(\.[0-9]+)?`.
  time: CLOCK,
  // `[0]|([1-9][0-9]*)`.
  unsignedInt: WHOLE,
  // `\S*`.
  uri: NO_SPACE,
  // `\S*`.
  url: NO_SPACE,
  // `urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}`.
  uuid: all(
    literal("urn:uuid:"),
    repeat(HEX, 8, 8),
    literal("-"),
    repeat(HEX, 4, 4),
    literal("-"),
    repeat(HEX, 4, 4),
    literal("-"),
    repeat(HEX, 4, 4),
    literal("-"),
    repeat(HEX, 12, 12),
  ),
};

/** `true` when `step` reads the whole of `text`. */
function reads(step: Step, text: string): boolean {
  return step(text, 0) === text.length;
}

/** One primitive type's format: its scan and, for an integer kind, its range. */
interface Format {
  readonly scan: Step;
  readonly min?: bigint;
  readonly max?: bigint;
  /**
   * For an integer kind, the most characters a value in its range can hold. Its pattern admits no
   * leading zero, so a longer value is out of range, and it is refused before it is read as a number.
   */
  readonly longest?: number;
}

/** Every primitive type R4 constrains further than a JSON string, by its type code. */
const FORMATS: ReadonlyMap<string | null, Format> = new Map(
  (Object.keys(SCANS) as FhirFormattedPrimitive[]).map((type) => {
    const f = FHIR_PRIMITIVE_FORMATS[type];
    const bounds =
      // Stryker disable next-line ConditionalExpression,LogicalOperator: the table gives an integer kind both ends of its range and every other type neither, so either test alone decides the same
      f.min === undefined || f.max === undefined
        ? {}
        : {
            min: BigInt(f.min),
            max: BigInt(f.max),
            longest: Math.max(String(f.min).length, String(f.max).length),
          };
    return [type, { scan: SCANS[type], ...bounds }];
  }),
);

/**
 * `SampledData.data`: decimal values, or `E`, `L` and `U`, separated by a single space (the R4
 * definition of the element). Each value is read by the `decimal` scan, so the whole is read once.
 */
function fitsSampledData(text: string): boolean {
  return text
    .split(" ")
    .every((point) => point === "E" || point === "L" || point === "U" || reads(DECIMAL, point));
}

/**
 * The elements held to a format beyond their type's, by path: `SampledData.data` (the R4 definition
 * of the element).
 */
const ELEMENT_FORMATS: ReadonlyMap<string | undefined, (text: string) => boolean> = new Map([
  ["SampledData.data", fitsSampledData],
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
 * that set's codes. It reads the value in time linear in its length, whatever the value holds.
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
    // Stryker disable next-line ConditionalExpression: a value longer than this is out of range, which the range check below finds too; this only spares reading a long value as a number
    if (format.longest !== undefined && text.length > format.longest) return false;
    if (!reads(format.scan, text)) return false;
    // An integer kind's text is digits with at most a sign, so it reads as a whole number exactly.
    if (format.min !== undefined && BigInt(text) < format.min) return false;
    if (format.max !== undefined && BigInt(text) > format.max) return false;
  }
  const own = ELEMENT_FORMATS.get(element);
  if (own !== undefined && !own(text)) return false;
  const bound = BINDINGS.get(element);
  return bound === undefined || bound.has(text);
}
