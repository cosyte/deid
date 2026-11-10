import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, normalize } from "node:path";

import ts from "typescript";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { docSnippetSuite } from "@cosyte/vitest-config/snippets";

import {
  DEID_DISPOSITION_CODES,
  FATAL_CODES,
  KEYED_TRANSFORMS,
  LIMITED_DATA_SET_PROFILE,
  SAFE_HARBOR_CATEGORIES,
  SAFE_HARBOR_CATEGORY_META,
  SAFE_HARBOR_POLICY,
  type TransformName,
} from "../src/index.js";

/**
 * Doc/code-agreement gate for `docs-content/`.
 *
 * Every TypeScript sample on a hand-written page is extracted and executed against the built
 * package, and its inline `// =>` assertions are checked, so a documented example cannot drift from
 * the shipped code. Blocks tagged ` ```ts runnable throws ` must throw. A sample that cannot run says
 * why in its fence (` ```ts no-run <reason> `), and a case below refuses a sample that does neither.
 * The runner strips types without checking them, so a second case compiles every sample against the
 * package's built declarations, the way a reader's project would.
 *
 * The pages under `docs-content/api/` are generated from the TSDoc comments in `src/`, and their
 * `@example` blocks are fragments written for an editor's tooltip, so they are not part of this
 * suite: only the top-level pages are passed in.
 *
 * Snippets import the package the way a consumer does: against the **built** artifact, not the
 * source tree. The harness executes each block as a standalone ES module, so it cannot resolve the
 * source's internal `.js` to `.ts` imports; the bundled `dist/` entry points are self-contained and
 * are exactly what an installer loads. The shared CI gate runs `test` before `build`, so `dist/` is
 * built here on demand rather than assumed.
 *
 * The cases after the samples hold the pages to the package in two more ways: every link between
 * pages, and into the generated reference, resolves to a page and a heading on it; and the reference
 * page of codes and categories lists exactly what the source exports.
 */
const root = join(import.meta.dirname, "..");
const docsDir = join(root, "docs-content");

/** Each published entry point, mapped to the built module a consumer's import loads. */
const ENTRY_POINTS: Readonly<Record<string, string>> = {
  "@cosyte/deid": join(root, "dist", "index.mjs"),
  "@cosyte/deid/hl7": join(root, "dist", "hl7", "index.mjs"),
  "@cosyte/deid/ccda": join(root, "dist", "ccda", "index.mjs"),
  "@cosyte/deid/fhir": join(root, "dist", "fhir", "index.mjs"),
  "@cosyte/deid/x12": join(root, "dist", "x12", "index.mjs"),
  "@cosyte/deid/ncpdp": join(root, "dist", "ncpdp", "index.mjs"),
  "@cosyte/deid/dicom": join(root, "dist", "dicom", "index.mjs"),
};
const resolve = (specifier: string): string | undefined => ENTRY_POINTS[specifier];

beforeAll(() => {
  execFileSync("pnpm", ["build"], { cwd: root, stdio: "inherit" });
}, 120_000);

/** The hand-written pages: every `.md` file at the top of `docs-content/`, not the generated `api/`. */
const pages = readdirSync(docsDir)
  .filter((name) => name.endsWith(".md"))
  .sort()
  .map((name) => join(docsDir, name));

/**
 * `every` runs each TypeScript and JavaScript sample whether or not it is tagged `runnable`, and
 * lists a `no-run` sample as skipped with its reason. It reaches the runner as a variable rather
 * than a literal so the line compiles against a `@cosyte/vitest-config` that predates the option;
 * such a runner ignores it and runs the `runnable` blocks, which is every sample that can run here,
 * as the first case below holds.
 */
const suiteOptions = { files: pages, every: true, resolve, requireSnippet: true };
docSnippetSuite(suiteOptions);

/** One fenced code block: its info string split into language and tags, its body and its line. */
interface Fence {
  readonly lang: string;
  readonly tags: readonly string[];
  readonly body: string;
  /** The markdown line of the block's first code line, counted from 1. */
  readonly line: number;
}

/** Every fenced block in a page, in document order. */
function fences(markdown: string): Fence[] {
  const out: Fence[] = [];
  let open: { marker: string; lang: string; tags: string[]; line: number } | undefined;
  let buf: string[] = [];
  markdown.split("\n").forEach((line, index) => {
    if (open === undefined) {
      const opened = /^(`{3,}|~{3,})\s*(.*)$/.exec(line);
      if (opened !== null) {
        const tokens = (opened[2] ?? "").trim().split(/\s+/).filter(Boolean);
        open = {
          marker: opened[1] ?? "```",
          lang: tokens[0] ?? "",
          tags: tokens.slice(1),
          line: index + 2,
        };
        buf = [];
      }
      return;
    }
    if (line.trimEnd() === open.marker) {
      out.push({ lang: open.lang, tags: open.tags, body: buf.join("\n"), line: open.line });
      open = undefined;
      return;
    }
    buf.push(line);
  });
  if (open !== undefined) throw new Error("unterminated code fence");
  return out;
}

/** The fence languages that make a block a code sample. */
const SAMPLE_LANGS = new Set(["ts", "typescript", "tsx", "js", "javascript", "mjs"]);
const TS_LANGS = new Set(["ts", "typescript", "tsx"]);

/** The words after a tag in a fence, or `undefined` when the fence does not carry the tag. */
function reasonAfter(fence: Fence, tag: string): string | undefined {
  const at = fence.tags.indexOf(tag);
  return at === -1 ? undefined : fence.tags.slice(at + 1).join(" ");
}

interface PageSample {
  readonly page: string;
  readonly fence: Fence;
}

const samples: PageSample[] = pages.flatMap((path) =>
  fences(readFileSync(path, "utf8"))
    .filter((fence) => SAMPLE_LANGS.has(fence.lang))
    .map((fence) => ({ page: path.slice(docsDir.length + 1), fence })),
);

describe("every sample on a hand-written page", () => {
  it("runs, or names in its fence why it cannot", () => {
    const unaccounted = samples
      .filter(({ fence }) => {
        const noRun = reasonAfter(fence, "no-run");
        return fence.tags.includes("runnable") ? noRun !== undefined : (noRun ?? "") === "";
      })
      .map(
        ({ page, fence }) => `${page}:${String(fence.line)}: ${fence.lang} ${fence.tags.join(" ")}`,
      );
    expect(unaccounted).toEqual([]);
  });

  /** Where the samples are written to be compiled: inside the root, so the package name resolves. */
  const typecheckDir = join(root, ".cosyte-doc-typecheck");
  afterAll(() => {
    rmSync(typecheckDir, { recursive: true, force: true });
  });

  it(
    "type-checks against the package's built declarations, as a reader's project compiles it",
    { timeout: 120_000 },
    () => {
      const checked = samples.filter(
        ({ fence }) =>
          TS_LANGS.has(fence.lang) &&
          reasonAfter(fence, "no-run") === undefined &&
          reasonAfter(fence, "no-typecheck") === undefined,
      );
      expect(checked.length).toBeGreaterThan(0);
      const parsed = ts.getParsedCommandLineOfConfigFile(join(root, "tsconfig.json"), undefined, {
        ...ts.sys,
        onUnRecoverableConfigFileDiagnostic: (d) => {
          throw new Error(ts.flattenDiagnosticMessageText(d.messageText, " "));
        },
      });
      if (parsed === undefined) throw new Error("tsconfig.json could not be read");
      // The repository's own options, with emit and the unused-name checks off: a sample may
      // declare a name only to show it. The package's name resolves through its `exports` to the
      // built declarations, which is what a reader installs.
      const options: ts.CompilerOptions = {
        ...parsed.options,
        noEmit: true,
        noUnusedLocals: false,
        noUnusedParameters: false,
        moduleDetection: ts.ModuleDetectionKind.Force,
      };
      // With an output folder set, TypeScript maps the package's `exports` back to its source;
      // a sample imports what the package publishes, so neither folder applies.
      delete options.outDir;
      delete options.rootDir;
      rmSync(typecheckDir, { recursive: true, force: true });
      mkdirSync(typecheckDir, { recursive: true });
      const files = checked.map(({ fence }, index) => {
        const file = join(typecheckDir, `sample-${String(index)}.ts`);
        writeFileSync(file, fence.body, "utf8");
        return file;
      });
      const program = ts.createProgram({ rootNames: files, options });
      const errors = files.flatMap((file, index) => {
        const sample = checked[index];
        return ts.getPreEmitDiagnostics(program, program.getSourceFile(file)).map((d) => {
          const line = d.file?.getLineAndCharacterOfPosition(d.start ?? 0).line ?? 0;
          const text = ts.flattenDiagnosticMessageText(d.messageText, " ");
          const at = (sample?.fence.line ?? 0) + line;
          return `${sample?.page ?? file}:${String(at)}: TS${String(d.code)} ${text}`;
        });
      });
      expect(errors).toEqual([]);
    },
  );
});

/**
 * The anchor the docs site gives a heading: its text (a code span read as its content, a link as
 * its text, a backslash escape as the character) in lower case, with every character that is not a
 * letter, a mark, a digit, an underscore, a space or a hyphen dropped, and each space turned into a
 * hyphen. That is how the site's markdown loader slugs a heading.
 */
function slug(heading: string): string {
  return heading
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\\(.)/g, "$1")
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}_ -]/gu, "")
    .replace(/ /g, "-");
}

/**
 * Every anchor a page offers: one per ATX heading outside fenced code, a repeated slug taking `-1`,
 * `-2` in page order, plus every explicit `<a id="...">`.
 */
function anchorsIn(markdown: string): Set<string> {
  const anchors = new Set<string>();
  const seen = new Map<string, number>();
  let fence: string | undefined;
  for (const line of markdown.split(/\r?\n/)) {
    const marker = /^(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker !== undefined) {
      if (fence === undefined) fence = marker;
      else if (line.trimEnd() === fence) fence = undefined;
      continue;
    }
    if (fence !== undefined) continue;
    const heading = /^#{1,6}\s+(.*?)\s*#*\s*$/.exec(line);
    if (heading !== null) {
      const base = slug(heading[1] ?? "");
      const count = seen.get(base) ?? 0;
      seen.set(base, count + 1);
      anchors.add(count === 0 ? base : `${base}-${String(count)}`);
    }
    for (const explicit of line.matchAll(/<a id="([^"]+)"/g)) anchors.add(explicit[1] ?? "");
  }
  return anchors;
}

/** Every inline link target on a page, outside fenced code and code spans, with its line. */
function linksIn(markdown: string): { target: string; line: number }[] {
  const out: { target: string; line: number }[] = [];
  let fence: string | undefined;
  markdown.split("\n").forEach((line, index) => {
    const marker = /^(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker !== undefined) {
      if (fence === undefined) fence = marker;
      else if (line.trimEnd() === fence) fence = undefined;
      return;
    }
    if (fence !== undefined) return;
    const prose = line.replace(/`[^`]*`/g, "");
    for (const link of prose.matchAll(/\]\(([^)\s]+)\)/g)) {
      out.push({ target: link[1] ?? "", line: index + 1 });
    }
  });
  return out;
}

describe("the links on a hand-written page", () => {
  const anchorCache = new Map<string, Set<string> | null>();
  const anchorsOf = (path: string): Set<string> | null => {
    if (!anchorCache.has(path)) {
      anchorCache.set(path, existsSync(path) ? anchorsIn(readFileSync(path, "utf8")) : null);
    }
    return anchorCache.get(path) ?? null;
  };

  it("are written ./<page>.md, or the full address of another site", () => {
    const wrong = pages.flatMap((path) =>
      linksIn(readFileSync(path, "utf8"))
        .filter(({ target }) => !/^(https:\/\/|#|\.\/[\w@/.-]+\.md(#[\w-]+)?$)/.test(target))
        .map(({ target, line }) => `${path.slice(docsDir.length + 1)}:${String(line)}: ${target}`),
    );
    expect(wrong).toEqual([]);
  });

  it("resolve to a page, and to a heading on it, as the site slugs headings", () => {
    const broken = pages.flatMap((path) => {
      const name = path.slice(docsDir.length + 1);
      return linksIn(readFileSync(path, "utf8")).flatMap(({ target, line }) => {
        if (target.startsWith("https://")) return [];
        const [file = "", anchor] = target.split("#");
        const page = file === "" ? path : normalize(join(dirname(path), file));
        if (!page.startsWith(docsDir))
          return [`${name}:${String(line)}: ${target} leaves docs-content/`];
        const anchors = anchorsOf(page);
        if (anchors === null) return [`${name}:${String(line)}: ${target} names no page`];
        if (anchor !== undefined && !anchors.has(anchor)) {
          return [`${name}:${String(line)}: ${target} names no heading on that page`];
        }
        return [];
      });
    });
    expect(broken).toEqual([]);
  });

  it("read a heading the way the site does", () => {
    expect(slug("`deidentifyHl7()`")).toBe("deidentifyhl7");
    expect(slug('What is retained, and what "fails closed" does NOT cover')).toBe(
      "what-is-retained-and-what-fails-closed-does-not-cover",
    );
    expect([...anchorsIn("## Example\n\n```ts\n## not a heading\n```\n\n## Example\n")]).toEqual([
      "example",
      "example-1",
    ]);
  });
});

/** The rows of the first table under a `##` heading, as arrays of trimmed cells, header excluded. */
function tableUnder(markdown: string, heading: string): string[][] {
  const start = markdown.indexOf(`\n## ${heading}\n`);
  expect(start, heading).toBeGreaterThan(-1);
  const rest = markdown.slice(start + heading.length + 5);
  const end = rest.search(/\n## /);
  const section = end === -1 ? rest : rest.slice(0, end);
  return section
    .split("\n")
    .filter((line) => line.startsWith("|"))
    .slice(2)
    .map((line) =>
      line
        .slice(1, -1)
        .split("|")
        .map((cell) => cell.trim()),
    );
}

/** The text of a code span that a cell opens with. */
const codeOf = (cell: string | undefined): string => /^`([^`]+)`/.exec(cell ?? "")?.[1] ?? "";

describe("the codes and categories reference page", () => {
  const page = readFileSync(join(docsDir, "codes-and-categories.md"), "utf8");

  it("lists every fatal code the package throws, and no other", () => {
    const listed = tableUnder(page, "Fatal codes").map((row) => codeOf(row[0]));
    expect(listed.sort()).toEqual(Object.keys(FATAL_CODES).sort());
  });

  it("lists every disposition code a manifest entry carries, and no other", () => {
    const listed = tableUnder(page, "Disposition codes").map((row) => codeOf(row[0]));
    expect(listed.sort()).toEqual(Object.keys(DEID_DISPOSITION_CODES).sort());
  });

  it("marks exactly the keyed transforms keyed, and lists every transform a preset assigns", () => {
    const rows = tableUnder(page, "Transforms");
    expect(rows).toHaveLength(8);
    for (const row of rows) {
      const name = codeOf(row[0]) as TransformName;
      expect(row[2], name).toBe(KEYED_TRANSFORMS.has(name) ? "yes" : "no");
    }
    const listed = new Set(rows.map((row) => codeOf(row[0])));
    const assigned = [
      ...Object.values(SAFE_HARBOR_POLICY.transforms),
      ...Object.values(LIMITED_DATA_SET_PROFILE.policy.transforms),
    ];
    expect(assigned.filter((name) => !listed.has(name))).toEqual([]);
  });

  it("gives each of the 18 categories its letter, title and the two presets' transforms", () => {
    const rows = tableUnder(page, "The 18 Safe Harbor categories");
    expect(rows.map((row) => codeOf(row[1]))).toEqual(Object.keys(SAFE_HARBOR_CATEGORIES));
    for (const row of rows) {
      const key = codeOf(row[1]) as keyof typeof SAFE_HARBOR_CATEGORY_META;
      const meta = SAFE_HARBOR_CATEGORY_META[key];
      expect(row[0], key).toBe(`(${meta.letter})`);
      expect(row[2], key).toBe(meta.title);
      expect(codeOf(row[3]), key).toBe(SAFE_HARBOR_POLICY.transforms[key]);
      expect(codeOf(row[4]), key).toBe(LIMITED_DATA_SET_PROFILE.policy.transforms[key]);
    }
  });
});
