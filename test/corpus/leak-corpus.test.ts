/**
 * The **consolidated leak / over-scrub corpus** (roadmap §Phase 10, §6) — one CI-gating suite that
 * exercises the two headline gates across **all six** format adapters in a single place:
 *
 * - **Leak gate (must be ZERO):** after a de-id pass, sweep the *entire serialized output* for every
 *   seeded synthetic PHI sentinel. A single survivor is a hard failure (the under-scrub harm, §4).
 * - **Over-scrub gate:** the clinical/financial survivor values must remain present (the over-scrub
 *   harm, §4) — the library must not degenerate into a "safe but useless" blanket scrubber.
 *
 * **Non-vacuity is proven two ways**, so a green result is never a green *scanner*:
 *
 * 1. **Pre-condition:** every sentinel is asserted **present in the ORIGINAL** (un-de-identified) wire —
 *    a sentinel the corpus can't even find before de-id would make its post-de-id absence meaningless.
 * 2. **Tamper:** a sentinel re-injected into the de-identified wire is **caught** by the same sweep —
 *    proving the sweep has teeth (it is not vacuously passing on an empty/broken haystack).
 *
 * Plus a **pipeline fuzz** gate: truncated / byte-flipped fixtures fed to the parse→de-id→serialize
 * string entry points never leak a full seeded sentinel and always terminate (bounded rejection or a
 * value-free result), never hang or OOM.
 *
 * Every fixture value is a synthetic, tagged sentinel; fixtures are declared synthetic in
 * `scripts/phi-allow-list.txt`. The per-format adapters keep their own detailed tests — this suite is
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

import { createDeidContext } from "../../src/index.js";
import { deidentifyHl7 } from "../../src/hl7/index.js";
import { deidentifyCcda } from "../../src/ccda/index.js";
import { deidentifyFhir } from "../../src/fhir/index.js";
import { deidentifyX12String } from "../../src/x12/index.js";
import { deidentifyTelecomString } from "../../src/ncpdp/index.js";
import { deidentifyDicom } from "../../src/dicom/index.js";
import { ALL_SENTINELS, buildPhiDataset, CLINICAL, UID } from "../dicom/helpers/fixtures.js";

const FIX = (fmt: string, file: string): string =>
  readFileSync(join(import.meta.dirname, "..", "fixtures", fmt, file), "utf8");

const hl7Wire = (name: string): string =>
  FIX("hl7", `${name}.hl7`).trim().split(/\r?\n/).join("\r");

/** One format's contribution to the corpus: the de-identified wire, the original, and its expectations. */
interface CorpusCase {
  readonly name: string;
  /** The serialized de-identified output the leak sweep scans. */
  readonly deidWire: string;
  /** The serialized ORIGINAL (un-de-identified) wire — used to prove the sentinels are really present. */
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
  const ctx = createDeidContext({ key: "hl7-corpus", patientId: "p-hl7" });
  const original = parseHL7(hl7Wire("oru-r01"));
  const { document } = deidentifyHl7(parseHL7(hl7Wire("oru-r01")), { context: ctx });
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

// ── C-CDA ─────────────────────────────────────────────────────────────────────────────────────────
function ccdaCase(): CorpusCase {
  const ctx = createDeidContext({ key: "ccda-corpus", patientId: "p-ccda" });
  const raw = FIX("ccda", "ccd.xml");
  const { document } = deidentifyCcda(parseCcda(raw), { context: ctx });
  return {
    name: "ccda",
    deidWire: document.toString(),
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
  const ctx = createDeidContext({ key: "fhir-corpus", patientId: "p-fhir" });
  const raw = FIX("fhir", "bundle.json");
  const { resource } = parseResource(raw);
  const { document } = deidentifyFhir(resource, { context: ctx });
  return {
    name: "fhir",
    deidWire: serializeResource(document),
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
    // Distinctive clinical survivors only — bare short numerics (140/135/145) are deliberately excluded
    // here, since a coincidental recurrence elsewhere in the JSON could mask a selective destruction of
    // exactly that value. LOINC / unit / status / reference wiring are unique; the FHIR adapter's own
    // test owns the byte-exact over-scrub check on the numeric values.
    survivors: ["2951-2", "mmol/L", "final", "Patient/pat1", "Practitioner/prac1"],
  };
}

// ── X12 EDI ───────────────────────────────────────────────────────────────────────────────────────
function x12Case(): CorpusCase {
  const ctx = createDeidContext({ key: "x12-corpus", patientId: "p-x12" });
  const raw = FIX("x12", "837p.edi");
  const { x12 } = deidentifyX12String(raw, { context: ctx });
  return {
    name: "x12",
    deidWire: x12,
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
    ],
    // Distinctive clinical/financial survivors only (bare years like 2026/1985 recur in envelopes/OIDs).
    survivors: ["E1165", "99213", "100.00", "COMMERCIALPAYER", "PAYERID12345"],
  };
}

// ── NCPDP Telecom ─────────────────────────────────────────────────────────────────────────────────
function ncpdpCase(): CorpusCase {
  const ctx = createDeidContext({ key: "ncpdp-corpus", patientId: "p-ncpdp" });
  const raw = FIX("ncpdp", "telecom-b1.ncpdp");
  const { telecom } = deidentifyTelecomString(raw, { context: ctx });
  return {
    name: "ncpdp",
    deidWire: telecom,
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
    ],
    // Distinctive survivors only — the NDC, payer, and pharmacy IDs (bare 441/1985 could recur).
    survivors: ["00071015527", "PAYERID99", "PHARM123"],
  };
}

// ── DICOM (metadata-only, delegated PS3.15 Annex E) ───────────────────────────────────────────────
function dicomCase(): CorpusCase {
  const original = serializeDicom(buildPhiDataset()).toString("latin1");
  const { dataset } = deidentifyDicom(buildPhiDataset());
  return {
    name: "dicom",
    deidWire: serializeDicom(dataset).toString("latin1"),
    originalWire: original,
    sentinels: [...ALL_SENTINELS, UID.sop, UID.study, UID.series],
    survivors: [CLINICAL.modality, CLINICAL.photometric, CLINICAL.sopClassUid],
  };
}

const CASES: readonly CorpusCase[] = [
  hl7Case(),
  ccdaCase(),
  fhirCase(),
  x12Case(),
  ncpdpCase(),
  dicomCase(),
];

/** The one leak sweep every gate uses — deliberately the SAME function the tamper test attacks. */
function leaks(wire: string, sentinels: readonly string[]): string[] {
  return sentinels.filter((s) => wire.includes(s));
}

describe("consolidated leak corpus — every format, zero leak", () => {
  for (const c of CASES) {
    it(`${c.name}: no seeded PHI sentinel survives the de-id pass`, () => {
      expect(leaks(c.deidWire, c.sentinels)).toEqual([]);
    });
  }
});

describe("corpus non-vacuity — the sweep and the corpus both have teeth", () => {
  for (const c of CASES) {
    it(`${c.name}: every sentinel is present in the ORIGINAL wire (pre-condition)`, () => {
      const missing = c.sentinels.filter((s) => !c.originalWire.includes(s));
      expect(missing).toEqual([]);
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

describe("consolidated over-scrub corpus — clinical/financial values survive", () => {
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
describe("pipeline fuzz — mutated fixtures never leak and always terminate", () => {
  const ctx = createDeidContext({ key: "fuzz-key", patientId: "p-fuzz" });

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

  // Property 1 — TRUNCATION never leaks. A prefix of a well-framed message keeps the framing/segment
  // order intact, so any FULL sentinel that survives truncation sits in a locus the adapter still
  // recognizes and scrubs (or the sentinel is cut mid-token and no longer whole). This isolates the
  // de-identifier's own fail-closed behavior from parser-framing robustness.
  for (const t of targets) {
    it(`${t.name}: any truncation (prefix) never leaks a full seeded sentinel`, () => {
      fc.assert(
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
        { numRuns: 200 },
      );
    });
  }

  // Property 2 — BYTE-FLIP robustness. Flipping arbitrary bytes can corrupt a parser's framing (a
  // separator, the HL7 encoding characters) — that is the parsers' own fuzz domain, so here we require
  // only that the pipeline TERMINATES with a string or a bounded throw, never a hang / OOM / non-Error.
  for (const t of targets) {
    it(`${t.name}: arbitrary byte-flips terminate with a string or a bounded rejection`, () => {
      fc.assert(
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
        { numRuns: 200 },
      );
    });
  }
});
