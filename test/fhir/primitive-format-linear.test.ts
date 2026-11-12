/**
 * Every FHIR primitive format check reads the value in time linear in its length, and accepts
 * exactly what R4's pattern for the type accepts.
 *
 * The values checked are the sender's text, so a check that runs a backtracking pattern can be held
 * for hours by a short value built to fail at its end: R4's `base64Binary` pattern,
 * `(\s*([0-9a-zA-Z\+/=]){4}\s*)+`, run as written, took seconds on a hundred bytes of
 * `"AAAA  "` groups ending in `!`, three times longer for every six bytes more. So each type is
 * checked by a scan (`src/fhir/primitive-format.ts`), and here:
 *
 * - a long value of each type (64 KiB) built to fail at its end, at a real position and in a choice
 *   element, under Safe Harbor and the Limited Data Set, is blocked within a small time bound, and
 *   so is the short `base64Binary` value that held the pattern for seconds;
 * - each scan is held to the pattern in the generated table, run as a regular expression on short
 *   values only: on every value one edit away from a valid one, and on random values;
 * - the white space a scan reads is exactly what JavaScript's `\s` matches, on every code unit.
 *
 * Every value here is synthetic: runs of one letter or digit, made-up dates and example codes.
 */

import { describe, expect, it } from "vitest";
import fc from "fast-check";

import {
  createDeidContext,
  LIMITED_DATA_SET_PROFILE,
  profileOptions,
  SAFE_HARBOR_PROFILE,
} from "../../src/index.js";
import { deidentifyFhirJson } from "../../src/fhir/index.js";
import { fitsFhirFormat, isFhirPatternSpace } from "../../src/fhir/primitive-format.js";
import {
  FHIR_PRIMITIVE_FORMATS,
  type FhirFormattedPrimitive,
} from "../../src/fhir/generated/primitive-formats.js";
import { checkProperty } from "../helpers/property.js";

const ctx = createDeidContext({ key: "primitive-format-linear-synthetic", patientId: "p" });

const PROFILES = [
  ["Safe Harbor", SAFE_HARBOR_PROFILE],
  ["the Limited Data Set", LIMITED_DATA_SET_PROFILE],
] as const;

/**
 * The most a pass over one of these documents may take. A linear check of 64 KiB takes a few
 * milliseconds; the pattern it replaces took seconds on a hundred bytes and grows threefold every six
 * bytes, so the bound is generous for a slow runner and still far below any backtracking reading.
 */
const BOUND_MS = 1000;

/** The length of each long value. */
const BIG = 64 * 1024;

/** A document with one `Parameters.parameter` holding `value` (JSON text) under `key`. */
function parameter(key: string, value: string): string {
  return `{"resourceType":"Parameters","parameter":[{"name":"zz","${key}":${value}}]}`;
}

/** A JSON string of `text`. */
const str = (text: string): string => JSON.stringify(text);

/** A long failing value at each kind of position: the label, the document, and the blocked locus. */
const LONG_MISFITS: readonly (readonly [string, string, string])[] = [
  [
    "base64Binary, Attachment.data",
    JSON.stringify({
      resourceType: "DocumentReference",
      status: "current",
      content: [
        { attachment: { contentType: "text/plain", data: `${"AAAA  ".repeat(BIG / 6)}!` } },
      ],
    }),
    "DocumentReference.content[0].attachment.data",
  ],
  [
    "base64Binary, Binary.data, a line break between groups",
    JSON.stringify({
      resourceType: "Binary",
      contentType: "text/plain",
      data: `${"AAAA\n".repeat(BIG / 5)}A`,
    }),
    "Binary.data",
  ],
  [
    "base64Binary, a choice element",
    parameter("valueBase64Binary", str(`${"AAAA \t ".repeat(BIG / 7)}=`)),
    "Parameters.parameter[0].valueBase64Binary",
  ],
  [
    "boolean, a string where a boolean belongs",
    parameter("valueBoolean", str("true ".repeat(BIG / 5))),
    "Parameters.parameter[0].valueBoolean",
  ],
  [
    "canonical",
    parameter("valueCanonical", str(`${"a".repeat(BIG)} `)),
    "Parameters.parameter[0].valueCanonical",
  ],
  [
    "code, Coding.code",
    JSON.stringify({
      resourceType: "Observation",
      status: "final",
      code: { coding: [{ system: "http://example.org/zz", code: `${"a ".repeat(BIG / 2)} ` }] },
    }),
    "Observation.code.coding[0].code",
  ],
  [
    "code, a required binding",
    JSON.stringify({ resourceType: "Encounter", status: "a".repeat(BIG), class: { code: "x" } }),
    "Encounter.status",
  ],
  [
    "date",
    parameter("valueDate", str(`2019-01-0${"1".repeat(BIG)}`)),
    "Parameters.parameter[0].valueDate",
  ],
  [
    "dateTime, Observation.effectiveDateTime",
    JSON.stringify({
      resourceType: "Observation",
      status: "final",
      effectiveDateTime: `2019-01-01T10:00:00.${"1".repeat(BIG)}x`,
    }),
    "Observation.effectiveDateTime",
  ],
  [
    "decimal, SampledData.data",
    JSON.stringify({
      resourceType: "Observation",
      status: "final",
      valueSampledData: {
        origin: { value: 1 },
        period: 1,
        dimensions: 1,
        data: `${"1.5 ".repeat(BIG / 4)}x`,
      },
    }),
    "Observation.valueSampledData.data",
  ],
  [
    "id, meta.versionId",
    JSON.stringify({
      resourceType: "Observation",
      status: "final",
      meta: { versionId: "a".repeat(BIG) },
    }),
    "Observation.meta.versionId",
  ],
  [
    "instant, Observation.issued",
    JSON.stringify({
      resourceType: "Observation",
      status: "final",
      issued: `2019-01-01T10:00:00.${"1".repeat(BIG)}+14:0x`,
    }),
    "Observation.issued",
  ],
  [
    "integer, past its range",
    parameter("valueInteger", "1".repeat(BIG)),
    "Parameters.parameter[0].valueInteger",
  ],
  [
    "oid",
    parameter("valueOid", str(`urn:oid:1${".1".repeat(BIG / 2)}.`)),
    "Parameters.parameter[0].valueOid",
  ],
  [
    "positiveInt, a sign",
    parameter("valuePositiveInt", `-${"1".repeat(BIG)}`),
    "Parameters.parameter[0].valuePositiveInt",
  ],
  [
    "time",
    parameter("valueTime", str(`10:00:00.${"1".repeat(BIG)}x`)),
    "Parameters.parameter[0].valueTime",
  ],
  [
    "unsignedInt, past its range",
    parameter("valueUnsignedInt", "1".repeat(BIG)),
    "Parameters.parameter[0].valueUnsignedInt",
  ],
  ["uri", parameter("valueUri", str(`${"a".repeat(BIG)} `)), "Parameters.parameter[0].valueUri"],
  ["url", parameter("valueUrl", str(`${"a".repeat(BIG)} `)), "Parameters.parameter[0].valueUrl"],
  [
    "uuid",
    parameter("valueUuid", str(`urn:uuid:${"a".repeat(BIG)}`)),
    "Parameters.parameter[0].valueUuid",
  ],
  [
    "a reference URL, Reference.reference",
    JSON.stringify({
      resourceType: "Observation",
      status: "final",
      subject: { reference: `http://example.org${"/a".repeat(BIG / 2)} ` },
    }),
    "Observation.subject.reference",
  ],
  [
    "uri, an extension's url",
    JSON.stringify({
      resourceType: "Observation",
      status: "final",
      extension: [{ url: `${"a".repeat(BIG)} `, valueString: "x" }],
    }),
    "Observation.extension[0].url",
  ],
];

/** Run the pass on `json` and return how long it took and the result. */
function timed(json: string, profile: (typeof PROFILES)[number][1]) {
  const start = performance.now();
  const result = deidentifyFhirJson(json, profileOptions(profile, ctx));
  return { ms: performance.now() - start, result };
}

describe("a value that does not fit its type is decided in time linear in its length", () => {
  it.each(PROFILES)(
    "a short base64Binary that held R4's pattern for seconds is blocked at once, under %s",
    (_name, profile) => {
      // Seventeen groups of four with two spaces after each, then a character outside the alphabet.
      const data = `${"AAAA  ".repeat(17)}!`;
      const json = JSON.stringify({
        resourceType: "DocumentReference",
        status: "current",
        content: [{ attachment: { contentType: "text/plain", data } }],
      });
      const { ms, result } = timed(json, profile);
      expect(ms).toBeLessThan(BOUND_MS);
      expect(result.manifest).toContainEqual(
        expect.objectContaining({
          locus: "DocumentReference.content[0].attachment.data",
          disposition: "blocked",
        }),
      );
      expect(result.json).not.toContain("AAAA");
    },
  );

  for (const [name, profile] of PROFILES) {
    it.each(LONG_MISFITS)(`%s, 64 KiB, under ${name}`, (_what, json, locus) => {
      const { ms, result } = timed(json, profile);
      expect(ms).toBeLessThan(BOUND_MS);
      expect(result.manifest).toContainEqual(
        expect.objectContaining({ locus, disposition: "blocked" }),
      );
    });
  }

  it("a long decimal, which JSON cannot write unfitting, is read in time too", () => {
    const { ms, result } = timed(
      parameter("valueDecimal", `${"1".repeat(BIG)}.5e-3`),
      SAFE_HARBOR_PROFILE,
    );
    expect(ms).toBeLessThan(BOUND_MS);
    expect(
      result.manifest.some((row) => row.locus === "Parameters.parameter[0].valueDecimal"),
    ).toBe(false);
  });
});

/** R4's pattern for `type`, compiled as the whole value, with its range: the reference a scan meets. */
function byPattern(type: FhirFormattedPrimitive, text: string): boolean {
  const format = FHIR_PRIMITIVE_FORMATS[type];
  if (!new RegExp(`^(?:${format.pattern})$`).test(text)) return false;
  if (format.min !== undefined && BigInt(text) < BigInt(format.min)) return false;
  return format.max === undefined || BigInt(text) <= BigInt(format.max);
}

/**
 * `SampledData.data` as its R4 definition words it, compiled: decimal values, or `E`, `L` and `U`,
 * separated by a single space.
 */
function sampledByPattern(text: string): boolean {
  const point = `(?:${FHIR_PRIMITIVE_FORMATS.decimal.pattern}|E|L|U)`;
  return new RegExp(`^(?:${point}(?: ${point})*)$`).test(text);
}

/** Valid values of each type, the edits of which are compared. */
const VALID: Readonly<Record<FhirFormattedPrimitive, readonly string[]>> = {
  base64Binary: ["AAAA", " QUJD\tZA== ", "ab+/ =9Zz"],
  boolean: ["true", "false"],
  canonical: ["http://example.org/zz|1.0", "urn:x#a"],
  code: ["a b", "in-progress", "a\tb c"],
  date: ["2019", "2019-03", "2019-03-14", "0001-12-31", "1000-10-29", "0010-01-01", "0100-01-01"],
  dateTime: [
    "2019-03-14T10:20:30Z",
    "2019-03-14T23:59:60.123+14:00",
    "2019-03-14T00:00:00-13:59",
    "2019-03-14T19:09:09+09:30",
    "2019",
  ],
  decimal: ["0", "-1.50", "12e-3", "1.0E+10", "90"],
  id: ["a-Z.9", "x".repeat(64)],
  instant: ["2019-03-14T10:20:30.5Z", "2019-12-31T20:59:59+09:30"],
  integer: ["0", "-12", "2147483647", "-2147483648", "-2147483649", "2147483648"],
  oid: ["urn:oid:1.2.840.10008", "urn:oid:2.0", "urn:oid:0.9.10"],
  positiveInt: ["1", "2147483647", "90"],
  time: ["00:00:00", "23:59:60.25", "19:09:59"],
  unsignedInt: ["0", "10", "2147483647"],
  uri: ["http://example.org/a?b=c", "urn:zz"],
  url: ["http://example.org/a"],
  uuid: ["urn:uuid:0a1b2c3d-4e5f-6789-abcd-ef0123456789"],
};

/** The characters an edit writes: each type's own, each one past the end of a range, and white space. */
const EDIT_CHARS = [..."0123456789/:@AFGZ[`afgz{-.+=|TEeLUxr ", " ", "\t", "\n", " "];

/** Every value one edit away from `text`: a character inserted, removed, or replaced. */
function oneEditAway(text: string): string[] {
  const out: string[] = [text];
  for (let i = 0; i <= text.length; i++) {
    for (const c of EDIT_CHARS) {
      out.push(text.slice(0, i) + c + text.slice(i));
      if (i < text.length) out.push(text.slice(0, i) + c + text.slice(i + 1));
    }
    if (i < text.length) out.push(text.slice(0, i) + text.slice(i + 1));
  }
  return out;
}

const TYPES = Object.keys(FHIR_PRIMITIVE_FORMATS) as FhirFormattedPrimitive[];

describe("each scan accepts exactly what R4's pattern for its type accepts", () => {
  it("the scans cover every type the generated table holds, and the table's patterns are R4's", () => {
    expect(Object.keys(VALID).sort()).toEqual([...TYPES].sort());
    // The pattern each scan was written from; a change in the published definitions fails here first.
    expect(Object.fromEntries(TYPES.map((t) => [t, FHIR_PRIMITIVE_FORMATS[t].pattern]))).toEqual({
      base64Binary: "(\\s*([0-9a-zA-Z\\+/=]){4}\\s*)+",
      boolean: "true|false",
      canonical: "\\S*",
      code: "[^\\s]+(\\s[^\\s]+)*",
      date: "([0-9]([0-9]([0-9][1-9]|[1-9]0)|[1-9]00)|[1-9]000)(-(0[1-9]|1[0-2])(-(0[1-9]|[1-2][0-9]|3[0-1]))?)?",
      dateTime:
        "([0-9]([0-9]([0-9][1-9]|[1-9]0)|[1-9]00)|[1-9]000)(-(0[1-9]|1[0-2])(-(0[1-9]|[1-2][0-9]|3[0-1])(T([01][0-9]|2[0-3]):[0-5][0-9]:([0-5][0-9]|60)(\\.[0-9]+)?(Z|(\\+|-)((0[0-9]|1[0-3]):[0-5][0-9]|14:00)))?)?)?",
      decimal: "-?(0|[1-9][0-9]*)(\\.[0-9]+)?([eE][+-]?[0-9]+)?",
      id: "[A-Za-z0-9\\-\\.]{1,64}",
      instant:
        "([0-9]([0-9]([0-9][1-9]|[1-9]0)|[1-9]00)|[1-9]000)-(0[1-9]|1[0-2])-(0[1-9]|[1-2][0-9]|3[0-1])T([01][0-9]|2[0-3]):[0-5][0-9]:([0-5][0-9]|60)(\\.[0-9]+)?(Z|(\\+|-)((0[0-9]|1[0-3]):[0-5][0-9]|14:00))",
      integer: "-?([0]|([1-9][0-9]*))",
      oid: "urn:oid:[0-2](\\.(0|[1-9][0-9]*))+",
      positiveInt: "[1-9][0-9]*",
      time: "([01][0-9]|2[0-3]):[0-5][0-9]:([0-5][0-9]|60)(\\.[0-9]+)?",
      unsignedInt: "[0]|([1-9][0-9]*)",
      uri: "\\S*",
      url: "\\S*",
      uuid: "urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}",
    });
  });

  it.each(TYPES)("%s, on every value one edit away from a valid one", (type) => {
    for (const valid of VALID[type]) {
      for (const text of oneEditAway(valid)) {
        expect([type, text, fitsFhirFormat(type, undefined, text)]).toEqual([
          type,
          text,
          byPattern(type, text),
        ]);
      }
    }
  });

  it("every type, on values whose first part is missing and a later part fits from the start", () => {
    // A scan must stop at the first part that does not fit, never read the next part from the start.
    const texts = [
      "-01",
      "-01-01",
      "-01-01T10:00:00Z",
      ":00:00",
      ":00:00.5",
      "T10:00:00Z",
      ".1",
      "-",
      "e5",
      ":",
      "urn:oid:.1",
      "urn:uuid:-",
      "",
      " ",
    ];
    for (const type of TYPES) {
      for (const text of texts) {
        expect([type, text, fitsFhirFormat(type, undefined, text)]).toEqual([
          type,
          text,
          byPattern(type, text),
        ]);
      }
    }
  });

  it("SampledData.data, on every value one edit away from a valid one", () => {
    for (const valid of ["1 E -2.5e3 L U 0", "0.5", "E"]) {
      for (const text of oneEditAway(valid)) {
        expect([text, fitsFhirFormat(null, "SampledData.data", text)]).toEqual([
          text,
          sampledByPattern(text),
        ]);
      }
    }
  });

  it("every type, and SampledData.data, on random short values", () => {
    const text = fc.oneof(
      fc.string({ unit: fc.constantFrom(...EDIT_CHARS), maxLength: 24 }),
      fc
        .tuple(
          fc.constantFrom(...Object.values(VALID).flat(), "1 E -2.5e3 L U 0"),
          fc.array(fc.tuple(fc.nat(), fc.constantFrom(...EDIT_CHARS), fc.nat(2)), { maxLength: 4 }),
        )
        .map(([valid, edits]) =>
          edits.reduce((s, [at, c, kind]) => {
            const i = at % (s.length + 1);
            if (kind === 0) return s.slice(0, i) + c + s.slice(i);
            if (kind === 1) return s.slice(0, i) + c + s.slice(i + 1);
            return s.slice(0, i) + s.slice(i + 1);
          }, valid),
        ),
    );
    checkProperty(
      "each FHIR primitive scan accepts what its R4 pattern accepts",
      fc.property(text, (t) => {
        for (const type of TYPES) {
          expect([type, t, fitsFhirFormat(type, undefined, t)]).toEqual([
            type,
            t,
            byPattern(type, t),
          ]);
        }
        expect([t, fitsFhirFormat(null, "SampledData.data", t)]).toEqual([t, sampledByPattern(t)]);
      }),
    );
  });

  it("white space is exactly what JavaScript's \\s matches, on every code unit", () => {
    const space = /\s/;
    for (let unit = 0; unit <= 0xffff; unit++) {
      const c = String.fromCharCode(unit);
      expect([unit, isFhirPatternSpace(unit)]).toEqual([unit, space.test(c)]);
    }
  });
});
