/**
 * **X12: a well-formed transaction set keeps every code it carries.** Every code position the pass
 * keeps checks its value against a list grounded in the HIPAA 005010 TR3s. A list that misses a code a
 * TR3 uses removes a recognized value from well-formed input, so here is one well-formed transaction
 * set of each kind the adapter covers: 270, 271, 276, 277, 277CA, 278, 834, 835, 837P, 837I, 837D and
 * 999 (another 837P control is in `fail-closed-positions.test.ts`). The 837P and 277CA controls carry
 * the codes of the `@cosyte/x12` library's own comprehensive 837P fixture and 277CA golden file.
 *
 * A real code no classifier routes on (a `REF` qualifier on neither `REF` table, an entity code on no
 * role table) is kept, and the value behind it is removed: those positions are the control's
 * `blocked` list.
 *
 * For each one, every segment is listed with the output it must have. A segment with no individual's
 * value in it must come back byte-identical; one that carries a name, an identifier or a date of the
 * individual moves only at those positions. `STC` keeps only its status composites and its payment
 * method, so its dates, amounts, action code and check number are the control's `blocked` rows. No
 * other position is removed, SE-01 still counts every segment, and the unexamined residual count is
 * zero.
 *
 * Every value is a synthetic, ZZ-tagged sentinel, a reserved 555 telephone number, a 1999999999 or
 * 999999999 placeholder, or a synthetic date.
 */

import { describe, expect, it } from "vitest";

import { createDeidContext } from "../../src/index.js";
import { deidentifyX12String } from "../../src/x12/index.js";

const ctx = createDeidContext({
  key: "x12-transaction-set-controls-synthetic-hmac-key",
  patientId: "p-x12-transaction-set-controls",
});

const ISA =
  "ISA*00*          *00*          *ZZ*A              *ZZ*B              *260615*0930*^*00501*000000006*0*P*:~";

/** One segment of a control, and the output it must have (the input itself when it must not move). */
type Line = string | readonly [input: string, output: string];

interface Control {
  /** The functional identifier code (GS-01). */
  readonly gs01: string;
  /** The TR3 version (GS-08 and ST-03). */
  readonly version: string;
  /** The transaction set identifier (ST-01). */
  readonly st01: string;
  /** The body, ST and SE excluded. */
  readonly lines: readonly Line[];
  /** The positions a policy blocks rather than removes or generalizes (none, for most sets). */
  readonly blocked?: readonly string[];
}

/** The blocked rows of the `k`-th `STC` of a 277, one per position. */
const STC_ROWS = (k: number, positions: readonly number[]): string[] =>
  positions.map((n) => `277/STC[${String(k)}]-${String(n)}`);

const input = (line: Line): string => (typeof line === "string" ? line : line[0]);
const output = (line: Line): string => (typeof line === "string" ? line : line[1]);

/** De-identify one control and return its envelope, its body, and what was recorded. */
function run(control: Control): {
  head: string;
  body: string[];
  se: string;
  blocked: string[];
  residuals: number;
} {
  const { gs01, version, st01, lines } = control;
  const head = `GS*${gs01}*A*B*20260615*0930*6*X*${version}~ST*${st01}*0006*${version}~`;
  const raw =
    `${ISA}${head}${lines.map((line) => `${input(line)}~`).join("")}` +
    `SE*${String(lines.length + 2)}*0006~GE*1*6~IEA*1*000000006~`;
  const { x12, manifest, unexaminedResiduals } = deidentifyX12String(raw, { context: ctx });
  const all = x12.split("~");
  const st = all.findIndex((s) => s.startsWith("ST*"));
  const se = all.findIndex((s) => s.startsWith("SE*"));
  return {
    head: all.slice(1, st + 1).join("~") + "~",
    body: all.slice(st + 1, se),
    se: all[se] ?? "",
    blocked: manifest.filter((e) => e.disposition === "blocked").map((e) => e.locus),
    residuals: unexaminedResiduals.length,
  };
}

const SUBSCRIBER = (member: string): Line => [
  `NM1*IL*1*ZZSUBLAST*ZZSUBFIRST****MI*${member}`,
  "NM1*IL*1******MI*",
];
const DOB = (gender: string): Line => [`DMG*D8*19850302*${gender}`, `DMG*D8*1985*${gender}`];
const DATE = (qualifier: string, value: string): Line => [
  `DTP*${qualifier}*D8*${value}`,
  `DTP*${qualifier}*D8*${value.slice(0, 4)}`,
];
const PAYER = "NM1*PR*2*ZZPAYERNAME*****PI*ZZPAYERID";
const PROVIDER = "NM1*1P*2*ZZPROVIDERORG*****XX*1999999999";
const SUBMITTER = "NM1*41*2*ZZSUBMITTER*****46*ZZSUBMITID";

const CONTROLS: Readonly<Record<string, Control>> = {
  "270 eligibility inquiry": {
    gs01: "HS",
    version: "005010X279A1",
    st01: "270",
    lines: [
      "BHT*0022*13*ZZTRACE270*20260615*0930",
      "HL*1**20*1",
      PAYER,
      "HL*2*1*21*1",
      PROVIDER,
      "HL*3*2*22*0",
      "TRN*1*ZZTRACE1*1999999999",
      SUBSCRIBER("ZZMEMBER270"),
      ["REF*6P*ZZGROUP270", "REF*6P*"],
      DOB("M"),
      DATE("291", "20260615"),
      "EQ*30",
    ],
  },
  "271 eligibility response": {
    gs01: "HB",
    version: "005010X279A1",
    st01: "271",
    lines: [
      "BHT*0022*11*ZZTRACE271*20260615*0930",
      "HL*1**20*1",
      PAYER,
      ["PER*IC*ZZPAYERCONTACT*TE*5550001234", "PER*IC**TE*"],
      "HL*2*1*21*1",
      PROVIDER,
      "HL*3*2*22*0",
      "TRN*2*ZZTRACE1*1999999999",
      SUBSCRIBER("ZZMEMBER271"),
      ["REF*EJ*ZZACCT271", "REF*EJ*"],
      ["REF*F6*ZZHICN271", "REF*F6*"],
      ["REF*18*ZZPLAN271", "REF*18*"],
      ["REF*N6*ZZNETWORK271", "REF*N6*"],
      DOB("F"),
      "INS*Y*18*001*25",
      DATE("346", "20260101"),
      DATE("458", "20260101"),
      DATE("539", "20260101"),
      DATE("540", "20261231"),
      DATE("771", "20260615"),
      "EB*1*IND*30*HM",
      "EB*C*IND*30*HM**23*500.00",
      "EB*B*IND*98*HM**27*25.00",
      "LS*2120",
      "NM1*P3*1*ZZPCPLAST*ZZPCPFIRST****XX*1999999999",
      "PRV*PE*PXC*207Q00000X",
      "NM1*PRP*2*ZZPRIMARYPAYER*****PI*ZZPAYERID2",
      "LE*2120",
      "AAA*N**72*C",
    ],
    // A plan number and a plan network id route nowhere: their codes stay, their values go.
    blocked: ["271/REF[2]-2", "271/REF[3]-2"],
  },
  "276 claim status request": {
    gs01: "HR",
    version: "005010X212",
    st01: "276",
    lines: [
      "BHT*0010*13*ZZTRACE276*20260615*0930",
      "HL*1**20*1",
      PAYER,
      "HL*2*1*21*1",
      SUBMITTER,
      "HL*3*2*19*1",
      PROVIDER,
      "HL*4*3*22*0",
      DOB("M"),
      SUBSCRIBER("ZZMEMBER276"),
      "TRN*1*ZZTRACE1",
      "REF*1K*ZZPAYERCLAIM",
      "REF*BLT*111",
      ["REF*EJ*ZZACCT276", "REF*EJ*"],
      "AMT*T3*200.00",
      ["DTP*472*RD8*20260601-20260602", "DTP*472*RD8*2026"],
      "SVC*HC:99213*100.00*****1",
      "REF*FJ*ZZLINECTRL",
      DATE("472", "20260601"),
    ],
  },
  "277 claim status response": {
    gs01: "HN",
    version: "005010X212",
    st01: "277",
    lines: [
      "BHT*0010*08*ZZTRACE277*20260615*0930*DG",
      "HL*1**20*1",
      PAYER,
      "HL*2*1*21*1",
      SUBMITTER,
      "HL*3*2*19*1",
      PROVIDER,
      "HL*4*3*22*0",
      SUBSCRIBER("ZZMEMBER277"),
      "TRN*2*ZZTRACE1",
      ["STC*F1:65*20260610**200.00*150.00*20260608*CHK*20260612*ZZCHECK1", "STC*F1:65******CHK**"],
      "REF*1K*ZZPAYERCLAIM",
      ["REF*EJ*ZZACCT277", "REF*EJ*"],
      ["DTP*472*RD8*20260601-20260602", "DTP*472*RD8*2026"],
      "SVC*HC:99213*100.00*75.00****1",
      ["STC*F1:65*20260610", "STC*F1:65*"],
      "REF*FJ*ZZLINECTRL",
      DATE("472", "20260601"),
    ],
    blocked: [...STC_ROWS(0, [2, 4, 5, 6, 8, 9]), ...STC_ROWS(1, [2])],
  },
  "278 services review response": {
    gs01: "HI",
    version: "005010X217",
    st01: "278",
    lines: [
      "BHT*0007*11*ZZTRACE278*20260615*0930",
      "HL*1**20*1",
      "NM1*X3*2*ZZUMONAME*****PI*ZZUMOID",
      "HL*2*1*21*1",
      PROVIDER,
      "HL*3*2*22*1",
      SUBSCRIBER("ZZMEMBER278"),
      DOB("F"),
      "HL*4*3*EV*1",
      "TRN*2*ZZTRACE1*1999999999",
      "UM*HS*I*3*11:B",
      "HCR*A1*ZZCERT278",
      "REF*BB*ZZAUTH278",
      ["REF*NT*ZZADMINREF278", "REF*NT*"],
      DATE("AAH", "20260620"),
      DATE("ABC", "20260901"),
      DATE("007", "20260615"),
      DATE("036", "20261215"),
      "HI*ABK:J449",
      "HSD*VS*12***27*1",
      "HL*5*4*SS*0",
      "UM*SC*I*3",
      "HCR*A1*ZZCERT278B",
      "SV1*HC:99213*100.00*UN*1",
      "PRV*PE*PXC*207Q00000X",
    ],
    blocked: ["278/REF[1]-2"],
  },
  "834 benefit enrollment": {
    gs01: "BE",
    version: "005010X220A1",
    st01: "834",
    lines: [
      "BGN*00*ZZREF834*20260615*0930****2",
      ["REF*38*ZZPOLICY834", "REF*38*"],
      DATE("007", "20260601"),
      "QTY*ET*12",
      // The plan sponsor is in practice the individual's employer: its name and id are removed.
      ["N1*P5*ZZSPONSOR*FI*999999999", "N1*P5**FI*"],
      "N1*IN*ZZINSURER*FI*999999998",
      "INS*Y*18*021*28*A***FT",
      ["REF*0F*ZZSUBNUM834", "REF*0F*"],
      ["REF*1L*ZZGROUP834", "REF*1L*"],
      DATE("336", "20200101"),
      ["NM1*IL*1*ZZMEMLAST*ZZMEMFIRST****ZZ*ZZMEMBER834", "NM1*IL*1******ZZ*"],
      ["PER*IP**HP*5550001234", "PER*IP**HP*"],
      ["DMG*D8*19850302*F*M*:RET:2106-3*1", "DMG*D8*1985*F*M*:RET:2106-3*1"],
      "HD*021**HLT**IND",
      DATE("348", "20260101"),
      "AMT*P3*250.00",
      // The 2100G responsible person is the Other Insured: a person, so the name goes.
      ["NM1*GB*1*ZZRESPLAST*ZZRESPFIRST", "NM1*GB*1**"],
      // The 2100H drop-off location names a person.
      ["NM1*45*1*ZZDROPLAST*ZZDROPFIRST", "NM1*45*1**"],
      "LS*2700",
      "LX*1",
      // The 2750 reporting categories: the party's name and the category values route nowhere.
      ["N1*75*ZZREPORTINGCAT", "N1*75*"],
      ["REF*17*ZZCATEGORY", "REF*17*"],
      ["REF*6O*ZZCROSSREF", "REF*6O*"],
      ["REF*DX*ZZDEPT", "REF*DX*"],
      ["REF*P5*ZZPOSITION", "REF*P5*"],
      ["REF*QQ*ZZUNIT", "REF*QQ*"],
      "LE*2700",
    ],
    // An employer's identifier under a qualifier no member-id rule routes fails closed, and so do the
    // reporting category's name and values.
    blocked: [
      "834/N1[0]-4",
      "834/N1[2]-2",
      "834/REF[3]-2",
      "834/REF[4]-2",
      "834/REF[5]-2",
      "834/REF[6]-2",
      "834/REF[7]-2",
    ],
  },
  "835 remittance": {
    gs01: "HP",
    version: "005010X221A1",
    st01: "835",
    lines: [
      "BPR*I*100.00*C*ACH*CCP*01*999999999*DA*123456*1999999999**01*999999999*DA*654321*20260615",
      "TRN*1*ZZTRACE1*1999999999",
      "REF*EV*ZZRECEIVER",
      ["DTM*405*20260615", "DTM*405*2026"],
      "N1*PR*ZZPAYERNAME",
      "N1*PE*ZZPAYEE*XX*1999999999",
      "REF*TJ*999999999",
      "LX*1",
      [
        "CLP*ZZACCT*1*100.00*80.00*20.00*12*ZZPAYERCLAIM*11*1",
        "CLP**1*100.00*80.00*20.00*12*ZZPAYERCLAIM*11*1",
      ],
      "CAS*PR*1*20.00",
      ["NM1*QC*1*ZZPATLAST*ZZPATFIRST****MI*ZZMEMBER835", "NM1*QC*1******MI*"],
      // The 2100 Other Subscriber is the Other Insured: a person, so the name and member id go.
      ["NM1*GB*1*ZZOTHLAST*ZZOTHFIRST****MI*ZZOTHMEMBER", "NM1*GB*1******MI*"],
      ["REF*28*ZZEMPID835", "REF*28*"],
      ["REF*CE*ZZCONTRACT", "REF*CE*"],
      ["DTM*232*20260601", "DTM*232*2026"],
      ["DTM*233*20260602", "DTM*233*2026"],
      "AMT*AU*100.00",
      "QTY*CA*1",
      "SVC*HC:99213*100.00*80.00**1",
      ["DTM*472*20260601", "DTM*472*2026"],
      "CAS*CO*45*20.00",
      "REF*6R*ZZLINECTRL",
      ["REF*E9*ZZATTACHMENT", "REF*E9*"],
      "AMT*B6*80.00",
      "LQ*HE*N130",
    ],
    // An employee identification number is an identifier of category (R): the policy blocks it. A
    // class of contract code and an attachment code route nowhere: their codes stay.
    blocked: ["835/REF[2]-2", "835/REF[3]-2", "835/REF[5]-2"],
  },
  "837I institutional claim": {
    gs01: "HC",
    version: "005010X223A2",
    st01: "837",
    lines: [
      "BHT*0019*00*ZZREF837I*20260615*0930*CH",
      "HL*1**20*1",
      "PRV*BI*PXC*282N00000X",
      "NM1*85*2*ZZBILLINGORG*****XX*1999999999",
      "HL*2*1*22*0",
      "SBR*P*18*******MC",
      SUBSCRIBER("ZZMEMBER837I"),
      ["CLM*ZZACCT*500.00***11:A:1**A*Y*Y", "CLM**500.00***11:A:1**A*Y*Y"],
      ["DTP*434*RD8*20260601-20260603", "DTP*434*RD8*2026"],
      ["DTP*435*DT*202606010800", "DTP*435*DT*2026"],
      "CL1*1*7*01",
      "HI*ABK:I10*ABJ:R079",
      "HI*BG:01",
      "HI*BE:80:::5",
      "NTE*SPT",
      "NM1*71*1*ZZATTENDLAST*ZZATTENDFIRST****XX*1999999999",
      "PRV*AT*PXC*207Q00000X",
      // The 2310C other operating physician: `ZZ` names no role, so the identity goes and the code stays.
      ["NM1*ZZ*1*ZZOPLAST*ZZOPFIRST****XX*1999999999", "NM1*ZZ*1******XX*"],
      "LX*1",
      "SV2*0450*HC:99283*500.00*UN*1",
      DATE("472", "20260601"),
    ],
    blocked: ["837/NM1[3]-3", "837/NM1[3]-9"],
  },
  "837D dental claim": {
    gs01: "HC",
    version: "005010X224A2",
    st01: "837",
    lines: [
      "BHT*0019*00*ZZREF837D*20260615*0930*CH",
      "HL*1**20*1",
      "NM1*85*2*ZZBILLINGORG*****XX*1999999999",
      "HL*2*1*22*0",
      "SBR*P*18*******CI",
      SUBSCRIBER("ZZMEMBER837D"),
      [
        `CLM*ZZACCT*200.00***11:B:1*Y*A*Y*Y${"*".repeat(10)}PB`,
        `CLM**200.00***11:B:1*Y*A*Y*Y${"*".repeat(10)}PB`,
      ],
      DATE("452", "20260101"),
      "DN1*12*6**Y",
      "DN2*12*M",
      "DN2*A*E****JP",
      "HI*ABK:K021",
      "PRV*PE*PXC*1223G0001X",
      "LX*1",
      "SV3*AD:D2391*200.00*11*L",
      "TOO*JP*3*M:O",
      DATE("472", "20260601"),
    ],
  },
  "837P professional claim (the @cosyte/x12 comprehensive claim fixture's codes)": {
    gs01: "HC",
    version: "005010X222A1",
    st01: "837",
    lines: [
      "BHT*0019*00*ZZREF837P*20260615*0930*CH",
      SUBMITTER,
      ["PER*IC*ZZSUBMITCONTACT*TE*5550001234", "PER*IC**TE*"],
      "NM1*40*2*ZZRECEIVER*****46*ZZRECEIVERID",
      "HL*1**20*1",
      "PRV*BI*PXC*207Q00000X",
      "NM1*85*2*ZZBILLINGORG*****XX*1999999999",
      "REF*EI*999999999",
      "HL*2*1*22*0",
      "SBR*P*18*******MB",
      SUBSCRIBER("ZZMEMBER837P"),
      PAYER,
      ["CLM*ZZACCT*250***11:B:1*Y*A*Y*Y", "CLM**250***11:B:1*Y*A*Y*Y"],
      DATE("431", "20260520"),
      DATE("454", "20260601"),
      "PWK*OZ*EL",
      "AMT*F5*25",
      "REF*G1*ZZPRIORAUTH",
      "HI*ABK:J209",
      "HI*ABF:I10",
      "HI*APR:Y929",
      "NM1*82*1*ZZRENDLAST*ZZRENDFIRST****XX*1999999999",
      "PRV*PE*PXC*207Q00000X",
      "NM1*DN*1*ZZREFLAST*ZZREFFIRST****XX*1999999999",
      // The 2310E ambulance pick-up location: a code and no name.
      "NM1*PW*2",
      "SBR*S*18*******CI",
      "OI***Y*P**Y",
      SUBSCRIBER("ZZOTHERMEMBER"),
      "NM1*PR*2*ZZSECONDPAYER*****PI*ZZPAYERID2",
      "LX*1",
      "SV1*HC:99213:25*150*UN*1***1:2",
      DATE("472", "20260601"),
      "REF*6R*ZZLINECTRL",
      // The 2400 repricing references route nowhere: their codes stay.
      ["REF*9B*ZZREPRICED", "REF*9B*"],
      ["REF*9D*ZZREPRICEDADJ", "REF*9D*"],
      "AMT*AAE*10",
      "NTE*DGN",
      "LIN**N4*00378010401",
      "CTP****1.5*ML",
      // The 2410 prescription number and link sequence number: the fixture's `REF*XZ`.
      ["REF*XZ*ZZRX12345", "REF*XZ*"],
      ["REF*VY*ZZLINK1", "REF*VY*"],
      "SVD*ZZPAYERID2*50*HC:99213**1",
      "CAS*CO*45*100",
      DATE("573", "20260520"),
      "LX*2",
      "SV1*HC:99214*100*UN*1***1",
      DATE("472", "20260601"),
    ],
    blocked: ["837/REF[3]-2", "837/REF[4]-2", "837/REF[5]-2", "837/REF[6]-2"],
  },
  "277CA claim acknowledgment (the @cosyte/x12 277CA golden file's codes)": {
    gs01: "HN",
    version: "005010X214",
    st01: "277",
    lines: [
      "BHT*0085*08*ZZBATCH277CA*20260615*0930*TH",
      "HL*1**20*1",
      PAYER,
      "HL*2*1*21*1",
      SUBMITTER,
      "TRN*1*ZZBATCHTRACE",
      ["STC*A1:19:PR*20260615*WQ*5000", "STC*A1:19:PR***"],
      "QTY*90*1",
      "QTY*AA*1",
      "AMT*YU*5000",
      "AMT*YY*150",
      "HL*3*2*19*1",
      PROVIDER,
      "TRN*2*ZZPROVIDERTRACE",
      ["STC*A2:20:PR*20260615*WQ*150", "STC*A2:20:PR***"],
      "QTY*QA*1",
      "AMT*YU*150",
      "HL*4*3*PT",
      ["NM1*QC*1*ZZPATLAST*ZZPATFIRST****MI*ZZMEMBER277CA", "NM1*QC*1******MI*"],
      "TRN*2*ZZCLAIMTRACE",
      ["STC*A7:21:PR*20260615*U*150", "STC*A7:21:PR***"],
      "REF*1K*ZZPAYERCLAIM",
      ["DTP*472*RD8*20260601-20260602", "DTP*472*RD8*2026"],
    ],
    blocked: [0, 1, 2].flatMap((k) => STC_ROWS(k, [2, 3, 4])),
  },
  "999 implementation acknowledgment": {
    gs01: "FA",
    version: "005010X231A1",
    st01: "999",
    lines: [
      "AK1*HC*2*005010X222A1",
      "AK2*837*0002*005010X222A1",
      "IK3*NM1*8*2010*8",
      "IK4*9*67*7",
      "CTX*SITUATIONAL TRIGGER*NM1*8*2010*9",
      "IK5*R*5",
      "AK9*R*1*1*0",
    ],
  },
};

describe("a well-formed transaction set keeps every code it carries", () => {
  for (const [name, control] of Object.entries(CONTROLS)) {
    it(name, () => {
      const { head, body, se, blocked, residuals } = run(control);
      expect(head).toBe(
        `GS*${control.gs01}*A*B*20260615*0930*6*X*${control.version}~` +
          `ST*${control.st01}*0006*${control.version}~`,
      );
      expect(body).toEqual(control.lines.map(output));
      expect(se).toBe(`SE*${String(control.lines.length + 2)}*0006`);
      expect(blocked).toEqual(control.blocked ?? []);
      expect(residuals).toBe(0);
    });
  }
});
