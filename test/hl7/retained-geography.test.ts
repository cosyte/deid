/**
 * **The postal-address allowance of §164.514(e)(2)(ii)**: the one clause of the limited data set's
 * sixteen direct identifiers that is a **partial** exclusion. It removes "Postal address information,
 * **other than town or city, State, and zip code**", so three named parts of an address survive a
 * limited data set and everything else in it does not.
 *
 * This suite is the HL7 v2 half of that. It is written to be **non-vacuous** in both directions,
 * because this class makes a preset release MORE geography than it did and a released record cannot be
 * un-released:
 *
 * - every part asserted KEPT is first asserted PRESENT at its exact path in the original wire, and
 *   then asserted present in the output AND recorded as a residual, so a kept part is never silent;
 * - every part asserted GONE is asserted gone from the whole wire, not merely from one path;
 * - the **absent-class** control runs the same messages with no retention set at all and asserts the
 *   pinned Safe Harbor reduction, so nothing here widens by omission;
 * - the **fail-closed** control feeds addresses the pass cannot vouch for and asserts the whole
 *   repetition is dropped with no retained residual recorded for it.
 *
 * Every value is a `ZZ`-tagged sentinel or a synthetic address declared in `scripts/phi-allow-list.txt`.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import { parseHL7 } from "@cosyte/hl7";

import {
  DEID_DISPOSITION_CODES,
  LIMITED_DATA_SET_PROFILE,
  RESTRICTED_ZIP3,
  RETAINED_LOCUS_CLASSES,
  SAFE_HARBOR_CATEGORIES,
  SAFE_HARBOR_PROFILE,
  createDeidContext,
  defineDeidProfile,
  profileOptions,
  type DeidManifestEntry,
} from "../../src/index.js";
import { applyHl7, deidentifyHl7, extractHl7Loci } from "../../src/hl7/index.js";

const C = SAFE_HARBOR_CATEGORIES;
const D = DEID_DISPOSITION_CODES;
const R = RETAINED_LOCUS_CLASSES;
const FIXTURES = join(import.meta.dirname, "..", "fixtures", "hl7");

const ctx = createDeidContext({ key: "retained-geography-key", patientId: "patient-901" });

/** Load a fixture and normalize its line endings to HL7 `\r` segment separators. */
function loadFixture(name: string): string {
  return readFileSync(join(FIXTURES, `${name}.hl7`), "utf8")
    .trim()
    .split(/\r?\n/)
    .join("\r");
}

const MSH = "MSH|^~\\&|SENDAPP|SENDFAC|RECVAPP|RECVFAC|20200101120000||ADT^A01|SYNTHMSG901|P|2.5";

/**
 * Build a message whose `PID-11` is exactly `address`, and whose optional `PID-12` (county code) and
 * `PID-23` (birth place) carry what the caller asks for. The field slots are **counted**, not
 * eyeballed: a fixture that seeded PID-10 would assert nothing at all, and the pre-condition case
 * below reads them back to prove it.
 */
function wire(address: string, county = "", birthPlace = ""): string {
  const fields = new Array<string>(23).fill("");
  fields[0] = "1"; // PID-1
  fields[2] = "ZZMRN901^^^HOSP^MR"; // PID-3
  fields[4] = "ZZFAMILY^ZZGIVEN"; // PID-5
  fields[10] = address; // PID-11
  fields[11] = county; // PID-12
  fields[22] = birthPlace; // PID-23
  // The segment id is JOINED rather than written as a `PID|` prefix literal: the PHI scanner reads
  // this module's string literals as a decoded HL7 document, and a literal prefix followed by an
  // interpolation reaches it as a segment whose first field is the template's own punctuation.
  return [MSH, ["PID", ...fields].join("|")].join("\r");
}

/** The de-identified wire plus manifest for one message under the shipped limited-data-set preset. */
function underLimitedDataSet(raw: string): {
  readonly text: string;
  readonly manifest: readonly DeidManifestEntry[];
  readonly get: (path: string) => string | undefined;
} {
  const { document, manifest } = deidentifyHl7(
    parseHL7(raw),
    profileOptions(LIMITED_DATA_SET_PROFILE, ctx),
  );
  return { text: document.toString(), manifest, get: (p) => document.get(p) };
}

/** Every manifest row this pass recorded at a locus under the given field prefix. */
function rowsAt(
  manifest: readonly DeidManifestEntry[],
  prefix: string,
): readonly DeidManifestEntry[] {
  return manifest.filter((m) => m.locus.startsWith(prefix));
}

const PATIENT_ADDRESS = "742 Evergreen Ter^^Springfield^IL^62704";

describe("the fixture really seeds a full patient address (non-vacuity)", () => {
  it("PRE-CONDITION: street, city, state and ZIP are each at their own XAD component", () => {
    const original = parseHL7(wire(PATIENT_ADDRESS));
    expect(original.get("PID.11.1")).toBe("742 Evergreen Ter");
    expect(original.get("PID.11.3")).toBe("Springfield");
    expect(original.get("PID.11.4")).toBe("IL");
    expect(original.get("PID.11.5")).toBe("62704");
  });

  it("PRE-CONDITION: the committed ADT fixture seeds one at PID-11 too", () => {
    const original = parseHL7(loadFixture("adt-a01"));
    expect(original.get("PID.11.1")).toBe("ZZSTREET");
    expect(original.get("PID.11.3")).toBe("ZZCITY");
    expect(original.get("PID.11.5")).toBe("90210");
  });
});

describe("§164.514(e)(2)(ii): town or city, State and the WHOLE zip code survive; the street does not", () => {
  const { text, manifest, get } = underLimitedDataSet(wire(PATIENT_ADDRESS));

  it("the three NAMED parts are emitted unchanged, each at its own component", () => {
    expect(get("PID.11.3")).toBe("Springfield");
    expect(get("PID.11.4")).toBe("IL");
    expect(get("PID.11.5")).toBe("62704");
  });

  it("the street address is gone from the whole wire, not merely from its component", () => {
    expect(text).not.toContain("742 Evergreen Ter");
    expect(text).not.toContain("Evergreen");
    expect(get("PID.11.1") ?? "").toBe("");
  });

  it("the ZIP is kept IN FULL: (e)(2) states no digit limit, so nothing is truncated", () => {
    expect(text).toContain("62704");
    expect(get("PID.11.5")).not.toBe("627");
  });

  it("each retained part is RECORDED as a residual, located to field, repetition and component", () => {
    const rows = rowsAt(manifest, "PID-11");
    expect(rows.map((m) => m.locus).sort()).toEqual(["PID-11[0].3", "PID-11[0].4", "PID-11[0].5"]);
    for (const row of rows) {
      expect(row.category).toBe(C.GEOGRAPHIC);
      expect(row.transform).toBe("retain");
      expect(row.disposition).toBe("retained");
      expect(row.code).toBe(D.DEID_RESIDUAL_RETAINED);
      // A residual is a position and a count, never a value: the manifest is the audit trail, and a
      // manifest that logged the town it kept would be the leak the manifest exists to avoid.
      expect(JSON.stringify(row)).not.toContain("Springfield");
      expect(JSON.stringify(row)).not.toContain("62704");
    }
  });

  it("the allowance follows the PARTY LIST, not just the patient", () => {
    // §164.514(e)(2) opens on "the individual or of relatives, employers, or household members", the
    // same scope clause as (b)(2)(i), so the next of kin, the guarantor, the guarantor's EMPLOYER and
    // the insured get the identical treatment. Their streets go and their towns stay.
    const lds = underLimitedDataSet(loadFixture("adt-a01"));
    for (const street of ["ZZSTREET", "ZZNKSTREET", "ZZGTSTREET", "ZZGTEMPSTREET", "ZZINSSTREET"]) {
      expect(lds.text.includes(street), `${street} survived`).toBe(false);
    }
    for (const town of ["ZZCITY", "ZZNKCITY", "ZZGTCITY", "ZZGTEMPCITY", "ZZINSCITY"]) {
      expect(lds.text.includes(town), `${town} was dropped`).toBe(true);
    }
    for (const zip of ["90210", "03601", "10001", "11201", "55901"]) {
      expect(lds.text.includes(zip), `${zip} was not kept in full`).toBe(true);
    }
    // And every one of them is recorded, at all five mapped address positions.
    const retained = lds.manifest.filter((m) => m.disposition === "retained").map((m) => m.locus);
    for (const locus of ["PID-11[0]", "NK1-4[0]", "GT1-5[0]", "GT1-17[0]", "IN1-19[0]"]) {
      expect(retained.filter((l) => l.startsWith(locus))).toHaveLength(3);
    }
  });
});

describe("a part §164.514(e)(2)(ii) does NOT name is removed, and is not recorded as retained", () => {
  // XAD.2 other designation, XAD.6 country, XAD.7 address type, XAD.8 other geographic designation,
  // XAD.9 county / parish code, XAD.10 census tract. The clause names none of them, so none survives.
  // HL7 v2's XAD types no PRECINCT component at all; XAD.8 is the position a precinct would arrive at,
  // and it is dropped like the rest.
  const full =
    "742 Evergreen Ter^ZZOTHERDESIG^Springfield^IL^62704^USA^H^ZZOTHERGEO^ZZCOUNTY^ZZTRACT";
  const { text, manifest, get } = underLimitedDataSet(wire(full, "ZZCOUNTYCODE", "ZZBIRTHPLACE"));

  it("PRE-CONDITION: the unnamed components really are seeded", () => {
    const original = parseHL7(wire(full, "ZZCOUNTYCODE", "ZZBIRTHPLACE"));
    expect(original.get("PID.11.9")).toBe("ZZCOUNTY");
    expect(original.get("PID.11.10")).toBe("ZZTRACT");
    expect(original.get("PID.12")).toBe("ZZCOUNTYCODE");
    expect(original.get("PID.23")).toBe("ZZBIRTHPLACE");
  });

  it("the county, the census tract, the country and every other component are gone", () => {
    for (const s of ["ZZOTHERDESIG", "USA", "ZZOTHERGEO", "ZZCOUNTY", "ZZTRACT"]) {
      expect(text.includes(s), `${s} survived`).toBe(false);
    }
  });

  it("the county-code FIELD and the birth place stay blocked, exactly as they are today", () => {
    expect(text).not.toContain("ZZCOUNTYCODE");
    expect(text).not.toContain("ZZBIRTHPLACE");
    for (const locus of ["PID-12", "PID-23"]) {
      const row = manifest.find((m) => m.locus === locus);
      expect(row?.disposition).toBe("blocked");
      expect(row?.code).toBe(D.DEID_LOCUS_BLOCKED);
    }
  });

  it("only the three named parts are recorded: nothing unnamed becomes a retained residual", () => {
    expect(
      rowsAt(manifest, "PID-11")
        .map((m) => m.locus)
        .sort(),
    ).toEqual(["PID-11[0].3", "PID-11[0].4", "PID-11[0].5"]);
    expect(manifest.filter((m) => m.disposition === "retained")).toHaveLength(3);
  });

  it("the three named parts still survive alongside them (the case is not vacuously clean)", () => {
    expect(get("PID.11.3")).toBe("Springfield");
    expect(get("PID.11.4")).toBe("IL");
    expect(get("PID.11.5")).toBe("62704");
  });
});

describe("a restricted-prefix ZIP is kept IN FULL: the three-digit rule is Safe Harbor's", () => {
  const restricted = "742 Evergreen Ter^^Springfield^IL^03601";

  it("PRE-CONDITION: 036 really is on the cited restricted-prefix list", () => {
    // Without this the case below would pass against an unrestricted prefix and prove nothing.
    expect(RESTRICTED_ZIP3.has("036")).toBe(true);
  });

  it("under the limited data set the whole ZIP survives and NOTHING is substituted", () => {
    const { text, get } = underLimitedDataSet(wire(restricted));
    expect(get("PID.11.5")).toBe("03601");
    expect(text).toContain("03601");
    expect(text).not.toContain("000");
  });

  it("under Safe Harbor the very same ZIP still becomes 000: that rule is untouched", () => {
    // The contrast is the point. §164.514(b)(2)(i)(B) has a population condition and (e)(2) has none,
    // so the two profiles must disagree here, and Safe Harbor must be exactly where it was.
    const { document } = deidentifyHl7(
      parseHL7(wire(restricted)),
      profileOptions(SAFE_HARBOR_PROFILE, ctx),
    );
    expect(document.get("PID.11.5")).toBe("000");
    expect(document.toString()).not.toContain("03601");
  });
});

describe("nothing widens by omission: an absent class reduces addresses exactly as at the pin", () => {
  const raw = wire(PATIENT_ADDRESS);

  /** The pinned Safe Harbor address reduction: the 3-digit prefix at XAD.5 and nothing else. */
  function expectPinnedReduction(text: string, get: (p: string) => string | undefined): void {
    expect(get("PID.11.5")).toBe("627");
    expect(text).not.toContain("62704");
    expect(text).not.toContain("Springfield");
    expect(text).not.toContain("742 Evergreen Ter");
    expect(get("PID.11.3") ?? "").toBe("");
    expect(get("PID.11.4") ?? "").toBe("");
  }

  it("a BARE options bag keeps nothing (the fail-closed default)", () => {
    const { document } = deidentifyHl7(parseHL7(raw), { context: ctx });
    expectPinnedReduction(document.toString(), (p) => document.get(p));
  });

  it("the limited-data-set POLICY without the profile's retention set keeps nothing either", () => {
    // The hand-built route no profile check can see: reading `profile.policy` alone loses the set.
    const { document } = deidentifyHl7(parseHL7(raw), {
      policy: LIMITED_DATA_SET_PROFILE.policy,
      context: ctx,
    });
    expectPinnedReduction(document.toString(), (p) => document.get(p));
  });

  it("a retention set naming the OTHER two classes does not reach geography", () => {
    const { document } = deidentifyHl7(parseHL7(raw), {
      policy: LIMITED_DATA_SET_PROFILE.policy,
      retainedLoci: [R.ENCOUNTER_DATES, R.ENCOUNTER_IDENTIFIERS],
      context: ctx,
    });
    expectPinnedReduction(document.toString(), (p) => document.get(p));
  });

  it("Safe Harbor is unchanged, and a profile that DROPS the class is back at Safe Harbor geography", () => {
    const { document: sh } = deidentifyHl7(parseHL7(raw), profileOptions(SAFE_HARBOR_PROFILE, ctx));
    expectPinnedReduction(sh.toString(), (p) => sh.get(p));

    const dropped = defineDeidProfile({
      name: "site-no-geography",
      base: LIMITED_DATA_SET_PROFILE,
      retainedLoci: [R.ENCOUNTER_DATES, R.ENCOUNTER_IDENTIFIERS],
    });
    const { document } = deidentifyHl7(parseHL7(raw), profileOptions(dropped, ctx));
    expectPinnedReduction(document.toString(), (p) => document.get(p));
  });

  it("the whole committed fixture reduces byte-for-byte the same with and without the class named", () => {
    // The strongest form of "widens nothing": two passes over a real message, one with an empty
    // retention set and one naming the two NON-geographic classes, produce the identical wire.
    const bare = deidentifyHl7(parseHL7(loadFixture("adt-a01")), {
      policy: LIMITED_DATA_SET_PROFILE.policy,
      context: ctx,
    }).document.toString();
    const others = deidentifyHl7(parseHL7(loadFixture("adt-a01")), {
      policy: LIMITED_DATA_SET_PROFILE.policy,
      retainedLoci: [R.ENCOUNTER_DATES, R.ENCOUNTER_IDENTIFIERS],
      context: ctx,
    }).document.toString();
    expect(others).toBe(bare);
    expect(bare).not.toContain("ZZCITY");
    expect(bare).not.toContain("90210");
  });
});

describe("fail closed: an address the pass cannot vouch for is dropped WHOLE, and never half-kept", () => {
  const cases: readonly { readonly name: string; readonly address: string }[] = [
    { name: "no ZIP component at all", address: "742 Evergreen Ter^^Springfield^IL" },
    { name: "an empty ZIP component", address: "742 Evergreen Ter^^Springfield^IL^" },
    { name: "a ZIP the parser cannot resolve to digits", address: "^^Springfield^IL^ZZNOTAZIP" },
    { name: "components that stop before the ZIP", address: "742 Evergreen Ter" },
  ];

  for (const { name, address } of cases) {
    it(`${name}: the whole repetition is dropped and no residual is recorded as retained`, () => {
      const { text, manifest, get } = underLimitedDataSet(wire(address));
      expect(text).not.toContain("Springfield");
      expect(text).not.toContain("742 Evergreen Ter");
      expect(get("PID.11.3") ?? "").toBe("");
      const rows = rowsAt(manifest, "PID-11");
      expect(rows.map((m) => m.disposition)).toEqual(["blocked"]);
      expect(rows[0]?.code).toBe(D.DEID_LOCUS_BLOCKED);
      expect(manifest.filter((m) => m.disposition === "retained")).toEqual([]);
    });
  }

  it("a ZIP that is not a WHOLE zip code falls back to the generalization, keeping no town", () => {
    // `627` and `62704-12` both have three leading digits, so the Safe Harbor generalization CAN read
    // them: they are not blocked. They are still not a zip code, so the class does not retain them and
    // the town does not ride along. A partially retained address is never emitted.
    for (const partial of ["627", "62704-12", "0062704"]) {
      const { text, manifest, get } = underLimitedDataSet(
        wire(`742 Evergreen Ter^^Springfield^IL^${partial}`),
      );
      expect(text, partial).not.toContain("Springfield");
      expect(get("PID.11.3") ?? "", partial).toBe("");
      expect(
        manifest.filter((m) => m.disposition === "retained"),
        partial,
      ).toEqual([]);
    }
  });

  it("an empty repetition beside a good one contributes nothing, and does not spoil its sibling", () => {
    const { text, manifest, get } = underLimitedDataSet(wire(`${PATIENT_ADDRESS}~`));
    expect(get("PID.11[0].3")).toBe("Springfield");
    expect(text).not.toContain("742 Evergreen Ter");
    // The populated repetition contributes three RETAINED rows, one per named part. The empty one
    // contributes a BLOCKED row at its own repetition ordinal: it carries no zip code, so the class
    // does not reach it, it falls back to the generalization and fails closed there. Recorded as a
    // block and never as a residual, which is the whole distinction AC9 turns on.
    const rows = rowsAt(manifest, "PID-11");
    expect(rows.map((m) => `${m.locus} ${m.disposition}`).sort()).toEqual([
      "PID-11[0].3 retained",
      "PID-11[0].4 retained",
      "PID-11[0].5 retained",
      "PID-11[1] blocked",
    ]);
  });

  it("the applier DROPS a reduced address whose every part came back blocked", () => {
    // The backstop `deidentifyHl7` cannot reach, because it hands the extractor and the engine the
    // same retention set and they agree. `extractHl7Loci` and `applyHl7` are both public, so a
    // consumer can pair a retaining extraction with a refusing engine, and what the applier must not
    // then emit is five empty components where an address used to be. It drops the repetition.
    const msg = parseHL7(wire(PATIENT_ADDRESS));
    const { coords } = extractHl7Loci(msg, { retainedLoci: [R.LIMITED_DATA_SET_GEOGRAPHY] });
    expect(coords.some((c) => c.edit === "address-part")).toBe(true); // non-vacuity
    const allBlocked = coords.map(() => ({
      path: "PID-11",
      kind: "identifier" as const,
      value: null,
      disposition: "blocked" as const,
    }));
    const out = applyHl7(msg, allBlocked, coords).toString();
    expect(out).not.toContain("Springfield");
    expect(out).not.toContain("62704");
    expect(out).not.toContain("^^^^"); // no component residue left standing in for the address
  });
});
