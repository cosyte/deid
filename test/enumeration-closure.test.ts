/**
 * **The enumeration is closed**: for every structure a pass hands through, the set of value-bearing
 * positions it counts is the set the parser model can actually carry.
 *
 * The measurement's per-adapter suites answer "does it list this position?". This one answers the
 * question behind those: **can a position exist that the walk cannot arrive at?** Three shapes of miss
 * are possible, and each is a property of a *walk* rather than of a format, so each is guarded here for
 * every adapter that has one:
 *
 * - **An alternate carrier at a coordinate the walk does visit.** The walk tests for one kind of thing
 *   and the model admits more: XML delivers character data as a text node *and* as a CDATA section, and
 *   keeps comments and processing instructions beside both.
 * - **A side channel on a node the walk does visit.** The walk reads one field of a node and the model
 *   carries others: a FHIR primitive has an `id` and an `extension` beside its `value`, and a fixed
 *   header is a struct whose fields are only enumerable by asking the object for them.
 * - **An early return whose premise is false.** The walk stops descending because "a decision consumed
 *   everything below", when the applier in fact re-emits part of it: a generalized address keeps its
 *   state and country **verbatim**.
 *
 * Each case below is written the same way, and the shape is the point: **assert the value reaches the
 * output first**, then assert the measurement counts it. A case that only checked the count would pass
 * just as well if the pass had silently removed the value, which is a different (and non-existent)
 * guarantee. The negative controls sit beside them: a position the pass really does remove must NOT be
 * counted, or the inventory would be over-reporting rather than measuring.
 *
 * The last section is the **inventory floor** over the committed fixtures: the totals a pass measures
 * today, asserted, so a change that stops counting a whole class shows up as a number rather than as a
 * silence. Values are synthetic `ZZ`-tagged sentinels throughout.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import { parseCcda, parseSecureXml, resolveLimits, serializeCcda } from "@cosyte/ccda";
import { parseResource, serializeResource } from "@cosyte/fhir";
import { parseHL7 } from "@cosyte/hl7";
import { parseTelecom } from "@cosyte/ncpdp/telecom";
import { parseX12 } from "@cosyte/x12";

import { createDeidContext } from "../src/index.js";
import { deidentifyCcda } from "../src/ccda/index.js";
import { deidentifyDicom } from "../src/dicom/index.js";
import {
  deriveUnexaminedResiduals,
  type EnumerableDataset,
  type FoldableReport,
} from "../src/dicom/fold.js";
import { deidentifyFhir } from "../src/fhir/index.js";
import { deidentifyHl7 } from "../src/hl7/index.js";
import { deidentifyTelecom } from "../src/ncpdp/index.js";
import { deidentifyX12 } from "../src/x12/index.js";
import { buildPhiDataset } from "./dicom/helpers/fixtures.js";

const ctx = (): ReturnType<typeof createDeidContext> =>
  createDeidContext({ key: "enumeration-closure", patientId: "p-closure" });

/** An empty Annex E report: nothing accounted for, so every position of a dataset is unaccounted. */
const EMPTY_ANNEX_E_REPORT: FoldableReport = {
  attributes: [],
  removedPrivateTags: [],
  warnings: [],
  retained: [],
};

const FIX = (dir: string, name: string): string =>
  readFileSync(join(import.meta.dirname, "fixtures", dir, name), "utf8");

/* ------------------------------------------------------------------ alternate carriers (XML) */

/**
 * One retained clinical observation carrying the same value four ways: a text node, a CDATA section, a
 * comment and a processing instruction. `@cosyte/ccda` preserves and re-emits all four verbatim, and no
 * locus rule reads any of them, so all four are positions the pass hands through unexamined.
 *
 * The `<zzMixed>` element carries text **and** CDATA, which is the case that shows the two are separate
 * positions rather than one summed run.
 */
const XML_CARRIERS = `<?xml version="1.0" encoding="UTF-8"?>
<ClinicalDocument xmlns="urn:hl7-org:v3">
  <id root="2.16.840.1.113883.19.5" extension="ZZDOCID"/>
  <title>ZZTITLE</title>
  <effectiveTime value="20200102"/>
  <component><structuredBody><component><section>
    <code code="11450-4" codeSystem="2.16.840.1.113883.6.1"/>
    <entry><observation classCode="OBS" moodCode="EVN">
      <zzPlainNote>ZZPLAINCARRIER</zzPlainNote>
      <zzCdataNote><![CDATA[ZZCDATACARRIER]]></zzCdataNote>
      <zzCommentNote><!-- ZZCOMMENTCARRIER --></zzCommentNote>
      <zzPiNote><?zzproc ZZPICARRIER?></zzPiNote>
      <zzMixed>ZZMIXEDTEXT<![CDATA[ZZMIXEDCDATA]]></zzMixed>
    </observation></entry>
  </section></component></structuredBody></component>
</ClinicalDocument>`;

const ENTRY = "component/structuredBody/component/section/entry/observation";

describe("closure: every character-data carrier an XML element can hold is a position", () => {
  const result = deidentifyCcda(parseCcda(XML_CARRIERS), { context: ctx() });
  const wire = serializeCcda(result.document);
  const loci = new Set(result.unexaminedResiduals.map((r) => r.locus));

  it("all four carriers survive the pass (non-vacuity: there is something to have missed)", () => {
    expect(wire).toContain("ZZPLAINCARRIER");
    expect(wire).toContain("ZZCDATACARRIER");
    expect(wire).toContain("ZZCOMMENTCARRIER");
    expect(wire).toContain("ZZPICARRIER");
  });

  it("counts a value delivered as a CDATA section, which is not a text node", () => {
    expect(loci.has(`${ENTRY}/zzCdataNote/#cdata-section`)).toBe(true);
  });

  it("counts a comment and a processing instruction, each at its own carrier's locus", () => {
    expect(loci.has(`${ENTRY}/zzCommentNote/#comment`)).toBe(true);
    expect(loci.has(`${ENTRY}/zzPiNote/#processing-instruction/zzproc`)).toBe(true);
  });

  it("counts text and CDATA on one element as two positions, not one summed run", () => {
    expect(loci.has(`${ENTRY}/zzMixed`)).toBe(true); // the element's own text
    expect(loci.has(`${ENTRY}/zzMixed/#cdata-section`)).toBe(true);
  });

  it("the plain-text control is counted too, so the CDATA case is not the only path that works", () => {
    expect(loci.has(`${ENTRY}/zzPlainNote`)).toBe(true);
  });

  it("carries no value from any of them: locus, count and the unexamined flag only", () => {
    for (const residual of result.unexaminedResiduals) {
      expect(Object.keys(residual).sort()).toEqual([
        "code",
        "count",
        "examined",
        "locus",
        "locusWithheld",
      ]);
      for (const sentinel of ["ZZCDATACARRIER", "ZZCOMMENTCARRIER", "ZZPICARRIER", "ZZTITLE"]) {
        expect(JSON.stringify(residual)).not.toContain(sentinel);
      }
    }
  });
});

/**
 * The mirror control. A narrative `<text>` is blocked, and the applier empties it by removing **every**
 * child node, so nothing inside one is handed through - not its text, and not a CDATA section or a
 * comment either. Counting those would over-report a position the pass removed.
 */
const XML_REMOVED_CARRIERS = `<?xml version="1.0" encoding="UTF-8"?>
<ClinicalDocument xmlns="urn:hl7-org:v3">
  <title>ZZTITLE</title>
  <component><structuredBody><component><section>
    <text>ZZNARRATIVE<![CDATA[ZZNARRATIVECDATA]]><!-- ZZNARRATIVECOMMENT --></text>
  </section></component></structuredBody></component>
</ClinicalDocument>`;

describe("closure: a carrier the applier removes is not a handed-through position", () => {
  const result = deidentifyCcda(parseCcda(XML_REMOVED_CARRIERS), { context: ctx() });
  const wire = serializeCcda(result.document);
  const loci = result.unexaminedResiduals.map((r) => r.locus);

  it("the blocked narrative really is emptied, carriers included", () => {
    expect(wire).not.toContain("ZZNARRATIVE");
    expect(wire).not.toContain("ZZNARRATIVECDATA");
    expect(wire).not.toContain("ZZNARRATIVECOMMENT");
  });

  it("so no position inside it is counted", () => {
    expect(loci.filter((l) => l.includes("/text"))).toEqual([]);
  });
});

/* ------------------------------------------------------------------ early returns (kept parts) */

const XML_ADDRESS = `<?xml version="1.0" encoding="UTF-8"?>
<ClinicalDocument xmlns="urn:hl7-org:v3">
  <title>ZZTITLE</title>
  <recordTarget><patientRole>
    <addr use="HP"><!-- ZZADDRCOMMENT -->
      <streetAddressLine zzDropped="ZZSTREETATTR">1 ZZSTREET</streetAddressLine>
      <state zzStateAttr="ZZSTATEATTR">MA</state>
      <country><zzNested>ZZCOUNTRYNESTED</zzNested></country>
      <postalCode zzZipAttr="ZZZIPATTR">02101</postalCode>
    </addr>
  </patientRole></recordTarget>
</ClinicalDocument>`;

describe("closure: what a generalized C-CDA address KEEPS is enumerated", () => {
  const result = deidentifyCcda(parseCcda(XML_ADDRESS), { context: ctx() });
  const wire = serializeCcda(result.document);
  const loci = new Set(result.unexaminedResiduals.map((r) => r.locus));
  const ADDR = "recordTarget/patientRole/addr";

  it("the address really is generalized: finer geography gone, state/country kept verbatim", () => {
    expect(wire).not.toContain("ZZSTREET");
    expect(wire).toContain('<postalCode zzZipAttr="ZZZIPATTR">021</postalCode>');
    expect(wire).toContain("ZZSTATEATTR");
    expect(wire).toContain("ZZCOUNTRYNESTED");
    expect(wire).toContain("ZZADDRCOMMENT");
  });

  it("counts what rides through inside a kept part", () => {
    expect(loci.has(`${ADDR}/state@zzStateAttr`)).toBe(true);
    expect(loci.has(`${ADDR}/country/zzNested`)).toBe(true);
  });

  it("counts the address's own carriers and the surviving attribute of the replaced ZIP", () => {
    expect(loci.has(`${ADDR}/#comment`)).toBe(true);
    expect(loci.has(`${ADDR}/postalCode@zzZipAttr`)).toBe(true);
  });

  it("counts NOTHING from a part the applier drops, and not the kept parts' own values", () => {
    expect([...loci].filter((l) => l.includes("streetAddressLine"))).toEqual([]);
    expect(loci.has(`${ADDR}/state`)).toBe(false); // retained as permitted: a decision, not a silence
    expect(loci.has(`${ADDR}/country`)).toBe(false);
    expect(loci.has(`${ADDR}/postalCode`)).toBe(false); // generalized: the rule's own subject
  });
});

/* ------------------------------------------------------------------ side channels (FHIR) */

const FHIR_PRIMITIVE_META = JSON.stringify({
  resourceType: "Observation",
  id: "obs-1",
  status: "final",
  _status: {
    id: "ZZELEMENTID",
    extension: [{ url: "http://zz.example", valueString: "ZZPRIMEXT" }],
  },
  code: { coding: [{ system: "http://loinc.org", code: "2951-2", display: "Sodium" }] },
});

describe("closure: a FHIR primitive's side-channel metadata", () => {
  const result = deidentifyFhir(parseResource(FHIR_PRIMITIVE_META).resource, { context: ctx() });
  const wire = serializeResource(result.document);
  const loci = new Set(result.unexaminedResiduals.map((r) => r.locus));

  it("the element id survives the pass and the primitive extension does not", () => {
    expect(wire).toContain("ZZELEMENTID");
    expect(wire).not.toContain("ZZPRIMEXT"); // the applier's primitive-extension guard drops it
  });

  it("counts the element id at its `_`-sibling locus", () => {
    expect(loci.has("Observation._status.id")).toBe(true);
  });

  it("does NOT count the extension the applier removed: a measurement, not a guess", () => {
    expect([...loci].filter((l) => l.includes("extension"))).toEqual([]);
  });
});

const FHIR_ADDRESS = JSON.stringify({
  resourceType: "Patient",
  id: "p1",
  address: [
    {
      line: ["1 ZZSTREET"],
      _line: [{ id: "ZZLINEID" }],
      city: "Springfield",
      state: "IL",
      _state: {
        id: "ZZSTATEID",
        extension: [{ url: "http://zz.example", valueString: "ZZSTATEEXT" }],
      },
      postalCode: "62704",
      _postalCode: { id: "ZZZIPID" },
      country: "US",
    },
  ],
});

describe("closure: what a rebuilt FHIR address KEEPS is enumerated", () => {
  const result = deidentifyFhir(parseResource(FHIR_ADDRESS).resource, { context: ctx() });
  const wire = serializeResource(result.document);
  const loci = new Set(result.unexaminedResiduals.map((r) => r.locus));

  it("the kept parts are re-emitted VERBATIM, metadata included; the rest is gone", () => {
    expect(wire).not.toContain("ZZSTREET");
    expect(wire).not.toContain("ZZLINEID");
    expect(wire).not.toContain("ZZZIPID"); // postalCode is REPLACED by a fresh primitive
    expect(wire).toContain("ZZSTATEID");
    expect(wire).toContain("ZZSTATEEXT");
  });

  it("counts the kept part's element id and every value inside its extension", () => {
    expect(loci.has("Patient.address[0]._state.id")).toBe(true);
    expect(loci.has("Patient.address[0]._state.extension[0].url")).toBe(true);
    expect(loci.has("Patient.address[0]._state.extension[0].valueString")).toBe(true);
  });

  it("counts nothing from a dropped or replaced part, and not the kept values themselves", () => {
    expect([...loci].filter((l) => l.includes("line"))).toEqual([]);
    expect([...loci].filter((l) => l.includes("postalCode"))).toEqual([]);
    expect(loci.has("Patient.address[0].state")).toBe(false);
    expect(loci.has("Patient.address[0].country")).toBe(false);
  });

  it("a kept part that is NOT a primitive is enumerated whole, because it is re-emitted whole", () => {
    // FHIR types `Address.state` as a string, but a document is not obliged to send one and the model
    // carries whatever arrived. The applier keeps the property verbatim either way, so if it is an
    // object every value inside it rides through and none of it was decided.
    const odd = deidentifyFhir(
      parseResource(
        JSON.stringify({
          resourceType: "Patient",
          id: "p1",
          address: [
            { line: ["1 ZZSTREET"], state: { zzInner: "ZZINNERSTATE" }, postalCode: "62704" },
          ],
        }),
      ).resource,
      { context: ctx() },
    );
    expect(serializeResource(odd.document)).toContain("ZZINNERSTATE");
    expect(odd.unexaminedResiduals.map((r) => r.locus)).toContain(
      "Patient.address[0].state.zzInner",
    );
  });
});

/* ------------------------------------------------------------------ side channels (fixed headers) */

describe("closure: an NCPDP header's positions are read off the header, not off a list", () => {
  const request = parseTelecom(FIX("ncpdp", "telecom-b1.ncpdp"));
  const response = parseTelecom(FIX("ncpdp", "telecom-b1-response.ncpdp"));
  const req = deidentifyTelecom(request, { context: ctx() });
  const res = deidentifyTelecom(response, { context: ctx() });

  /** Every populated field of a decoded header, straight off the object the parser handed back. */
  const populated = (header: object): string[] =>
    Object.entries(header)
      .filter(([, v]) => typeof v === "string" && v.trim().length > 0)
      .map(([k]) => k);

  it("every populated field of the emitted REQUEST header is counted but the one a rule names", () => {
    const counted = new Set(
      req.unexaminedResiduals
        .filter((r) => r.locus.startsWith("header/"))
        .map((r) => r.locus.slice("header/".length)),
    );
    // The Date of Service is the one header position a rule reaches; every other populated field is a
    // position nothing examined, and the set is derived from the header rather than restated here.
    const owed = populated(request.header).filter((k) => k !== "dateOfService");
    expect([...counted].sort()).toEqual(owed.sort());
    expect(counted.has("dateOfService")).toBe(false);
  });

  it("a RESPONSE is measured on the header whose bytes reach the output, in full", () => {
    const responseHeader = response.responseHeader;
    expect(responseHeader).toBeDefined();
    const counted = new Set(
      res.unexaminedResiduals
        .filter((r) => r.locus.startsWith("header/"))
        .map((r) => r.locus.slice("header/".length)),
    );
    expect([...counted].sort()).toEqual(populated(responseHeader ?? {}).sort());
    // The derived view's request-only fields are NOT counted: those bytes never reach the output.
    expect(counted.has("binNumber")).toBe(false);
    expect(counted.has("processorControlNumber")).toBe(false);
  });
});

/* ------------------------------------------------------------------ alternate carriers (X12) */

const X12_WHITESPACE =
  "ISA*00*          *00*          *ZZ*SENDER         *ZZ*RECEIVER       *250101*1200*^*00501*000000001*0*P*:~" +
  "GS*HC*S*R*20250101*1200*1*X*005010X222A2~" +
  "ST*837*0001~" +
  "BHT*0019*00*ZZREF1*20250101*1200*CH~" +
  "NTE*ADD*note*   *ZZTAIL~" +
  "SE*4*0001~GE*1*1~IEA*1*000000001~";

describe("closure: a whitespace-only X12 element outside the fixed-width ISA", () => {
  const result = deidentifyX12(parseX12(X12_WHITESPACE), { context: ctx() });
  const loci = new Set(result.unexaminedResiduals.map((r) => r.locus));

  it("the element is re-emitted verbatim (non-vacuity)", () => {
    expect(result.x12).toContain("*   *ZZTAIL");
  });

  it("counts it: the definition says non-empty, and whitespace there is content", () => {
    expect(loci.has("837/NTE[0]-3")).toBe(true);
    expect(loci.has("837/NTE[0]-4")).toBe(true);
  });

  it("does NOT count the ISA's blank fill, which the standard pads to a declared width", () => {
    expect(loci.has("ISA[0]-2")).toBe(false);
    expect(loci.has("ISA[0]-4")).toBe(false);
    expect(loci.has("ISA[0]-6")).toBe(true); // and the populated ISA positions still are counted
  });
});

/* ------------------------------------------------------------------ the model-shape tripwires */

/**
 * The guards that keep the class **closed rather than merely fixed**. Each asserts that an enumeration's
 * carrier set is the model's carrier set, so a peer that grows a field, or a walk that quietly narrows,
 * reddens here instead of shipping a silence.
 */
describe("closure: the enumeration's carrier set is the model's carrier set", () => {
  it("C-CDA: every non-element child node with data is a position, whatever kind it is", () => {
    // Six carriers under one element: two comments, two CDATA sections and two processing
    // instructions. The assertion is the COUNT, so an enumeration keyed on a fixed list of kinds
    // rather than on the child-node space cannot satisfy it by naming three of them.
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<ClinicalDocument xmlns="urn:hl7-org:v3">
  <title>ZZTITLE</title>
  <component><structuredBody><component><section>
    <code code="11450-4" codeSystem="2.16.840.1.113883.6.1"/>
    <entry><observation classCode="OBS" moodCode="EVN"><zzCarriers><!-- ZZC1 --><![CDATA[ZZC2]]><?zzA ZZC3?><!-- ZZC4 --><![CDATA[ZZC5]]><?zzB ZZC6?></zzCarriers></observation></entry>
  </section></component></structuredBody></component>
</ClinicalDocument>`;
    const result = deidentifyCcda(parseCcda(xml), { context: ctx() });
    const wire = serializeCcda(result.document);
    for (const s of ["ZZC1", "ZZC2", "ZZC3", "ZZC4", "ZZC5", "ZZC6"]) expect(wire).toContain(s);
    const carriers = result.unexaminedResiduals.filter((r) => r.locus.includes("/zzCarriers/#"));
    expect(carriers.reduce((t, r) => t + r.count, 0)).toBe(6);
  });

  it("C-CDA: the three named carrier kinds ARE the whole space, which is why four is enough", () => {
    // The claim above ("whatever kind it is") is only closed if no fifth kind can be a child of an
    // element. The hardened DOM says so itself: it refuses an entity reference, the one remaining
    // candidate the DOM specification defines, so the walk's node-kind set is exhaustive rather than
    // merely long. The module keeps a withheld fallback anyway, for a DOM that would accept one.
    const dom = parseSecureXml(
      `<?xml version="1.0" encoding="UTF-8"?><ClinicalDocument xmlns="urn:hl7-org:v3"><title>ZZTITLE</title></ClinicalDocument>`,
      resolveLimits(undefined),
      () => {
        /* parse warnings are not part of this assertion */
      },
    );
    const root = dom.documentElement;
    expect(root).not.toBeNull();
    const reference = dom.createEntityReference("zzEnt");
    expect(reference.nodeType).toBe(5); // a real node of a kind the segments do not name
    expect(() => root?.appendChild(reference)).toThrow(/Unexpected node type 5/);
  });

  it("FHIR: a primitive carries exactly `value`, `id` and `extension` beside its kind", () => {
    // The tripwire for a peer that starts modelling a fourth place a value can sit on a primitive:
    // the key set moves and this reddens, instead of the new carrier going uncounted.
    const parsed = parseResource(
      JSON.stringify({
        resourceType: "Observation",
        status: "final",
        _status: { id: "ZZKEYSETID", extension: [{ url: "http://zz.example" }] },
      }),
    ).resource;
    const status = parsed.properties.find((p) => p.name === "status")?.value;
    expect(status).toBeDefined();
    expect(Object.keys(status ?? {}).sort()).toEqual(["extension", "id", "kind", "value"]);
  });

  it("DICOM: a File Meta field whose PS3.10 tag is unknown keeps its count and loses its locus", () => {
    // The typed File Meta view is the peer's, so a field it gains is a position the day it ships.
    // The enumeration reads the group's own keys; a key it cannot place is recorded WITHHELD rather
    // than dropped, which is the first fail-safe applied to a carrier instead of to a token.
    // A field the typed view does not have TODAY: exactly what a future peer release would add.
    const future: Record<string, string> = { zzFutureFileMetaField: "ZZFUTUREVALUE" };
    const withUnknownField: EnumerableDataset = {
      elements: () => [],
      fileMeta: { transferSyntaxUID: "1.2.840.10008.1.2.1", ...future },
    };
    const residuals = deriveUnexaminedResiduals(withUnknownField, EMPTY_ANNEX_E_REPORT);
    const withheld = residuals.filter((r) => r.locusWithheld);
    expect(withheld).toHaveLength(1);
    expect(withheld[0]?.count).toBe(1);
    expect(withheld[0]?.locus).not.toContain("ZZFUTUREVALUE");
    expect(withheld[0]?.locus).not.toContain("zzFutureFileMetaField");
    // And the field it CAN place is still located, so the fallback is not swallowing the group.
    expect(residuals.some((r) => r.locus.includes("(0002,0010)"))).toBe(true);
  });

  it("DICOM: nothing in the committed fixture's File Meta group needs the withheld fallback", () => {
    // The other half of the same tripwire: on a real dataset every File Meta position is placed, so a
    // withheld one here would mean the peer's view moved under us.
    const { unexaminedResiduals } = deidentifyDicom(buildPhiDataset());
    expect(unexaminedResiduals.filter((r) => r.locusWithheld)).toEqual([]);
  });

  it("HL7 v2: the walk covers the model's whole carrier tree, subcomponents included", () => {
    // HL7's carriers are segment / field / repetition / component / subcomponent and nothing else, so
    // this adapter has no side channel to miss. The guard is that the finest carrier is reached: a
    // component whose FIRST subcomponent is empty is still a position, because a later one carries.
    // No PID: this case is about the finest CARRIER, so the message carries no demographic at all.
    const wire =
      "MSH|^~\\&|APP|FAC|RCV|RFAC|20240101120000||ORU^R01|ZZMSG901|P|2.5.1\r" +
      "NTE|1|L|note|&ZZSUBCOMPONENT\r";
    const { unexaminedResiduals } = deidentifyHl7(parseHL7(wire), { context: ctx() });
    const loci = new Set(unexaminedResiduals.map((r) => r.locus));
    expect(loci.has("NTE-4")).toBe(true);
  });
});

/* ------------------------------------------------------------------ the inventory floor */

describe("closure: the measured inventory over every committed fixture", () => {
  /** The number of positions a pass measured: loci are aggregated, so counts are summed. */
  const total = (residuals: readonly { readonly count: number }[]): number =>
    residuals.reduce((t, r) => t + r.count, 0);

  const measured: Record<string, number> = {
    "hl7 adt-a01": total(
      deidentifyHl7(parseHL7(FIX("hl7", "adt-a01.hl7")), { context: ctx() }).unexaminedResiduals,
    ),
    "hl7 oru-r01": total(
      deidentifyHl7(parseHL7(FIX("hl7", "oru-r01.hl7")), { context: ctx() }).unexaminedResiduals,
    ),
    ccda: total(
      deidentifyCcda(parseCcda(FIX("ccda", "ccd.xml")), { context: ctx() }).unexaminedResiduals,
    ),
    fhir: total(
      deidentifyFhir(parseResource(FIX("fhir", "bundle.json")).resource, { context: ctx() })
        .unexaminedResiduals,
    ),
    x12: total(
      deidentifyX12(parseX12(FIX("x12", "837p.edi")), { context: ctx() }).unexaminedResiduals,
    ),
    "ncpdp request": total(
      deidentifyTelecom(parseTelecom(FIX("ncpdp", "telecom-b1.ncpdp")), { context: ctx() })
        .unexaminedResiduals,
    ),
    "ncpdp response": total(
      deidentifyTelecom(parseTelecom(FIX("ncpdp", "telecom-b1-response.ncpdp")), { context: ctx() })
        .unexaminedResiduals,
    ),
  };

  it("every adapter measures a non-zero inventory: none is silently at zero", () => {
    for (const [name, count] of Object.entries(measured)) {
      expect(count, `${name} measured nothing`).toBeGreaterThan(0);
    }
  });

  it("the per-fixture totals are pinned, so a class that stops being counted is a number", () => {
    expect(measured).toMatchInlineSnapshot(`
      {
        "ccda": 62,
        "fhir": 51,
        "hl7 adt-a01": 39,
        "hl7 oru-r01": 61,
        "ncpdp request": 15,
        "ncpdp response": 13,
        "x12": 82,
      }
    `);
  });
});
