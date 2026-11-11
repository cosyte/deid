/**
 * **What the generated leak property found**, one test per defect, each with the smallest input that
 * showed it. Every value is a synthetic sentinel (`ZQLK...`) or a published code.
 *
 * Each defect was the same class the property exists for: a value in a shape the rule did not expect,
 * kept verbatim. Each fix fails closed: the unexpected shape is removed and recorded, never kept.
 *
 * The last block pins the keeps the property also reaches and this change does NOT close. Each is a
 * decision the adapter takes on purpose (a code-shaped value at a position that keeps codes) and each
 * is named on the limitations page. Each pin asserts that the value still survives, so the day a
 * change closes one, its pin turns red and is moved, rather than the limitations page going stale.
 */

import { describe, expect, it } from "vitest";
import { parseHL7 } from "@cosyte/hl7";
import { parseResource, serializeResource } from "@cosyte/fhir";
import { parseCcda } from "@cosyte/ccda";
import { buildTelecomRequest, serializeTelecom } from "@cosyte/ncpdp/telecom";

import {
  createDeidContext,
  defineDeidPolicy,
  DEID_DISPOSITION_CODES as D,
  SAFE_HARBOR_CATEGORIES as C,
} from "../../src/index.js";
import { deidentifyHl7 } from "../../src/hl7/index.js";
import { deidentifyFhir } from "../../src/fhir/index.js";
import { deidentifyCcda } from "../../src/ccda/index.js";
import { deidentifyX12String } from "../../src/x12/index.js";
import { deidentifyTelecomString } from "../../src/ncpdp/index.js";

const ctx = createDeidContext({ key: "leak-found-synthetic-key", patientId: "p-found" });

const MSH = "MSH|^~\\&|A|B|C|D|20200101||ADT^A01|M1|P|2.5";

/** Run one HL7 message and return the wire, the manifest loci and codes, and the residual loci. */
function hl7(segments: string): { wire: string; rows: string[]; residuals: string[] } {
  const r = deidentifyHl7(parseHL7(`${MSH}\r${segments}`), { context: ctx });
  return {
    wire: r.hl7,
    rows: r.manifest.map((m) => `${m.locus} ${m.code}`),
    residuals: r.unexaminedResiduals.map((x) => x.locus),
  };
}

/** Run one FHIR JSON value and return the output JSON, the wire and the manifest. */
function fhir(json: unknown): {
  out: Record<string, unknown>;
  wire: string;
  rows: string[];
} {
  const { resource } = parseResource(JSON.stringify(json));
  const r = deidentifyFhir(resource, { context: ctx });
  const wire = serializeResource(r.document);
  return {
    out: JSON.parse(wire) as Record<string, unknown>,
    wire,
    rows: r.manifest.map((m) => `${m.locus} ${m.code}`),
  };
}

describe("HL7 v2: an identifier keeps only its replaced number, its authority and a known type code", () => {
  it("an identifier type code that is not an HL7 Table 0203 code is removed", () => {
    const { wire } = hl7("PID|1||ZZMRN001^^^HOSP^ZQLKCXFV00X");
    expect(wire).not.toContain("ZQLKCXFV00X");
    // A Table 0203 code is still kept, with the authority.
    expect(hl7("PID|1||ZZMRN001^^^HOSP^MR").wire).toContain("PID|1||^^^HOSP^MR");
  });

  it("the check digit, the facility, the dates and the agency of an identifier are removed", () => {
    const { wire } = hl7(
      "PID|1||ZZMRN001^ZQLKCDIG00X^M10^HOSP^MR^ZQLKFACL01X^20200101^20250101^ZQLKJURI02X^ZQLKAGCY03X",
    );
    for (const s of ["ZQLKCDIG00X", "ZQLKFACL01X", "ZQLKJURI02X", "ZQLKAGCY03X", "20250101"]) {
      expect(wire).not.toContain(s);
    }
    expect(wire).toContain("PID|1||^^^HOSP^MR");
  });

  it("a repetition with no identifier number is blocked, not kept whole", () => {
    const { wire, rows } = hl7("PID|1||ZZMRN001^^^HOSP^MR~^ZQLKNOID00X^^^ZQLKTYPE01X");
    expect(wire).not.toContain("ZQLKNOID00X");
    expect(wire).not.toContain("ZQLKTYPE01X");
    expect(rows).toContain(`PID-3[1] ${D.DEID_LOCUS_BLOCKED}`);
  });

  it("and in the visit number a retained PV1 carries (PV1-19)", () => {
    const pv1 = ["PV1", "1", "I", ...Array<string>(16).fill(""), "^ZQLKVNUM00X^^HOSP^VN"];
    const { wire, rows } = hl7(pv1.join("|"));
    expect(wire).not.toContain("ZQLKVNUM00X");
    expect(wire).toContain("^^^HOSP^VN");
    expect(rows).toContain(`PV1-19[0] ${D.DEID_LOCUS_BLOCKED}`);
  });

  it("the same holds at every identifier the map names: a policy number held as a composite", () => {
    // IN1-36, the policy number, written as a composite.
    const in1 = ["IN1", "1", "PLAN1", ...Array<string>(33).fill(""), "ZQLKPOL00X^ZQLKPOLB01X"];
    const { wire } = hl7(in1.join("|"));
    expect(wire).not.toContain("ZQLKPOLB01X");
  });
});

describe("HL7 v2: a date field keeps only the date it was reduced to", () => {
  it("a component after the date in a retained segment's date field is removed", () => {
    const { wire } = hl7("PID|1||ZZMRN001^^^HOSP^MR\rEVN|A01|20200101^ZQLKPREC00X");
    expect(wire).not.toContain("ZQLKPREC00X");
    expect(wire).toContain("EVN|A01|2020\r");
  });

  it("a date component whose date is empty but which holds a value in a subcomponent is blocked", () => {
    // SPM-17, the collection date range: its start (component 1) is a date position of its own.
    const spm = ["SPM", "1", ...Array<string>(15).fill(""), "&ZQLKSPMD00X^20200102"];
    const { wire, rows } = hl7(spm.join("|"));
    expect(wire).not.toContain("ZQLKSPMD00X");
    expect(rows).toContain(`SPM-17[0].1 ${D.DEID_LOCUS_BLOCKED}`);
  });

  it("a date field whose date is empty but which holds a value elsewhere is blocked", () => {
    expect(hl7("EVN|A01|^ZQLKEDAT00X").wire).not.toContain("ZQLKEDAT00X");
    expect(hl7("EVN|A01|&ZQLKEDAT01X").wire).not.toContain("ZQLKEDAT01X");
  });
});

describe("X12: a party's own reference number is kept only under a party its role keeps", () => {
  // Found by the X12 property on seed -614318039: `REF*0B*<value>` in a 270, kept with no party before
  // it. A REF that names a party's own number (a license, a tax id, a provider, payer, payee,
  // submitter or receiver number) is the individual's own when the party it follows is the individual,
  // a relative or an employer, or when no party says whose it is.
  const envelope = (gs: string, st: string, guide: string): string =>
    "ISA*00*          *00*          *ZZ*A              *ZZ*A              *000101*0000*^*00501*000000001*0*P*:~" +
    `GS*${gs}*A*A*20000101*0000*1*X*${guide}~ST*${st}*0001*${guide}~`;
  function x12(body: string, st = "270"): { out: string; rows: string[] } {
    const head =
      st === "834"
        ? envelope("BE", "834", "005010X220A1")
        : st === "820"
          ? envelope("RA", "820", "005010X218")
          : envelope("HS", "270", "005010X279A1");
    const count = body.split("~").length + 1;
    const r = deidentifyX12String(
      `${head}${body}SE*${String(count)}*0001~GE*1*1~IEA*1*000000001~`,
      { context: ctx },
    );
    return { out: r.x12, rows: r.manifest.map((m) => `${m.locus} ${m.code}`) };
  }

  const PARTY_NUMBERS = [
    "0B",
    "1A",
    "1B",
    "1C",
    "1D",
    "1G",
    "1J",
    "2U",
    "D3",
    "EI",
    "EO",
    "EV",
    "EW",
    "FY",
    "G2",
    "HPI",
    "LU",
    "N5",
    "N7",
    "PQ",
    "TJ",
    "X4",
  ];
  const BEFORE: readonly (readonly [string, string])[] = [
    ["after the patient's own party", "NM1*IL*1*ZZFAMILY~"],
    ["after a party that is not a provider (an employer)", "N1*36*ZZEMPLOYER~"],
    ["after a party whose role is not recognised", "NM1*XQ9*2*ZZORG~"],
    ["with no party before it", ""],
  ];
  const CASES = PARTY_NUMBERS.flatMap((q) => BEFORE.map(([label, party]) => [q, label, party]));

  it.each(CASES)("a %s reference %s is removed and recorded", (qualifier, _label, party) => {
    const { out, rows } = x12(`${party ?? ""}REF*${qualifier ?? ""}*ZQLKREFA00X~`);
    expect(out).not.toContain("ZQLKREFA00X");
    expect(rows).toContain(`270/REF[0]-2 ${D.DEID_LOCUS_BLOCKED}`);
  });

  it.each(PARTY_NUMBERS)(
    "a %s reference after a party its role keeps (a provider) is kept",
    (q) => {
      expect(x12(`NM1*1P*2*ZZORG~REF*${q}*ZQLKREFC02X~`).out).toContain("ZQLKREFC02X");
    },
  );

  it("a new HL level starts a new section: a provider before it does not vouch for the REF", () => {
    const { out, rows } = x12("NM1*1P*2*ZZORG~HL*2*1*22*0~REF*0B*ZQLKREFE04X~");
    expect(out).not.toContain("ZQLKREFE04X");
    expect(rows).toContain(`270/REF[0]-2 ${D.DEID_LOCUS_BLOCKED}`);
    // A provider inside the new level still vouches for its own REF.
    expect(x12("HL*2*1*22*0~NM1*1P*2*ZZORG~REF*0B*ZQLKREFF05X~").out).toContain("ZQLKREFF05X");
  });

  it("in an 834, a member's INS starts a new section: the header's party does not vouch for it", () => {
    const { out, rows } = x12("NM1*1P*2*ZZORG~INS*Y*18*030*XN*A~REF*0B*ZQLKREFG06X~", "834");
    expect(out).not.toContain("ZQLKREFG06X");
    expect(rows).toContain(`834/REF[0]-2 ${D.DEID_LOCUS_BLOCKED}`);
  });

  it("an administrative reference is kept by its qualifier alone, as before", () => {
    expect(x12("NM1*IL*1*ZZFAMILY~REF*G1*ZQLKREFD03X~").out).toContain("ZQLKREFD03X");
  });

  it("in an 820, an ENT starts a new section: a payee before it does not vouch for the REF", () => {
    // Non-conforming input (a party number with no NM1 after the ENT), the shape the property's
    // pin already read as a new section while the adapter did not.
    const { out, rows } = x12("N1*PE*ZZPAYEE~ENT*1~REF*0B*ZQLKREFH07X~", "820");
    expect(out).not.toContain("ZQLKREFH07X");
    expect(rows).toContain(`820/REF[0]-2 ${D.DEID_LOCUS_BLOCKED}`);
    // A payee inside the entity's own section still vouches for its REF.
    expect(x12("ENT*1~N1*PE*ZZPAYEE~REF*0B*ZQLKREFI08X~", "820").out).toContain("ZQLKREFI08X");
  });

  it("a provider NM1 with no name and no id vouches for nothing: no row, so no keep", () => {
    // The manifest records a party kept by role only when it names itself; the REF rule now agrees.
    const { out, rows } = x12("NM1*1P*2~REF*0B*ZQLKREFJ09X~");
    expect(out).not.toContain("ZQLKREFJ09X");
    expect(rows).toContain(`270/REF[0]-2 ${D.DEID_LOCUS_BLOCKED}`);
    expect(rows.some((r) => r.includes(D.DEID_PARTY_ROLE_RETAINED))).toBe(false);
  });
});

describe("X12: a trace number is replaced, the same one by the same value", () => {
  const isa =
    "ISA*00*          *00*          *ZZ*A              *ZZ*A              *000101*0000*^*00501*000000001*0*P*:~";
  function run(body: string): { out: string; rows: string[] } {
    const count = body.split("~").length + 1;
    const r = deidentifyX12String(
      `${isa}GS*HB*A*A*20000101*0000*1*X*005010X279A1~ST*271*0001*005010X279A1~${body}` +
        `SE*${String(count)}*0001~GE*1*1~IEA*1*000000001~`,
      { context: ctx },
    );
    return { out: r.x12, rows: r.manifest.map((m) => `${m.locus} ${m.code}`) };
  }

  it("TRN-02 is replaced and recorded, in every shape a trace number takes", () => {
    for (const trace of ["ZQLKTRAC00X", "ZQVAB", "Zqvabc", "93175012547"]) {
      const { out, rows } = run(`TRN*1*${trace}*9ZZORIGIN~`);
      expect(out).not.toContain(trace);
      expect(out).toContain("TRN*1*1*9ZZORIGIN~");
      expect(rows).toContain(`271/TRN[0]-2 ${D.DEID_IDENTIFIER_SUBSTITUTED}`);
    }
  });

  it("a reference element holding a second component or a repetition is removed whole", () => {
    // Found by the X12 property on seed -1577527710 once the TRN pin read the shape from the input:
    // `TRN-04` written as `A1:<value>` was kept whole, the value riding in its second component.
    const { out, rows } = run("TRN*1*ZZTRACE*9ZZORIGIN*A1:ZQLKAAAA00X~TRN*1*ZZTRACE*A1^ZQVABA~");
    expect(out).not.toContain("ZQLKAAAA00X");
    expect(out).not.toContain("ZQVABA");
    expect(rows).toContain(`271/TRN[0]-4 ${D.DEID_LOCUS_BLOCKED}`);
    expect(rows).toContain(`271/TRN[1]-3 ${D.DEID_LOCUS_BLOCKED}`);
    // One simple value is still kept.
    expect(run("TRN*1*ZZTRACE*9ZZORIGIN*ZZDIVISION~").out).toContain("*9ZZORIGIN*ZZDIVISION~");
  });

  it("a TRN with no trace number records nothing at TRN-02", () => {
    const { out, rows } = run("TRN*1~");
    expect(out).toContain("TRN*1~");
    expect(rows.filter((r) => r.startsWith("271/TRN"))).toEqual([]);
  });

  it("a trace number echoed in the same interchange gets the same replacement", () => {
    const { out } = run(
      "TRN*2*ZQLKTRAC01X*9ZZORIGIN~TRN*1*ZQLKTRAC02X*9ZZORIGIN~TRN*2*ZQLKTRAC01X*9ZZORIGIN~",
    );
    expect(out).toContain("TRN*2*1*9ZZORIGIN~TRN*1*2*9ZZORIGIN~TRN*2*1*9ZZORIGIN~");
  });
});

describe("NCPDP Telecom: a field a person segment keeps is kept only in its own format", () => {
  function telecom(segmentId: string, id: string, value: string): string {
    const tx = buildTelecomRequest({
      header: { transactionCode: "B1", binNumber: "999999", dateOfService: "20260115" },
      segments: [
        { segmentId, fields: [{ id, value }] },
        { segmentId: "07", fields: [{ id: "D7", value: "00000000000" }] },
      ],
    });
    return deidentifyTelecomString(serializeTelecom(tx), { context: ctx }).telecom;
  }

  it.each([
    ["01", "C5"],
    ["01", "CO"],
    ["01", "CX"],
    ["01", "4X"],
    ["01", "2C"],
    ["03", "EZ"],
    ["04", "C3"],
    ["05", "5C"],
    ["05", "6C"],
    ["05", "4C"],
    ["05", "7C"],
  ])("a value at %s/%s that is not in the field's format is removed", (seg, id) => {
    expect(telecom(seg, id, "ZQLKNCPD00X")).not.toContain("ZQLKNCPD00X");
  });

  it.each([
    ["01", "C5", "2"],
    ["01", "CO", "MA"],
    ["01", "CX", "01"],
    ["03", "EZ", "01"],
    ["04", "C3", "001"],
    ["05", "6C", "03"],
    ["05", "7C", "610014"],
    ["05", "7C", "12345"],
  ])("a value at %s/%s in the field's format is still kept", (seg, id, value) => {
    expect(telecom(seg, id, value)).toContain(value);
  });

  it.each(["ZQVABA", "Zqvaba", "ZQV 12345", "PAYERID99", "1234567", "1234", "44-1700"])(
    "an other payer id (05/7C) that is not five or six digits is removed: %s",
    (value) => {
      expect(telecom("05", "7C", value)).not.toContain(value);
    },
  );

  it.each(["ZQVABA", "ZQLKPCN00X", "MEDDPRIME", "4417"])(
    "an other payer processor control number (05/MH) is removed whatever it holds: %s",
    (value) => {
      expect(telecom("05", "MH", value)).not.toContain(value);
    },
  );
});

describe("FHIR: a conditional request header is removed", () => {
  const run = fhir({
    resourceType: "Bundle",
    type: "transaction",
    entry: [
      {
        resource: { resourceType: "Patient", active: true },
        request: {
          method: "POST",
          url: "Patient",
          ifNoneExist: "identifier=http://example.org/mrn|ZQLKIFNE00X",
          ifMatch: 'W/"ZQLKIFMA01X"',
          ifNoneMatch: 'W/"ZQLKIFNM02X"',
          ifModifiedSince: "2020-01-01T00:00:00Z",
        },
      },
      {
        resource: { resourceType: "Patient", active: false },
        request: { method: "POST", url: "Patient", ifNoneExist: "_id=ZQLKIFNE03X" },
      },
    ],
  });

  it("an identifier search, an id search and an entity tag do not survive", () => {
    for (const s of ["ZQLKIFNE00X", "ZQLKIFMA01X", "ZQLKIFNM02X", "ZQLKIFNE03X"]) {
      expect(run.wire).not.toContain(s);
    }
  });

  it("each is recorded as blocked at its own position", () => {
    for (const locus of [
      "Bundle.entry[0].request.ifNoneExist",
      "Bundle.entry[0].request.ifMatch",
      "Bundle.entry[0].request.ifNoneMatch",
      "Bundle.entry[1].request.ifNoneExist",
    ]) {
      expect(run.rows).toContain(`${locus} ${D.DEID_LOCUS_BLOCKED}`);
    }
  });

  it("the method and a type-only url are kept", () => {
    const entry = (run.out["entry"] as { request: Record<string, unknown> }[])[0];
    expect(entry?.request["method"]).toBe("POST");
    expect(entry?.request["url"]).toBe("Patient");
  });
});

describe("FHIR: a person resource keeps a string only where R4 puts a code it can check", () => {
  it.each(["link", "contact", "patient", "managingOrganization", "generalPractitioner"])(
    "a plain string at %s, where R4 expects a structure, is removed",
    (element) => {
      const run = fhir({ resourceType: "Patient", [element]: "ZQLKSTRG00X" });
      expect(run.wire).not.toContain("ZQLKSTRG00X");
      expect(run.rows).toContain(`Patient.${element} ${D.DEID_LOCUS_BLOCKED}`);
    },
  );

  it.each(["Patient", "Practitioner", "RelatedPerson", "Person"])(
    "a gender outside the R4 value set is removed from a %s",
    (resourceType) => {
      const run = fhir({ resourceType, gender: "ZQLKGNDR00X" });
      expect(run.wire).not.toContain("ZQLKGNDR00X");
    },
  );

  it("a gender in the value set and a language tag are kept", () => {
    const run = fhir({ resourceType: "Patient", gender: "female", language: "en-US" });
    expect(run.out["gender"]).toBe("female");
    expect(run.out["language"]).toBe("en-US");
  });

  it.each(["en", "es-419", "zh-Hant-TW", "pt-BR", "fr"])(
    "a language tag from the fixed list of primary subtags is kept: %s",
    (language) => {
      expect(fhir({ resourceType: "Patient", language }).out["language"]).toBe(language);
    },
  );

  it.each([
    "Smith",
    "Mary-Ann",
    "Zqvaba",
    "ZQVABA",
    "Li",
    "EN-us",
    "en-Latn-US-x-zqv",
    "haw",
    "xx-US",
  ])(
    "a language that is no tag from the fixed list, a short name included, is removed: %s",
    (language) => {
      const run = fhir({ resourceType: "Patient", language });
      expect(run.wire).not.toContain(language);
      expect(run.rows).toContain(`Patient.language ${D.DEID_LOCUS_BLOCKED}`);
    },
  );
});

describe("C-CDA: an id with no extension has its root replaced, the same root by the same value", () => {
  const doc = (header: string, body = ""): string => `<?xml version="1.0"?>
<ClinicalDocument xmlns="urn:hl7-org:v3">
${header}
<component><structuredBody><component><section><entry>
<observation classCode="OBS" moodCode="EVN">${body}</observation>
</entry></section></component></structuredBody></component>
</ClinicalDocument>`;
  function ccda(xml: string): { out: string; rows: string[] } {
    const r = deidentifyCcda(parseCcda(xml), { context: ctx });
    return { out: r.document.toString(), rows: r.manifest.map((m) => `${m.locus} ${m.code}`) };
  }

  it("a patient-role id with no extension, or an empty one, loses its root", () => {
    const { out, rows } = ccda(
      doc(
        `<recordTarget><patientRole><id root="ZQLKROOT00X"/><id root="ZQLKROOT01X" extension=""/>` +
          `<patient/></patientRole></recordTarget>`,
      ),
    );
    expect(out).not.toContain("ZQLKROOT00X");
    expect(out).not.toContain("ZQLKROOT01X");
    expect(rows).toContain(`recordTarget/patientRole/id[0] ${D.DEID_IDENTIFIER_SUBSTITUTED}`);
    expect(rows).toContain(`recordTarget/patientRole/id[1] ${D.DEID_IDENTIFIER_SUBSTITUTED}`);
  });

  it("the same root gets the same replacement in the header and in the body, in its own shape", () => {
    const author = "2.16.840.1.113883.19.5.99.1";
    const { out } = ccda(
      doc(
        `<author><assignedAuthor><id root="${author}"/></assignedAuthor></author>` +
          `<legalAuthenticator><assignedEntity><id root="${author}"/></assignedEntity></legalAuthenticator>`,
        `<author><assignedAuthor><id root="${author}"/></assignedAuthor></author>`,
      ),
    );
    expect(out).not.toContain(author);
    expect(out.match(/<id root="2\.25\.1"\/>/g)?.length).toBe(3);
  });

  it("the document id and a set id that repeats it are replaced by one value", () => {
    const { out, rows } = ccda(
      doc(
        `<id root="11111111-2222-4333-8444-555555555555"/>` +
          `<setId root="11111111-2222-4333-8444-555555555555"/>`,
      ),
    );
    expect(out).not.toContain("11111111-2222-4333-8444-555555555555");
    expect(out).toContain(`<id root="00000000-0000-4000-8000-000000000001"/>`);
    expect(out).toContain(`<setId root="00000000-0000-4000-8000-000000000001"/>`);
    expect(rows).toContain(`id ${D.DEID_IDENTIFIER_SUBSTITUTED}`);
    expect(rows).toContain(`setId ${D.DEID_IDENTIFIER_SUBSTITUTED}`);
  });

  it("an id with nothing to replace is left as it was; a replaced root is replaced beside an extension", () => {
    const header = "2.16.840.1.113883.19.5.99.3";
    const r = deidentifyCcda(
      parseCcda(
        doc(
          `<id nullFlavor="NI"/><setId root="2.16.840.1.113883.19.5.99.4" extension="ZZSET1"/>` +
            `<author><assignedAuthor><id root="${header}"/><id nullFlavor="UNK"/></assignedAuthor></author>`,
          `<id root="${header}" extension="ZZENTRY1"/><id nullFlavor="NA"/>`,
        ),
      ),
      { context: ctx },
    );
    const out = r.document.toString();
    const residuals = r.unexaminedResiduals.map((x) => x.locus);
    // The envelope: an id with no root is untouched; a set id with an extension is kept and counted.
    expect(out).toContain(`<id nullFlavor="NI"/>`);
    expect(out).toContain(`<setId root="2.16.840.1.113883.19.5.99.4" extension="ZZSET1"/>`);
    expect(residuals).toContain("setId@extension");
    // The body: the root the header replaced is the same identifier beside an extension, so it takes
    // the header's replacement there too. The extension, a clinical record id, is kept and counted.
    expect(out).not.toContain(header);
    expect(out).toContain(`<id root="2.25.1" extension="ZZENTRY1"/>`);
    expect(residuals).not.toContain(
      "component/structuredBody/component/section/entry/observation/id[0]@root",
    );
    expect(residuals).toContain(
      "component/structuredBody/component/section/entry/observation/id[0]@extension",
    );
    expect(out).toContain(`<id nullFlavor="NA"/>`);
  });

  it("under a policy whose transform cannot replace an id, the root is removed, not kept", () => {
    // `generalize` is no way to replace an identifier, so the engine blocks the root (fail closed).
    const policy = defineDeidPolicy({ name: "odd", transforms: { [C.MRN]: "generalize" } });
    const r = deidentifyCcda(
      parseCcda(
        doc(
          `<recordTarget><patientRole><id root="ZQLKROOT05X"/><patient/></patientRole></recordTarget>`,
        ),
      ),
      { context: ctx, policy },
    );
    expect(r.document.toString()).not.toContain("ZQLKROOT05X");
    expect(r.document.toString()).toContain("<id/>");
    expect(r.manifest.map((m) => `${m.locus} ${m.code}`)).toContain(
      `recordTarget/patientRole/id ${D.DEID_LOCUS_BLOCKED}`,
    );
  });

  it("a body id the header does not name is handed through and counted, as before", () => {
    const r = deidentifyCcda(parseCcda(doc("", `<id root="2.16.840.1.113883.19.5.99.2"/>`)), {
      context: ctx,
    });
    expect(r.document.toString()).toContain("2.16.840.1.113883.19.5.99.2");
    expect(r.unexaminedResiduals.map((x) => x.locus)).toContain(
      "component/structuredBody/component/section/entry/observation/id@root",
    );
  });
});

describe("pinned: keeps the property reaches that this change does not close", () => {
  it("HL7 v2: an identifier's assigning authority (CX.4) is kept verbatim and counted", () => {
    const { wire, residuals } = hl7("PID|1||ZZMRN001^^^ZQLKAUTH00X^MR");
    expect(wire).toContain("ZQLKAUTH00X");
    expect(residuals).toContain("PID-3.4");
  });

  it("X12: an originating company id, a code-shaped procedure code, and a kept party's id are kept", () => {
    const isa =
      "ISA*00*          *00*          *ZZ*SENDER         *ZZ*RECEIVER       *260101*1200*^*00501*000000001*0*P*:~" +
      "GS*HC*SENDER*RECEIVER*20260101*1200*1*X*005010X222A2~ST*837*0001*005010X222A2~";
    const tail = "SE*6*0001~GE*1*1~IEA*1*000000001~";
    // Found again on seed -1723084702: REF*1S (an ambulatory patient group) kept with any value.
    const body =
      "TRN*1*ZQLKTRAC04X*ZQVABA~SV1*A1:ZQLKPROC01X*100*UN*1***1~" +
      "N1*1P*0928*A1*A1^ZQLKPRTY02X~REF*1S*ZQLKAPGN03X~";
    const out = deidentifyX12String(`${isa}${body}${tail}`, { context: ctx }).x12;
    // TRN-03, the originating company id: kept when it fits ten characters. TRN-02 is replaced.
    expect(out).toContain("TRN*1*1*ZQVABA~");
    expect(out).toContain("ZQLKPROC01X");
    expect(out).toContain("ZQLKPRTY02X");
    expect(out).toContain("ZQLKAPGN03X");
  });

  it("C-CDA: a header coded element's code and display name, and an id's root, are kept", () => {
    // The root of an id WITH an extension: the assigning authority, not the identifier.
    const xml = `<?xml version="1.0"?>
<ClinicalDocument xmlns="urn:hl7-org:v3">
<recordTarget><patientRole>
<id root="ZQLKROOT00X" extension="ZZMRN0001"/>
<patient><administrativeGenderCode code="ZQLKGNDR01X" codeSystem="2.16.840.1.113883.5.1"/>
<maritalStatusCode code="M" displayName="ZQLKDISP02X"/></patient>
</patientRole></recordTarget>
</ClinicalDocument>`;
    const out = deidentifyCcda(parseCcda(xml), { context: ctx }).document.toString();
    for (const s of ["ZQLKROOT00X", "ZQLKGNDR01X", "ZQLKDISP02X"]) expect(out).toContain(s);
  });
});
