/**
 * The **date-locus enumeration** itself: the committed HL7 v2.5.1 table the retained-segment date
 * sweep is derived from.
 *
 * Two different things are checked here, and the second is the one that matters:
 *
 * 1. the table's own shape, so a row cannot be added that names a position outside the segment
 *    definition it cites, or a duplicate of one already there;
 * 2. that **every row is wired end to end**. A walk builds one synthetic message per segment in the
 *    table's domain with a full-precision timestamp at every position the table names, and asserts that
 *    each one is reduced to its year and recorded under its own locus path. A row that exists in the
 *    table but is never acted on would pass a shape check and fail this one.
 *
 * Every value here is a synthetic timestamp; no fixture is read.
 */

import { describe, expect, it } from "vitest";
import { parseHL7 } from "@cosyte/hl7";

import {
  SAFE_HARBOR_CATEGORIES,
  SAFE_HARBOR_PROFILE,
  createDeidContext,
  profileOptions,
} from "../../src/index.js";
import {
  HL7_DATE_LOCI,
  HL7_DATE_LOCUS_VERSION,
  HL7_PASSED_THROUGH_SEGMENTS,
  RETAINED_LOCUS_RULES,
  RETAIN_SEGMENTS,
  deidentifyHl7,
  type Hl7DateLocusRule,
} from "../../src/hl7/index.js";

const ctx = createDeidContext({ key: "date-loci-key", patientId: "patient-800" });
const STAMP = "20240315103000";
const YEAR = "2024";

/** Build one segment line carrying `value` at every position the enumeration names for `type`. */
function segmentFor(type: string, loci: readonly Hl7DateLocusRule[], value: string): string {
  const byField = new Map<number, Map<number, string>>();
  for (const rule of loci) {
    const components = byField.get(rule.field) ?? new Map<number, string>();
    components.set(rule.component ?? 1, value);
    byField.set(rule.field, components);
  }
  const max = Math.max(...byField.keys());
  const fields = new Array<string>(max).fill("");
  for (const [field, components] of byField) {
    const width = Math.max(...components.keys());
    const parts = new Array<string>(width).fill("");
    for (const [component, v] of components) parts[component - 1] = v;
    fields[field - 1] = parts.join("^");
  }
  return `${type}|${fields.join("|")}`;
}

/** The manifest locus path the pass must record a given enumerated position under. */
function expectedPath(type: string, rule: Hl7DateLocusRule): string {
  const carved = (RETAINED_LOCUS_RULES[type] ?? []).some((r) => r.field === rule.field);
  if (rule.component === undefined) {
    // A field the carve-out table already owns keeps ITS path: it is the same position, acted on by
    // the rule that owned it before this change, never a second locus beside it.
    return carved ? `${type}-${String(rule.field)}` : `${type}-${String(rule.field)}[0]`;
  }
  return `${type}-${String(rule.field)}[0].${String(rule.component)}`;
}

describe("the HL7 v2.5.1 date-locus enumeration: shape", () => {
  it("is derived from exactly one version of the standard", () => {
    expect(HL7_DATE_LOCUS_VERSION).toBe("2.5.1");
  });

  it("covers every segment the pass hands through, and nothing that is not one", () => {
    const enumerated = new Set(Object.keys(HL7_DATE_LOCI));
    const domain = new Set(HL7_PASSED_THROUGH_SEGMENTS);
    const missing = [...domain].filter((s) => !enumerated.has(s)).sort();
    const extra = [...enumerated].filter((s) => !domain.has(s)).sort();
    expect({ missing, extra }).toEqual({ missing: [], extra: [] });
  });

  it("the domain is the retain-list plus exactly one segment, and that segment is OBX", () => {
    // The difference is stated rather than left implicit: OBX is passed through by the OBX-2
    // value-type branch instead of by the list, which is what makes its own date/time fields
    // reachable. A second entry appearing here silently would widen the sweep with nothing to notice.
    const beyond = [...HL7_PASSED_THROUGH_SEGMENTS].filter((s) => !RETAIN_SEGMENTS.has(s)).sort();
    expect(beyond).toEqual(["OBX"]);
    // ... and the domain never LOSES a retain-list segment either.
    const dropped = [...RETAIN_SEGMENTS].filter((s) => !HL7_PASSED_THROUGH_SEGMENTS.has(s));
    expect(dropped).toEqual([]);
  });

  it("enumerates the OBX date/time fields the message does not type for itself", () => {
    // OBX-5 is typed by OBX-2 and is deliberately absent from the table; OBX-12 / OBX-14 / OBX-19 are
    // facts about v2.5.1 like any other row, and were the whole-segment omission this table once had.
    const obx = HL7_DATE_LOCI["OBX"];
    expect(obx?.loci.map((r) => r.field)).toEqual([12, 14, 19]);
    expect(obx?.loci.every((r) => r.datatype === "TS" && r.component === undefined)).toBe(true);
    expect(obx?.loci.some((r) => r.field === 5)).toBe(false);
  });

  it("cites a chapter and a walked field count for every segment", () => {
    for (const [type, table] of Object.entries(HL7_DATE_LOCI)) {
      expect(table.chapter, type).not.toBe("");
      expect(table.fields, type).toBeGreaterThanOrEqual(0);
      // A segment with no fixed field count says why in its own note rather than by being silent.
      if (table.fields === 0) expect(table.note, type).toBeDefined();
    }
  });

  it("names every row inside the segment definition it cites, with no duplicate position", () => {
    for (const [type, table] of Object.entries(HL7_DATE_LOCI)) {
      const seen = new Set<string>();
      for (const rule of table.loci) {
        const where = `${type}-${String(rule.field)}`;
        expect(rule.field, where).toBeGreaterThanOrEqual(1);
        expect(rule.field, where).toBeLessThanOrEqual(table.fields);
        expect(rule.name, where).not.toBe("");
        expect(["DT", "DTM", "TS"], where).toContain(rule.datatype);
        if (rule.component !== undefined) {
          expect(rule.component, where).toBeGreaterThanOrEqual(1);
          expect(rule.composite, where).toBeDefined();
        }
        const key = `${String(rule.field)}.${String(rule.component ?? 0)}`;
        expect(seen.has(key), `${where} is enumerated twice`).toBe(false);
        seen.add(key);
      }
    }
  });

  it("lists rows in ascending field then component order, so extraction order is document order", () => {
    for (const [type, table] of Object.entries(HL7_DATE_LOCI)) {
      const keys = table.loci.map((r) => r.field * 1000 + (r.component ?? 0));
      expect(
        [...keys].sort((a, b) => a - b),
        type,
      ).toEqual(keys);
    }
  });

  it("carries the encounter-date carve-out positions, so the whole class is readable in one place", () => {
    for (const [type, field] of [
      ["PV1", 44],
      ["PV1", 45],
      ["OBR", 7],
      ["DG1", 5],
    ] as const) {
      expect(HL7_DATE_LOCI[type]?.loci.some((r) => r.field === field)).toBe(true);
    }
  });

  it("adds no segment to the retain-list: its membership is exactly what it was", () => {
    // The enumeration extends what happens INSIDE a retained segment; it never widens which segments
    // are retained. A segment added here would pass every other test in this file.
    expect([...RETAIN_SEGMENTS].sort()).toMatchInlineSnapshot(`
      [
        "AIG",
        "AIL",
        "AIP",
        "AIS",
        "AL1",
        "APR",
        "ARQ",
        "BHS",
        "BTS",
        "CER",
        "CSP",
        "CSR",
        "CSS",
        "CTD",
        "CTI",
        "DB1",
        "DG1",
        "DSC",
        "DSP",
        "EDU",
        "EQL",
        "ERR",
        "EVN",
        "FHS",
        "FT1",
        "FTS",
        "GOL",
        "IAM",
        "IN3",
        "LCC",
        "LCH",
        "LDP",
        "LOC",
        "LRL",
        "MCP",
        "MFA",
        "MFE",
        "MFI",
        "MSA",
        "MSH",
        "OBR",
        "OMC",
        "ORC",
        "ORG",
        "PD1",
        "PDC",
        "PR1",
        "PRA",
        "PRB",
        "PRC",
        "PRD",
        "PV1",
        "PV2",
        "QAK",
        "QID",
        "QPD",
        "QRF",
        "QRI",
        "RDF",
        "RDT",
        "RGS",
        "ROL",
        "RXA",
        "RXC",
        "RXD",
        "RXE",
        "RXG",
        "RXO",
        "RXR",
        "RXV",
        "SCH",
        "SFT",
        "SPM",
        "STF",
        "TQ1",
        "TQ2",
        "TXA",
        "UB1",
        "UB2",
      ]
    `);
  });

  it("has the size a reviewer weighed: the domain and the enumeration are both counted", () => {
    const retainListSegments = RETAIN_SEGMENTS.size;
    const enumeratedSegments = Object.keys(HL7_DATE_LOCI).length;
    const withDates = Object.values(HL7_DATE_LOCI).filter((t) => t.loci.length > 0).length;
    const loci = Object.values(HL7_DATE_LOCI).reduce((n, t) => n + t.loci.length, 0);
    const components = Object.values(HL7_DATE_LOCI).reduce(
      (n, t) => n + t.loci.filter((r) => r.component !== undefined).length,
      0,
    );
    expect({ retainListSegments, enumeratedSegments, withDates, loci, components })
      .toMatchInlineSnapshot(`
      {
        "components": 48,
        "enumeratedSegments": 80,
        "loci": 174,
        "retainListSegments": 79,
        "withDates": 51,
      }
    `);
  });
});

describe("the HL7 v2.5.1 date-locus enumeration: every row is wired end to end", () => {
  const walked = Object.entries(HL7_DATE_LOCI).filter(([, t]) => t.loci.length > 0);

  it("walks every passed-through segment that carries a date", () => {
    expect(walked.length).toBeGreaterThan(0);
  });

  for (const [type, table] of walked) {
    it(`acts on and records every enumerated date position of ${type}`, () => {
      const header = `MSH|^~\\&|A|B|C|D|${STAMP}||ORM^O01|M1|P|2.5.1`;
      const wire =
        type === "MSH" ? header : [header, segmentFor(type, table.loci, STAMP)].join("\r");
      const original = parseHL7(wire);
      const { document, manifest } = deidentifyHl7(
        parseHL7(wire),
        profileOptions(SAFE_HARBOR_PROFILE, ctx),
      );

      for (const rule of table.loci) {
        const path = `${type}.${String(rule.field)}${rule.component === undefined ? "" : `.${String(rule.component)}`}`;
        // PRE-CONDITION: the value really is at the position the enumeration names.
        expect(original.get(path), `${type} seeded at ${path}`).toBe(STAMP);
        // It is reduced to its year in the output ...
        expect(document.get(path), `${type} generalized at ${path}`).toBe(YEAR);
        // ... and recorded, value-free, under its own locus path.
        const entry = manifest.find((m) => m.locus === expectedPath(type, rule));
        expect(entry?.category, `${type} recorded at ${expectedPath(type, rule)}`).toBe(
          SAFE_HARBOR_CATEGORIES.DATES,
        );
      }
      // No full-precision value survives anywhere in the serialized output.
      expect(document.toString()).not.toContain(STAMP);
    });
  }
});
