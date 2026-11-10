/**
 * C-CDA adapter on the shapes the headline fixtures never send, and on a DOM a JavaScript caller hands
 * `extractCcdaLoci` / `applyCcda` directly.
 *
 * The XML half: an empty `<name/>`, a `<telecom>` with no `@value`, an empty `<postalCode/>`, an interval
 * bound with no `@value`, an empty unstructured body, a whitespace-only comment, and a pseudonymized
 * identifier that carries an `@extension`. The DOM half: the public extractor and applier take any DOM
 * element, so an element with no `localName`, a text node with no `nodeValue`, a hole in a node or
 * attribute list, a processing instruction with no target, a node kind the hardened parser refuses, and
 * an element detached from any document are all inputs a caller can build. Each one keeps its value out
 * of the output or counts it; none crashes the pass or passes a value through in silence.
 *
 * All values are synthetic `ZZ` sentinels.
 */

import { parseCcda, parseSecureXml, resolveLimits } from "@cosyte/ccda";
import type { Element, Node } from "@xmldom/xmldom";
import { describe, expect, it } from "vitest";

import {
  createDeidContext,
  deidentify,
  defineDeidPolicy,
  SAFE_HARBOR_CATEGORIES,
  type TransformedLocus,
} from "../../src/index.js";
import {
  applyCcda,
  deidentifyCcda,
  extractCcdaLoci,
  type CcdaCoord,
} from "../../src/ccda/index.js";

const V3 = "urn:hl7-org:v3";
const HEAD = `<?xml version="1.0"?><ClinicalDocument xmlns="${V3}">`;
const ctx = createDeidContext({ key: "odd-shape-key-synthetic-hmac", patientId: "p" });
const C = SAFE_HARBOR_CATEGORIES;

/** De-identify a document body and return the serialized output, manifest rows and residual loci. */
function run(body: string, policy?: ReturnType<typeof defineDeidPolicy>) {
  const result = deidentifyCcda(parseCcda(`${HEAD}${body}</ClinicalDocument>`), {
    context: ctx,
    ...(policy === undefined ? {} : { policy }),
  });
  return {
    xml: result.document.toString(),
    rows: result.manifest.map((m) => `${m.locus} ${m.disposition}`),
    residuals: result.unexaminedResiduals.map((r) => r.locus),
  };
}

/** Parse a document body into a DOM the caller owns, as the public extractor's example does. */
function dom(body: string, rootAttrs = ""): Element {
  const doc = parseSecureXml(
    `<?xml version="1.0"?><ClinicalDocument xmlns="${V3}"${rootAttrs}>${body}</ClinicalDocument>`,
    resolveLimits(undefined),
    () => {},
  );
  const root = doc.documentElement;
  if (root === null) throw new Error("fixture has no root");
  return root;
}

/** The first V3 element with this local name. */
function first(root: Element, localName: string): Element {
  const el = root.getElementsByTagNameNS(V3, localName).item(0);
  if (el === null) throw new Error(`fixture has no <${localName}>`);
  return el;
}

/** Overwrite one property on a single DOM node, as a caller's hand-built node would carry it. */
function forge(node: object, property: string, value: unknown): void {
  Object.defineProperty(node, property, { value, configurable: true });
}

/** Serialize a DOM node: `@xmldom/xmldom` nodes serialize through their own `toString()`. */
function serialize(node: Element): string {
  const serializable: { toString(): string } = node;
  return serializable.toString();
}

/** Run the public extract, engine and apply steps over a caller's DOM, then serialize it. */
function passOver(root: Element): string {
  const { loci, coords } = extractCcdaLoci(root);
  const { document } = deidentify({ loci }, { context: ctx });
  applyCcda(document.loci, coords);
  return serialize(root);
}

describe("deidentifyCcda, empty and partial values in the XML", () => {
  it("replaces only the extension of a pseudonymized id that carries one, keeping the root", () => {
    const keyed = defineDeidPolicy({ name: "keyed", transforms: { [C.MRN]: "pseudonymize" } });
    const out = run(
      `<recordTarget><patientRole><id root="2.16.840.1.113883.19.5" extension="ZZMRNEXT"/></patientRole></recordTarget>`,
      keyed,
    );
    expect(out.xml).not.toContain("ZZMRNEXT");
    expect(out.xml).toMatch(/<id root="2\.16\.840\.1\.113883\.19\.5" extension="[0-9a-f]{64}"\/>/);
    expect(out.rows).toEqual(["recordTarget/patientRole/id transformed"]);
  });

  it("acts on an empty name, a telecom with no value and an address with an empty postalCode", () => {
    const out = run(
      `<recordTarget><patientRole>
        <addr><city>ZZCITY</city><postalCode/></addr>
        <telecom use="HP"/>
        <patient><name/></patient>
      </patientRole></recordTarget>`,
    );
    expect(out.xml).not.toContain("ZZCITY");
    expect(out.rows).toEqual([
      "recordTarget/patientRole/addr blocked",
      "recordTarget/patientRole/telecom removed",
      "recordTarget/patientRole/patient/name removed",
    ]);
    // The telecom's use code is handed through, so it is counted.
    expect(out.residuals).toEqual(["recordTarget/patientRole/telecom@use"]);
  });

  it("emits no date locus for an interval bound with no value, and still acts on its sibling", () => {
    const out = run(
      `<componentOf><encompassingEncounter><effectiveTime><low/><high value="20200101"/></effectiveTime></encompassingEncounter></componentOf>`,
    );
    expect(out.rows).toEqual(["componentOf/encompassingEncounter/effectiveTime/high transformed"]);
    expect(out.xml).toContain('<low/><high value="2020"/>');
  });

  it("blocks an empty unstructured body all the same", () => {
    const out = run(`<component><nonXMLBody><text/></nonXMLBody></component>`);
    expect(out.rows).toEqual(["component/nonXMLBody/text blocked"]);
  });

  it("does not count a whitespace-only comment or CDATA section as a value", () => {
    const out = run(`<title>T<!--   --><![CDATA[  ]]></title>`);
    expect(out.residuals).toEqual(["title"]); // the title's own text, and nothing else
  });
});

describe("extractCcdaLoci, element names a caller's DOM does not carry", () => {
  it("withholds the name of a root element with no localName rather than printing nothing", () => {
    const root = dom("", ' classCode="DOCCLIN"');
    forge(root, "localName", null);
    const { unexaminedResiduals } = extractCcdaLoci(root);
    expect(unexaminedResiduals.map((r) => r.locus)).toEqual(["<withheld>@classCode"]);
  });

  it("blocks a top-level child with no localName as an unknown element", () => {
    const root = dom(`<zzThing value="ZZTOPVALUE">ZZTOPTEXT</zzThing>`);
    forge(first(root, "zzThing"), "localName", null);
    const { loci } = extractCcdaLoci(root);
    expect(loci).toEqual([
      expect.objectContaining({ path: "<withheld>[0]", kind: "unknown", value: "ZZTOPTEXT" }),
    ]);
    expect(loci.every((l) => l.category === undefined)).toBe(true);
    expect(passOver(root)).not.toContain("ZZTOP"); // its text and its @value both go
  });

  it("blocks a nameless element inside a participation instead of reading it as a person name", () => {
    const root = dom(
      `<recordTarget><patientRole><patient><name>ZZHIDDENNAME</name></patient></patientRole></recordTarget>`,
    );
    forge(first(root, "name"), "localName", null);
    const { loci } = extractCcdaLoci(root);
    expect(loci).toEqual([
      expect.objectContaining({
        path: "recordTarget/patientRole/patient/<withheld>[0]",
        kind: "unknown",
        value: "ZZHIDDENNAME",
      }),
    ]);
  });

  it("does not take a nameless body element for narrative, and counts the text it carries", () => {
    const root = dom(
      `<component><structuredBody><component><section><text>ZZNARRATIVE</text></section></component></structuredBody></component>`,
    );
    forge(first(root, "text"), "localName", null);
    const { loci, unexaminedResiduals } = extractCcdaLoci(root);
    expect(loci).toEqual([]);
    expect(unexaminedResiduals.map((r) => r.locus)).toEqual([
      "component/structuredBody/component/section/<withheld>[0]",
    ]);
  });

  it("removes a nameless address part outright, as it removes any part it does not keep", () => {
    const root = dom(
      `<recordTarget><patientRole><addr><city>ZZNAMELESSCITY</city><state>MA</state><postalCode>02139</postalCode></addr></patientRole></recordTarget>`,
    );
    forge(first(root, "city"), "localName", null);
    const xml = passOver(root);
    expect(xml).not.toContain("ZZNAMELESSCITY");
    expect(xml).toContain("<addr><state>MA</state><postalCode>021</postalCode></addr>");
  });
});

describe("extractCcdaLoci, node and attribute lists a caller's DOM fills unusually", () => {
  it("skips a null slot in an attribute list instead of reading it", () => {
    const root = dom(
      `<recordTarget><patientRole><patient><administrativeGenderCode code="F" codeSystem="2.16.840.1.113883.5.1"/></patient></patientRole></recordTarget>`,
    );
    const gender = first(root, "administrativeGenderCode");
    const attributes = gender.attributes;
    const item = attributes.item.bind(attributes);
    forge(attributes, "item", (i: number) => (i === 0 ? null : item(i)));
    const { loci, unexaminedResiduals } = extractCcdaLoci(root);
    expect(loci).toEqual([]);
    expect(unexaminedResiduals).toEqual([]);
  });

  it("reads a text node with no nodeValue as carrying nothing", () => {
    const root = dom(`<title>ZZTITLE</title>`);
    const textNode = first(root, "title").firstChild;
    if (textNode === null) throw new Error("fixture has no text node");
    forge(textNode, "nodeValue", null);
    expect(extractCcdaLoci(root).unexaminedResiduals).toEqual([]);
  });

  it("names a processing instruction with no target by the withheld token", () => {
    const root = dom(`<title>T<?zzpi ZZPIDATA?></title>`);
    const pi = first(root, "title").lastChild;
    if (pi === null) throw new Error("fixture has no processing instruction");
    forge(pi, "target", undefined);
    expect(extractCcdaLoci(root).unexaminedResiduals.map((r) => r.locus)).toEqual([
      "title",
      "title/#processing-instruction/<withheld>",
    ]);
  });

  it("counts a node of a kind the parser refuses under the withheld token, and skips a hole or a valueless node", () => {
    const root = dom(`<title>T</title>`);
    const title = first(root, "title");
    const entity = { nodeType: 5, nodeValue: "ZZENTITYVALUE" } as unknown as Node;
    const valueless = { nodeType: 8, nodeValue: null } as unknown as Node; // a comment with no value
    forge(title, "childNodes", [title.firstChild, null, undefined, valueless, entity]);
    const residuals = extractCcdaLoci(root).unexaminedResiduals;
    expect(residuals.map((r) => r.locus)).toEqual(["title", "title/#<withheld>"]);
    expect(JSON.stringify(residuals)).not.toContain("ZZENTITYVALUE");
  });
});

describe("applyCcda, hand-built coordinates and nodes", () => {
  const redacted = (value: string | null, kind: TransformedLocus["kind"]): TransformedLocus => ({
    path: "x",
    kind,
    value,
    disposition: value === null ? "removed" : "transformed",
  });

  it("empties an element detached from any document rather than writing text it cannot create", () => {
    const root = dom(`<title>ZZDETACHED</title>`);
    const title = first(root, "title");
    forge(title, "ownerDocument", null);
    applyCcda([redacted("[REDACTED]", "freetext")], [{ node: title, edit: "clear-element" }]);
    expect(title.firstChild).toBeNull();
    expect(serialize(root)).toContain("<title/>");
  });

  it("removes direct text past a hole in the node list on a block edit", () => {
    const root = dom(`<zzThing value="ZZBLOCKVALUE">ZZBLOCKTEXT</zzThing>`);
    const thing = first(root, "zzThing");
    forge(thing, "childNodes", [null, thing.firstChild]);
    applyCcda([redacted(null, "unknown")], [{ node: thing, edit: "block" }]);
    expect(serialize(root)).not.toContain("ZZBLOCK");
  });

  it("skips a coordinate with no transformed locus beside it, and a hole in the coordinate list", () => {
    const root = dom(`<title>ZZKEPT</title><zzThing>ZZGONE</zzThing>`);
    const coords: CcdaCoord[] = [];
    coords[1] = { node: first(root, "zzThing"), edit: "block" }; // index 0 is a hole
    coords[2] = { node: first(root, "title"), edit: "block" }; // no transformed[2]
    applyCcda([redacted(null, "unknown"), redacted(null, "unknown")], coords);
    const xml = serialize(root);
    expect(xml).not.toContain("ZZGONE");
    expect(xml).toContain("ZZKEPT");
  });
});
