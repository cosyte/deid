/**
 * **FHIR R4: content the pass does not read, removed by default, kept only on the caller's word.**
 *
 * An `Attachment.data`, a `Binary.data`, a `Signature.data` and any other `base64Binary` can hold a
 * whole document (a scanned form, a PDF, a C-CDA) in valid base64, and an `Attachment.url` points at
 * such content or, as a `data:` url, carries it. The pass reads none of it. So under Safe Harbor and
 * the Limited Data Set each one is removed with a manifest row that carries no value, at every depth
 * and in every place R4 types one. A caller who knows the content is safe names its kind in
 * `keepEmbeddedContent`, and each kept element is recorded as `DEID_EMBEDDED_CONTENT_RETAINED`. An
 * extension's `valueBase64Binary` and the narrative `div` were already removed, and no kind keeps them.
 *
 * Every value is synthetic and built here: the embedded document is a made-up note naming `Zzembed`.
 */

import { describe, expect, it } from "vitest";
import { getProperty, isPrimitive, parseResource } from "@cosyte/fhir";

import {
  createDeidContext,
  deidentify,
  DEID_DISPOSITION_CODES,
  LIMITED_DATA_SET_PROFILE,
  profileOptions,
  SAFE_HARBOR_CATEGORIES,
  SAFE_HARBOR_PROFILE,
} from "../../src/index.js";
import {
  deidentifyFhirJson,
  extractFhirLoci,
  FHIR_EMBEDDED_CONTENT_KINDS,
  type FhirDeidOptions,
  type FhirEmbeddedContentKind,
} from "../../src/fhir/index.js";

const ctx = createDeidContext({ key: "fhir-embedded-content-synthetic-key", patientId: "p" });

const PROFILES = [SAFE_HARBOR_PROFILE, LIMITED_DATA_SET_PROFILE] as const;

/** The made-up note an embedded document carries, and its base64 form. */
const NOTE = "<note>Patient Zzembed Zzperson, MRN ZZ000123</note>";
const B64 = Buffer.from(NOTE).toString("base64");
const DATA_URL = `data:text/plain;base64,${B64}`;
const LINK = "http://example.org/fhir/Binary/zzembed-1";

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

/** A `DocumentReference` holding one attachment. */
function docRef(attachment: Json): Json {
  return { resourceType: "DocumentReference", status: "current", content: [{ attachment }] };
}

/** A `Provenance` whose signature carries `data`. */
function provenance(data: string): Json {
  return {
    resourceType: "Provenance",
    target: [{ reference: "Observation/zz-1" }],
    recorded: "2020-01-01T00:00:00Z",
    agent: [{ who: { reference: "Device/zz-1" } }],
    signature: [
      {
        type: [{ system: "urn:iso-astm:E1762-95:2013", code: "1.2.840.10065.1.12.1.1" }],
        when: "2020-01-01T00:00:00Z",
        who: { reference: "Device/zz-1" },
        data,
      },
    ],
  };
}

/**
 * Each position that embeds content: a label, the document, the locus of the element, the text that
 * must not come back, and the kind that keeps it.
 */
const POSITIONS: readonly (readonly [string, Json, string, string, FhirEmbeddedContentKind])[] = [
  [
    "DocumentReference attachment.data",
    docRef({ contentType: "text/plain", data: B64 }),
    "DocumentReference.content[0].attachment.data",
    B64,
    "attachment-data",
  ],
  [
    "Media content.data",
    {
      resourceType: "Media",
      status: "completed",
      content: { contentType: "image/png", data: B64 },
    },
    "Media.content.data",
    B64,
    "attachment-data",
  ],
  [
    "DiagnosticReport presentedForm[0].data",
    {
      resourceType: "DiagnosticReport",
      status: "final",
      code: { text: "zz" },
      presentedForm: [{ contentType: "application/pdf", data: B64 }],
    },
    "DiagnosticReport.presentedForm[0].data",
    B64,
    "attachment-data",
  ],
  [
    "Communication payload contentAttachment.data",
    {
      resourceType: "Communication",
      status: "completed",
      payload: [{ contentAttachment: { contentType: "text/plain", data: B64 } }],
    },
    "Communication.payload[0].contentAttachment.data",
    B64,
    "attachment-data",
  ],
  [
    "QuestionnaireResponse answer valueAttachment.data",
    {
      resourceType: "QuestionnaireResponse",
      status: "completed",
      item: [{ linkId: "1", answer: [{ valueAttachment: { data: B64 } }] }],
    },
    "QuestionnaireResponse.item[0].answer[0].valueAttachment.data",
    B64,
    "attachment-data",
  ],
  [
    "attachment.url to a server",
    docRef({ contentType: "text/plain", url: LINK }),
    "DocumentReference.content[0].attachment.url",
    LINK,
    "attachment-url",
  ],
  [
    "attachment.url as a data: url",
    docRef({ url: DATA_URL }),
    "DocumentReference.content[0].attachment.url",
    B64,
    "attachment-url",
  ],
  [
    "Binary.data",
    { resourceType: "Binary", contentType: "text/plain", data: B64 },
    "Binary.data",
    B64,
    "binary-data",
  ],
  [
    "Provenance signature.data",
    provenance(B64),
    "Provenance.signature[0].data",
    B64,
    "signature-data",
  ],
  [
    "attachment.hash",
    docRef({ contentType: "text/plain", hash: B64 }),
    "DocumentReference.content[0].attachment.hash",
    B64,
    "base64-binary",
  ],
  [
    "Device udiCarrier.carrierAIDC",
    { resourceType: "Device", udiCarrier: [{ deviceIdentifier: "zz", carrierAIDC: B64 }] },
    "Device.udiCarrier[0].carrierAIDC",
    B64,
    "base64-binary",
  ],
  [
    "Parameters valueBase64Binary",
    { resourceType: "Parameters", parameter: [{ name: "zz", valueBase64Binary: B64 }] },
    "Parameters.parameter[0].valueBase64Binary",
    B64,
    "base64-binary",
  ],
  [
    "AuditEvent entity.query",
    {
      resourceType: "AuditEvent",
      type: { code: "zz" },
      recorded: "2020-01-01T00:00:00Z",
      agent: [{ requestor: true }],
      source: { observer: { reference: "Device/zz-1" } },
      entity: [{ query: B64 }],
    },
    "AuditEvent.entity[0].query",
    B64,
    "base64-binary",
  ],
];

/** Run the pass under a profile, with the given options on top. */
function run(doc: Json, profile: (typeof PROFILES)[number], options: FhirDeidOptions = {}) {
  return deidentifyFhirJson(JSON.stringify(doc), { ...profileOptions(profile, ctx), ...options });
}

describe("embedded content is removed by default, with a row that carries no value", () => {
  for (const profile of PROFILES) {
    it.each(POSITIONS)(`%s, under ${profile.name}`, (_label, doc, locus, text) => {
      const { json, manifest, unexaminedResiduals } = run(doc, profile);
      expect(json).not.toContain(text);
      expect(json).not.toContain("Zzembed");
      expect(manifest).toContainEqual(
        expect.objectContaining({
          locus,
          disposition: "blocked",
          code: DEID_DISPOSITION_CODES.DEID_LOCUS_BLOCKED,
          category: SAFE_HARBOR_CATEGORIES.OTHER_UNIQUE_ID,
        }),
      );
      expect(JSON.stringify(manifest)).not.toContain(text);
      expect(unexaminedResiduals.map((r) => r.locus)).not.toContain(locus);
    });
  }

  it("in a contained resource and in a Bundle entry", () => {
    const binary = { resourceType: "Binary", contentType: "text/plain", data: B64 };
    const contained = {
      resourceType: "DocumentReference",
      status: "current",
      contained: [binary],
      content: [{ attachment: { contentType: "text/plain", data: B64 } }],
    };
    const bundle = { resourceType: "Bundle", type: "collection", entry: [{ resource: contained }] };
    for (const profile of PROFILES) {
      const { json, manifest } = run(bundle, profile);
      expect(json).not.toContain(B64);
      const loci = manifest.filter((e) => e.disposition === "blocked").map((e) => e.locus);
      expect(loci).toEqual(
        expect.arrayContaining([
          "Bundle.entry[0].resource.contained[0].data",
          "Bundle.entry[0].resource.content[0].attachment.data",
        ]),
      );
    }
  });

  it("the rest of the attachment is kept: its content type, title and size", () => {
    const doc = docRef({ contentType: "text/plain", title: "zz note", size: 12, data: B64 });
    const { json } = run(doc, SAFE_HARBOR_PROFILE);
    expect(JSON.parse(json)).toEqual(
      docRef({ contentType: "text/plain", title: "zz note", size: 12 }),
    );
  });

  it("an extension's valueBase64Binary and the narrative div stay removed, as before", () => {
    const doc = {
      resourceType: "Observation",
      status: "final",
      code: { text: "zz" },
      text: { status: "generated", div: `<div xmlns="http://www.w3.org/1999/xhtml">Zzembed</div>` },
      extension: [{ url: "http://example.org/zz-embed", valueBase64Binary: B64 }],
    };
    for (const profile of PROFILES) {
      for (const keep of [[], [...FHIR_EMBEDDED_CONTENT_KINDS]]) {
        const { json, manifest } = run(doc, profile, { keepEmbeddedContent: keep });
        expect(json).not.toContain(B64);
        expect(json).not.toContain("Zzembed");
        expect(manifest.map((e) => [e.locus, e.code])).toEqual(
          expect.arrayContaining([
            ["Observation.text.div", DEID_DISPOSITION_CODES.DEID_LOCUS_BLOCKED],
            [
              "Observation.extension[0].valueBase64Binary",
              DEID_DISPOSITION_CODES.DEID_LOCUS_BLOCKED,
            ],
          ]),
        );
      }
    }
  });
});

describe("keepEmbeddedContent keeps the kinds a caller names, and records each keep", () => {
  for (const profile of PROFILES) {
    it.each(POSITIONS)(
      `%s, kept by its kind, under ${profile.name}`,
      (_l, doc, locus, text, kind) => {
        const { json, manifest, unexaminedResiduals } = run(doc, profile, {
          keepEmbeddedContent: [kind],
        });
        expect(json).toContain(text);
        expect(manifest).toContainEqual({
          category: SAFE_HARBOR_CATEGORIES.OTHER_UNIQUE_ID,
          transform: "retain",
          locus,
          count: 1,
          disposition: "retained",
          code: DEID_DISPOSITION_CODES.DEID_EMBEDDED_CONTENT_RETAINED,
          reidentificationCode: false,
        });
        expect(manifest.filter((e) => e.locus === locus)).toHaveLength(1);
        expect(JSON.stringify(manifest)).not.toContain(text);
        expect(unexaminedResiduals.map((r) => r.locus)).not.toContain(locus);
      },
    );

    it.each(POSITIONS)(
      `%s, not kept by another kind, under ${profile.name}`,
      (_l, doc, locus, text, kind) => {
        const others = FHIR_EMBEDDED_CONTENT_KINDS.filter((k) => k !== kind);
        const { json, manifest } = run(doc, profile, { keepEmbeddedContent: others });
        expect(json).not.toContain(text);
        expect(manifest).toContainEqual(
          expect.objectContaining({ locus, code: DEID_DISPOSITION_CODES.DEID_LOCUS_BLOCKED }),
        );
      },
    );
  }

  it("a kind is kept on its own: the data is kept and the url beside it removed", () => {
    const doc = docRef({ contentType: "text/plain", url: LINK, data: B64 });
    const { json, manifest } = run(doc, SAFE_HARBOR_PROFILE, {
      keepEmbeddedContent: ["attachment-data"],
    });
    expect(JSON.parse(json)).toEqual(docRef({ contentType: "text/plain", data: B64 }));
    expect(manifest.map((e) => [e.locus, e.code])).toEqual([
      ["DocumentReference.content[0].attachment.url", DEID_DISPOSITION_CODES.DEID_LOCUS_BLOCKED],
      [
        "DocumentReference.content[0].attachment.data",
        DEID_DISPOSITION_CODES.DEID_EMBEDDED_CONTENT_RETAINED,
      ],
    ]);
  });

  it("a value that is not a kind keeps nothing", () => {
    const doc = { resourceType: "Binary", contentType: "text/plain", data: B64 };
    const keep = ["zz-not-a-kind", "Binary.data"] as unknown as FhirEmbeddedContentKind[];
    const { json } = run(doc, SAFE_HARBOR_PROFILE, { keepEmbeddedContent: keep });
    expect(json).not.toContain(B64);
  });

  it("a kept value that does not fit base64Binary is still blocked", () => {
    const doc = { resourceType: "Binary", contentType: "text/plain", data: `${B64} Zzembed!` };
    const { json, manifest } = run(doc, SAFE_HARBOR_PROFILE, {
      keepEmbeddedContent: ["binary-data"],
    });
    expect(json).not.toContain("Zzembed");
    expect(manifest).toContainEqual(
      expect.objectContaining({ locus: "Binary.data", disposition: "blocked" }),
    );
  });

  it("names every kind, in a fixed order", () => {
    expect(FHIR_EMBEDDED_CONTENT_KINDS).toEqual([
      "attachment-data",
      "attachment-url",
      "binary-data",
      "signature-data",
      "base64-binary",
    ]);
    expect(Object.isFrozen(FHIR_EMBEDDED_CONTENT_KINDS)).toBe(true);
  });

  it("extractFhirLoci takes the option too: the record carries no value", () => {
    const { resource } = parseResource(
      JSON.stringify({ resourceType: "Binary", contentType: "text/plain", data: B64 }),
    );
    const kept = extractFhirLoci(resource, { keepEmbeddedContent: ["binary-data"] });
    expect(kept.loci).toEqual([
      { path: "Binary.data", kind: "unknown", embeddedContentKept: true, value: "" },
    ]);
    // The record's coordinate names a stand-in with no value, never the kept node, so the applier
    // writes nothing for it and the kept value is written as it arrived.
    const data = getProperty(resource, "data");
    expect(kept.coords).toHaveLength(1);
    const [coord] = kept.coords;
    expect(coord?.edit).toBe("drop");
    expect(coord?.node).not.toBe(data);
    expect(coord !== undefined && isPrimitive(coord.node) && coord.node.value).toBe(undefined);
    const removed = extractFhirLoci(resource);
    expect(removed.loci).toEqual([{ path: "Binary.data", kind: "unknown", value: B64 }]);
  });
});

describe("the engine's embedded-content record", () => {
  it("is a retained row with no value written back", () => {
    const { document, manifest } = deidentify(
      { loci: [{ path: "X.data", kind: "unknown", embeddedContentKept: true, value: "" }] },
      {},
    );
    expect(document.loci[0]).toMatchObject({ value: "", disposition: "retained" });
    expect(manifest).toEqual([
      {
        category: SAFE_HARBOR_CATEGORIES.OTHER_UNIQUE_ID,
        transform: "retain",
        locus: "X.data",
        count: 1,
        disposition: "retained",
        code: DEID_DISPOSITION_CODES.DEID_EMBEDDED_CONTENT_RETAINED,
        reidentificationCode: false,
      },
    ]);
  });

  it("a record that carries a value is blocked, never kept", () => {
    const { document, manifest } = deidentify(
      {
        loci: [
          {
            path: "X.data",
            kind: "identifier",
            category: SAFE_HARBOR_CATEGORIES.NAMES,
            embeddedContentKept: true,
            value: "Zzembed",
          },
        ],
      },
      {},
    );
    expect(document.loci[0]).toMatchObject({ value: null, disposition: "blocked" });
    expect(manifest).toEqual([
      expect.objectContaining({
        locus: "X.data",
        category: SAFE_HARBOR_CATEGORIES.OTHER_UNIQUE_ID,
        code: DEID_DISPOSITION_CODES.DEID_LOCUS_BLOCKED,
      }),
    ]);
  });

  it("a locus marked false takes its policy transform as before", () => {
    const { manifest } = deidentify(
      {
        loci: [
          {
            path: "X.name",
            kind: "identifier",
            category: SAFE_HARBOR_CATEGORIES.NAMES,
            embeddedContentKept: false,
            value: "Zzembed",
          },
        ],
      },
      {},
    );
    expect(manifest).toEqual([
      expect.objectContaining({ code: DEID_DISPOSITION_CODES.DEID_CATEGORY_REMOVED }),
    ]);
  });
});
