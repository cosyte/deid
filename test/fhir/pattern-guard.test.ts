/**
 * A guard on the regular expressions the FHIR adapter runs on a sender's text: none may backtrack
 * without bound.
 *
 * A backtracking engine can take time exponential in the text on a pattern that repeats a group that
 * itself repeats (`(a+)+`, R4's own `base64Binary` pattern `(\s*([0-9a-zA-Z\+/=]){4}\s*)+`). So:
 *
 * - no source under `src/fhir/` builds a pattern at run time (`new RegExp`), since a pattern built
 *   from data cannot be read here, and the R4 patterns in the generated table are checked by scans,
 *   never compiled (`src/fhir/primitive-format.ts` holds no pattern at all);
 * - every pattern written in that source repeats no group that holds a quantifier, unless the group
 *   is optional (at most once), which cannot multiply the ways to read the text, or the pattern is
 *   named below with the reason its repeated group has one reading only (and a long value at its
 *   position is timed in `./primitive-format-linear.test.ts`).
 *
 * It reads the source as text, so the mutation run leaves it out (`vitest.mutation.config.ts`).
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import ts from "typescript";
import { describe, expect, it } from "vitest";

import { FHIR_PRIMITIVE_FORMATS } from "../../src/fhir/generated/primitive-formats.js";

const FHIR_SRC = join(import.meta.dirname, "../../src/fhir");

/** Every TypeScript source under `src/fhir/`, with its path. */
function sources(): { readonly path: string; readonly text: string }[] {
  return readdirSync(FHIR_SRC, { recursive: true, encoding: "utf8" })
    .filter((f) => f.endsWith(".ts"))
    .sort()
    .map((f) => ({ path: f, text: readFileSync(join(FHIR_SRC, f), "utf8") }));
}

/** The body of every regular expression literal in `text`, and every use of the `RegExp` name. */
function patternsIn(text: string): { readonly literals: string[]; readonly constructors: number } {
  const literals: string[] = [];
  let constructors = 0;
  const file = ts.createSourceFile("x.ts", text, ts.ScriptTarget.Latest, true);
  const visit = (node: ts.Node): void => {
    if (ts.isRegularExpressionLiteral(node)) {
      literals.push(node.text.slice(1, node.text.lastIndexOf("/")));
    } else if (ts.isIdentifier(node) && node.text === "RegExp") {
      constructors++;
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return { literals, constructors };
}

/**
 * `true` when `pattern` repeats (more than once) a group that holds a quantifier, at any depth: the
 * shape a backtracking engine can read in exponentially many ways. An escape and a character class
 * are one atom; a group's own prefix (`?:`, `?=`, `?<name>`) and a lazy marker are no quantifier.
 */
export function repeatsAQuantifiedGroup(pattern: string): boolean {
  /** For each open group, whether it holds a quantifier so far. */
  const open: boolean[] = [false];
  let i = 0;
  /** Read a quantifier at `i`, if one is there: its upper bound (1 for `?`), or 0 for none. */
  const quantifier = (): number => {
    const c = pattern[i];
    let max: number;
    if (c === "*" || c === "+") {
      max = Infinity;
      i++;
    } else if (c === "?") {
      max = 1;
      i++;
    } else {
      const m = c === "{" ? /^\{(\d+)(,(\d*))?\}/.exec(pattern.slice(i)) : null;
      if (m === null) return 0;
      max = m[2] === undefined ? Number(m[1]) : m[3] === "" ? Infinity : Number(m[3]);
      i += m[0].length;
    }
    if (pattern[i] === "?") i++; // lazy
    return max;
  };
  while (i < pattern.length) {
    const c = pattern[i];
    if (c === "(") {
      i++;
      if (pattern[i] === "?") {
        i++;
        if (pattern[i] === "<" && pattern[i + 1] !== "=" && pattern[i + 1] !== "!") {
          i = pattern.indexOf(">", i) + 1;
        } else {
          i++;
        }
      }
      open.push(false);
      continue;
    }
    if (c === ")") {
      i++;
      const held = open.pop() ?? false;
      const max = quantifier();
      if (held && max > 1) return true;
      if (held || max > 0) open[open.length - 1] = true;
      continue;
    }
    if (c === "[") {
      i++;
      if (pattern[i] === "^") i++;
      if (pattern[i] === "]") i++;
      while (i < pattern.length && pattern[i] !== "]") i += pattern[i] === "\\" ? 2 : 1;
      i++;
    } else if (c === "\\") {
      i += 2;
    } else {
      i++;
    }
    if (quantifier() > 0) open[open.length - 1] = true;
  }
  return false;
}

/**
 * The patterns that repeat a group holding a quantifier and still read a text one way only, by file,
 * each with the reason.
 */
const ONE_READING: ReadonlyMap<string, string> = new Map([
  [
    "reference.ts " + "^https?:\\/\\/[A-Za-z0-9.-]+(:[0-9]+)?(\\/[A-Za-z0-9._~%!$&'()*+,;=:@-]+)*$",
    "each repeated path segment starts with a `/`, which no segment character matches",
  ],
]);

describe("the patterns the FHIR adapter runs", () => {
  it("the guard finds a repeated group that holds a quantifier, and passes one that does not", () => {
    expect(repeatsAQuantifiedGroup(FHIR_PRIMITIVE_FORMATS.base64Binary.pattern)).toBe(true);
    expect(repeatsAQuantifiedGroup("(a+)+")).toBe(true);
    expect(repeatsAQuantifiedGroup("(?:a|b*)*")).toBe(true);
    expect(repeatsAQuantifiedGroup("(?:(a)?b){2}")).toBe(true);
    expect(repeatsAQuantifiedGroup("(?:x(?:a{2,}))+")).toBe(true);
    expect(repeatsAQuantifiedGroup("^[1-9]\\d{3}$")).toBe(false);
    expect(repeatsAQuantifiedGroup("^(\\d{4})-(\\d{2})(?:-(\\d{2}))?(?:T[\\d:.]+)?$")).toBe(false);
    expect(repeatsAQuantifiedGroup("[(+]+(a)+")).toBe(false);
    expect(repeatsAQuantifiedGroup("\\(a+\\)+")).toBe(false);
    expect(repeatsAQuantifiedGroup("(?<y>a+)?")).toBe(false);
  });

  it("no FHIR source builds a pattern at run time, and the format checks hold none", () => {
    const files = sources();
    expect(files.map((f) => f.path)).toContain("primitive-format.ts");
    for (const { path, text } of files) {
      expect([path, patternsIn(text).constructors]).toEqual([path, 0]);
    }
    const formats = files.find((f) => f.path === "primitive-format.ts");
    expect(patternsIn(formats?.text ?? "").literals).toEqual([]);
  });

  it("no pattern written in a FHIR source repeats a group that holds a quantifier", () => {
    const found = sources().flatMap(({ path, text }) =>
      patternsIn(text).literals.map((pattern) => ({ path, pattern })),
    );
    expect(found.length).toBeGreaterThan(0);
    for (const { path, pattern } of found) {
      const nested = repeatsAQuantifiedGroup(pattern) && !ONE_READING.has(`${path} ${pattern}`);
      expect([path, pattern, nested]).toEqual([path, pattern, false]);
    }
    // Each pattern named as having one reading is still in the source, and still needs naming.
    for (const key of ONE_READING.keys()) {
      expect(found.map(({ path, pattern }) => `${path} ${pattern}`)).toContain(key);
      expect(repeatsAQuantifiedGroup(key.slice(key.indexOf(" ") + 1))).toBe(true);
    }
  });
});
