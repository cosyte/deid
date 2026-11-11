/**
 * The generator for the **C-CDA** leak property (the rule is in `./sweep.ts`).
 *
 * `@cosyte/ccda` publishes no arbitraries, so this is a deid generator: a CDA document whose header and
 * one clinical entry are assembled from generated fragments, each carrying a tagged sentinel in a
 * generated shape at a generated place (the patient role, the patient, a name, an address, the
 * clinical entry, the document's own participants). The shapes: a plain string where a structured
 * element is expected (a `<name>` or an `<addr>` with no parts, an `<id>` with text), an extra
 * repeat (a second name, telecom or id), an extra component (a part the datatype does not define),
 * a value in a code or qualifier position (`@code`, `@displayName`, `@use`, `@root`), and nested
 * structures (a participant's playing entity, an entry relationship, a guardian, a related person).
 *
 * Where a sentinel sits is read back from the parsed input as the adapter writes a locus
 * (`recordTarget/patientRole/patient/name[1]/family`, `...@code`).
 */

import fc from "fast-check";
import { DOMParser, type Element } from "@xmldom/xmldom";
import { parseCcda } from "@cosyte/ccda";

import { createDeidContext, DeidError, FATAL_CODES } from "../../src/index.js";
import { deidentifyCcda } from "../../src/ccda/index.js";
import {
  sentinelAt,
  sentinelStem,
  sweep,
  type LeakShape,
  type LeakTally,
  type PassOutcome,
  type Pin,
  type Placement,
} from "./sweep.js";

const FATAL = new Set<string>(Object.values(FATAL_CODES));
const ctx = createDeidContext({ key: "leak-property-ccda-synthetic-key", patientId: "p-leak" });

/** Where a fragment goes. */
type Slot = "doc" | "patientRole" | "patient" | "name" | "addr" | "entry";

/** One fragment template: its slot and its XML around the sentinel `S`. */
type Template = readonly [Slot, (s: string) => string];

const TEMPLATES: Readonly<Record<string, readonly Template[]>> = {
  "plain-for-composite": [
    ["patient", (s) => `<name>${s}</name>`],
    ["patientRole", (s) => `<addr>${s}</addr>`],
    ["patientRole", (s) => `<id>${s}</id>`],
    ["patientRole", (s) => `<telecom>${s}</telecom>`],
    ["entry", (s) => `<code>${s}</code>`],
  ],
  "extra-repeat": [
    ["patient", (s) => `<name><given>ZZGIVEN</given><family>${s}</family></name>`],
    ["patientRole", (s) => `<telecom use="HP" value="tel:${s}"/>`],
    ["patientRole", (s) => `<id root="2.16.840.1.113883.19.5" extension="${s}"/>`],
    ["name", (s) => `<given>${s}</given>`],
    ["addr", (s) => `<streetAddressLine>${s}</streetAddressLine>`],
  ],
  "extra-component": [
    ["name", (s) => `<nickname>${s}</nickname>`],
    ["addr", (s) => `<buildingNumber>${s}</buildingNumber>`],
    ["patient", (s) => `<favoriteColor>${s}</favoriteColor>`],
    ["patientRole", (s) => `<zqNote>${s}</zqNote>`],
    ["entry", (s) => `<zqNote>${s}</zqNote>`],
  ],
  "qualifier-or-code": [
    [
      "patient",
      (s) => `<administrativeGenderCode code="${s}" codeSystem="2.16.840.1.113883.5.1"/>`,
    ],
    ["patient", (s) => `<maritalStatusCode code="M" displayName="${s}"/>`],
    ["patientRole", (s) => `<telecom use="${s}" value="tel:+1-555-0100"/>`],
    ["patient", (s) => `<name use="${s}"><given>ZZGIVEN</given></name>`],
    ["patientRole", (s) => `<id root="${s}" extension="123"/>`],
    ["entry", (s) => `<code code="${s}" codeSystem="2.16.840.1.113883.6.1"/>`],
    ["entry", (s) => `<value xsi:type="CD" code="${s}" codeSystem="2.16.840.1.113883.6.96"/>`],
    ["entry", (s) => `<statusCode code="${s}"/>`],
  ],
  nested: [
    [
      "entry",
      (s) =>
        `<participant typeCode="PRF"><participantRole><playingEntity><name>${s}</name></playingEntity></participantRole></participant>`,
    ],
    [
      "entry",
      (s) =>
        `<entryRelationship typeCode="COMP"><observation classCode="OBS" moodCode="EVN"><value xsi:type="ST">${s}</value></observation></entryRelationship>`,
    ],
    [
      "doc",
      (s) =>
        `<informant><relatedEntity classCode="PRS"><relatedPerson><name><given>${s}</given></name></relatedPerson></relatedEntity></informant>`,
    ],
    [
      "patient",
      (s) =>
        `<guardian><guardianPerson><name><family>${s}</family></name></guardianPerson></guardian>`,
    ],
    [
      "entry",
      (s) =>
        `<author><assignedAuthor><assignedPerson><name>${s}</name></assignedPerson></assignedAuthor></author>`,
    ],
    ["entry", (s) => `<text>see ${s}</text>`],
  ],
};

const SHAPES = Object.keys(TEMPLATES) as LeakShape[];

const placementArb = fc.record({
  shape: fc.constantFrom(...SHAPES),
  pick: fc.nat({ max: 7 }),
});

/** One generated case: the placements, and whether the entry and the address are there at all. */
export const caseArb = fc.record({
  stem: sentinelStem,
  withAddress: fc.boolean(),
  placements: fc.array(placementArb, { minLength: 1, maxLength: 5 }),
});

/** Build the document text with each fragment in its slot. */
export function build(value: {
  stem: string;
  withAddress: boolean;
  placements: readonly { shape: LeakShape; pick: number }[];
}): { raw: string; placed: Placement[] } {
  const slots: Record<Slot, string[]> = {
    doc: [],
    patientRole: [],
    patient: [],
    name: [],
    addr: [],
    entry: [],
  };
  const placed: Placement[] = [];
  value.placements.forEach((p, i) => {
    const sentinel = sentinelAt(value.stem, i);
    const list = TEMPLATES[p.shape] ?? [];
    const [slot, xml] = list[p.pick % list.length] as Template;
    slots[slot].push(xml(sentinel));
    placed.push({ sentinel, shape: p.shape, where: `${slot}#${String(p.pick % list.length)}` });
  });
  const addr =
    value.withAddress || slots.addr.length > 0
      ? `<addr use="HP"><city>ZZCITY</city>${slots.addr.join("")}</addr>`
      : "";
  const raw = `<?xml version="1.0"?>
<ClinicalDocument xmlns="urn:hl7-org:v3" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<typeId root="2.16.840.1.113883.1.3" extension="POCD_HD000040"/>
<recordTarget><patientRole>
<id root="2.16.840.1.113883.19.5" extension="ZZMRN0001"/>
${addr}${slots.patientRole.join("")}
<patient><name><given>ZZGIVEN</given>${slots.name.join("")}<family>ZZFAMILY</family></name>${slots.patient.join("")}</patient>
</patientRole></recordTarget>
${slots.doc.join("")}
<component><structuredBody><component><section>
<code code="30954-2" codeSystem="2.16.840.1.113883.6.1"/>
<entry><observation classCode="OBS" moodCode="EVN">
<code code="2951-2" codeSystem="2.16.840.1.113883.6.1"/>
<value xsi:type="PQ" value="140" unit="mmol/L"/>
${slots.entry.join("")}
</observation></entry>
</section></component></structuredBody></component>
</ClinicalDocument>`;
  return { raw, placed };
}

/** Child elements of an element, with the adapter's `[i]` suffix only where a name repeats. */
function children(el: Element): { el: Element; seg: string }[] {
  const kids: Element[] = [];
  for (let n = el.firstChild; n !== null; n = n.nextSibling) {
    if (n.nodeType === 1) kids.push(n as Element);
  }
  const counts = new Map<string, number>();
  for (const k of kids) counts.set(k.localName ?? "", (counts.get(k.localName ?? "") ?? 0) + 1);
  const seen = new Map<string, number>();
  return kids.map((k) => {
    const name = k.localName ?? "";
    const i = seen.get(name) ?? 0;
    seen.set(name, i + 1);
    return { el: k, seg: (counts.get(name) ?? 1) > 1 ? `${name}[${String(i)}]` : name };
  });
}

/** Every locus at which the sentinel sits: an attribute (`path@name`) or an element's direct text. */
function lociOf(el: Element, path: string, sentinel: string, out: string[]): void {
  for (let i = 0; i < el.attributes.length; i += 1) {
    const a = el.attributes.item(i);
    if (a !== null && a.value.includes(sentinel)) out.push(`${path}@${a.localName ?? a.name}`);
  }
  let direct = "";
  for (let n = el.firstChild; n !== null; n = n.nextSibling) {
    if (n.nodeType === 3 || n.nodeType === 4) direct += n.nodeValue ?? "";
  }
  if (direct.includes(sentinel)) out.push(path);
  for (const { el: child, seg } of children(el)) {
    lociOf(child, path === "ClinicalDocument" ? seg : `${path}/${seg}`, sentinel, out);
  }
}

/** Run the adapter on the text and read back the outcome. */
export function pass(raw: string): PassOutcome {
  const dom = new DOMParser().parseFromString(raw, "text/xml");
  const root = dom.documentElement;
  try {
    const result = deidentifyCcda(parseCcda(raw), { context: ctx });
    const residualLoci = new Set(result.unexaminedResiduals.map((r) => r.locus));
    return {
      output: result.document.toString(),
      manifest: result.manifest,
      unexaminedResiduals: result.unexaminedResiduals,
      residualAt: (s) => {
        if (root === null) return false;
        const loci: string[] = [];
        lociOf(root, "ClinicalDocument", s, loci);
        return loci.length > 0 && loci.every((l) => residualLoci.has(l));
      },
      refused: false,
    };
  } catch (err) {
    if (err instanceof DeidError && FATAL.has(err.code)) {
      return {
        output: "",
        manifest: [],
        unexaminedResiduals: [],
        residualAt: () => false,
        refused: true,
      };
    }
    throw err;
  }
}

/**
 * The C-CDA keeps this suite pins rather than closes (named on the limitations page, pinned in
 * `./found.test.ts`): in the header, a coded element the allow-list recognizes keeps its `@code` and
 * its `@displayName` as they arrived, and an identifier keeps its `@root`.
 */
export const CCDA_PINS: readonly Pin[] = [
  // administrativeGenderCode/@code, maritalStatusCode/@displayName, id/@root.
  { applies: (p) => ["patient#0", "patient#1", "patientRole#4"].includes(p.where) },
];

/** One case through the property: build, check the sentinels are in the input, run, sweep. */
export function checkCase(
  value: {
    stem: string;
    withAddress: boolean;
    placements: readonly { shape: LeakShape; pick: number }[];
  },
  tally: LeakTally,
): string[] {
  const { raw, placed } = build(value);
  const before = parseCcda(raw).toString();
  // Non-vacuity: only a sentinel the input holds is swept, and a case must hold one. A later
  // placement can overwrite an earlier one at the same position.
  const present = placed.filter((p) => before.includes(p.sentinel));
  if (present.length === 0) return ["no sentinel reached the input"];
  return sweep(present, pass(raw), tally, CCDA_PINS);
}
