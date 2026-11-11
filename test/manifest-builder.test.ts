/**
 * The manifest builder aggregates identical rows into one entry with a running count and keeps the
 * order rows were first seen in. It finds a row by its locus and compares the rest of the row field
 * by field, so these pin what a row is: two rows that differ in any of category, transform,
 * disposition, code or role never share an entry, and an entry already handed out by `build` never
 * changes under its holder.
 */

import { describe, expect, it } from "vitest";

import { DEID_DISPOSITION_CODES, SAFE_HARBOR_CATEGORIES as C } from "../src/index.js";
import { ManifestBuilder } from "../src/manifest.js";

const REMOVED = {
  category: C.NAMES,
  transform: "redact",
  locus: "PID-5",
  disposition: "removed",
  code: DEID_DISPOSITION_CODES.DEID_CATEGORY_REMOVED,
} as const;

describe("ManifestBuilder", () => {
  it("counts a repeated row on its first entry and keeps first-seen order", () => {
    const b = new ManifestBuilder();
    b.add(REMOVED);
    b.add({ ...REMOVED, locus: "PID-11" });
    b.add(REMOVED);
    b.add(REMOVED);
    const built = b.build();
    expect(built.map((e) => [e.locus, e.count])).toEqual([
      ["PID-5", 3],
      ["PID-11", 1],
    ]);
    expect(Object.keys(built[0] ?? {})).toEqual([
      "category",
      "transform",
      "locus",
      "disposition",
      "code",
      "count",
      "reidentificationCode",
    ]);
    expect(Object.isFrozen(built)).toBe(true);
    expect(built.every((e) => Object.isFrozen(e))).toBe(true);
  });

  it("never merges rows at one locus that differ in any other field", () => {
    const b = new ManifestBuilder();
    const rows = [
      REMOVED,
      { ...REMOVED, category: C.SSN },
      { ...REMOVED, transform: "pseudonymize", disposition: "transformed" },
      { ...REMOVED, disposition: "blocked" },
      { ...REMOVED, code: DEID_DISPOSITION_CODES.DEID_LOCUS_BLOCKED },
      { ...REMOVED, partyRole: "IL" },
      { ...REMOVED, partyRole: "PR" },
    ] as const;
    for (const row of rows) b.add(row);
    for (const row of rows) b.add(row);
    const built = b.build();
    expect(built).toHaveLength(rows.length);
    expect(built.every((e) => e.count === 2)).toBe(true);
    expect(built[2]?.reidentificationCode).toBe(true);
    expect(built[0]?.reidentificationCode).toBe(false);
  });

  it("an absent role and an empty one are the same row", () => {
    const b = new ManifestBuilder();
    b.add(REMOVED);
    b.add({ ...REMOVED, partyRole: "" });
    expect(b.build().map((e) => e.count)).toEqual([2]);
  });

  it("a row added after build counts on a copy, never on the entry already handed out", () => {
    const b = new ManifestBuilder();
    b.add(REMOVED);
    b.add({ ...REMOVED, code: DEID_DISPOSITION_CODES.DEID_LOCUS_BLOCKED });
    b.add({ ...REMOVED, locus: "PID-11" });
    const first = b.build();
    b.add(REMOVED);
    b.add({ ...REMOVED, code: DEID_DISPOSITION_CODES.DEID_LOCUS_BLOCKED });
    b.add({ ...REMOVED, locus: "PID-11" });
    b.add({ ...REMOVED, locus: "PID-11" });
    const second = b.build();
    expect(first.map((e) => e.count)).toEqual([1, 1, 1]);
    expect(second.map((e) => [e.locus, e.code, e.count])).toEqual([
      ["PID-5", DEID_DISPOSITION_CODES.DEID_CATEGORY_REMOVED, 2],
      ["PID-5", DEID_DISPOSITION_CODES.DEID_LOCUS_BLOCKED, 2],
      ["PID-11", DEID_DISPOSITION_CODES.DEID_CATEGORY_REMOVED, 3],
    ]);
  });
});
