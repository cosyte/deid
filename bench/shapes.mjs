// The inputs the benchmarks, the profile and the scaling gate run on, built in code from an index.
// No file is read. Every name, identifier, date, phone number and pixel is made up: names are
// ZZ-tagged tokens, phone numbers are in the reserved 555 range and identifiers are 900-range or
// ZZ-tagged, the same conventions the repository's own synthetic fixtures use.
//
// Each shape is one kind of traffic a de-identification pass handles every day, at the size a feed
// sends all day and at sizes well past it:
// - `hl7Message`: one ORU^R01 of about 1.5 KiB, every identifying segment the adapter maps (PID,
//   PV1, NK1, GT1, IN1) filled, then an order and its results; `hl7Batch` is `messages` of them in
//   one FHS/BHS file, the shape a nightly extract or a backloaded interface hands over;
// - `fhirPatient`: one Patient resource; `fhirBundle` is a collection Bundle of one Patient and
//   `entries` more resources about them (Encounters and Observations, each with a date, a
//   reference and a performer), the shape a bulk export or a $everything call returns;
// - `ccdaDocument`: a CCD with a full header (patient, guardian, author, informant, custodian,
//   encounter) and a Results section of `results` observations, each with a narrative table row;
// - `x12Claims`: one 837P interchange with a billing provider and `claims` subscriber, patient and
//   claim loops, each claim with two service lines, the shape a clearinghouse batch has;
// - `ncpdpClaim`: one NCPDP Telecom vD.0 B1 billing request, the Patient and Insurance segments at
//   the transmission level, then one claim with its prescriber and pricing; `ncpdpBatch` is
//   `claims` such transmissions, one a line, the shape a pharmacy's claims extract or a switch log
//   keeps (`@cosyte/ncpdp` reads one transmission at a time, and the adapter refuses more than one
//   transaction in a transmission, so a batch is many transmissions, not one long one);
// - `ctImage` and `enhancedCt`: a DICOM CT slice of 512 by 512 by 16 bits under a header of about
//   80 elements, and an Enhanced CT object of `frames` such frames with one Per-frame Functional
//   Groups Item a frame (200 frames is 100 MiB of Pixel Data and over 1,000 nested elements); a
//   smaller `side` keeps the header and shrinks the pixels, which the scaling gate uses;
// - `locusModel`: the format-agnostic model the policy engine reads, `loci` loci across every
//   category it acts on, the work each adapter hands it.

import { Buffer } from "node:buffer";

/** 1024. */
export const KIB = 1024;
/** 1024 * 1024. */
export const MIB = 1024 * 1024;

function pad(i, width) {
  return String(i).padStart(width, "0");
}

/** A synthetic date in 1950 to 1999, from the index. */
function birthDate(i) {
  return `19${String(50 + (i % 50))}${pad(1 + (i % 12), 2)}${pad(1 + (i % 28), 2)}`;
}

/** A synthetic phone number in the reserved 555 range. */
function phone(i) {
  return `555${pad(i % 10_000_000, 7)}`;
}

// ---------------------------------------------------------------------------------------------
// HL7 v2

const HL7_RESULTS = [
  ["2951-2", "Sodium", "140", "mmol/L", "135-145"],
  ["2823-3", "Potassium", "4.2", "mmol/L", "3.5-5.1"],
  ["2075-0", "Chloride", "102", "mmol/L", "98-107"],
  ["2028-9", "Carbon dioxide", "25", "mmol/L", "22-29"],
  ["3094-0", "Urea nitrogen", "14", "mg/dL", "7-20"],
  ["2160-0", "Creatinine", "0.9", "mg/dL", "0.6-1.2"],
  ["2345-7", "Glucose", "92", "mg/dL", "70-110"],
  ["17861-6", "Calcium", "9.4", "mg/dL", "8.6-10.3"],
];

/** The segments of one synthetic ORU^R01, PHI-dense, about 1.5 KiB. */
function hl7Segments(i) {
  const id = pad(i, 8);
  // Every identifying position is a bare substitution site, so the source carries no value in an
  // identifying field for the PHI scan to read; the values are built here, all synthetic.
  const mrn = `ZZMRN${id}`;
  const ssn = `9${id}`;
  const family = `ZZFAMILY${id}`;
  const given = "ZZGIVEN";
  const middle = "ZZMIDDLE";
  const dob = birthDate(i);
  const street = `ZZSTREET ${pad(i % 900, 3)}`;
  const zip = `0${pad(2100 + (i % 800), 4)}`;
  const home = phone(i);
  const work = phone(i + 1);
  const account = `ZZACCT${id}`;
  const kinFamily = `ZZNKFAMILY${id}`;
  const kinPhone = phone(i + 2);
  const guarantorId = `ZZGT${id}`;
  const guarantorPhone = phone(i + 3);
  const guarantorDob = birthDate(i + 7);
  const guarantorSsn = `9${pad(i + 1, 8)}`;
  const insuredDob = birthDate(i + 3);
  const insuredFamily = "ZZINSFAMILY";
  const policy = `ZZPOLICY${id}`;
  const segments = [
    `MSH|^~\\&|LABAPP|LABFAC|EHRAPP|EHRFAC|20240115083000||ORU^R01|SYNTH${id}|P|2.5.1`,
    `PID|1||${mrn}^^^HOSP^MR~${ssn}^^^SSA^SS||${family}^${given}^${middle}||${dob}|F|||${street}^^ZZCITY^MA^${zip}||${home}|${work}||||${account}|${ssn}`,
    `PV1|1|O|CLINIC^101^A||||ZZATTEND^ZZDOCFAMILY^ZZDOCGIVEN|||MED||||1|||||ZZVISIT${id}|||||||||||||||||||||||||20240115080000|20240115120000`,
    `NK1|1|${kinFamily}^ZZNKGIVEN|SPO|ZZNKSTREET^^ZZNKCITY^MA^02101|${kinPhone}`,
    `GT1|1|${guarantorId}^^^HOSP^AN|ZZGTFAMILY^ZZGTGIVEN||ZZGTSTREET^^ZZGTCITY^NY^10001|${guarantorPhone}||${guarantorDob}|M||SEL|${guarantorSsn}`,
    `IN1|1|PLAN001|INSCO001|SYNTH INSURANCE CO|ORGADDR^^ORGCITY^MA^02101||5559990000|ZZGROUP001||||||||${insuredFamily}^ZZINSGIVEN|SEL|${insuredDob}|ZZINSSTREET^^ZZINSCITY^MA^01890|||||||||||||||||${policy}`,
    `ORC|RE|ZZPLACER${id}|ZZFILLER${id}`,
    `OBR|1|ZZPLACER${id}|ZZFILLER${id}|24323-8^Comprehensive metabolic panel^LN|||20240115081500|||||||||ZZORDERING^ZZORDFAMILY^ZZORDGIVEN||||||20240115082500|||F`,
  ];
  HL7_RESULTS.forEach(([code, name, value, unit, range], k) => {
    segments.push(
      `OBX|${String(k + 1)}|NM|${code}^${name}^LN|1|${value}|${unit}|${range}|N|||F|||20240115081500`,
    );
  });
  segments.push(`NTE|1|L|Reviewed for ZZFAMILY${id} by the ordering provider.`);
  return segments;
}

/** One synthetic ORU^R01 with every identifying segment filled, about 1.5 KiB. */
export function hl7Message(i) {
  return `${hl7Segments(i).join("\r")}\r`;
}

/** `messages` synthetic ORU^R01 messages in one FHS/BHS batch file. */
export function hl7Batch(i, messages) {
  const lines = [
    "FHS|^~\\&|LABAPP|LABFAC|EHRAPP|EHRFAC|20240115090000",
    "BHS|^~\\&|LABAPP|LABFAC|EHRAPP|EHRFAC|20240115090000",
  ];
  for (let m = 0; m < messages; m++) lines.push(...hl7Segments(i * messages + m));
  lines.push(`BTS|${String(messages)}`, "FTS|1");
  return `${lines.join("\r")}\r`;
}

// ---------------------------------------------------------------------------------------------
// FHIR R4

function fhirPatientResource(i) {
  const id = pad(i, 8);
  return {
    resourceType: "Patient",
    id: `pat${id}`,
    identifier: [
      { system: "http://hospital.example/mrn", value: `ZZMRN${id}` },
      { system: "http://hl7.org/fhir/sid/us-ssn", value: `9${id}` },
    ],
    active: true,
    name: [{ use: "official", family: `ZZFAMILY${id}`, given: ["ZZGIVEN", "ZZMIDDLE"] }],
    telecom: [
      { system: "phone", value: phone(i), use: "home" },
      { system: "email", value: `zz${id}@example.com` },
    ],
    gender: "female",
    birthDate: `${birthDate(i).slice(0, 4)}-${birthDate(i).slice(4, 6)}-${birthDate(i).slice(6, 8)}`,
    address: [
      {
        line: [`ZZSTREET ${pad(i % 900, 3)}`],
        city: "ZZCITY",
        district: "ZZCOUNTY",
        state: "MA",
        postalCode: `0${pad(2100 + (i % 800), 4)}`,
      },
    ],
    maritalStatus: {
      coding: [
        { system: "http://terminology.hl7.org/CodeSystem/v3-MaritalStatus", code: "M" },
      ],
    },
    contact: [
      {
        relationship: [
          { coding: [{ system: "http://terminology.hl7.org/CodeSystem/v2-0131", code: "N" }] },
        ],
        name: { family: `ZZCONTACT${id}`, given: ["ZZCONTACTGIVEN"] },
        telecom: [{ system: "phone", value: phone(i + 1) }],
      },
    ],
  };
}

function fhirEncounter(i, k) {
  return {
    resourceType: "Encounter",
    id: `enc${pad(i, 8)}x${String(k)}`,
    identifier: [{ system: "http://hospital.example/visit", value: `ZZVISIT${pad(i, 8)}${String(k)}` }],
    status: "finished",
    class: {
      system: "http://terminology.hl7.org/CodeSystem/v3-ActCode",
      code: "AMB",
    },
    subject: { reference: `Patient/pat${pad(i, 8)}` },
    participant: [{ individual: { display: "ZZDOCFAMILY, ZZDOCGIVEN" } }],
    period: { start: "2024-01-15T08:00:00Z", end: "2024-01-15T09:00:00Z" },
  };
}

function fhirObservation(i, k) {
  const [code, name, value, unit] = HL7_RESULTS[k % HL7_RESULTS.length];
  return {
    resourceType: "Observation",
    id: `obs${pad(i, 8)}x${String(k)}`,
    status: "final",
    category: [
      {
        coding: [
          {
            system: "http://terminology.hl7.org/CodeSystem/observation-category",
            code: "laboratory",
          },
        ],
      },
    ],
    code: { coding: [{ system: "http://loinc.org", code, display: name }] },
    subject: { reference: `Patient/pat${pad(i, 8)}` },
    encounter: { reference: `Encounter/enc${pad(i, 8)}x${String(k - (k % 4))}` },
    effectiveDateTime: "2024-01-15T08:15:00Z",
    issued: "2024-01-15T08:25:00Z",
    performer: [{ display: "ZZLABFAMILY, ZZLABGIVEN" }],
    valueQuantity: {
      value: Number(value),
      unit,
      system: "http://unitsofmeasure.org",
      code: unit,
    },
  };
}

/** One synthetic Patient resource as FHIR JSON, about 1 KiB. */
export function fhirPatient(i) {
  return JSON.stringify(fhirPatientResource(i));
}

/**
 * A collection Bundle of one Patient and `entries` resources about them, as FHIR JSON: one
 * Encounter for every four entries, the rest Observations.
 */
export function fhirBundle(i, entries) {
  const entry = [{ fullUrl: `urn:uuid:pat-${pad(i, 8)}`, resource: fhirPatientResource(i) }];
  for (let k = 0; k < entries; k++) {
    const resource = k % 4 === 0 ? fhirEncounter(i, k) : fhirObservation(i, k);
    entry.push({ fullUrl: `urn:uuid:${resource.id}`, resource });
  }
  return JSON.stringify({ resourceType: "Bundle", id: `bundle${pad(i, 8)}`, type: "collection", entry });
}

// ---------------------------------------------------------------------------------------------
// C-CDA

function ccdaHeader(i) {
  const id = pad(i, 8);
  // The patient's identifying values are bare substitution sites, as in `hl7Segments`.
  const mrn = `ZZMRN${id}`;
  const ssn = `9${id}`;
  const street = `ZZSTREET ${pad(i % 900, 3)}`;
  const zip = `0${pad(2100 + (i % 800), 4)}`;
  const home = phone(i);
  const family = `ZZFAMILY${id}`;
  const dob = birthDate(i);
  return `<?xml version="1.0" encoding="UTF-8"?>
<ClinicalDocument xmlns="urn:hl7-org:v3" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:sdtc="urn:hl7-org:sdtc">
  <realmCode code="US"/>
  <typeId root="2.16.840.1.113883.1.3" extension="POCD_HD000040"/>
  <templateId root="2.16.840.1.113883.10.20.22.1.1" extension="2015-08-01"/>
  <templateId root="2.16.840.1.113883.10.20.22.1.2" extension="2015-08-01"/>
  <id root="2.16.840.1.113883.19.5.99999.1" extension="DOC${id}"/>
  <code code="34133-9" codeSystem="2.16.840.1.113883.6.1" displayName="Summarization of Episode Note"/>
  <title>Continuity of Care Document</title>
  <effectiveTime value="20240115103000-0500"/>
  <confidentialityCode code="N" codeSystem="2.16.840.1.113883.5.25"/>
  <languageCode code="en-US"/>
  <recordTarget>
    <patientRole>
      <id root="2.16.840.1.113883.19.5" extension="${mrn}"/>
      <id root="2.16.840.1.113883.4.1" extension="${ssn}"/>
      <addr use="HP">
        <streetAddressLine>${street}</streetAddressLine>
        <city>ZZCITY</city>
        <county>ZZCOUNTY</county>
        <state>MA</state>
        <postalCode>${zip}</postalCode>
        <country>US</country>
      </addr>
      <telecom use="HP" value="tel:+1-${home}"/>
      <patient>
        <name use="L">
          <given>ZZGIVEN</given>
          <family>${family}</family>
        </name>
        <administrativeGenderCode code="F" codeSystem="2.16.840.1.113883.5.1"/>
        <birthTime value="${dob}"/>
        <maritalStatusCode code="M" codeSystem="2.16.840.1.113883.5.2"/>
        <guardian>
          <addr>
            <streetAddressLine>ZZGUARDSTREET</streetAddressLine>
            <city>ZZGUARDCITY</city>
            <state>NH</state>
            <postalCode>03601</postalCode>
          </addr>
          <telecom value="tel:+1-${phone(i + 1)}"/>
          <guardianPerson>
            <name>
              <given>ZZGUARDGIVEN</given>
              <family>ZZGUARDFAMILY</family>
            </name>
          </guardianPerson>
        </guardian>
      </patient>
    </patientRole>
  </recordTarget>
  <author>
    <time value="20240115103000-0500"/>
    <assignedAuthor>
      <id root="2.16.840.1.113883.4.6" extension="ZZAUTHORNPI"/>
      <addr>
        <streetAddressLine>ZZAUTHSTREET</streetAddressLine>
        <city>ZZAUTHCITY</city>
        <state>MA</state>
        <postalCode>02101</postalCode>
      </addr>
      <telecom value="tel:+1-${phone(i + 2)}"/>
      <assignedPerson>
        <name>
          <given>ZZAUTHGIVEN</given>
          <family>ZZAUTHFAMILY</family>
        </name>
      </assignedPerson>
      <representedOrganization>
        <name>ZZAUTHORG</name>
      </representedOrganization>
    </assignedAuthor>
  </author>
  <informant>
    <relatedEntity classCode="PRS">
      <code code="SPS" codeSystem="2.16.840.1.113883.5.111"/>
      <relatedPerson>
        <name>
          <given>ZZINFGIVEN</given>
          <family>ZZINFFAMILY</family>
        </name>
      </relatedPerson>
    </relatedEntity>
  </informant>
  <custodian>
    <assignedCustodian>
      <representedCustodianOrganization>
        <id root="2.16.840.1.113883.19.5.99999.1393"/>
        <name>ZZCUSTODIANORG</name>
        <telecom value="tel:+1-5550009999"/>
        <addr>
          <streetAddressLine>ZZCUSTODIANSTREET</streetAddressLine>
          <city>ZZCUSTODIANCITY</city>
          <state>MA</state>
          <postalCode>02101</postalCode>
        </addr>
      </representedCustodianOrganization>
    </assignedCustodian>
  </custodian>
  <componentOf>
    <encompassingEncounter>
      <id root="2.16.840.1.113883.19.5.99999.19" extension="ZZVISIT${id}"/>
      <effectiveTime>
        <low value="20240115"/>
        <high value="20240116"/>
      </effectiveTime>
    </encompassingEncounter>
  </componentOf>
`;
}

function ccdaResult(k) {
  const [code, name, value, unit] = HL7_RESULTS[k % HL7_RESULTS.length];
  return `              <component>
                <observation classCode="OBS" moodCode="EVN">
                  <templateId root="2.16.840.1.113883.10.20.22.4.2" extension="2015-08-01"/>
                  <id root="2.16.840.1.113883.19.5.99999.2" extension="R${String(k)}"/>
                  <code code="${code}" codeSystem="2.16.840.1.113883.6.1" displayName="${name}"/>
                  <statusCode code="completed"/>
                  <effectiveTime value="20240115081500"/>
                  <value xsi:type="PQ" value="${value}" unit="${unit}"/>
                </observation>
              </component>
`;
}

/** A CCD with a full header and a Results section of `results` observations. */
export function ccdaDocument(i, results) {
  const rows = [];
  const observations = [];
  for (let k = 0; k < results; k++) {
    const [, name, value, unit] = HL7_RESULTS[k % HL7_RESULTS.length];
    rows.push(`<tr><td>${name}</td><td>${value} ${unit}</td><td>2024-01-15</td></tr>`);
    observations.push(ccdaResult(k));
  }
  return `${ccdaHeader(i)}  <component>
    <structuredBody>
      <component>
        <section>
          <templateId root="2.16.840.1.113883.10.20.22.2.3.1" extension="2015-08-01"/>
          <code code="30954-2" codeSystem="2.16.840.1.113883.6.1" displayName="Results"/>
          <title>Results</title>
          <text><table><tbody>${rows.join("")}</tbody></table></text>
          <entry>
            <organizer classCode="BATTERY" moodCode="EVN">
              <statusCode code="completed"/>
${observations.join("")}            </organizer>
          </entry>
        </section>
      </component>
    </structuredBody>
  </component>
</ClinicalDocument>
`;
}

// ---------------------------------------------------------------------------------------------
// X12 837P

function x12Claim(i, k, hl) {
  const id = pad((i * 100_000 + k) % 1_000_000_000, 9);
  return [
    `HL*${String(hl)}*1*22*1`,
    "SBR*P**ZZGROUP001******CI",
    `NM1*IL*1*ZZSUBFAMILY${id}*ZZSUBGIVEN****MI*ZZMEMBER${id}`,
    "N3*ZZSUBSTREET",
    "N4*ZZSUBCITY*OH*44101",
    `DMG*D8*${birthDate(k)}*F`,
    "NM1*PR*2*SYNTH PAYER*****PI*PAYER0001",
    `HL*${String(hl + 1)}*${String(hl)}*23*0`,
    "PAT*19",
    `NM1*QC*1*ZZPATFAMILY${id}*ZZPATGIVEN`,
    "N3*ZZPATSTREET",
    "N4*ZZPATCITY*OH*44101",
    `DMG*D8*${birthDate(k + 5)}*M`,
    `CLM*ZZACCT${id}*150.00***11:B:1*Y*A*Y*Y`,
    `REF*EA*ZZMRN${id}`,
    "HI*ABK:E1165*ABF:I10",
    "NM1*82*1*ZZRENDERFAMILY*ZZRENDERGIVEN****XX*1999999999",
    "LX*1",
    "SV1*HC:99213*100.00*UN*1***1",
    "DTP*472*D8*20240115",
    "LX*2",
    "SV1*HC:80053*50.00*UN*1***1",
    "DTP*472*D8*20240115",
  ];
}

/** One 837P interchange with a billing provider and `claims` subscriber, patient and claim loops. */
export function x12Claims(i, claims) {
  const control = pad(i % 1_000_000_000, 9);
  const body = [
    "ST*837*0001*005010X222A2",
    `BHT*0019*00*BATCH${control}*20240115*0930*CH`,
    "NM1*41*2*SYNTH SUBMITTER*****46*SUBMIT1",
    "PER*IC*SUBMITCONTACT*TE*5550009999",
    "NM1*40*2*SYNTH RECEIVER*****46*RECEIVER1",
    "HL*1**20*1",
    "NM1*85*2*SYNTH BILLING LLC*****XX*1999999999",
    "N3*100 PROVIDER RD",
    "N4*PROVCITY*OH*43004",
    "REF*EI*990000111",
  ];
  let hl = 2;
  for (let k = 0; k < claims; k++) {
    body.push(...x12Claim(i, k, hl));
    hl += 2;
  }
  body.push(`SE*${String(body.length + 1)}*0001`);
  return `${[
    `ISA*00*          *00*          *ZZ*SYNTHSUBMIT    *ZZ*SYNTHRECEIVE   *240115*0930*^*00501*${control}*0*P*:`,
    `GS*HC*SYNTHSUBMIT*SYNTHRECEIVE*20240115*0930*${control}*X*005010X222A2`,
    ...body,
    `GE*1*${control}`,
    `IEA*1*${control}`,
  ].join("~")}~`;
}

// ---------------------------------------------------------------------------------------------
// NCPDP Telecom vD.0, in the canonical form `serializeTelecom` writes: the 56-byte request header,
// the transmission-level segments, a Group Separator, then the transaction's segments, each segment
// `AM<id>` and its fields behind a Field Separator.

const NCPDP_FS = "\x1c";
const NCPDP_RS = "\x1e";
const NCPDP_GS = "\x1d";

function telecomSegment(id, fields) {
  return `AM${id}${fields.map(([field, value]) => `${NCPDP_FS}${field}${value}`).join("")}`;
}

/**
 * One synthetic B1 billing request, the same length at every index: Patient (01) and Insurance (04)
 * for the transmission, then Claim (07), Prescriber (03) and Pricing (11) for its one transaction.
 */
export function ncpdpClaim(i) {
  const id = pad(i % 100_000_000, 8);
  // The fixed header: BIN, version, transaction code, processor control number, transaction
  // count, service provider id qualifier and id, date of service, software vendor.
  const header = `999999D0B1PCN${pad(i % 10_000_000, 7)}101ZZPHARM${id}20240115SYNTHVEND1`;
  // Every identifying value is a bare substitution site, as in `hl7Segments`.
  const family = `ZZFAMILY${id}`;
  const dob = birthDate(i);
  const street = `ZZSTREET ${pad(i % 900, 3)}`;
  const home = phone(i);
  const patientId = `ZZPATID${id}`;
  const cardholder = `ZZCARD${id}`;
  const transmission = [
    telecomSegment("01", [
      ["CX", "99"],
      ["CY", patientId],
      ["C4", dob],
      ["C5", String(1 + (i % 2))],
      ["CA", "ZZGIVEN"],
      ["CB", family],
      ["CM", street],
      ["CN", "ZZCITY"],
      ["CO", "OH"],
      ["CP", `441${pad(i % 100, 2)}0000`],
      ["CQ", home],
    ]),
    telecomSegment("04", [
      ["C2", cardholder],
      ["CC", "ZZGIVEN"],
      ["CD", family],
      ["C1", "ZZGROUP001"],
      ["C3", "001"],
    ]),
  ];
  // A made-up product code in the eleven-digit NDC shape.
  const ndc = `99999${pad(i % 1_000_000, 6)}`;
  const transaction = [
    telecomSegment("07", [
      ["EM", "1"],
      ["D2", `9${pad(i % 100_000_000, 8)}`],
      ["E1", "03"],
      ["D7", ndc],
      ["E7", "30000"],
      ["D3", "00"],
      ["D5", "30"],
      ["D6", "1"],
      ["D8", "0"],
      ["DE", "20240115"],
      ["DJ", "1"],
    ]),
    telecomSegment("03", [
      ["EZ", "01"],
      ["DB", `ZZNPI${pad(i % 1_000_000, 6)}`],
    ]),
    telecomSegment("11", [
      ["D9", "1500{"],
      ["DC", "250{"],
      ["DQ", "1750{"],
      ["DU", "1750{"],
    ]),
  ];
  return `${header}${transmission.join(NCPDP_RS)}${NCPDP_GS}${transaction.join(NCPDP_RS)}`;
}

/** `claims` synthetic B1 requests, one transmission a line. */
export function ncpdpBatch(i, claims) {
  const lines = [];
  for (let k = 0; k < claims; k++) lines.push(ncpdpClaim(i * claims + k));
  return `${lines.join("\n")}\n`;
}

// ---------------------------------------------------------------------------------------------
// DICOM, in the shape @cosyte/dicom's own bench builds: Explicit VR Little Endian Part 10, every
// Data Set in ascending tag order, UIDs under the 2.25 root.

const EXPLICIT_VR_LE = "1.2.840.10008.1.2.1";
const CT_IMAGE_STORAGE = "1.2.840.10008.5.1.4.1.1.2";
const ENHANCED_CT_IMAGE_STORAGE = "1.2.840.10008.5.1.4.1.1.2.1";
const IMPLEMENTATION_CLASS_UID = "2.25.1000000000000000000000000000001";
const LONG_FORM = new Set(["OB", "OD", "OF", "OL", "OV", "OW", "SQ", "SV", "UC", "UN", "UR", "UT", "UV"]);
const NUL_PADDED = new Set(["UI", "OB", "OD", "OF", "OL", "OV", "OW", "UN"]);

function uid(kind, i) {
  return `2.25.${String(kind)}${pad(i, 12)}`;
}

function tagHeader(tag) {
  const head = Buffer.alloc(4);
  head.writeUInt16LE(Number.parseInt(tag.slice(0, 4), 16), 0);
  head.writeUInt16LE(Number.parseInt(tag.slice(4, 8), 16), 2);
  return head;
}

function element(tag, vr, value) {
  let bytes = value;
  if (bytes.length % 2 === 1) {
    bytes = Buffer.concat([bytes, Buffer.from([NUL_PADDED.has(vr) ? 0x00 : 0x20])]);
  }
  const head = Buffer.alloc(LONG_FORM.has(vr) ? 12 : 8);
  tagHeader(tag).copy(head, 0);
  head.write(vr, 4, "latin1");
  if (LONG_FORM.has(vr)) head.writeUInt32LE(bytes.length, 8);
  else head.writeUInt16LE(bytes.length, 6);
  return Buffer.concat([head, bytes]);
}

function text(tag, vr, value) {
  return element(tag, vr, Buffer.from(value, "latin1"));
}

function us(tag, value) {
  const bytes = Buffer.alloc(2);
  bytes.writeUInt16LE(value, 0);
  return element(tag, "US", bytes);
}

function ul(tag, ...values) {
  const bytes = Buffer.alloc(4 * values.length);
  values.forEach((v, k) => bytes.writeUInt32LE(v, 4 * k));
  return element(tag, "UL", bytes);
}

/** A Sequence of Items of defined length, each Item the concatenated elements of its Data Set. */
function sequence(tag, items) {
  const parts = [];
  for (const content of items) {
    const body = Buffer.concat(content);
    const head = Buffer.alloc(8);
    head.writeUInt16LE(0xfffe, 0);
    head.writeUInt16LE(0xe000, 2);
    head.writeUInt32LE(body.length, 4);
    parts.push(head, body);
  }
  const value = Buffer.concat(parts);
  const head = Buffer.alloc(12);
  tagHeader(tag).copy(head, 0);
  head.write("SQ", 4, "latin1");
  head.writeUInt32LE(value.length, 8);
  return Buffer.concat([head, value]);
}

function code(value, scheme, meaning) {
  return [text("00080100", "SH", value), text("00080102", "SH", scheme), text("00080104", "LO", meaning)];
}

function part10(sopClassUid, sopInstanceUid, body) {
  const meta = Buffer.concat([
    element("00020001", "OB", Buffer.from([0x00, 0x01])),
    text("00020002", "UI", sopClassUid),
    text("00020003", "UI", sopInstanceUid),
    text("00020010", "UI", EXPLICIT_VR_LE),
    text("00020012", "UI", IMPLEMENTATION_CLASS_UID),
    text("00020013", "SH", "SYNTH_BENCH_1"),
  ]);
  return Buffer.concat([
    Buffer.alloc(128),
    Buffer.from("DICM", "latin1"),
    ul("00020000", meta.length),
    meta,
    ...body,
  ]);
}

/** The patient elements every DICOM object here carries, in tag order. */
function patientElements(i) {
  return [
    text("00100010", "PN", `ZZFAMILY${pad(i, 8)}^ZZGIVEN`),
    text("00100020", "LO", `ZZMRN${pad(i, 8)}`),
    text("00100021", "LO", "ZZISSUER"),
    text("00100030", "DA", birthDate(i)),
    text("00100040", "CS", i % 2 === 0 ? "F" : "M"),
  ];
}

/**
 * `frames` frames of `side` by `side` unsigned 16-bit pixels: one frame computed, the rest copied from
 * it with the frame index in its first pixel, so a 100 MiB build stays under a second.
 */
function pixelData(i, frames, side) {
  const frame = Buffer.alloc(side * side * 2);
  for (let y = 0; y < side; y++) {
    for (let x = 0; x < side; x++) {
      const dx = x - side / 2;
      const dy = y - side / 2;
      const inside = dx * dx + dy * dy < (side * side * 5) / 50;
      frame.writeUInt16LE((inside ? 1_000 : 0) + ((x * 3 + y * 5 + i * 7) & 0x3ff), 2 * (y * side + x));
    }
  }
  const all = Buffer.allocUnsafe(frame.length * frames);
  for (let f = 0; f < frames; f++) {
    frame.copy(all, f * frame.length);
    all.writeUInt16LE(f & 0xffff, f * frame.length);
  }
  return all;
}

function equipmentElements() {
  return [
    text("00080070", "LO", "SYNTHETIC MANUFACTURER"),
    text("00080080", "LO", "ZZHOSPITAL"),
    text("00080081", "ST", "ZZHOSPITALSTREET"),
    text("00080090", "PN", "ZZREFERRING^ZZDOC"),
  ];
}

function privateBlock(i) {
  return [
    text("00090010", "LO", "SYNTHETIC VENDOR 1"),
    text("00091001", "LO", "SYNTH PROTOCOL"),
    us("00091002", i & 0xffff),
  ];
}

/** A slice depth in millimetres, the same length for every index. */
function sliceDepth(i) {
  return ((i % 1000) * 1.25).toFixed(2).padStart(7, "0");
}

/** One CT slice: about 80 header elements and `side` by `side` 16-bit native Pixel Data (514 KiB at 512). */
export function ctImage(i, side = 512) {
  const body = [
    text("00080005", "CS", "ISO_IR 100"),
    text("00080008", "CS", "ORIGINAL\\PRIMARY\\AXIAL"),
    text("00080012", "DA", "20240115"),
    text("00080013", "TM", "093000"),
    text("00080016", "UI", CT_IMAGE_STORAGE),
    text("00080018", "UI", uid(4, i)),
    text("00080020", "DA", "20240115"),
    text("00080021", "DA", "20240115"),
    text("00080022", "DA", "20240115"),
    text("00080023", "DA", "20240115"),
    text("00080030", "TM", "091500"),
    text("00080031", "TM", "092000"),
    text("00080032", "TM", "092500"),
    text("00080033", "TM", "093000"),
    text("00080050", "SH", `ZZACC${pad(i >> 6, 8)}`),
    text("00080060", "CS", "CT"),
    ...equipmentElements(),
    text("00081010", "SH", "SYNTH_CT_01"),
    sequence("00081032", [code("SYN-CT-001", "99SYNTH", "CT chest without contrast")]),
    text("0008103E", "LO", "AXIAL 1.25MM"),
    text("00081050", "PN", "ZZPERFORMING^ZZDOC"),
    text("00081070", "PN", "ZZOPERATOR^ZZTECH"),
    text("00081090", "LO", "SYNTHETIC SCANNER"),
    ...privateBlock(i),
    ...patientElements(i >> 6),
    text("00101010", "AS", "044Y"),
    text("00101040", "LO", "ZZPATIENTADDRESS"),
    text("00102154", "SH", phone(i)),
    text("00180015", "CS", "CHEST"),
    text("00180050", "DS", "1.25"),
    text("00180060", "DS", "120"),
    text("00180088", "DS", "1.25"),
    text("00180090", "DS", "500"),
    text("00181000", "LO", `ZZSERIAL${pad(i % 100, 4)}`),
    text("00181020", "LO", "SYNTH 1.0"),
    text("00181030", "LO", "CHEST ROUTINE"),
    text("00181100", "DS", "360"),
    text("00181110", "DS", "1040"),
    text("00181111", "DS", "540"),
    text("00181120", "DS", "0"),
    text("00181130", "DS", "150"),
    text("00181140", "CS", "CW"),
    text("00181150", "IS", "500"),
    text("00181151", "IS", "200"),
    text("00181152", "IS", "100"),
    text("00181160", "SH", "BODY FILTER"),
    text("00181170", "IS", "24"),
    text("00181190", "DS", "0.7"),
    text("00181210", "SH", "STANDARD"),
    text("00185100", "CS", "FFS"),
    text("0020000D", "UI", uid(1, i >> 6)),
    text("0020000E", "UI", uid(3, i >> 4)),
    text("00200010", "SH", "1"),
    text("00200011", "IS", pad((i >> 4) % 1000, 3)),
    text("00200012", "IS", "1"),
    text("00200013", "IS", pad(i % 1000, 3)),
    text("00200032", "DS", `-250\\-250\\-${sliceDepth(i)}`),
    text("00200037", "DS", "1\\0\\0\\0\\1\\0"),
    text("00200052", "UI", uid(5, i >> 6)),
    text("00201040", "LO", ""),
    text("00201041", "DS", `-${sliceDepth(i)}`),
    us("00280002", 1),
    text("00280004", "CS", "MONOCHROME2"),
    us("00280010", side),
    us("00280011", side),
    text("00280030", "DS", "0.9765625\\0.9765625"),
    us("00280100", 16),
    us("00280101", 12),
    us("00280102", 11),
    us("00280103", 0),
    text("00281050", "DS", "40\\400"),
    text("00281051", "DS", "400\\1500"),
    text("00281052", "DS", "-1024"),
    text("00281053", "DS", "1"),
    text("00281054", "LO", "HU"),
    element("7FE00010", "OW", pixelData(i, 1, side)),
  ];
  return part10(CT_IMAGE_STORAGE, uid(4, i), body);
}

function perFrameItem(f) {
  const z = (-f * 1.25).toFixed(2);
  return [
    sequence("00209111", [[text("00189151", "DT", "20240115092500.000000"), ul("00209157", 1, f + 1)]]),
    sequence("00209113", [[text("00200032", "DS", `-250\\-250\\${z}`)]]),
    sequence("00209116", [[text("00200037", "DS", "1\\0\\0\\0\\1\\0")]]),
    sequence("00289132", [[text("00281050", "DS", "40"), text("00281051", "DS", "400")]]),
  ];
}

/**
 * An Enhanced CT object of `frames` `side` by `side` 16-bit frames (512 by default): 200 frames is 100 MiB of Pixel
 * Data, with one Per-frame Functional Groups Item a frame, each with four nested sequences.
 */
export function enhancedCt(i, frames, side = 512) {
  const shared = [
    sequence("00289110", [[text("00180050", "DS", "1.25"), text("00280030", "DS", "0.9765625\\0.9765625")]]),
    sequence("00289145", [
      [text("00281052", "DS", "-1024"), text("00281053", "DS", "1"), text("00281054", "LO", "HU")],
    ]),
  ];
  const body = [
    text("00080005", "CS", "ISO_IR 100"),
    text("00080008", "CS", "ORIGINAL\\PRIMARY\\AXIAL\\NONE"),
    text("00080016", "UI", ENHANCED_CT_IMAGE_STORAGE),
    text("00080018", "UI", uid(6, i)),
    text("00080020", "DA", "20240115"),
    text("00080030", "TM", "091500"),
    text("00080050", "SH", `ZZACC${pad(i, 8)}`),
    text("00080060", "CS", "CT"),
    ...equipmentElements(),
    text("0008103E", "LO", "ENHANCED AXIAL"),
    ...privateBlock(i),
    ...patientElements(i),
    text("0020000D", "UI", uid(1, i)),
    text("0020000E", "UI", uid(3, i)),
    text("00200010", "SH", "1"),
    text("00200011", "IS", "1"),
    text("00200013", "IS", "1"),
    text("00200052", "UI", uid(5, i)),
    us("00280002", 1),
    text("00280004", "CS", "MONOCHROME2"),
    text("00280008", "IS", String(frames)),
    us("00280010", side),
    us("00280011", side),
    us("00280100", 16),
    us("00280101", 12),
    us("00280102", 11),
    us("00280103", 0),
    sequence("52009229", [shared]),
    sequence("52009230", Array.from({ length: frames }, (_v, f) => perFrameItem(f))),
    element("7FE00010", "OW", pixelData(i, frames, side)),
  ];
  return part10(ENHANCED_CT_IMAGE_STORAGE, uid(6, i), body);
}

// ---------------------------------------------------------------------------------------------
// The policy engine's own input

const LOCUS_KINDS = [
  ["PID-5", "identifier", "NAMES", (i) => `ZZFAMILY${pad(i, 8)}^ZZGIVEN`],
  ["PID-7", "date", "DATES", (i) => birthDate(i)],
  ["PID-11", "zip", "GEOGRAPHIC", (i) => `0${pad(2100 + (i % 800), 4)}`],
  ["PID-13", "identifier", "PHONE", (i) => phone(i)],
  ["PID-3", "identifier", "MRN", (i) => `ZZMRN${pad(i, 8)}`],
  ["PID-18", "identifier", "ACCOUNT", (i) => `ZZACCT${pad(i, 8)}`],
  ["PID-19", "identifier", "SSN", (i) => `9${pad(i, 8)}`],
  ["OBX-5", "clinical", undefined, () => "140"],
];

/**
 * A format-agnostic locus model of `loci` loci, cycling through names, dates, ZIPs, phones, MRNs,
 * accounts, SSNs and a clinical value, each with its own value. `category` is a string here; the
 * engine reads the same strings from `SAFE_HARBOR_CATEGORIES`.
 */
export function locusModel(i, loci) {
  const out = [];
  for (let k = 0; k < loci; k++) {
    const [path, kind, category, value] = LOCUS_KINDS[k % LOCUS_KINDS.length];
    const locus = { path: `${path}[${String(k)}]`, kind, value: value(i * loci + k) };
    if (category !== undefined) locus.category = category;
    out.push(locus);
  }
  return { loci: out };
}
