/**
 * **NCPDP Telecom: the segments the adapter keeps whole, field by field.** A recognized clinical,
 * financial or response segment is kept as a structure, so a field inside it leaves the pass
 * unchanged unless a rule names it. This file holds the three things that keep that honest:
 *
 * - every kept segment has a listed reason (`TELECOM_RETAIN_SEGMENT_REASONS`), and the kept set is
 *   exactly the segments with one;
 * - a walk over each kept segment, carrying every field our field tables place in it, shows each
 *   field either reached by a rule (transformed and in the manifest), failed closed as free text, or
 *   kept byte for byte and counted as an unexamined residual: never one that leaves unrecorded;
 * - the fields found to carry an individual's data in a segment that used to be kept whole: the
 *   response DUR segment's Previous Date Of Fill (`530-FU`), now cut to the year, and the Prior
 *   Authorization segment (`12`), now kept by a list, so its fields other than the type code are
 *   removed.
 *
 * Where a field sits comes from the field tables we hold: `FIELD_NAMES` and the response reader of
 * `@cosyte/ncpdp`, and this package's own tests. A field id those tables do not place is marked as
 * such below and is walked as an unestablished candidate: the walk shows it counted, not that it is
 * what the id is said to be.
 *
 * Every value is synthetic: made-up names, codes, numbers and dates chosen for the test.
 */

import {
  buildTelecomRequest,
  fieldValue,
  findSegment,
  parseTelecom,
  type TelecomTransaction,
} from "@cosyte/ncpdp/telecom";
import { describe, expect, it } from "vitest";

import {
  createDeidContext,
  LIMITED_DATA_SET_PROFILE,
  profileOptions,
  SAFE_HARBOR_CATEGORIES,
} from "../../src/index.js";
import {
  deidentifyTelecom,
  TELECOM_FREE_TEXT_FIELDS,
  TELECOM_LOCUS_MAP,
  TELECOM_RETAIN_SEGMENT_REASONS,
  TELECOM_RETAIN_SEGMENTS,
  TELECOM_RETAINED_SEGMENT_RULES,
} from "../../src/ncpdp/index.js";

const C = SAFE_HARBOR_CATEGORIES;
const FS = "\x1c";
const RS = "\x1e";
const GS = "\x1d";

/** The fixed-width response header the committed response fixture carries. */
const RESPONSE_HEADER = "D0B11A01PHARM123       ";

type Field = readonly [id: string, value: string];

/** A response transmission built from its segments, the way the committed response fixture is framed. */
function responseRaw(segments: readonly (readonly [string, readonly Field[]])[]): string {
  const body = segments
    .map(([id, fields]) => [`AM${id}`, ...fields.map(([f, v]) => `${f}${v}`)].join(FS))
    .join(RS);
  return `${RESPONSE_HEADER}${GS}${body}`;
}

/** A B1 request carrying the given segments after a minimal Patient segment. */
function request(segments: readonly (readonly [string, readonly Field[]])[]): TelecomTransaction {
  return buildTelecomRequest({
    header: { transactionCode: "B1", binNumber: "999999", dateOfService: "20250610" },
    segments: segments.map(([segmentId, fields]) => ({
      segmentId,
      fields: fields.map(([id, value]) => ({ id, value })),
    })),
  });
}

/**
 * Each kept segment, with the fields our tables place in it. `FIELD_NAMES` groups its ids by
 * segment; the Pricing fields come from this package's Claim date test; the three ids marked
 * `candidate` are named by no table we hold for that segment, and two placeholder ids (`ZY`, `ZX`)
 * stand for the fields of a segment no table names at all.
 */
const WALK: Readonly<Record<string, readonly Field[]>> = {
  "02": [
    ["ZY", "ZYPHARMVALUE"], // placeholder: no table we hold names a Pharmacy Provider field
  ],
  "07": [
    ["EM", "1"],
    ["D2", "900000101"],
    ["E1", "03"],
    ["D7", "99999000101"],
    ["D3", "01"],
    ["E7", "30000"],
    ["D5", "30"],
    ["D8", "0"],
    ["DE", "20250602"],
    ["EP", "20250415"],
    ["EK", "ZZSCHEDRXID01"], // candidate: Scheduled Prescription ID Number, not in our tables
    ["CW", "ZZCLAIMALTID01"], // candidate: Alternate ID, not in our tables
  ],
  "08": [
    ["E4", "TD"],
    ["E5", "M0"],
    ["E6", "1B"],
    ["8E", "11"],
    ["J9", "03"],
    ["H7", "99999000102"],
    ["FY", "ZZDURFREETEXT"],
  ],
  "10": [
    ["EF", "10"],
    ["EG", "1"],
    ["EC", "1"],
    ["RE", "03"],
    ["TE", "99999000103"],
    ["ED", "1000"],
    ["EE", "250{"],
    ["UE", "01"],
  ],
  "11": [
    ["D9", "1500{"],
    ["DC", "250{"],
    ["DU", "1750{"],
  ],
  "13": [
    ["ZE", "20250301"], // candidate: Measurement Date, not in our tables
    ["ZX", "ZXCLINVALUE"], // placeholder: no table we hold names another Clinical field
  ],
  "20": [["F4", "ZZRESPMESSAGE"]],
  "21": [
    ["AN", "P"],
    ["F3", "AUTH0000101"],
    ["FA", "1"],
    ["FB", "75"],
    ["FQ", "ZZADDLMESSAGE"],
  ],
  "22": [
    ["EM", "1"],
    ["D2", "900000101"],
  ],
  "23": [
    ["F5", "0001000"],
    ["F6", "0002500"],
    ["F7", "0000200"],
    ["F9", "0002700"],
    ["FM", "1"],
  ],
  "24": [
    ["J6", "1"],
    ["E4", "ER"],
    ["FS", "1"],
    ["FT", "0"],
    ["FU", "20250511"],
    ["FV", "30000"],
    ["FW", "1"],
    ["FX", "0"],
    ["E5", "M0"],
    ["E6", "1B"],
    ["8E", "11"],
    ["J9", "03"],
    ["H7", "99999000104"],
    ["FY", "ZZRESPDURTEXT"],
  ],
};

const RESPONSE_SEGMENTS = new Set(["20", "21", "22", "23", "24"]);

const ctx = createDeidContext({ key: "kept-segments-synthetic-key", patientId: "p-kept" });

describe("every segment the NCPDP adapter keeps whole has a listed reason", () => {
  it("lists a reason for each kept segment, and keeps exactly the segments it lists", () => {
    const listed = Object.keys(TELECOM_RETAIN_SEGMENT_REASONS).sort();
    expect(listed).toEqual([...TELECOM_RETAIN_SEGMENTS].sort());
    for (const reason of Object.values(TELECOM_RETAIN_SEGMENT_REASONS)) {
      expect(reason.trim().length).toBeGreaterThan(20);
    }
  });

  it("walks a field list for every kept segment, and only for kept segments", () => {
    expect(Object.keys(WALK).sort()).toEqual([...TELECOM_RETAIN_SEGMENTS].sort());
  });
});

describe("a walk over the fields of each kept segment", () => {
  for (const segId of Object.keys(WALK)) {
    it(`segment ${segId}: each field is reached by a rule, fails closed, or is kept and counted`, () => {
      const fields = WALK[segId] ?? [];
      const tx = RESPONSE_SEGMENTS.has(segId)
        ? parseTelecom(responseRaw([[segId, fields]]))
        : request([[segId, fields]]);
      const { telecom, manifest, unexaminedResiduals } = deidentifyTelecom(tx, { context: ctx });
      const out = findSegment(parseTelecom(telecom).segments, segId);
      const residual = new Set(unexaminedResiduals.map((r) => r.locus));
      const rules = TELECOM_RETAINED_SEGMENT_RULES[segId] ?? {};

      for (const [id, value] of fields) {
        const locus = `${segId}/${id}`;
        const inManifest = manifest.some((e) => e.locus === locus);
        if (rules[id] !== undefined || TELECOM_FREE_TEXT_FIELDS.has(id)) {
          expect({ locus, inManifest }).toEqual({ locus, inManifest: true });
          expect({ locus, kept: fieldValue(out, id) === value }).toEqual({ locus, kept: false });
          expect({ locus, residual: residual.has(locus) }).toEqual({ locus, residual: false });
        } else {
          expect({ locus, value: fieldValue(out, id) }).toEqual({ locus, value });
          expect({ locus, residual: residual.has(locus) }).toEqual({ locus, residual: true });
          expect({ locus, inManifest }).toEqual({ locus, inManifest: false });
        }
      }
    });
  }
});

describe("the response DUR segment's Previous Date Of Fill (530-FU)", () => {
  const raw = responseRaw([
    [
      "24",
      [
        ["J6", "1"],
        ["E4", "ER"],
        ["FU", "20250511"],
        ["FV", "30000"],
      ],
    ],
  ]);

  it("is cut to its year under Safe Harbor and recorded as a date", () => {
    const { telecom, manifest, unexaminedResiduals } = deidentifyTelecom(parseTelecom(raw));
    expect(telecom).not.toContain("20250511");
    const dur = findSegment(parseTelecom(telecom).segments, "24");
    expect(fieldValue(dur, "FU")).toBe("2025");
    expect(fieldValue(dur, "FV")).toBe("30000");
    expect(manifest.some((e) => e.locus === "24/FU" && e.category === C.DATES)).toBe(true);
    expect(unexaminedResiduals.map((r) => r.locus)).not.toContain("24/FU");
  });

  it("is a date rule of the kept segment, not of a date of birth", () => {
    expect(TELECOM_RETAINED_SEGMENT_RULES["24"]?.["FU"]).toEqual({
      mode: "date",
      category: C.DATES,
    });
  });

  it("is shifted like the other dates under a profile that shifts dates", () => {
    const shiftCtx = createDeidContext({ key: "kept-segments-shift-key", patientId: "p-kept" });
    const { manifest } = deidentifyTelecom(
      parseTelecom(raw),
      profileOptions(LIMITED_DATA_SET_PROFILE, shiftCtx),
    );
    const fu = manifest.find((e) => e.locus === "24/FU");
    expect(fu?.category).toBe(C.DATES);
    expect(fu?.transform).toBe("date-shift");
  });
});

describe("the Prior Authorization segment (12) is kept by a list", () => {
  const priorAuth: readonly Field[] = [
    ["EU", "1"],
    ["EV", "90000000101"],
    ["PE", "ZZAUTHREPFIRST"],
    ["PF", "ZZAUTHREPLAST"],
    ["PG", "ZZAUTHREPSTREET"],
    ["PH", "ZZAUTHREPCITY"],
    ["PJ", "OH"],
    ["PK", "44199"],
  ];

  it("removes the representative's name and address fields and records each", () => {
    const { telecom, manifest } = deidentifyTelecom(request([["12", priorAuth]]));
    for (const value of [
      "ZZAUTHREPFIRST",
      "ZZAUTHREPLAST",
      "ZZAUTHREPSTREET",
      "ZZAUTHREPCITY",
      "44199",
    ]) {
      expect({ value, kept: telecom.includes(value) }).toEqual({ value, kept: false });
    }
    for (const id of ["PE", "PF", "PG", "PH", "PJ", "PK"]) {
      expect(manifest.some((e) => e.locus === `12/${id}`)).toBe(true);
    }
  });

  it("removes the submitted authorization number and keeps the type code", () => {
    const { telecom, manifest, unexaminedResiduals } = deidentifyTelecom(
      request([["12", priorAuth]]),
    );
    const pa = findSegment(parseTelecom(telecom).segments, "12");
    expect(telecom).not.toContain("90000000101");
    expect(manifest.some((e) => e.locus === "12/EV")).toBe(true);
    expect(fieldValue(pa, "EU")).toBe("1");
    expect(unexaminedResiduals.map((r) => r.locus).filter((l) => l.startsWith("12/"))).toEqual([]);
  });

  it("removes a type code that is not in the form of a code", () => {
    const { telecom } = deidentifyTelecom(request([["12", [["EU", "ZZNOTACODE"]]]]));
    expect(telecom).not.toContain("ZZNOTACODE");
  });

  it("is a mapped segment, no longer one kept whole", () => {
    expect(TELECOM_RETAIN_SEGMENTS.has("12")).toBe(false);
    expect(TELECOM_LOCUS_MAP["12"]).toBeDefined();
  });
});
