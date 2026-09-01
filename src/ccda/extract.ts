/**
 * The C-CDA **extractor**: walks a parsed CDA DOM (the hardened `@xmldom/xmldom` tree the sibling
 * `@cosyte/ccda` parser produces via `parseSecureXml`) and produces the format-agnostic
 * {@link GenericLocus} list the core engine transforms, plus a **parallel coordinate list** ({@link
 * CcdaCoord}) holding a direct handle to the DOM node each locus came from, so the applier writes each
 * transformed value back with no path re-parsing. Loci and coordinates are produced in the same order,
 * so `result.document.loci[i]` corresponds to `coords[i]`.
 *
 * PHI is located **structurally**, per the cited {@link CCDA_LOCUS_MAP}: the person `<name>` /
 * `<telecom>` / `<addr>` / `<birthTime>` / person-role `<id>` and participation dates of the CDA
 * **header participations** (recordTarget/patient + guardian, author, informant, authenticator,
 * legalAuthenticator, dataEnterer, participant, custodian, documentationOf, componentOf, relatives
 * included). The **fail-closed** rule governs everything else: section narrative `<text>`
 * blocks and the unstructured `nonXMLBody` are blocked; an element carrying a value that is neither a
 * mapped PHI element nor a recognized coded/administrative one is blocked; the clinical
 * **structuredBody** entries are retained untouched (the over-scrub guard): a `<name>` there is a drug
 * or material name, not a person, so it must survive.
 *
 * @packageDocumentation
 */

import { attr, childElements, children, text, xsiType } from "@cosyte/ccda";

import { SAFE_HARBOR_CATEGORIES } from "../categories.js";
import { isWithheldToken, safeLocusToken } from "../derived-token.js";
import type { GenericLocus } from "../locus.js";
import {
  enumerateOrFail,
  UnexaminedResidualBuilder,
  type UnexaminedResidual,
} from "../residual.js";
import {
  CCDA_ENVELOPE_ELEMENTS,
  CCDA_LOCUS_MAP,
  V3_NS,
  categoryForIdRoot,
  isRetainedCcdaElement,
} from "./locus-map.js";
import type { Attr, Element } from "@xmldom/xmldom";

/** DOM `Node.TEXT_NODE`. @internal */
const TEXT_NODE = 3 as const;
/** `xsi:type` prefixes that denote a periodic/dosing interval, NOT a calendar date, never generalized. */
const PERIOD_TYPES: readonly string[] = ["PIVL", "EIVL", "SXPR", "PPD"];
/**
 * The XML Schema instance namespace `xsi:type` lives in. Read by namespace rather than by the `xsi:`
 * prefix, because a document is free to bind that namespace to any prefix it likes and the date rule
 * resolves it the same way.
 */
const XSI_NS = "http://www.w3.org/2001/XMLSchema-instance";

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
 * A write-back coordinate: a direct handle to the DOM node one extracted locus came from, plus how to
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
  /**
   * Every **value-bearing position the pass hands through that no locus rule named**: an attribute or a
   * run of direct text on an element inside the retained clinical body, the document envelope, or a
   * wrapper the header sweep passed over. The unit is the position, so an attribute no rule reached is
   * listed even where the pass acted on a *different* attribute of the same element. Counted and
   * located, never transformed.
   */
  readonly unexaminedResiduals: readonly UnexaminedResidual[];
}

/**
 * The positions of one element a locus rule **reached and decided about**, whatever it then decided: a
 * `nullFlavor`-only `<id>`, a dosing-interval `<effectiveTime>` and a recognized coded element whose
 * coded attributes the over-scrub guard keeps are all decisions, not silences.
 *
 * The unit is the **position**, never the element. A rule that reaches one attribute of an element says
 * nothing about the element's other attributes: `actTelecom` clears a `<telecom>`'s `@value` and its
 * `@use` is handed through untouched, so `@use` is a position nothing examined and is measured as one.
 */
interface NamedPositions {
  /**
   * The attribute **nodes** a rule read or wrote. Node identity rather than name, because an attribute
   * is addressed two ways here: by name (`@value`) and by namespace (`xsi:type`, whose prefix a document
   * chooses), and only the node is the same thing under both.
   */
  readonly attributes: Set<Attr>;
  /** `true` when a rule reached the element's own run of direct character text. */
  text: boolean;
  /**
   * `true` when a decision consumed everything **below** the element. Deliberately says nothing about
   * the element's own positions: `clear-element` empties an element's children and leaves every one of
   * its attributes in place, so those attributes are still handed through.
   */
  subtree: boolean;
}

/** The mutable pair the sweep accumulates into, before it is frozen into a {@link CcdaExtraction}. */
interface CcdaLocusAccumulator {
  readonly loci: GenericLocus[];
  readonly coords: CcdaCoord[];
  /** What each rule named, recorded at the decision site, keyed by the element the decision was about. */
  readonly named: Map<Element, NamedPositions>;
}

/** Append a locus + its coordinate to the accumulator. */
function push(out: CcdaLocusAccumulator, locus: GenericLocus, coord: CcdaCoord): void {
  out.loci.push(locus);
  out.coords.push(coord);
}

/** The named-position record for an element, created empty on first use. */
function named(out: CcdaLocusAccumulator, el: Element): NamedPositions {
  const existing = out.named.get(el);
  if (existing !== undefined) return existing;
  const fresh: NamedPositions = { attributes: new Set<Attr>(), text: false, subtree: false };
  out.named.set(el, fresh);
  return fresh;
}

/** Record that a rule named these attributes of this element, whatever it then decided about them. */
function nameAttributes(out: CcdaLocusAccumulator, el: Element, names: readonly string[]): void {
  const record = named(out, el);
  for (const name of names) {
    const node = el.getAttributeNode(name);
    if (node !== null) record.attributes.add(node);
  }
}

/** Record that a rule named an attribute resolved by namespace, whatever prefix the document bound it to. */
function nameAttributeNS(
  out: CcdaLocusAccumulator,
  el: Element,
  namespace: string,
  localName: string,
): void {
  const node = el.getAttributeNodeNS(namespace, localName);
  if (node !== null) named(out, el).attributes.add(node);
}

/**
 * Record that a rule named **every one** of this element's own positions: all of its attributes and its
 * direct text. Reserved for the over-scrub guard, whose decision is explicitly about the whole coded
 * element ("its coded attributes are retained"), never for a rule that reaches a named attribute.
 */
function nameOwnPositions(out: CcdaLocusAccumulator, el: Element): void {
  const record = named(out, el);
  const attributes = el.attributes;
  for (let i = 0; i < attributes.length; i += 1) {
    const attribute = attributes.item(i);
    if (attribute !== null) record.attributes.add(attribute);
  }
  record.text = true;
}

/** Record that a rule reached the element's own run of direct character text. */
function nameText(out: CcdaLocusAccumulator, el: Element): void {
  named(out, el).text = true;
}

/** Record that a decision consumed everything below the element (its children, not its attributes). */
function nameSubtree(out: CcdaLocusAccumulator, el: Element): void {
  named(out, el).subtree = true;
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

/**
 * Build the value-free path segment for every element child of `parent`: **the one place a CDA path
 * segment is composed**, used by both the header sweep and the body narrative descent.
 *
 * The element's local name is **bounded before it becomes a path segment** ({@link safeLocusToken}):
 * an XML name is unbounded by the XML specification, so an element name is only an identifier by
 * convention.
 *
 * ## The index base, which a manifest reader must be able to state without this file
 *
 * `[n]` is the child's index **among its document siblings that print the same segment name**, and it
 * is emitted in exactly two cases:
 *
 * - **more than one sibling prints that name**, so the name alone would not say which one this is; or
 * - **the name was refused**, because `<withheld>` names nothing, so the index is the only "where"
 *   that position has left. A refused segment therefore always carries one, even when it is the only
 *   refusal at that level.
 *
 * Three consequences worth stating, because each has been mis-read:
 *
 * - **It counts document siblings, not manifest rows, so the indices in a manifest can be gapped.** A
 *   sibling that yields no locus (an empty `<text>`, an `<entry>` whose narrative is a `<reference>`
 *   into the section, a `nullFlavor`-only `<id>`) contributes no row, and the surviving rows keep
 *   their document indices. `component[2]` alone means two siblings had nothing to record, not that
 *   rows went missing. Do not document it as a counter derivable from the manifest alone.
 * - The counter keys on the **printed** name, not on `namespaceURI|name`. A path prints no namespace,
 *   so keying on one hid the counter from the reader and let two refused siblings in *different*
 *   namespaces both print a bare `<withheld>` and aggregate into a single manifest row.
 * - Only the printed path is affected. Every scrub decision below dispatches on the **raw**
 *   `localName` and namespace, so a refusal degrades an audit label and never moves what is
 *   de-identified.
 *
 * Segments composed here are element names. The fixed-string segments (`structuredBody`,
 * `nonXMLBody/text`, and an interval's `low` / `high` / `center` bounds) do not pass through this
 * function and carry no index; the CDA schema allows each at most once at its position.
 */
function childSegments(parent: Element): { el: Element; path: string }[] {
  const named = childElements(parent).map((el) => {
    const name = safeLocusToken(el.localName ?? "", "xmlName");
    return { el, name, withheld: isWithheldToken(name) };
  });
  const counts = new Map<string, number>();
  for (const k of named) counts.set(k.name, (counts.get(k.name) ?? 0) + 1);
  const seen = new Map<string, number>();
  return named.map(({ el, name, withheld }) => {
    const idx = seen.get(name) ?? 0;
    seen.set(name, idx + 1);
    const indexed = withheld || (counts.get(name) ?? 1) > 1;
    return { el, path: indexed ? `${name}[${String(idx)}]` : name };
  });
}

/** Join a running path with a child segment. */
function join(base: string, seg: string): string {
  return base === "" ? seg : `${base}/${seg}`;
}

/** Extract a person `<name>` locus: redacted (whole element cleared). */
function actName(out: CcdaLocusAccumulator, el: Element, path: string): void {
  // The rule reads the element's whole text and the applier empties it: its text and everything below it
  // are decided. Its attributes are not - `clear-element` leaves every one of them in place.
  nameText(out, el);
  nameSubtree(out, el);
  push(
    out,
    { path, kind: "identifier", category: SAFE_HARBOR_CATEGORIES.NAMES, value: text(el) ?? "" },
    { node: el, edit: "clear-element" },
  );
}

/** Extract a `<telecom>` locus: redacted (its `@value` cleared). */
function actTelecom(out: CcdaLocusAccumulator, el: Element, path: string): void {
  // The rule's subject is the `@value` that carries the number, plus the children the applier removes
  // with it. A `<telecom use="HP">`'s `@use` is not in that set and is handed through untouched.
  nameAttributes(out, el, ["value"]);
  nameText(out, el);
  nameSubtree(out, el);
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

/** Extract an `<addr>` locus: generalized to the safe 3-digit ZIP; finer geography dropped by apply. */
function actAddr(out: CcdaLocusAccumulator, el: Element, path: string): void {
  // The rule decides every geographic child as a unit: the ZIP is generalized, state and country are
  // retained as permitted, the rest are dropped. The `<addr>`'s own attributes are decided by nothing.
  nameSubtree(out, el);
  const postal = children(el, "postalCode")[0];
  const zip = postal === undefined ? "" : (text(postal) ?? "");
  push(
    out,
    { path, kind: "zip", category: SAFE_HARBOR_CATEGORIES.GEOGRAPHIC, value: zip },
    { node: el, edit: "address" },
  );
}

/** Extract a person-role `<id>` locus: pseudonymized (SSN-rooted → redacted); assigning root retained. */
function actId(out: CcdaLocusAccumulator, el: Element, path: string): void {
  // The id rule reads the assigning authority and the id value, and the applier rewrites one of them.
  nameAttributes(out, el, ["root", "extension"]);
  const root = attr(el, "root");
  const ext = attr(el, "extension");
  const value = ext !== undefined ? ext : (root ?? "");
  if (value.length === 0) return; // nullFlavor-only id, nothing to transform
  push(
    out,
    { path, kind: "identifier", category: categoryForIdRoot(root), value },
    { node: el, edit: "id" },
  );
}

/** Extract calendar-date loci from a `<birthTime>` / `<time>` / `<effectiveTime>`: generalized to year. */
function actDate(out: CcdaLocusAccumulator, el: Element, path: string): void {
  // The date rule's subject is the timestamp and the `xsi:type` that says whether it is a calendar one at
  // all. Both are named on every branch, including the dosing-period branch, which is a decision about
  // them ("this is an interval, not a date, so it is retained") rather than a position nothing reached.
  nameAttributes(out, el, ["value"]);
  nameAttributeNS(out, el, XSI_NS, "type");
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
      nameAttributes(out, c, ["value"]);
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
 * Fail closed on **direct character text** carried by a recognized coded/structural element: its own
 * coded attributes (`@code` / `@root` / `@extension`) are structure and stay, but a CD/CE element in
 * conformant HL7 v3 has no direct text, so any that appears is unrecognized content and is blocked. This
 * keeps the fail-closed guarantee uniform: a retained element passes through neither an unhandled child
 * (the sweep descends) nor stray direct text (blocked here).
 */
function blockRetainedText(out: CcdaLocusAccumulator, el: Element, path: string): void {
  nameText(out, el);
  const dt = directText(el);
  if (dt.length === 0) return;
  push(out, { path, kind: "unknown", value: dt }, { node: el, edit: "block-text" });
}

/**
 * Fail closed on an unrecognized element that carries a value: block its direct text + value attrs.
 *
 * **The decision is partial by design and the measurement says so.** The rule's subject is the direct
 * text and the three value-carrying attributes below; an unrecognized element's *other* attributes are
 * neither blocked nor decided here, so they are handed through and the enumeration counts each one.
 */
function blockUnknown(out: CcdaLocusAccumulator, el: Element, path: string): void {
  nameAttributes(out, el, ["value", "extension", "root"]);
  nameText(out, el);
  const dt = directText(el);
  const hasVal = hasAttr(el, "value") || hasAttr(el, "extension") || hasAttr(el, "root");
  if (dt.length === 0 && !hasVal) return; // pure structural wrapper, nothing to block here
  // Omit the category to force the engine's fail-closed block (category R).
  push(out, { path, kind: "unknown", value: dt }, { node: el, edit: "block" });
}

/**
 * Recursively sweep a header person participation, applying the mapped element rules, retaining
 * recognized coded/administrative elements untouched, and **failing closed** on everything else.
 */
function sweep(out: CcdaLocusAccumulator, el: Element, path: string): void {
  for (const { el: childEl, path: seg } of childSegments(el)) {
    const childPath = join(path, seg);
    if (childEl.namespaceURI !== V3_NS) {
      // Foreign / sdtc namespace: unrecognized structure. Fail closed on any value, then descend.
      blockUnknown(out, childEl, childPath);
      sweep(out, childEl, childPath);
      continue;
    }
    const ln = childEl.localName ?? "";
    const rule = CCDA_LOCUS_MAP[ln];
    if (rule !== undefined) {
      // The map NAMES this element, so the positions its rule reaches are examined whatever the rule
      // then recorded: a `nullFlavor`-only `<id>` and a dosing-interval `<effectiveTime>` are both
      // decisions reached. Each rule below names the positions it actually reaches, and only those.
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
      continue; // mapped element handled as a unit: do not descend
    }
    if (isRetainedCcdaElement(ln)) {
      // Recognized coded/structural element: its coded attributes are retained (over-scrub guard), but
      // (a) block any stray direct text on it: a conformant CD/CE has none, so it is unrecognized
      // content, and (b) descend, since a `<code>` may wrap a free-text `<originalText>` and a `*Code`
      // could nest a `<name>`; neither may ride through because their parent was recognized.
      // Recognizing the element is a decision about ITS OWN positions (the over-scrub guard keeps its
      // coded attributes on purpose), and about nothing below it: the descent decides that separately.
      nameOwnPositions(out, childEl);
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
 * Fail closed on **every** narrative `<text>` element anywhere in the body: section-level, nested
 * subsection, and entry-level alike, while retaining all coded clinical structure (codes, values,
 * units, statuses, dosing periods) untouched. Blocking a `<text>` never touches the coded siblings that
 * carry the clinical meaning, so this is strictly leak-safe and never an over-scrub: a `<text>` holds
 * human-readable narrative (or a reference into it), never a clinical value.
 */
function blockNarrative(out: CcdaLocusAccumulator, el: Element, path: string): void {
  for (const { el: child, path: seg } of childSegments(el)) {
    const childPath = join(path, seg);
    if (child.namespaceURI === V3_NS && (child.localName ?? "") === "text") {
      if (text(child) === undefined) continue; // empty narrative: nothing to block
      nameText(out, child);
      nameSubtree(out, child);
      push(
        out,
        {
          path: childPath,
          kind: "freetext",
          category: SAFE_HARBOR_CATEGORIES.OTHER_UNIQUE_ID,
          value: text(child) ?? "",
        },
        { node: child, edit: "clear-element" },
      );
      continue; // do not descend into a blocked narrative block
    }
    // Descend to reach nested / entry-level narrative, over segments composed exactly as the header
    // sweep composes its own ({@link childSegments}). This descent runs over the clinical body, which
    // is where same-named siblings are the norm: a `structuredBody` is a run of `<component>`s and a
    // `<section>` a run of `<entry>`s, so without the shared index every section's narrative
    // aggregates into a single manifest row and the artifact stops saying *which* narratives were
    // blocked.
    blockNarrative(out, child, childPath);
  }
}

/** Handle the document body `<component>`: all narrative fails closed; unstructured `nonXMLBody` blocks. */
function handleBody(out: CcdaLocusAccumulator, componentEl: Element, path: string): void {
  for (const sb of children(componentEl, "structuredBody")) {
    // Retain every coded entry untouched (the over-scrub guard); block every narrative <text> (fail closed).
    blockNarrative(out, sb, join(path, "structuredBody"));
  }
  for (const nx of children(componentEl, "nonXMLBody")) {
    for (const t of children(nx, "text")) {
      // Fail closed on unstructured content (an opaque base64 blob can carry any PHI, un-de-identifiable).
      nameText(out, t);
      nameSubtree(out, t);
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
 * tree: the applier writes onto it after the engine transforms the loci.
 *
 * The document is also **enumerated**: every value-bearing position it hands through that no rule above
 * named is counted and located as an unexamined residual. That is where the retained clinical body's
 * entry dates, entry ids, in-entry performer names and family-history relative demographics show up, and
 * the document envelope's own values with them. Nothing is transformed on account of the measurement.
 *
 * @param root - The `ClinicalDocument` DOM element (from `parseSecureXml(...).documentElement`).
 * @returns The loci (for the engine), their index-aligned write-back coordinates, and the unexamined
 *   residual positions the pass hands through.
 * @throws {@link DeidError} `DEID_POSITIONS_UNENUMERABLE` when the document's value-bearing positions
 *   cannot be enumerated: the pass fails rather than emit a zero or a partial count.
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
  const out: CcdaLocusAccumulator = {
    loci: [],
    coords: [],
    named: new Map<Element, NamedPositions>(),
  };
  for (const { el, path } of childSegments(root)) {
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
    // Document envelope: the STRUCTURE is retained (like HL7's MSH), which names no position inside it,
    // so its own values are enumerated below rather than passing through in silence.
    if (CCDA_ENVELOPE_ELEMENTS.has(ln)) continue;
    if (ln === "component") {
      handleBody(out, el, path);
      continue;
    }
    // Every header participation (and any unknown top-level element) → the fail-closed person sweep.
    blockUnknown(out, el, path);
    sweep(out, el, path);
  }

  const residuals = new UnexaminedResidualBuilder();
  const rootName = safeLocusToken(root.localName ?? "", "xmlName");
  enumerateOrFail(rootName, () => {
    // The root element's own positions print under its name; its children print from the same empty
    // base the sweep composes their loci from, so an enumerated position and a locus agree on "where".
    recordOwnPositions(residuals, root, rootName, out.named);
    for (const { el, path } of childSegments(root)) {
      recordUnexaminedCcdaPositions(residuals, el, path, out.named);
    }
  });
  return { loci: out.loci, coords: out.coords, unexaminedResiduals: residuals.build() };
}

/** What the pass decided about, position by position, keyed by the element each decision was about. */
type CcdaCoverage = ReadonlyMap<Element, NamedPositions>;

/** `true` when an attribute name is an XML namespace declaration rather than a document value. */
function isNamespaceDeclaration(name: string): boolean {
  return name === "xmlns" || name.startsWith("xmlns:");
}

/**
 * Enumerate every value-bearing position of one element and record the ones no locus rule named.
 *
 * A **position** here is one attribute of an element, or the element's own run of direct character text.
 * Both are places a value sits, and both are enumerated at their own coordinates: `…/observation@classCode`
 * names the attribute, `…/observation/value` names the text. XML **namespace declarations are not
 * document values** and are excluded; every other attribute is enumerated, an OID root and a code system
 * included, because a position nothing examined is counted whether or not it looks like an identifier.
 *
 * **The exclusion is per position, not per element**, which is the whole point of the unit: an element a
 * rule reached at one attribute keeps every other attribute in the measurement, because the rule decided
 * nothing about them and they are handed through exactly as they arrived.
 *
 * The attribute name is **bounded before it is interpolated**, exactly as an element name is: an XML
 * attribute name is unbounded by the specification, so it is only an identifier by convention.
 */
function recordOwnPositions(
  residuals: UnexaminedResidualBuilder,
  el: Element,
  path: string,
  covered: CcdaCoverage,
): void {
  const decided = covered.get(el);
  const attributes = el.attributes;
  for (let i = 0; i < attributes.length; i += 1) {
    const attribute = attributes.item(i);
    if (attribute === null) continue;
    if (isNamespaceDeclaration(attribute.name) || attribute.value.length === 0) continue;
    if (decided?.attributes.has(attribute) === true) continue;
    residuals.record(`${path}@${safeLocusToken(attribute.name, "xmlName")}`);
  }
  if (decided?.text !== true && directText(el).length > 0) residuals.record(path);
}

/** Recurse the tree, recording each element's own unexamined positions in document order. */
function recordUnexaminedCcdaPositions(
  residuals: UnexaminedResidualBuilder,
  el: Element,
  path: string,
  covered: CcdaCoverage,
): void {
  recordOwnPositions(residuals, el, path, covered);
  // A decision that consumed everything below this element (a cleared `<name>`, a rebuilt `<addr>`, a
  // blocked narrative `<text>`) leaves no descendant position for anything else to have missed.
  if (covered.get(el)?.subtree === true) return;
  for (const { el: child, path: seg } of childSegments(el)) {
    recordUnexaminedCcdaPositions(residuals, child, join(path, seg), covered);
  }
}
