/**
 * The **consolidated leak / over-scrub corpus** (roadmap §Phase 10, §6): one CI-gating suite that
 * exercises the two headline gates across **all six** format adapters in a single place:
 *
 * - **Leak gate (must be ZERO):** after a de-id pass, sweep the *entire serialized output* AND the
 *   *value-free manifest* for every seeded synthetic PHI sentinel. A single survivor is a hard failure
 *   (the under-scrub harm, §4). The manifest half exists because the output document is not the only
 *   artifact a pass hands back: a locus is built by interpolating an identifier read out of the input,
 *   so a manifest can carry document content that never appears in the output at all. Sweeping only the
 *   wire is structurally blind to that; `derived-locus.test.ts` attacks it directly, and this adds the
 *   same sentinels to the same sweep so the headline gate is not the one that misses it.
 * - **Over-scrub gate:** the clinical/financial survivor values must remain present (the over-scrub
 *   harm, §4): the library must not degenerate into a "safe but useless" blanket scrubber.
 *
 * **Non-vacuity is proven two ways**, so a green result is never a green *scanner*:
 *
 * 1. **Pre-condition:** every sentinel is asserted **present in the ORIGINAL** (un-de-identified) wire,
 *    a sentinel the corpus can't even find before de-id would make its post-de-id absence meaningless.
 * 2. **Tamper:** a sentinel re-injected into the de-identified wire is **caught** by the same sweep,
 *    proving the sweep has teeth (it is not vacuously passing on an empty/broken haystack).
 *
 * Plus a **pipeline fuzz** gate: truncated / byte-flipped fixtures fed to the parse→de-id→serialize
 * string entry points never leak a full seeded sentinel and always terminate (bounded rejection or a
 * value-free result), never hang or OOM.
 *
 * Every fixture value is a synthetic, tagged sentinel; fixtures are declared synthetic in
 * `scripts/phi-allow-list.txt`. The per-format adapters keep their own detailed tests: this suite is
 * the unified, adversarial, non-vacuous gate over them.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { parseHL7 } from "@cosyte/hl7";
import { parseCcda } from "@cosyte/ccda";
import { parseResource, serializeResource } from "@cosyte/fhir";
import { serializeDicom } from "@cosyte/dicom";

import {
  buildExpertDeterminationSupportReport,
  createDeidContext,
  createDeidRegistry,
  formatExpertDeterminationSupportReport,
  LIMITED_DATA_SET_PROFILE,
  profileOptions,
  SAFE_HARBOR_PROFILE,
  type DeidManifestEntry,
  type UnexaminedResidual,
} from "../../src/index.js";
import { deidentifyHl7 } from "../../src/hl7/index.js";
import { deidentifyCcda } from "../../src/ccda/index.js";
import { deidentifyFhir } from "../../src/fhir/index.js";
import { deidentifyX12String } from "../../src/x12/index.js";
import { deidentifyTelecomString } from "../../src/ncpdp/index.js";
import { deidentifyDicom } from "../../src/dicom/index.js";
import { ALL_SENTINELS, buildPhiDataset, CLINICAL, UID } from "../dicom/helpers/fixtures.js";
import { checkProperty } from "../helpers/property.js";

const FIX = (fmt: string, file: string): string =>
  readFileSync(join(import.meta.dirname, "..", "fixtures", fmt, file), "utf8");

const hl7Wire = (name: string): string =>
  FIX("hl7", `${name}.hl7`).trim().split(/\r?\n/).join("\r");

/** One format's contribution to the corpus: the de-identified wire, the original, and its expectations. */
interface CorpusCase {
  readonly name: string;
  /** The serialized de-identified output the leak sweep scans. */
  readonly deidWire: string;
  /** The value-free manifest the pass produced; swept for the same sentinels as the wire. */
  readonly manifest: readonly DeidManifestEntry[];
  /**
   * The pass's **unexamined residual positions**: the second value-free list, swept by the same gate.
   *
   * It is here because it is the newest diagnostic surface, and in this package a diagnostic surface IS a
   * PHI surface: a residual record that carried the value at the position it enumerates would leak, in the
   * audit trail, exactly the PHI the pass could not examine. It enumerates far more positions than the
   * manifest names, so a locus composed there is the widest interpolation this library performs.
   */
  readonly unexaminedResiduals: readonly UnexaminedResidual[];
  /**
   * `true` for an adapter that decides every position it hands through (X12): its inventory is a
   * measured zero, so the pre-condition asserts that zero instead of a haystack. The tamper proof below
   * still runs against it, so the sweep is shown to read the list either way.
   */
  readonly decidesEveryPosition?: true;
  /** The serialized ORIGINAL (un-de-identified) wire: used to prove the sentinels are really present. */
  readonly originalWire: string;
  /** Synthetic PHI sentinels that must be ABSENT from `deidWire` and PRESENT in `originalWire`. */
  readonly sentinels: readonly string[];
  /** Clinical/financial values that must SURVIVE (be present in `deidWire`). Empty ⇒ checked elsewhere. */
  readonly survivors: readonly string[];
  /** Optional custom over-scrub assertions (HL7 compares model loci, not wire substrings). */
  readonly overScrub?: () => void;
}

// ── HL7 v2 ────────────────────────────────────────────────────────────────────────────────────────
function hl7Case(): CorpusCase {
  const ctx = createDeidContext({ key: "hl7-corpus-synthetic-hmac-key", patientId: "p-hl7" });
  const original = parseHL7(hl7Wire("oru-r01"));
  const { document, manifest, unexaminedResiduals } = deidentifyHl7(parseHL7(hl7Wire("oru-r01")), {
    context: ctx,
  });
  const clinicalPaths = [
    "OBX[0].5",
    "OBX[0].6",
    "OBX[0].7",
    "OBX[0].3.1",
    "OBX[0].11",
    "OBX[1].5",
    "OBX[1].6",
    "OBX[1].3.1",
    "OBX[2].3.1",
    "OBX[2].5.2",
  ];
  return {
    name: "hl7",
    deidWire: document.toString(),
    manifest,
    unexaminedResiduals,
    originalWire: hl7Wire("oru-r01"),
    sentinels: [
      "ZZMRN002",
      "ZZLABFAMILY",
      "ZZLABGIVEN",
      "19850302",
      "ZZLABSTREET",
      "ZZLABCITY",
      "90210",
      "5550000010",
      "ZZACCT200",
      "900000010",
    ],
    survivors: [],
    overScrub: () => {
      for (const p of clinicalPaths) {
        expect(document.get(p)).toBe(original.get(p));
      }
    },
  };
}

/**
 * The HL7 v2 **employer** case: the guarantor / insurance employer positions, which no other fixture in
 * this corpus carries. §164.514(b)(2)(i) removes the identifiers of the individual "or of relatives,
 * **employers**, or household members", and those positions sit inside segments the pass otherwise
 * retains, so without this case the headline gate is structurally blind to a whole class: an adapter
 * that hands an employer name, address, phone or id straight through produces exactly the same green as
 * one that removes it. The insurer's own company identity is asserted the other way, in `survivors`, so
 * the case cannot be passed by a blanket scrub either.
 */
function hl7EmployerCase(): CorpusCase {
  const ctx = createDeidContext({
    key: "hl7-emp-corpus-synthetic-hmac-key",
    patientId: "p-hl7-emp",
  });
  const raw = hl7Wire("adt-a01");
  const { document, manifest, unexaminedResiduals } = deidentifyHl7(parseHL7(raw), {
    context: ctx,
  });
  return {
    name: "hl7-employer",
    deidWire: document.toString(),
    manifest,
    unexaminedResiduals,
    originalWire: raw,
    sentinels: [
      // The employer as a set of fields: name, address, phone, employee id, employer id.
      "ZZGTEMPFAMILY",
      "ZZGTEMPGIVEN",
      "ZZGTEMPSTREET",
      "ZZGTEMPCITY",
      "11201",
      "5550000007",
      "ZZGTEMPLOYERID",
      "ZZGTEMPEIN",
      "ZZINSGRPEMPID",
      "ZZINSGRPEMPNAME",
      "ZZEMPLOYERINC",
      "ZZEMPCONTACTFAM",
      "ZZEMPCONTACTGIV",
      "5550000008",
      "5550000009",
      // The employer as an ORGANISATION-typed party (IN2-70): name and identifier both.
      "ZZEMPORGNAME",
      "ZZEMPORGID",
      // The patient / guarantor / insured demographics carried alongside them.
      "ZZMRN001",
      "ZZFAMILY",
      "ZZGTFAMILY",
      "ZZINSURED",
      "5550000001",
    ],
    // The over-scrub control: the INSURER is not the individual, a relative, an employer or a
    // household member, and the coded employment status is not an identifier at all.
    survivors: ["INSCO001", "SYNTH INSURANCE CO", "ORGADDR", "ORGCITY", "5559990000"],
  };
}

/**
 * The HL7 v2 **encounter** case: the loci carved out of the RETAINED visit / order / diagnosis
 * segments, which no other fixture in this corpus carries. Without it the headline gate is
 * structurally blind to this whole class: the leak sweep can only report on sentinels a fixture
 * actually seeds, so an adapter that passes an admission date or a visit number straight through
 * produces exactly the same green as one that removes it.
 *
 * Swept under the **Safe Harbor** profile, where §164.514(b)(2)(i)(C) permits only the year of a date
 * directly related to the individual and (R) reaches the encounter and order numbers. The other
 * direction, that the limited-data-set profile still CARRIES them, is asserted below: a corpus that
 * only ever proves absence cannot tell a removal from a preset that scrubs everything.
 */
function hl7EncounterCase(): CorpusCase {
  const ctx = createDeidContext({
    key: "hl7-enc-corpus-synthetic-hmac-key",
    patientId: "p-hl7-enc",
  });
  const raw = hl7Wire("adt-a03");
  const { document, manifest, unexaminedResiduals } = deidentifyHl7(
    parseHL7(raw),
    profileOptions(SAFE_HARBOR_PROFILE, ctx),
  );
  return {
    name: "hl7-encounter",
    deidWire: document.toString(),
    manifest,
    unexaminedResiduals,
    originalWire: raw,
    sentinels: [
      // The encounter loci: the visit number, the admit / discharge / observation / diagnosis dates,
      // and the placer + filler order numbers.
      "ZZVISIT700",
      "20200103040500",
      "20200109060700",
      "20200104080000",
      "20200105090000",
      "ZZPLACER700",
      "ZZFILLER700",
      // The patient demographics carried alongside them, so this fixture is a whole document.
      "ZZMRN003",
      "ZZENCFAMILY",
      "ZZENCGIVEN",
      "ZZENCSTREET",
      "ZZENCCITY",
      "90210",
      "5550000020",
      "ZZACCT300",
      "19900215",
    ],
    // Distinctive clinical survivors only: the LOINC code, the unit, the diagnosis code, and the
    // patient-location text. The bare "140" is excluded for the same reason as the other cases.
    survivors: ["2951-2", "mmol/L", "E11.9", "WARD"],
  };
}

// ── C-CDA ─────────────────────────────────────────────────────────────────────────────────────────
function ccdaCase(): CorpusCase {
  const ctx = createDeidContext({ key: "ccda-corpus-synthetic-hmac-key", patientId: "p-ccda" });
  const raw = FIX("ccda", "ccd.xml");
  const { document, manifest, unexaminedResiduals } = deidentifyCcda(parseCcda(raw), {
    context: ctx,
  });
  return {
    name: "ccda",
    deidWire: document.toString(),
    manifest,
    unexaminedResiduals,
    originalWire: raw,
    sentinels: [
      "ZZMRNCCDA1",
      "ZZSSNCCDA1",
      "ZZPATGIVEN",
      "ZZPATFAMILY",
      "ZZCCDASTREET",
      "ZZCCDACITY",
      "ZZCOUNTY",
      "19900215",
      "555-000-1111",
      "ZZGUARDGIVEN",
      "ZZGUARDFAMILY",
      "ZZAUTHORNPI",
      "ZZAUTHGIVEN",
      "ZZINFGIVEN",
      "ZZCUSTODIANORG",
      "ZZENCOUNTERID",
      "ZZNARRATIVEPHI",
      "ZZSDTCLEAK",
      "ZZVENDORLEAK",
    ],
    // Distinctive survivors only (LOINC, unit, status, template id); bare "140" excluded as above.
    survivors: ["2951-2", "mmol/L", "completed", "314076"],
  };
}

// ── FHIR R4 ───────────────────────────────────────────────────────────────────────────────────────
function fhirCase(): CorpusCase {
  const ctx = createDeidContext({ key: "fhir-corpus-synthetic-hmac-key", patientId: "p-fhir" });
  const raw = FIX("fhir", "bundle.json");
  const { resource } = parseResource(raw);
  const { document, manifest, unexaminedResiduals } = deidentifyFhir(resource, { context: ctx });
  return {
    name: "fhir",
    deidWire: serializeResource(document),
    manifest,
    unexaminedResiduals,
    originalWire: raw,
    sentinels: [
      "ZZPATNARRATIVE",
      "ZZMRNFHIR1",
      "ZZSSNFHIR1",
      "ZZPATFAMILY",
      "ZZPATGIVEN",
      "555-000-1111",
      "ZZPATSTREET",
      "ZZPATCITY",
      "ZZEXTMRN",
      "ZZNESTEDEXTPHI",
      "ZZNPI1",
      "ZZDOCFAMILY",
      "zzrel@example.com",
      "ZZREFDISPLAYNAME",
      "ZZOBSNOTEPHI",
      "ZZACCESSION1",
      "1990-02-15",
      "2019-03-14",
    ],
    // Distinctive clinical survivors only: bare short numerics (140/135/145) are deliberately excluded
    // here, since a coincidental recurrence elsewhere in the JSON could mask a selective destruction of
    // exactly that value. LOINC / unit / status / reference wiring are unique; the FHIR adapter's own
    // test owns the byte-exact over-scrub check on the numeric values. The wiring survives with the
    // logical ids replaced by the call's stand-ins (`pat1` is the second id met, `prac1` the fourth).
    survivors: ["2951-2", "mmol/L", "final", "Patient/2", "Practitioner/4"],
  };
}

/**
 * The FHIR **non-person** case: a name and an address on resources whose type is not a person type,
 * which no other fixture in this corpus carries. Without it the headline gate is structurally blind to
 * a whole class, because the leak sweep can only report on sentinels a fixture actually seeds: an
 * adapter that hands `Organization.contact.name` or `Location.address` straight through produces
 * exactly the same green as one that acts on them.
 *
 * The mirror direction is in `survivors` and it is the load-bearing half here, because the fix for
 * this class is a WIDER sweep and the failure mode of a wider sweep is over-removal. The
 * organisation's own name, its switchboard number, the location's name, the coded display and the
 * clinical code, unit, status and reference wiring are all asserted PRESENT afterwards, so the case
 * cannot be passed by a blanket scrub either.
 */
function fhirNonPersonCase(): CorpusCase {
  const ctx = createDeidContext({ key: "fhir-non-person-corpus", patientId: "p-fhir-np" });
  const raw = FIX("fhir", "non-person-loci.json");
  const { resource } = parseResource(raw);
  const { document, manifest, unexaminedResiduals } = deidentifyFhir(resource, { context: ctx });
  return {
    name: "fhir-non-person",
    deidWire: serializeResource(document),
    manifest,
    unexaminedResiduals,
    originalWire: raw,
    sentinels: [
      "ZZORGCONTACTFAM",
      "ZZORGCONTACTGIV",
      "ZZORGCONTACTSTREET",
      "ZZORGCONTACTCITY",
      "ZZORGSTREET",
      "ZZORGCITY",
      "ZZLOCSTREET",
      "ZZLOCCITY",
      "ZZLOCCOUNTY",
      "ZZLOCADDRSTRING",
      "ZZAUDITHOST",
      "ZZPLANCONTACTNAME",
      "ZZVSCONTACTNAME",
    ],
    survivors: [
      "ZZORGOWNNAME",
      "ZZPLANOWNNAME",
      "ZZVSOWNNAME",
      "ZZORGTYPEDISPLAY",
      "ZZLOCNAME",
      "555-000-8881",
      "555-000-8882",
      "2951-2",
      "mmol/L",
      "final",
      "https://example.org/fhir/endpoint",
      "mllp:interface.example.org:9234",
    ],
  };
}

// ── X12 EDI ───────────────────────────────────────────────────────────────────────────────────────
function x12Case(): CorpusCase {
  const ctx = createDeidContext({ key: "x12-corpus-synthetic-hmac-key", patientId: "p-x12" });
  const raw = FIX("x12", "837p.edi");
  const { x12, manifest, unexaminedResiduals } = deidentifyX12String(raw, { context: ctx });
  return {
    name: "x12",
    deidWire: x12,
    manifest,
    unexaminedResiduals,
    decidesEveryPosition: true,
    originalWire: raw,
    sentinels: [
      "ZZSUBLAST",
      "ZZSUBFIRST",
      "ZZMEMBERX12",
      "900000201",
      "ZZSUBSTREET",
      "ZZPATLAST",
      "ZZPATFIRST",
      "19850302",
      "ZZACCTX12",
      "ZZUNKNOWNREF",
      "ZZWEIRDPHI",
      "ZZNTEPHI",
      "ZZMSGPHI",
      // The EMPLOYER party (NM1*36): §164.514(b)(2)(i) names employers, so its name and its employer
      // identification number are Safe Harbor subjects, not retained organisation identity.
      "ZZEMPLOYERX12",
      "ZZEMPEIN12",
    ],
    // Distinctive clinical/financial survivors only (bare years like 2026/1985 recur in envelopes/OIDs).
    survivors: ["E1165", "99213", "100.00", "COMMERCIALPAYER", "PAYERID12345"],
  };
}

// ── X12 EDI, values shifted into code positions ──────────────────────────────────────────────────
// A sender who drops one element separator shifts the next value left by one position, so an identifier
// lands in a qualifier, entity-code, state or country position that the rules read as a code. Each
// segment below is one such shift; the recognized codes around them, and the clinical lines, survive.
function x12ShiftedCase(): CorpusCase {
  const ctx = createDeidContext({ key: "x12-corpus-synthetic-hmac-key", patientId: "p-x12" });
  const raw = FIX("x12", "837p-shifted.edi");
  const { x12, manifest, unexaminedResiduals } = deidentifyX12String(raw, { context: ctx });
  return {
    name: "x12-shifted",
    deidWire: x12,
    manifest,
    unexaminedResiduals,
    decidesEveryPosition: true,
    originalWire: raw,
    sentinels: [
      "ZZSHIFTPATMEMBER", // NM1-08 of a patient party
      "ZZSHIFTPROVID", // NM1-08 of a retained provider party
      "ZZSHIFTN1MEMBER", // N1-03 of a subscriber party
      "ZZSHIFTPAYERID", // N1-03 of a retained payer party
      "ZZSHIFTENTITY", // NM1-01, no entity code
      "ZZSHIFTREFID", // REF-01 with no REF-02
      "ZZSHIFTJOINEDID", // REF-01 run together with its qualifier
      "ZZSHIFTJOINEDVAL",
      "44199", // a full ZIP shifted into N4-02, the state position
      "ZZSHIFTCOUNTRY", // N4-04, no country code
      "ZZSHIFTSUBMEMBER",
      "ZZSHIFTSUBLAST",
      "ZZSHIFTN1NAME",
      "ZZSHIFTPARTYLAST",
      "ZZSHIFTCITY",
    ],
    survivors: [
      "E1165",
      "99213",
      "100.00",
      "SHIFTPAYERORG",
      "SHIFTBILLINGORG",
      "SHIFTCLAIMCTRL",
      "REF*F8*",
      "N1*PR*",
      "NM1*85*2*",
      "NM1*IL*1*",
      "*OH*441",
    ],
  };
}

// ── X12 EDI, values a rule's code check, shape check or unnamed position must catch ─────────────────
// A refused code routes nothing (a lower-case or padded entity code or REF qualifier); a value shifted
// into a position the rules keep must have that position's shape (a date of birth in DMG-01, a service
// date in DTP-02, a phone in PER-03, a group number in SBR-02, a date in DTM-01); a value shifted right
// past the last position a rule names is removed (NM1-02, NM1-10, N1-05, REF-03); and a segment
// outside every transaction set is removed whole. The codes, dates and amounts around them survive.
function x12FailClosedCase(): CorpusCase {
  const ctx = createDeidContext({ key: "x12-corpus-synthetic-hmac-key", patientId: "p-x12" });
  const raw = FIX("x12", "837p-fail-closed.edi");
  const { x12, manifest, unexaminedResiduals } = deidentifyX12String(raw, { context: ctx });
  return {
    name: "x12-fail-closed",
    deidWire: x12,
    manifest,
    unexaminedResiduals,
    decidesEveryPosition: true,
    originalWire: raw,
    sentinels: [
      "ZZORPHANLAST", // a segment between GS and ST
      "ZZLOWERPAYERLAST", // NM1-01 in lower case
      "ZZLOWERPAYERID",
      "ZZPADPROVLAST", // NM1-01 padded with a space
      "ZZPADPROVID",
      "ZZLOWERN1NAME", // N1-01 in lower case
      "ZZLOWERN1ID",
      "ZZLOWERREFVAL", // REF-01 in lower case
      "19800101", // a date of birth in DMG-01
      "20260101", // a service date in DTP-02
      "5559876543", // a phone in PER-03
      "ZZGROUPNUM", // a group number in SBR-02
      "20260102", // a date in DTM-01
      "ZZNM102LAST", // a last name in NM1-02
      "ZZNM102MEMBER",
      "ZZNM110MEMBER", // a member id in NM1-10
      "ZZN105MEMBER", // a member id in N1-05
      "ZZREF03NAME", // a name in REF-03
      "20260103", // an occurrence date, generalized at its own component
      "ZZSV1DESC", // a free-text procedure description
      "ZZHIMEMBER", // an identifier where a diagnosis code belongs
      "ZZSEGIDMEMBER", // a member id after an extra segment terminator, where the segment id belongs
      "ZZSEGIDRUNON", // a value run into the segment id by a missing element separator
      "ZZSEGIDORPHAN", // a value alone between GE and IEA, where the segment id belongs
    ],
    survivors: [
      "HI*ABK:E1165*BH:11:D8:2026~",
      "SE*21*0005~", // SE-01 counts out the two segments removed whole
      "SV1*HC:99213:25::::*100.00*UN*1***1:2~",
      "REF*F8*ZZCLAIMCTRL*~",
      "NM1*85*2*ZZKEPTPROVORG*****XX*1999999999~",
      "DTP*472*D8*2026~",
    ],
  };
}

// ── X12 EDI, values shifted into amount, quantity and count positions ──────────────────────────────
// A number shape cannot tell a shifted date or account number from an amount. An extra separator leaves
// a position the TR3s require, or one a qualifier implies, empty while a later one holds a value: an
// `HI` occurrence or procedure date past its component (C022-05 / -06), a numeric patient control number
// in `CLM-02` or `CLP-03`, a date of death in `PAT-08`, an amount after an empty `CAS` reason, and a
// status date in `STC-04`. Every value after the empty position is removed; the well-formed codes,
// amounts and dates beside them survive.
function x12ShiftedNumbersCase(): CorpusCase {
  const ctx = createDeidContext({ key: "x12-corpus-synthetic-hmac-key", patientId: "p-x12" });
  const raw = FIX("x12", "shifted-numbers.edi");
  const { x12, manifest, unexaminedResiduals } = deidentifyX12String(raw, { context: ctx });
  return {
    name: "x12-shifted-numbers",
    deidWire: x12,
    manifest,
    unexaminedResiduals,
    decidesEveryPosition: true,
    originalWire: raw,
    sentinels: [
      "4455667701", // a numeric patient control number in CLM-02 (CLM-01 empty)
      "20260118", // an occurrence date in C022-05 (C022-04 empty after D8)
      "20260119", // a principal procedure date in C022-05
      "20260120", // an occurrence span start in C022-05 (after RD8)
      "20260121", // a date in C022-05 after its format in C022-04 (C022-03 empty)
      "20260122", // a date two separators late, in C022-06
      "4455667704", // a value code amount's place taken by a number in C022-06
      "20250117", // a date of death in PAT-08 (PAT-06 empty after D8)
      "4455667702", // a numeric patient control number in CLP-03 (CLP-01 and -02 empty)
      "4455667703", // a number in CAS-04 (CAS-03 empty)
      "20260126", // a status date in STC-04 (STC-01 empty)
      "20260127", // a status date in STC-04 (STC-02 empty)
    ],
    survivors: [
      "HI*ABK:E1165*BE:80:::125.00*BH:11:D8:2026~",
      "HI*BH:11:D8::~",
      "SVC*HC:99213*150*100~",
      "PAT*19****D8***~",
    ],
  };
}

// ── X12 EDI, dates shifted by a separator added or left out ─────────────────────────────────────────
// A date of death two places late lands in the patient's weight (`PAT-08`), with a unit code before it
// that is a real code but not the pound the TR3s allow there; it is removed with every value after the
// place the shift shows. An adjudication or check date lands in an `STC` amount, the check number or the
// last position after a separator is added or left out: `STC` keeps only its status composites and its
// payment method, so every date and amount in it is removed wherever it sits, in a 277 and a 277CA
// alike. The 270, 271 and 278 controls are well formed for their own set and keep every value: their
// TR3s do not require `INS-03` / `-05` or the service line charge.
function x12ShiftedDatesCase(): CorpusCase {
  const ctx = createDeidContext({ key: "x12-corpus-synthetic-hmac-key", patientId: "p-x12" });
  const raw = FIX("x12", "shifted-dates.edi");
  const { x12, manifest, unexaminedResiduals } = deidentifyX12String(raw, { context: ctx });
  return {
    name: "x12-shifted-dates",
    deidWire: x12,
    manifest,
    unexaminedResiduals,
    decidesEveryPosition: true,
    originalWire: raw,
    sentinels: [
      "20250117", // a date of death in PAT-08, after two extra separators (patient and subscriber)
      "20260126", // the STC-02 status date, removed wherever it sits
      "20260128", // an adjudication date in STC-05 (STC-03's empty slot left out)
      "20260129", // a check issue date in STC-07
      "20260130", // an adjudication date, removed in place too
      "20260131", // a check issue date in STC-09 (one extra separator)
      "ZZCHECK02", // a check number in STC-08
      "20260202", // an adjudication date in STC-05, the last position (amounts run together)
      "20260203", // the same date run into the payment amount in STC-05
      "20260204", // two amounts run together, the date in STC-05 with no check after it
      "20260205", // a well-formed STC that ends at its adjudication date
      "20260206", // a 277CA status date
      "20260207", // a 277CA status date in a status with STC-10 and -11
      "ZZSTCMESSAGE", // a 277CA free-form message in STC-12
    ],
    survivors: [
      "PAT*19****D8*2024*01*165~",
      "STC*A1:20******CHK**~",
      "STC*A1:19:PR***~",
      "STC*A3:21*********A3:562:85*A3:128*~",
      "INS*Y*18***************1~",
      "INS*Y*18*001*25*************1~",
      "INS*N*19***************2~",
      "SV1*HC:99213**UN*1~",
      "SV2*0300*HC:80053**UN*1~",
      "SV3*AD:D2391*****1~",
    ],
  };
}

// ── X12 EDI, people who can be the individual or stand for the individual ────────────────────────────
// The 835 Other Subscriber (`NM1*GB`) and the 834 responsible persons (`GB`, `6Y`, `9K`) and drop-off
// person (`45`) name the individual, a relative or someone acting for them. Each one's name and
// identifier are removed and recorded; the payer, the payee and the clinical lines survive.
function x12PersonsCase(): CorpusCase {
  const ctx = createDeidContext({ key: "x12-corpus-synthetic-hmac-key", patientId: "p-x12" });
  const raw = FIX("x12", "other-insured-and-responsible.edi");
  const { x12, manifest, unexaminedResiduals } = deidentifyX12String(raw, { context: ctx });
  return {
    name: "x12-persons",
    deidWire: x12,
    manifest,
    unexaminedResiduals,
    decidesEveryPosition: true,
    originalWire: raw,
    sentinels: [
      "ZZOTHERSUBLAST", // 835 Other Subscriber (GB)
      "ZZOTHERSUBFIRST",
      "ZZOTHERSUBMEMBER",
      "ZZRESPGBLAST", // 834 responsible person (GB)
      "ZZRESPGBFIRST",
      "ZZCASEMGRLAST", // 834 responsible person (6Y)
      "ZZCASEMGRFIRST",
      "ZZKEYPERSONLAST", // 834 responsible person (9K)
      "ZZKEYPERSONFIRST",
      "ZZDROPOFFLAST", // 834 drop-off person (45)
      "ZZDROPOFFFIRST",
      "ZZGBPATLAST",
      "ZZGBPATMEMBER",
      "ZZMEMBERLAST834",
      "ZZSUBSCRIBER834",
    ],
    survivors: [
      "N1*PR*COMMERCIALPAYER~",
      "N1*PE*ZZKEPTPAYEEORG*XX*1999999999~",
      "SVC*HC:99213*150*100~",
      "NM1*GB*1******MI*~",
      "NM1*6Y*1**~",
    ],
  };
}

// ── X12 EDI, an entity code whose meaning changes by transaction set ────────────────────────────────
// In the 820 premium payment the premium payer (`N1*PR`) is the employer of the individuals the payment
// lists, not a health plan: its name and identifier are removed and recorded, as the 834 sponsor's are.
// The premium receiver, the amounts and the payment's own references survive. The shape is the x12
// library's golden 820.
function x12PremiumCase(): CorpusCase {
  const ctx = createDeidContext({ key: "x12-corpus-synthetic-hmac-key", patientId: "p-x12" });
  const raw = FIX("x12", "820-premium.edi");
  const { x12, manifest, unexaminedResiduals } = deidentifyX12String(raw, { context: ctx });
  return {
    name: "x12-premium",
    deidWire: x12,
    manifest,
    unexaminedResiduals,
    decidesEveryPosition: true,
    originalWire: raw,
    sentinels: [
      "ZZPREMPAYERX12", // the premium payer, the members' employer
      "ZZPREMPAYEREIN",
      "ZZPREMPAYERSTREET",
      "ZZPREMPAYERCITY",
      "ZZPREMLAST",
      "ZZPREMMEMBER",
    ],
    survivors: ["N1*PE*MEDPAY INSURANCE*FI*111223333~", "N1*PR**FI*~", "BPR*C*12500.00*"],
  };
}

// ── NCPDP Telecom ─────────────────────────────────────────────────────────────────────────────────
function ncpdpCase(): CorpusCase {
  const ctx = createDeidContext({ key: "ncpdp-corpus-synthetic-hmac-key", patientId: "p-ncpdp" });
  const raw = FIX("ncpdp", "telecom-b1.ncpdp");
  const { telecom, manifest, unexaminedResiduals } = deidentifyTelecomString(raw, { context: ctx });
  return {
    name: "ncpdp",
    deidWire: telecom,
    manifest,
    unexaminedResiduals,
    originalWire: raw,
    sentinels: [
      "ZZPATFIRST",
      "ZZPATLAST",
      "19850302",
      "ZZPTSTREET",
      "ZZPTCITY",
      "ZZPATIENTID",
      "ZZPRESCRIBERID",
      "ZZCARDHOLDER",
      "ZZOTHERCARDID",
      "ZZDURPHI",
      "ZZUNKNOWNSEG",
      "ZZPATEMAIL",
      "ZZPRESCRIBERNAME",
      "20251203", // 414-DE Date Prescription Written, generalized to its year
      "20251104", // 457-EP Associated Prescription/Service Date, generalized to its year
      // The Prior Authorization segment (12) keeps only its type code: a representative's name and
      // address, and the authorization number submitted, are removed.
      "ZZAUTHREPFIRST",
      "ZZAUTHREPLAST",
      "ZZAUTHREPSTREET",
      "ZZAUTHREPCITY",
      "44199",
      "90000000001",
    ],
    // Distinctive survivors only: the NDC and pharmacy IDs (bare 441/1985 could recur). The fixture's
    // other payer id is letters and digits, which the pass no longer keeps (only five or six digits).
    survivors: ["00071015527", "PHARM123"],
  };
}

/** The adjudication response: its free text fails closed and its previous date of fill is cut. */
function ncpdpResponseCase(): CorpusCase {
  const ctx = createDeidContext({ key: "ncpdp-corpus-synthetic-hmac-key", patientId: "p-ncpdp" });
  const raw = FIX("ncpdp", "telecom-b1-response.ncpdp");
  const { telecom, manifest, unexaminedResiduals } = deidentifyTelecomString(raw, { context: ctx });
  return {
    name: "ncpdp-response",
    deidWire: telecom,
    manifest,
    unexaminedResiduals,
    originalWire: raw,
    sentinels: [
      "ZZRESPMSG",
      "ZZRESPFQ",
      "20251020", // 530-FU Previous Date Of Fill, generalized to its year
    ],
    survivors: ["AUTH0000001", "RX0000001"],
  };
}

// ── Ages over 89, birth dates and positions the maps missed (HL7 v2, FHIR, C-CDA) ────────────────────
/**
 * The positions no other fixture in this corpus carries: an age held as a number (an HL7 v2 OBX age,
 * a FHIR `Age` and age-coded `valueQuantity`, a C-CDA age observation), birth dates no rule marked
 * (`NK1-16`, an OBX birth-date result, `FamilyMemberHistory.bornDate`, a relative's `birthTime`), the
 * NK1 employee number and organisation, the v2.7 telecoms, and a residence's `Location.position`. The
 * person over 89 was born in 1920 and is 97.25 years old; an age of 45.5 beside it must survive.
 */
const MISSED_SENTINELS: readonly string[] = ["1920", "97.25"];

function hl7MissedCase(): CorpusCase {
  const ctx = createDeidContext({ key: "hl7-missed-corpus-synthetic-key", patientId: "p-hl7-m" });
  const nk1 = ["NK1", "1", "ZZNKFAMILY^ZZNKGIVEN", "SPO"];
  nk1[12] = "ZZNKEMPNO01^^^ZZEMPAUTH^EI";
  nk1[13] = "ZZNKORGNAME^^^^^^^^^ZZNKORGID";
  nk1[16] = "19200301";
  nk1[40] = "^PRN^PH^^1^555^0000041";
  nk1[41] = "^WPN^PH^^1^555^0000042";
  const raw = hl7Wire("adt-a01")
    .split("\r")
    .map((line) => {
      if (line.startsWith("NK1|")) return Array.from(nk1, (v) => v ?? "").join("|");
      if (line.startsWith("PID|")) {
        return `${line}${"|".repeat(40 - line.split("|").length + 1)}^PRN^PH^^1^555^0000040`;
      }
      return line;
    })
    .concat([
      "OBX|1|NM|30525-0^Age^LN|1|97.25|a^year^UCUM|||||F",
      "OBX|2|NM|21612-7^Age - Reported^LN|1|45.5|a^year^UCUM|||||F",
      "OBX|3|DT|21112-8^Birth date^LN|1|19200301||||||F",
    ])
    .join("\r");
  const { document, manifest, unexaminedResiduals } = deidentifyHl7(parseHL7(raw), {
    context: ctx,
  });
  return {
    name: "hl7-ages-and-missed-positions",
    deidWire: document.toString(),
    manifest,
    unexaminedResiduals,
    originalWire: raw,
    sentinels: [
      ...MISSED_SENTINELS,
      "ZZNKEMPNO01",
      "ZZNKORGNAME",
      "ZZNKORGID",
      "0000040",
      "0000041",
      "0000042",
    ],
    survivors: ["45.5", "30525-0", "21112-8", "SPO", "a^year^UCUM"],
  };
}

function fhirMissedCase(): CorpusCase {
  const ctx = createDeidContext({ key: "fhir-missed-corpus-synthetic-key", patientId: "p-fhir-m" });
  const ucum = { unit: "a", system: "http://unitsofmeasure.org", code: "a" };
  const resource = (r: object): object => ({ resource: r });
  const raw = JSON.stringify({
    resourceType: "Bundle",
    type: "collection",
    entry: [
      resource({
        resourceType: "FamilyMemberHistory",
        status: "completed",
        bornDate: "1920-03-01",
        ageAge: { value: 97.25, ...ucum },
        condition: [{ code: { text: "ZZCONDITIONTEXT" }, onsetAge: { value: 45.5, ...ucum } }],
      }),
      resource({
        resourceType: "Observation",
        status: "final",
        code: { coding: [{ system: "http://loinc.org", code: "30525-0" }] },
        valueQuantity: { value: 97.25, ...ucum },
      }),
      resource({
        resourceType: "Location",
        status: "active",
        type: [
          {
            coding: [
              { system: "http://terminology.hl7.org/CodeSystem/v3-RoleCode", code: "PTRES" },
            ],
          },
        ],
        position: { longitude: -71.0589, latitude: 42.3601 },
      }),
    ],
  });
  const { document, manifest, unexaminedResiduals } = deidentifyFhir(parseResource(raw).resource, {
    context: ctx,
  });
  return {
    name: "fhir-ages-and-missed-positions",
    deidWire: serializeResource(document),
    manifest,
    unexaminedResiduals,
    originalWire: raw,
    sentinels: [...MISSED_SENTINELS, "42.3601", "71.0589"],
    survivors: ["45.5", "30525-0", "PTRES", "ZZCONDITIONTEXT", "completed"],
  };
}

/**
 * The FHIR **logical ids**: a Patient's `id`, the `fullUrl` of its Bundle entry and every reference to
 * it, each carrying a sentinel, under the Safe Harbor default (a per-call stand-in) and under the
 * limited data set preset (a keyed surrogate). A server id is very often the medical record number
 * itself, so none of the three positions may carry it out. The wiring is the survivor: the reference
 * still names the Patient, by its replacement.
 */
const FHIR_ID_SENTINELS: readonly string[] = [
  "ZZFHIRIDPAT1",
  "ZZFHIRIDOBS1",
  "ZZFHIRIDCONT1",
  "ZZFHIRIDVER1",
  "ZZFHIRIDOTHER1",
];

function fhirResourceIdCase(keyed: boolean): CorpusCase {
  const raw = JSON.stringify({
    resourceType: "Bundle",
    type: "collection",
    entry: [
      {
        fullUrl: "https://fhir.example.org/r4/Patient/ZZFHIRIDPAT1",
        resource: { resourceType: "Patient", id: "ZZFHIRIDPAT1", gender: "female" },
      },
      {
        fullUrl: "urn:uuid:ZZFHIRIDOBS1",
        resource: {
          resourceType: "Observation",
          id: "ZZFHIRIDOBS1",
          status: "final",
          code: { coding: [{ system: "http://loinc.org", code: "2951-2" }] },
          contained: [{ resourceType: "Specimen", id: "ZZFHIRIDCONT1" }],
          specimen: { reference: "#ZZFHIRIDCONT1" },
          subject: { reference: "Patient/ZZFHIRIDPAT1/_history/ZZFHIRIDVER1" },
          performer: [{ reference: "https://other.example.net/fhir/Practitioner/ZZFHIRIDOTHER1" }],
          valueQuantity: { value: 140, unit: "mmol/L", system: "http://unitsofmeasure.org" },
        },
      },
    ],
  });
  const registry = createDeidRegistry({ key: "fhir-id-corpus-synthetic-hmac-key" });
  const ctx = registry.forPatient("p-fhir-ids");
  const options = keyed
    ? profileOptions(LIMITED_DATA_SET_PROFILE, ctx)
    : profileOptions(SAFE_HARBOR_PROFILE, ctx);
  const { document, manifest, unexaminedResiduals } = deidentifyFhir(
    parseResource(raw).resource,
    options,
  );
  const patient = keyed ? registry.pseudonym("ZZFHIRIDPAT1") : "1";
  return {
    name: keyed ? "fhir-resource-ids-keyed" : "fhir-resource-ids",
    deidWire: serializeResource(document),
    manifest,
    unexaminedResiduals,
    originalWire: raw,
    sentinels: FHIR_ID_SENTINELS,
    survivors: ["2951-2", "mmol/L", "final", `"reference":"Patient/${patient}"`],
  };
}

function ccdaMissedCase(): CorpusCase {
  const ctx = createDeidContext({ key: "ccda-missed-corpus-synthetic-key", patientId: "p-ccda-m" });
  const sct = "2.16.840.1.113883.6.96";
  const age = (value: string): string =>
    `<entryRelationship typeCode="SUBJ" inversionInd="true"><observation classCode="OBS" moodCode="EVN">` +
    `<code code="445518008" codeSystem="${sct}"/><statusCode code="completed"/>` +
    `<value xsi:type="PQ" value="${value}" unit="a"/></observation></entryRelationship>`;
  const familyHistory =
    `<component><section><code code="10157-6" codeSystem="2.16.840.1.113883.6.1"/>` +
    `<entry><organizer classCode="CLUSTER" moodCode="EVN"><statusCode code="completed"/>` +
    `<subject><relatedSubject classCode="PRS"><code code="FTH" codeSystem="2.16.840.1.113883.5.111"/>` +
    `<subject><birthTime value="19200301"/></subject></relatedSubject></subject>` +
    `<component><observation classCode="OBS" moodCode="EVN"><code code="64572001" codeSystem="${sct}"/>` +
    `<value xsi:type="CD" code="22298006" codeSystem="${sct}"/>${age("97.25")}${age("45.5")}` +
    `</observation></component></organizer></entry></section></component>`;
  const raw = FIX("ccda", "ccd.xml").replace(
    "</structuredBody>",
    `${familyHistory}</structuredBody>`,
  );
  const { document, manifest, unexaminedResiduals } = deidentifyCcda(parseCcda(raw), {
    context: ctx,
  });
  return {
    name: "ccda-ages-and-missed-positions",
    deidWire: document.toString(),
    manifest,
    unexaminedResiduals,
    originalWire: raw,
    sentinels: [...MISSED_SENTINELS],
    survivors: ['value="45.5"', "22298006", "FTH", "2951-2"],
  };
}

// ── DICOM (metadata-only, delegated PS3.15 Annex E) ───────────────────────────────────────────────
function dicomCase(): CorpusCase {
  const original = serializeDicom(buildPhiDataset()).toString("latin1");
  const { dataset, manifest, unexaminedResiduals } = deidentifyDicom(buildPhiDataset());
  return {
    name: "dicom",
    deidWire: serializeDicom(dataset).toString("latin1"),
    manifest,
    unexaminedResiduals,
    originalWire: original,
    sentinels: [...ALL_SENTINELS, UID.sop, UID.study, UID.series],
    survivors: [CLINICAL.modality, CLINICAL.photometric, CLINICAL.sopClassUid],
  };
}

const CASES: readonly CorpusCase[] = [
  hl7Case(),
  hl7EmployerCase(),
  hl7EncounterCase(),
  ccdaCase(),
  fhirCase(),
  fhirNonPersonCase(),
  x12Case(),
  x12ShiftedCase(),
  x12FailClosedCase(),
  x12ShiftedNumbersCase(),
  x12ShiftedDatesCase(),
  x12PersonsCase(),
  x12PremiumCase(),
  ncpdpCase(),
  ncpdpResponseCase(),
  dicomCase(),
  hl7MissedCase(),
  fhirMissedCase(),
  ccdaMissedCase(),
  fhirResourceIdCase(false),
  fhirResourceIdCase(true),
];

/** The one leak sweep every gate uses: deliberately the SAME function the tamper test attacks. */
function leaks(wire: string, sentinels: readonly string[]): string[] {
  return sentinels.filter((s) => wire.includes(s));
}

describe("consolidated leak corpus, every format, zero leak", () => {
  for (const c of CASES) {
    it(`${c.name}: no seeded PHI sentinel survives the de-id pass`, () => {
      expect(leaks(c.deidWire, c.sentinels)).toEqual([]);
    });

    // The manifest is the OTHER artifact of a pass, and it is built by interpolating identifiers read
    // out of the input, so it can carry document content the output document never sees.
    it(`${c.name}: no seeded PHI sentinel reaches the value-free manifest or the report`, () => {
      const manifestText = JSON.stringify(c.manifest);
      const reportText = JSON.stringify(
        buildExpertDeterminationSupportReport(c.manifest, {
          unexaminedResiduals: c.unexaminedResiduals,
        }),
      );
      expect(leaks(manifestText, c.sentinels)).toEqual([]);
      expect(leaks(reportText, c.sentinels)).toEqual([]);
    });

    // The THIRD artifact, and the one with the widest reach: the unexamined-residual list enumerates
    // every value-bearing position the pass handed through, so it composes far more loci than the
    // manifest names and touches parts of the document no other artifact describes. A record that
    // carried the value at a position it enumerates would leak, in the audit trail, exactly the PHI the
    // pass could not examine, and a manifest already handed to a determiner cannot be recalled.
    it(`${c.name}: no seeded PHI sentinel reaches the unexamined-residual inventory`, () => {
      const residualText = JSON.stringify(c.unexaminedResiduals);
      const renderedText = formatExpertDeterminationSupportReport(
        buildExpertDeterminationSupportReport(c.manifest, {
          unexaminedResiduals: c.unexaminedResiduals,
        }),
      );
      expect(leaks(residualText, c.sentinels)).toEqual([]);
      expect(leaks(renderedText, c.sentinels)).toEqual([]);
    });

    // And the record shape itself: a locus, a count and two booleans. Nothing that could hold a value.
    it(`${c.name}: every unexamined-residual record carries a locus, a count and the fact, only`, () => {
      for (const residual of c.unexaminedResiduals) {
        expect(Object.keys(residual).sort()).toEqual([
          "code",
          "count",
          "examined",
          "locus",
          "locusWithheld",
        ]);
        expect(typeof residual.locus).toBe("string");
        expect(Number.isInteger(residual.count)).toBe(true);
        expect(residual.examined).toBe(false);
      }
    });
  }
});

describe("corpus non-vacuity, the sweep and the corpus both have teeth", () => {
  for (const c of CASES) {
    it(`${c.name}: every sentinel is present in the ORIGINAL wire (pre-condition)`, () => {
      const missing = c.sentinels.filter((s) => !c.originalWire.includes(s));
      expect(missing).toEqual([]);
    });

    it(`${c.name}: the manifest sweep has a haystack (pre-condition)`, () => {
      // A manifest sweep over an empty manifest reports zero for the wrong reason.
      expect(c.manifest.length).toBeGreaterThan(0);
    });

    if (c.decidesEveryPosition === true) {
      it(`${c.name}: the unexamined-residual inventory is a measured zero (pre-condition)`, () => {
        // Every position is decided by a rule or by its shape, so nothing is left to count.
        expect(c.unexaminedResiduals).toEqual([]);
      });
    } else {
      it(`${c.name}: the unexamined-residual sweep has a haystack (pre-condition)`, () => {
        // Same reasoning: a zero-leak result over an empty inventory proves nothing about the inventory.
        expect(c.unexaminedResiduals.length).toBeGreaterThan(0);
      });
    }

    it(`${c.name}: a sentinel injected into the residual inventory IS caught (tamper)`, () => {
      const canary = c.sentinels[0];
      expect(canary).toBeDefined();
      // The very same sweep that reports zero on the real inventory must report a forged locus.
      const tampered = JSON.stringify([
        ...c.unexaminedResiduals,
        { locus: canary, count: 1, examined: false, locusWithheld: false, code: "X" },
      ]);
      expect(leaks(tampered, c.sentinels)).toContain(canary);
    });

    it(`${c.name}: a sentinel re-injected into the de-identified wire IS caught (tamper)`, () => {
      const canary = c.sentinels[0];
      expect(canary).toBeDefined();
      const tampered = `${c.deidWire}\n<<${canary as string}>>`;
      // The very same sweep that reports zero on the clean wire must report the tampered sentinel.
      expect(leaks(tampered, c.sentinels)).toContain(canary);
      // And the clean wire must NOT already contain it (else the tamper proof is vacuous).
      expect(c.deidWire.includes(canary as string)).toBe(false);
    });
  }
});

/**
 * **The carriers the measurement counts but the pass does not remove.** The corpus above sweeps a
 * sentinel that must be gone from the wire; these positions are the opposite case and need their own
 * gate, because this phase **counts and does not scrub**. A value delivered as a CDATA section, a
 * comment or a processing instruction rides into the output on purpose, and a FHIR primitive's
 * `_`-sibling element id rides with the primitive it belongs to.
 *
 * So the wire keeps them, deliberately, and that is asserted rather than glossed - and the artifact a
 * determiner reads must still carry no byte of any of them. That is the exposure that cannot be
 * recalled: a residual record naming a position it could not examine, with the value written beside it.
 */
describe("counted, not removed: a carrier's value reaches the wire and never the audit trail", () => {
  const CARRIER_XML = `<?xml version="1.0" encoding="UTF-8"?>
<ClinicalDocument xmlns="urn:hl7-org:v3">
  <title>ZZTITLE</title>
  <component><structuredBody><component><section>
    <code code="11450-4" codeSystem="2.16.840.1.113883.6.1"/>
    <entry><observation classCode="OBS" moodCode="EVN">
      <zzCdataNote><![CDATA[ZZCARRIERCDATA]]></zzCdataNote>
      <zzCommentNote><!-- ZZCARRIERCOMMENT --></zzCommentNote>
      <zzPiNote><?zzproc ZZCARRIERPI?></zzPiNote>
    </observation></entry>
  </section></component></structuredBody></component>
</ClinicalDocument>`;
  const CARRIER_JSON = JSON.stringify({
    resourceType: "Observation",
    status: "final",
    _status: { id: "ZZCARRIERELEMENTID" },
  });
  const CARRIER_SENTINELS = [
    "ZZCARRIERCDATA",
    "ZZCARRIERCOMMENT",
    "ZZCARRIERPI",
    "ZZCARRIERELEMENTID",
  ];

  const ccda = deidentifyCcda(parseCcda(CARRIER_XML), {
    context: createDeidContext({
      key: "carrier-corpus-synthetic-hmac-key",
      patientId: "p-carrier",
    }),
  });
  const fhir = deidentifyFhir(parseResource(CARRIER_JSON).resource, {
    context: createDeidContext({
      key: "carrier-corpus-synthetic-hmac-key",
      patientId: "p-carrier",
    }),
  });
  const residuals = [...ccda.unexaminedResiduals, ...fhir.unexaminedResiduals];

  it("the carriers really do reach the wire: this phase counts, it does not scrub", () => {
    const wire = `${ccda.document.toString()}\n${serializeResource(fhir.document)}`;
    expect(leaks(wire, CARRIER_SENTINELS).sort()).toEqual([...CARRIER_SENTINELS].sort());
  });

  it("each one is measured, so the inventory is a haystack and not an empty list", () => {
    const loci = new Set(residuals.map((r) => r.locus));
    expect(
      loci.has(
        "component/structuredBody/component/section/entry/observation/zzCdataNote/#cdata-section",
      ),
    ).toBe(true);
    expect(
      loci.has(
        "component/structuredBody/component/section/entry/observation/zzCommentNote/#comment",
      ),
    ).toBe(true);
    expect(
      loci.has(
        "component/structuredBody/component/section/entry/observation/zzPiNote/#processing-instruction/zzproc",
      ),
    ).toBe(true);
    expect(loci.has("Observation._status.id")).toBe(true);
  });

  it("and no value from any of them reaches the inventory, the report or its Markdown", () => {
    const built = [ccda, fhir].map((r) =>
      buildExpertDeterminationSupportReport(r.manifest, {
        unexaminedResiduals: r.unexaminedResiduals,
      }),
    );
    const artifacts = [
      JSON.stringify(residuals),
      JSON.stringify(built),
      built.map((r) => formatExpertDeterminationSupportReport(r)).join("\n"),
    ].join("\n");
    expect(leaks(artifacts, CARRIER_SENTINELS)).toEqual([]);
  });

  it("the same sweep catches a forged one, so the zero above has teeth (tamper)", () => {
    const forged = JSON.stringify([
      ...residuals,
      { locus: "ZZCARRIERCDATA", count: 1, examined: false, locusWithheld: false, code: "X" },
    ]);
    expect(leaks(forged, CARRIER_SENTINELS)).toContain("ZZCARRIERCDATA");
  });
});

/**
 * The **other direction**, and it is not optional. Every gate above proves a value is ABSENT, and a
 * detector that reports zero can be a gap rather than a clearance: an adapter that dropped the whole
 * PV1 segment, or a fixture whose loci the extractor never reached, would pass all of them. This
 * proves the same loci are still CARRIED by the profile that is entitled to carry them, so the
 * absences above are a decision the policy made and not an accident of the harness.
 */
describe("encounter loci positive control, the limited-data-set profile still carries them", () => {
  const ENCOUNTER_SENTINELS: readonly string[] = [
    "ZZVISIT700",
    "20200103040500",
    "20200109060700",
    "20200104080000",
    "20200105090000",
    "ZZPLACER700",
    "ZZFILLER700",
  ];

  const ctx = createDeidContext({
    key: "hl7-lds-corpus-synthetic-hmac-key",
    patientId: "p-hl7-lds",
  });
  const { document, manifest } = deidentifyHl7(
    parseHL7(hl7Wire("adt-a03")),
    profileOptions(LIMITED_DATA_SET_PROFILE, ctx),
  );
  const wire = document.toString();

  it("every encounter sentinel survives the limited-data-set pass", () => {
    const removed = ENCOUNTER_SENTINELS.filter((s) => !wire.includes(s));
    expect(removed).toEqual([]);
  });

  it("every surviving encounter locus is RECORDED as a retained residual", () => {
    const retained = manifest.filter((m) => m.disposition === "retained");
    // The three PID-11 rows are the §164.514(e)(2)(ii) address parts: town or city, State and the
    // whole zip code, each located to its own COMPONENT so a reader knows which part survived.
    expect(retained.map((m) => m.locus).sort()).toEqual([
      "DG1-5",
      "OBR-2",
      "OBR-3",
      "OBR-7",
      "ORC-2",
      "ORC-3",
      "PID-11[0].3",
      "PID-11[0].4",
      "PID-11[0].5",
      "PV1-19[0]",
      "PV1-44",
      "PV1-45",
    ]);
    expect(retained.every((m) => m.code === "DEID_RESIDUAL_RETAINED")).toBe(true);
  });

  it("and each one reaches the determiner's residual inventory in the support report", () => {
    const report = buildExpertDeterminationSupportReport(manifest, {
      policy: LIMITED_DATA_SET_PROFILE.policy,
    });
    const inventoried = new Set(report.retainedQuasiIdentifiers.map((r) => r.locus));
    for (const locus of [
      "PV1-19[0]",
      "PV1-44",
      "PV1-45",
      "OBR-2",
      "OBR-3",
      "OBR-7",
      "ORC-2",
      "ORC-3",
      "DG1-5",
    ]) {
      expect(inventoried.has(locus)).toBe(true);
    }
    expect(report.dispositionSummary.retained).toBe(12);
  });

  it("the address parts §164.514(e)(2)(ii) NAMES survive, and reach the inventory too", () => {
    // The positive control for the geographic class: (e)(2)(ii) removes postal address information
    // "other than town or city, State, and zip code", so the town and the whole ZIP are carried, and
    // the ZIP is NOT reduced to its three-digit prefix, which is Safe Harbor's rule and not this one.
    expect(wire).toContain("ZZENCCITY");
    expect(wire).toContain("90210");
    const report = buildExpertDeterminationSupportReport(manifest, {
      policy: LIMITED_DATA_SET_PROFILE.policy,
    });
    const inventoried = new Set(report.retainedQuasiIdentifiers.map((r) => r.locus));
    for (const locus of ["PID-11[0].3", "PID-11[0].4", "PID-11[0].5"]) {
      expect(inventoried.has(locus)).toBe(true);
    }
  });

  it("the patient identifiers §164.514(e)(2) DOES name are still gone", () => {
    // ZZENCCITY is deliberately NOT on this list any more: (e)(2)(ii) is the sixteen-item list's only
    // PARTIAL exclusion, and the town or city is one of the three parts it names as surviving. The
    // STREET is the half of that clause that is still excluded, and it stays here.
    for (const s of ["ZZENCFAMILY", "ZZENCGIVEN", "ZZENCSTREET", "5550000020", "ZZMRN003"]) {
      expect(wire.includes(s)).toBe(false);
    }
  });
});

describe("consolidated over-scrub corpus, clinical/financial values survive", () => {
  for (const c of CASES) {
    if (c.survivors.length > 0) {
      it(`${c.name}: every clinical survivor value remains present`, () => {
        const destroyed = c.survivors.filter((s) => !c.deidWire.includes(s));
        expect(destroyed).toEqual([]);
      });
    }
    if (c.overScrub !== undefined) {
      it(`${c.name}: clinical loci are byte-identical to the original`, c.overScrub);
    }
  }
});

// ── Pipeline fuzz: truncated / mutated fixtures never leak a full sentinel and always terminate ─────
describe("pipeline fuzz, mutated fixtures never leak and always terminate", () => {
  const ctx = createDeidContext({ key: "fuzz-key-synthetic-hmac-key", patientId: "p-fuzz" });

  interface FuzzTarget {
    readonly name: string;
    readonly raw: string;
    readonly sentinels: readonly string[];
    readonly run: (input: string) => string;
  }

  const targets: readonly FuzzTarget[] = [
    {
      name: "x12",
      raw: FIX("x12", "837p.edi"),
      sentinels: x12Case().sentinels,
      run: (i) => deidentifyX12String(i, { context: ctx }).x12,
    },
    {
      name: "ncpdp",
      raw: FIX("ncpdp", "telecom-b1.ncpdp"),
      sentinels: ncpdpCase().sentinels,
      run: (i) => deidentifyTelecomString(i, { context: ctx }).telecom,
    },
    {
      name: "hl7",
      raw: hl7Wire("adt-a01"),
      sentinels: ["ZZFAMILY", "ZZGIVEN", "ZZMRN001", "900000001"],
      run: (i) => deidentifyHl7(parseHL7(i), { context: ctx }).document.toString(),
    },
  ];

  // Property 1: TRUNCATION never leaks. A prefix of a well-framed message keeps the framing/segment
  // order intact, so any FULL sentinel that survives truncation sits in a locus the adapter still
  // recognizes and scrubs (or the sentinel is cut mid-token and no longer whole). This isolates the
  // de-identifier's own fail-closed behavior from parser-framing robustness.
  for (const t of targets) {
    it(`${t.name}: any truncation (prefix) never leaks a full seeded sentinel`, () => {
      checkProperty(
        `${t.name}: any truncation (prefix) never leaks a full seeded sentinel`,
        fc.property(fc.nat({ max: t.raw.length }), (cut) => {
          let out: string;
          try {
            out = t.run(t.raw.slice(0, cut));
          } catch {
            return true; // a bounded rejection (parser or fatal DeidError) is acceptable
          }
          for (const sentinel of t.sentinels) {
            if (out.includes(sentinel)) return false;
          }
          return true;
        }),
      );
    });
  }

  // Property 2: BYTE-FLIP robustness. Flipping arbitrary bytes can corrupt a parser's framing (a
  // separator, the HL7 encoding characters), that is the parsers' own fuzz domain, so here we require
  // only that the pipeline TERMINATES with a string or a bounded throw, never a hang / OOM / non-Error.
  for (const t of targets) {
    it(`${t.name}: arbitrary byte-flips terminate with a string or a bounded rejection`, () => {
      checkProperty(
        `${t.name}: arbitrary byte-flips terminate with a string or a bounded rejection`,
        fc.property(
          fc.nat({ max: Math.max(0, t.raw.length - 1) }),
          fc.integer({ min: 0, max: 255 }),
          (pos, code) => {
            const s =
              pos < t.raw.length
                ? t.raw.slice(0, pos) + String.fromCharCode(code) + t.raw.slice(pos + 1)
                : t.raw;
            try {
              return typeof t.run(s) === "string";
            } catch (err) {
              return err instanceof Error; // bounded rejection, not a crash
            }
          },
        ),
      );
    });
  }
});
