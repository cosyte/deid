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

import { createDeidContext, DEID_DISPOSITION_CODES as D } from "../../src/index.js";
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
    const { wire } = hl7(spm.join("|"));
    expect(wire).not.toContain("ZQLKSPMD00X");
  });

  it("a date field whose date is empty but which holds a value elsewhere is blocked", () => {
    expect(hl7("EVN|A01|^ZQLKEDAT00X").wire).not.toContain("ZQLKEDAT00X");
    expect(hl7("EVN|A01|&ZQLKEDAT01X").wire).not.toContain("ZQLKEDAT01X");
  });
});

describe("X12: a provider identity reference is kept only under a party its role keeps", () => {
  // Found by the X12 property on seed -614318039: `REF*0B*<value>` in a 270, kept with no party before
  // it. 0B (a state license number) and the other provider identity qualifiers name a person's own
  // number when the party they follow is the individual, or when no party says whose they are.
  const isa =
    "ISA*00*          *00*          *ZZ*A              *ZZ*A              *000101*0000*^*00501*000000001*0*P*:~" +
    "GS*HS*A*A*20000101*0000*1*X*005010X279A1~ST*270*0001*005010X279A1~";
  function x12(body: string): { out: string; rows: string[] } {
    const count = body.split("~").length + 1;
    const r = deidentifyX12String(`${isa}${body}SE*${String(count)}*0001~GE*1*1~IEA*1*000000001~`, {
      context: ctx,
    });
    return { out: r.x12, rows: r.manifest.map((m) => `${m.locus} ${m.code}`) };
  }

  it("with no party before it, the reference is removed", () => {
    const { out, rows } = x12("REF*0B*ZQLKREFA00X~");
    expect(out).not.toContain("ZQLKREFA00X");
    expect(rows).toContain(`270/REF[0]-2 ${D.DEID_LOCUS_BLOCKED}`);
  });

  it.each(["0B", "TJ", "EI", "1G", "HPI"])(
    "after the individual's own party, a %s reference is removed",
    (qualifier) => {
      expect(x12(`NM1*IL*1*ZZFAMILY~REF*${qualifier}*ZQLKREFB01X~`).out).not.toContain(
        "ZQLKREFB01X",
      );
    },
  );

  it("after a party its role keeps (a provider), the reference is still kept", () => {
    expect(x12("NM1*1P*2*ZZORG~REF*0B*ZQLKREFC02X~").out).toContain("ZQLKREFC02X");
  });

  it("an administrative reference is kept by its qualifier alone, as before", () => {
    expect(x12("NM1*IL*1*ZZFAMILY~REF*G1*ZQLKREFD03X~").out).toContain("ZQLKREFD03X");
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
  ])("a value at %s/%s in the field's format is still kept", (seg, id, value) => {
    expect(telecom(seg, id, value)).toContain(value);
  });
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
});

describe("pinned: keeps the property reaches that this change does not close", () => {
  it("HL7 v2: an identifier's assigning authority (CX.4) is kept verbatim and counted", () => {
    const { wire, residuals } = hl7("PID|1||ZZMRN001^^^ZQLKAUTH00X^MR");
    expect(wire).toContain("ZQLKAUTH00X");
    expect(residuals).toContain("PID-3.4");
  });

  it("X12: a trace number, a code-shaped procedure code, and a kept party's identifier are kept", () => {
    const isa =
      "ISA*00*          *00*          *ZZ*SENDER         *ZZ*RECEIVER       *260101*1200*^*00501*000000001*0*P*:~" +
      "GS*HC*SENDER*RECEIVER*20260101*1200*1*X*005010X222A2~ST*837*0001*005010X222A2~";
    const tail = "SE*6*0001~GE*1*1~IEA*1*000000001~";
    // Found again on seed -1723084702: REF*1S (an ambulatory patient group) kept with any value.
    const body =
      "TRN*1*ZQLKTRAC00X*1999999999~SV1*A1:ZQLKPROC01X*100*UN*1***1~" +
      "N1*1P*0928*A1*A1^ZQLKPRTY02X~REF*1S*ZQLKAPGN03X~";
    const out = deidentifyX12String(`${isa}${body}${tail}`, { context: ctx }).x12;
    expect(out).toContain("ZQLKTRAC00X");
    expect(out).toContain("ZQLKPROC01X");
    expect(out).toContain("ZQLKPRTY02X");
    expect(out).toContain("ZQLKAPGN03X");
  });

  it("C-CDA: a header coded element's code and display name, and an id's root, are kept", () => {
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
