/**
 * The C-CDA **extractor** — walks a parsed CDA DOM (the hardened `@xmldom/xmldom` tree the sibling
 * `@cosyte/ccda` parser produces via `parseSecureXml`) and produces the format-agnostic
 * {@link GenericLocus} list the core engine transforms, plus a **parallel coordinate list** ({@link
 * CcdaCoord}) holding a direct handle to the DOM node each locus came from, so the applier writes each
 * transformed value back with no path re-parsing. Loci and coordinates are produced in the same order,
 * so `result.document.loci[i]` corresponds to `coords[i]`.
 *
 * PHI is located **structurally**, per the cited {@link CCDA_LOCUS_MAP}: the person `<name>` /
 * `<telecom>` / `<addr>` / `<birthTime>` / person-role `<id>` and participation dates of the CDA
 * **header participations** (recordTarget/patient + guardian, author, informant, authenticator,
 * legalAuthenticator, dataEnterer, participant, custodian, documentationOf, componentOf — roadmap §4.6
 * relatives included). The **fail-closed** rule governs everything else: section narrative `<text>`
 * blocks and the unstructured `nonXMLBody` are blocked; an element carrying a value that is neither a
 * mapped PHI element nor a recognized coded/administrative one is blocked; the clinical
 * **structuredBody** entries are retained untouched (the over-scrub guard) — a `<name>` there is a drug
 * or material name, not a person, so it must survive.
 *
 * @packageDocumentation
 */

import { attr, childElements, children, text, xsiType } from "@cosyte/ccda";

import { SAFE_HARBOR_CATEGORIES } from "../categories.js";
import type { GenericLocus } from "../locus.js";
import {
  CCDA_ENVELOPE_ELEMENTS,
  CCDA_LOCUS_MAP,
  V3_NS,
  categoryForIdRoot,
  isRetainedCcdaElement,
} from "./locus-map.js";
import type { Element } from "@xmldom/xmldom";

/** DOM `Node.TEXT_NODE`. @internal */
const TEXT_NODE = 3 as const;
/** `xsi:type` prefixes that denote a periodic/dosing interval — NOT a calendar date, never generalized. */
const PERIOD_TYPES: readonly string[] = ["PIVL", "EIVL", "SXPR", "PPD"];

/** How the applier writes one transformed locus back onto the CDA DOM node it came from. */
export type CcdaEditKind =
  | "clear-element"
  | "clear-telecom"
  | "id"
  | "date-value"
  | "address"
  | "block"
  | "block-text";

/**
 * A write-back coordinate — a direct handle to the DOM node one extracted locus came from, plus how to
 * write the transformed value back onto it. Carries no value.
 */
export interface CcdaCoord {
  /** The DOM element to edit. */
  readonly node: Element;
  /** How to write the transformed value back. */
  readonly edit: CcdaEditKind;
}

/** The paired output of {@link extractCcdaLoci}: loci for the engine + coordinates for the applier. */
export interface CcdaExtraction {
  /** The located candidate values, in document order. */
  readonly loci: GenericLocus[];
  /** The write-back coordinates, index-aligned with {@link loci}. */
  readonly coords: CcdaCoord[];
}

/** Append a locus + its coordinate to the accumulator. */
function push(out: CcdaExtraction, locus: GenericLocus, coord: CcdaCoord): void {
  out.loci.push(locus);
  out.coords.push(coord);
}

/** The concatenated **direct** (non-descendant) text of an element, trimmed. `""` when there is none. */
function directText(el: Element): string {
  let acc = "";
  const nodes = el.childNodes;
  for (let i = 0; i < nodes.length; i += 1) {
    const n = nodes[i];
    if (n !== null && n !== undefined && n.nodeType === TEXT_NODE) acc += n.nodeValue ?? "";
  }
  return acc.trim();
}

/** `true` when an attribute is present and non-empty. */
function hasAttr(el: Element, name: string): boolean {
  const v = attr(el, name);
  return v !== undefined && v.length > 0;
}

/** Build a value-free child path segment, indexing among same-named siblings only when there is >1. */
function childPaths(parent: Element): { el: Element; path: string }[] {
  const kids = childElements(parent);
  const counts = new Map<string, number>();
  for (const k of kids) {
    const key = `${k.namespaceURI ?? ""}|${k.localName ?? ""}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const seen = new Map<string, number>();
  return kids.map((el) => {
    const key = `${el.namespaceURI ?? ""}|${el.localName ?? ""}`;
    const idx = seen.get(key) ?? 0;
    seen.set(key, idx + 1);
    const suffix = (counts.get(key) ?? 1) > 1 ? `[${String(idx)}]` : "";
    return { el, path: `${el.localName ?? ""}${suffix}` };
  });
}

/** Join a running path with a child segment. */
function join(base: string, seg: string): string {
  return base === "" ? seg : `${base}/${seg}`;
}

/** Extract a person `<name>` locus — redacted (whole element cleared). */
function actName(out: CcdaExtraction, el: Element, path: string): void {
  push(
    out,
    { path, kind: "identifier", category: SAFE_HARBOR_CATEGORIES.NAMES, value: text(el) ?? "" },
    { node: el, edit: "clear-element" },
  );
}

/** Extract a `<telecom>` locus — redacted (its `@value` cleared). */
function actTelecom(out: CcdaExtraction, el: Element, path: string): void {
  push(
    out,
    {
      path,
      kind: "identifier",
      category: SAFE_HARBOR_CATEGORIES.PHONE,
      value: attr(el, "value") ?? "",
    },
    { node: el, edit: "clear-telecom" },
  );
}

/** Extract an `<addr>` locus — generalized to the safe 3-digit ZIP; finer geography dropped by apply. */
function actAddr(out: CcdaExtraction, el: Element, path: string): void {
  const postal = children(el, "postalCode")[0];
  const zip = postal === undefined ? "" : (text(postal) ?? "");
  push(
    out,
    { path, kind: "zip", category: SAFE_HARBOR_CATEGORIES.GEOGRAPHIC, value: zip },
    { node: el, edit: "address" },
  );
}

/** Extract a person-role `<id>` locus — pseudonymized (SSN-rooted → redacted); assigning root retained. */
function actId(out: CcdaExtraction, el: Element, path: string): void {
  const root = attr(el, "root");
  const ext = attr(el, "extension");
  const value = ext !== undefined ? ext : (root ?? "");
  if (value.length === 0) return; // nullFlavor-only id — nothing to transform
  push(
    out,
    { path, kind: "identifier", category: categoryForIdRoot(root), value },
    { node: el, edit: "id" },
  );
}

/** Extract calendar-date loci from a `<birthTime>` / `<time>` / `<effectiveTime>` — generalized to year. */
function actDate(out: CcdaExtraction, el: Element, path: string): void {
  const xt = xsiType(el);
  if (xt !== undefined && PERIOD_TYPES.some((p) => xt.startsWith(p))) return; // dosing period, not a date
  const own = attr(el, "value");
  if (own !== undefined) {
    push(
      out,
      { path, kind: "date", category: SAFE_HARBOR_CATEGORIES.DATES, value: own },
      { node: el, edit: "date-value" },
    );
  }
  for (const bound of ["low", "high", "center"] as const) {
    for (const c of children(el, bound)) {
      const v = attr(c, "value");
      if (v === undefined) continue;
      push(
        out,
        { path: join(path, bound), kind: "date", category: SAFE_HARBOR_CATEGORIES.DATES, value: v },
        { node: c, edit: "date-value" },
      );
    }
  }
}

/**
 * Fail closed on **direct character text** carried by a recognized coded/structural element — its own
 * coded attributes (`@code` / `@root` / `@extension`) are structure and stay, but a CD/CE element in
 * conformant HL7 v3 has no direct text, so any that appears is unrecognized content and is blocked. This
 * keeps the fail-closed guarantee uniform: a retained element passes through neither an unhandled child
 * (the sweep descends) nor stray direct text (blocked here).
 */
function blockRetainedText(out: CcdaExtraction, el: Element, path: string): void {
  const dt = directText(el);
  if (dt.length === 0) return;
  push(out, { path, kind: "unknown", value: dt }, { node: el, edit: "block-text" });
}

/** Fail closed on an unrecognized element that carries a value: block its direct text + value attrs. */
function blockUnknown(out: CcdaExtraction, el: Element, path: string): void {
  const dt = directText(el);
  const hasVal = hasAttr(el, "value") || hasAttr(el, "extension") || hasAttr(el, "root");
  if (dt.length === 0 && !hasVal) return; // pure structural wrapper — nothing to block here
  // Omit the category to force the engine's fail-closed block (category R).
  push(out, { path, kind: "unknown", value: dt }, { node: el, edit: "block" });
}

/**
 * Recursively sweep a header person participation, applying the mapped element rules, retaining
 * recognized coded/administrative elements untouched, and **failing closed** on everything else.
 */
function sweep(out: CcdaExtraction, el: Element, path: string): void {
  for (const { el: childEl, path: seg } of childPaths(el)) {
    const childPath = join(path, seg);
    if (childEl.namespaceURI !== V3_NS) {
      // Foreign / sdtc namespace — unrecognized structure. Fail closed on any value, then descend.
      blockUnknown(out, childEl, childPath);
      sweep(out, childEl, childPath);
      continue;
    }
    const ln = childEl.localName ?? "";
    const rule = CCDA_LOCUS_MAP[ln];
    if (rule !== undefined) {
      switch (rule.mode) {
        case "name":
          actName(out, childEl, childPath);
          break;
        case "telecom":
          actTelecom(out, childEl, childPath);
          break;
        case "addr":
          actAddr(out, childEl, childPath);
          break;
        case "date":
          actDate(out, childEl, childPath);
          break;
        case "id":
          actId(out, childEl, childPath);
          break;
      }
      continue; // mapped element handled as a unit — do not descend
    }
    if (isRetainedCcdaElement(ln)) {
      // Recognized coded/structural element: its coded attributes are retained (over-scrub guard), but
      // (a) block any stray direct text on it — a conformant CD/CE has none, so it is unrecognized
      // content — and (b) descend, since a `<code>` may wrap a free-text `<originalText>` and a `*Code`
      // could nest a `<name>`; neither may ride through because their parent was recognized.
      blockRetainedText(out, childEl, childPath);
      sweep(out, childEl, childPath);
      continue;
    }
    // Wrapper or unknown: block any direct PHI text/value, then descend to sweep nested loci.
    blockUnknown(out, childEl, childPath);
    sweep(out, childEl, childPath);
  }
}

/**
 * Fail closed on **every** narrative `<text>` element anywhere in the body — section-level, nested
 * subsection, and entry-level alike — while retaining all coded clinical structure (codes, values,
 * units, statuses, dosing periods) untouched. Blocking a `<text>` never touches the coded siblings that
 * carry the clinical meaning, so this is strictly leak-safe and never an over-scrub: a `<text>` holds
 * human-readable narrative (or a reference into it), never a clinical value.
 */
function blockNarrative(out: CcdaExtraction, el: Element, path: string): void {
  for (const child of childElements(el)) {
    const ln = child.localName ?? "";
    if (child.namespaceURI === V3_NS && ln === "text") {
      if (text(child) === undefined) continue; // empty narrative — nothing to block
      push(
        out,
        {
          path: join(path, "text"),
          kind: "freetext",
          category: SAFE_HARBOR_CATEGORIES.OTHER_UNIQUE_ID,
          value: text(child) ?? "",
        },
        { node: child, edit: "clear-element" },
      );
      continue; // do not descend into a blocked narrative block
    }
    blockNarrative(out, child, join(path, ln)); // descend to reach nested / entry-level narrative
  }
}

/** Handle the document body `<component>`: all narrative fails closed; unstructured `nonXMLBody` blocks. */
function handleBody(out: CcdaExtraction, componentEl: Element, path: string): void {
  for (const sb of children(componentEl, "structuredBody")) {
    // Retain every coded entry untouched (the over-scrub guard); block every narrative <text> (fail closed).
    blockNarrative(out, sb, join(path, "structuredBody"));
  }
  for (const nx of children(componentEl, "nonXMLBody")) {
    for (const t of children(nx, "text")) {
      // Fail closed on unstructured content (an opaque base64 blob can carry any PHI, un-de-identifiable).
      push(
        out,
        {
          path: join(path, "nonXMLBody/text"),
          kind: "freetext",
          category: SAFE_HARBOR_CATEGORIES.OTHER_UNIQUE_ID,
          value: text(t) ?? "",
        },
        { node: t, edit: "clear-element" },
      );
    }
  }
}

/**
 * Walk a parsed CDA document element (`ClinicalDocument`) and extract every PHI-bearing (or fail-closed)
 * locus, structurally, from the CDA header participations and the section narrative. Never mutates the
 * tree — the applier writes onto it after the engine transforms the loci.
 *
 * @param root - The `ClinicalDocument` DOM element (from `parseSecureXml(...).documentElement`).
 * @returns The loci (for the engine) and their index-aligned write-back coordinates.
 * @example
 * ```ts
 * import { parseSecureXml, resolveLimits } from "@cosyte/ccda";
 * import { extractCcdaLoci } from "@cosyte/deid/ccda";
 *
 * const dom = parseSecureXml(xml, resolveLimits(undefined), () => {});
 * const { loci } = extractCcdaLoci(dom.documentElement);
 * loci.length; // number of located candidate values
 * ```
 */
export function extractCcdaLoci(root: Element): CcdaExtraction {
  const out: CcdaExtraction = { loci: [], coords: [] };
  for (const { el, path } of childPaths(root)) {
    if (el.namespaceURI !== V3_NS) {
      blockUnknown(out, el, path);
      sweep(out, el, path);
      continue;
    }
    const ln = el.localName ?? "";
    if (ln === "effectiveTime") {
      actDate(out, el, path); // the document (service-related) date
      continue;
    }
    if (CCDA_ENVELOPE_ELEMENTS.has(ln)) continue; // document envelope — retained (like HL7 MSH)
    if (ln === "component") {
      handleBody(out, el, path);
      continue;
    }
    // Every header participation (and any unknown top-level element) → the fail-closed person sweep.
    blockUnknown(out, el, path);
    sweep(out, el, path);
  }
  return out;
}
