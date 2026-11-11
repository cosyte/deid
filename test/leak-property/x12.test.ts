/**
 * The generated leak property for the **X12** leak property (the rule is in `./sweep.ts`).
 *
 * Interchanges come from the parser's own arbitraries (`@cosyte/x12/arbitraries`): generated
 * delimiters, sender and receiver ids, groups and transaction sets of the guides the library declares,
 * and generated body segments. Into the first transaction set the property adds segments carrying
 * tagged sentinels, in generated shapes: a plain element, a value where a composite is expected, an
 * extra repetition, an extra component, and a value in a qualifier or code position (an entity
 * identifier, an id qualifier, a reference qualifier, a date qualifier, a contact function).
 *
 * The builder releases every delimiter in a value, so a composite or a repetition is written with a
 * placeholder and the placeholder is swapped for the interchange's own delimiter in the text. The
 * builder counts the segments, so every control number and count still agrees.
 *
 * The X12 adapter decides every element it hands through, so its residual inventory is a measured
 * zero: any sentinel that survives is a violation, whatever the inventory says.
 */

import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { buildInterchange, serializeX12, type InterchangeSpec } from "@cosyte/x12";
import { interchangeSpec } from "@cosyte/x12/arbitraries";

import { createDeidContext, DeidError, FATAL_CODES } from "../../src/index.js";
import { classifyRefQualifier, deidentifyX12String } from "../../src/x12/index.js";
import {
  runLeakProperty,
  sentinelAt,
  sentinelStem,
  stemAvoiding,
  sweep,
  tamper,
  type LeakShape,
  type LeakTally,
  type PassOutcome,
  type Pin,
  type Placement,
} from "./sweep.js";

const FATAL = new Set<string>(Object.values(FATAL_CODES));
const ctx = createDeidContext({ key: "leak-property-x12-synthetic-key", patientId: "p-leak" });

/** Placeholders the builder writes as letters; swapped for the real delimiters afterwards. */
const REP = "QQREPQQ";
const COMP = "QQCOMPQQ";

/** Segment ids a sentinel is written into: party, demographic, claim, service, date and unknown. */
const SEGMENTS = [
  "NM1",
  "N1",
  "N2",
  "N3",
  "N4",
  "REF",
  "DMG",
  "PER",
  "DTP",
  "DTM",
  "CLM",
  "HI",
  "SV1",
  "SV2",
  "NTE",
  "PAT",
  "INS",
  "SBR",
  "AMT",
  "TRN",
  "ENT",
  "HL",
  "EB",
  "MSG",
  "K3",
  "ZZZ",
] as const;

/** Qualifier and code positions: segment, element, and the other elements the segment carries. */
const CODE_POSITIONS: readonly (readonly [string, number])[] = [
  ["NM1", 1],
  ["NM1", 2],
  ["NM1", 8],
  ["N1", 1],
  ["N1", 3],
  ["REF", 1],
  ["DTP", 1],
  ["DTP", 2],
  ["DTM", 1],
  ["PER", 1],
  ["PER", 3],
  ["DMG", 1],
  ["DMG", 3],
  ["SBR", 2],
  ["PAT", 1],
  ["INS", 2],
  ["AMT", 1],
  ["HI", 1],
  ["CLM", 5],
];

const SHAPES: readonly LeakShape[] = [
  "plain",
  "plain-for-composite",
  "extra-repeat",
  "extra-component",
  "qualifier-or-code",
];

interface X12Placement {
  readonly segment: string;
  readonly element: number;
  readonly component: number;
  readonly shape: LeakShape;
  readonly code: readonly [string, number];
  /** Generated values for the segment's other elements. */
  readonly filler: readonly string[];
  /** Whether a plain placement in a segment {@link WELL_FORMED} names is written into its template. */
  readonly wellFormed: boolean;
  /** The `REF-01` of a well-formed `REF`: a party number, an administrative number, or neither. */
  readonly qualifier: string;
}

/**
 * Well-formed segments a plain sentinel is written into: the elements before and around it are the
 * ones a TR3 writes (a trace type code, a reference qualifier, a provider's or a payee's entity code),
 * so the rules that read them are reached rather than the shift rule removing everything after a
 * filler that is no code. Each lists its template and the elements a sentinel may take in it. A run of
 * these builds the sequences a party-number rule reads: a provider or a payee, then an `HL` or an
 * `ENT`, then a `REF` naming a party's own number.
 */
const WELL_FORMED: Readonly<
  Record<string, { readonly template: (q: string) => string[]; readonly at: readonly number[] }>
> = {
  TRN: { template: () => ["1", "ZZTRACE", "9ZZORIGIN", "ZZDIV"], at: [2, 3, 4] },
  REF: { template: (q) => [q, "ZZREF"], at: [2] },
  NM1: { template: () => ["1P", "2", "ZZORG", "", "", "", "", "XX", "1999999999"], at: [3, 9] },
  N1: { template: () => ["PE", "ZZPAYEE", "FI", "999999999"], at: [2, 4] },
  ENT: { template: () => ["1", "2J", "FI", "ZZENTITY"], at: [4] },
  // A sentinel in an `HL` takes its child code, which it is not, so it is removed: the segment is
  // there to start a section.
  HL: { template: () => ["2", "1", "22", "0"], at: [4] },
};

/** Filler values: letters and digits, so they never collide with a placeholder or a delimiter. */
const filler = fc.array(fc.stringMatching(/^[A-Z0-9]{1,6}$/), { minLength: 0, maxLength: 9 });

const placementArb: fc.Arbitrary<X12Placement> = fc.record({
  segment: fc.constantFrom(...SEGMENTS),
  element: fc.integer({ min: 1, max: 9 }),
  component: fc.integer({ min: 1, max: 5 }),
  shape: fc.constantFrom(...SHAPES),
  code: fc.constantFrom(...CODE_POSITIONS),
  filler,
  wellFormed: fc.boolean(),
  qualifier: fc.constantFrom("0B", "HPI", "EI", "G1", "1S", "F8", "ZZ"),
});

/** One generated case: an interchange spec from the sibling's arbitraries and the placements. */
/**
 * A party run: a party, then what may start a new section, then a `REF` holding a sentinel under a
 * party-number or an administrative qualifier. It is the sequence the party-number rule reads, so a
 * run builds directly the cases the rule must get right: a provider that names itself or one that
 * names nothing, a payee, the individual or no party, and an `HL` or an 820 `ENT` between it and the
 * number.
 */
interface PartyRun {
  readonly party: string;
  readonly section: string;
  readonly qualifier: string;
}

const partyRunArb: fc.Arbitrary<PartyRun> = fc.record({
  party: fc.constantFrom(
    "NM1*1P*2*ZZORG*****XX*1999999999",
    "NM1*1P*2",
    "N1*PE*ZZPAYEE*FI*999999999",
    "NM1*IL*1*ZZFAMILY",
    "",
  ),
  section: fc.constantFrom("HL*2*1*22*0", "ENT*1*2J*FI*ZZENTITY", ""),
  qualifier: fc.constantFrom("0B", "HPI", "EI", "PQ", "G1", "1S", "ZZ"),
});

export const caseArb = fc.record({
  spec: interchangeSpec({ maxGroups: 1, maxTransactions: 1, maxSegments: 4, maxElements: 6 }),
  stem: sentinelStem,
  placements: fc.array(placementArb, { minLength: 1, maxLength: 5 }),
  run: fc.option(partyRunArb, { nil: undefined }),
});

/** The element value for one placement's sentinel, written with placeholders. */
function sentinelValue(p: X12Placement, sentinel: string): string {
  switch (p.shape) {
    case "extra-repeat":
      return `A1${REP}${sentinel}`;
    case "extra-component":
      return `${"A1".concat(COMP).repeat(p.component - 1)}${sentinel}`;
    case "plain-for-composite":
    case "plain":
    case "qualifier-or-code":
    case "nested":
    case "subcomponent":
      return sentinel;
  }
}

/** Build the interchange text with each placement added to the first transaction set. */
export function build(
  spec: InterchangeSpec,
  stem: string,
  specs: readonly X12Placement[],
  run?: PartyRun,
): { raw: string; placed: Placement[] } {
  const placed: Placement[] = [];
  const added: string[][] = [];
  // The generated delimiters: a value must not hold one, or the builder releases it.
  const safeStem = stemAvoiding(
    stem,
    [
      spec.elementSeparator,
      spec.repetitionSeparator,
      spec.componentSeparator,
      spec.segmentTerminator,
    ].join(""),
  );
  specs.forEach((p, i) => {
    const sentinel = sentinelAt(safeStem, i);
    const [segment, element] =
      p.shape === "qualifier-or-code"
        ? p.code
        : p.shape === "plain-for-composite"
          ? (["CLM", 5] as const)
          : ([p.segment, p.element] as const);
    const shape = p.shape === "plain" && p.wellFormed ? WELL_FORMED[segment] : undefined;
    if (shape !== undefined) {
      // A well-formed segment: the sentinel takes one of the template's own elements.
      const elements = [segment, ...shape.template(p.qualifier)];
      const at = shape.at[p.element % shape.at.length] ?? 1;
      elements[at] = sentinel;
      added.push(elements);
      placed.push({ sentinel, shape: p.shape, where: `${segment}-${String(at)} well-formed` });
      return;
    }
    const elements = [segment, ...p.filler];
    while (elements.length <= element) elements.push("A1");
    elements[element] = sentinelValue(p, sentinel);
    added.push(elements);
    placed.push({ sentinel, shape: p.shape, where: `${segment}-${String(element)}` });
  });
  if (run !== undefined) {
    const sentinel = sentinelAt(safeStem, specs.length);
    for (const segment of [run.party, run.section]) {
      if (segment.length > 0) added.push(segment.split("*"));
    }
    added.push(["REF", run.qualifier, sentinel]);
    placed.push({ sentinel, shape: "plain", where: `REF-2 after ${run.party} ${run.section}` });
  }
  const [group] = spec.groups;
  const [tx] = group?.transactions ?? [];
  if (group === undefined || tx === undefined) throw new Error("no transaction set");
  const withAdded: InterchangeSpec = {
    ...spec,
    groups: [{ ...group, transactions: [{ ...tx, segments: [...tx.segments, ...added] }] }],
  };
  const ix = buildInterchange(withAdded);
  const text = serializeX12(ix);
  const d = ix.delimiters;
  return { raw: text.split(REP).join(d.repetition).split(COMP).join(d.component), placed };
}

/** Where a sentinel sits in the input, read from the text: its transaction set, segment and element. */
interface X12Site {
  /** `ST-01` of the transaction set holding it. */
  readonly st: string;
  /** The transaction set's position in the interchange, counted from 0. */
  readonly tx: number;
  readonly segId: string;
  /** The segment's occurrence among segments of its id, counted per transaction set from its `ST`. */
  readonly occ: number;
  /** The 1-based element. */
  readonly element: number;
  /** The 1-based component of that element. */
  readonly component: number;
  /** The whole element as written. */
  readonly elementValue: string;
  /** The first component of that element. */
  readonly firstComponent: string;
}

/** One body segment as the input writes it, with its place inside its transaction set. */
interface X12Line {
  readonly st: string;
  readonly tx: number;
  readonly id: string;
  readonly occ: number;
  readonly parts: readonly string[];
}

/**
 * The segments of the input, each with the `ST-01` and position of its transaction set and its
 * occurrence counted the way the adapter counts it: per transaction set, from its `ST`. ISA is fixed
 * width, so the separators are read from it: the element separator is its fourth byte, the component
 * separator its 105th and the terminator its 106th.
 */
function linesOf(raw: string): { lines: X12Line[]; component: string } {
  const element = raw.charAt(3);
  const component = raw.charAt(104);
  const terminator = raw.charAt(105);
  const lines: X12Line[] = [];
  let st = "";
  let tx = -1;
  let counts = new Map<string, number>();
  for (const seg of raw.split(terminator)) {
    const parts = seg.split(element);
    const id = parts[0]?.trim() ?? "";
    if (id === "ST") {
      st = parts[1] ?? "";
      tx += 1;
      counts = new Map();
    }
    const occ = counts.get(id) ?? 0;
    counts.set(id, occ + 1);
    lines.push({ st, tx, id, occ, parts });
  }
  return { lines, component };
}

/** Every place in the input that holds the sentinel. */
function sitesOf(raw: string, sentinel: string): X12Site[] {
  const { lines, component } = linesOf(raw);
  const sites: X12Site[] = [];
  for (const line of lines) {
    line.parts.forEach((value, e) => {
      if (e === 0) return;
      const components = value.split(component);
      components.forEach((c, ci) => {
        if (!c.includes(sentinel)) return;
        sites.push({
          st: line.st,
          tx: line.tx,
          segId: line.id,
          occ: line.occ,
          element: e,
          component: ci + 1,
          elementValue: value,
          firstComponent: components[0] ?? "",
        });
      });
    });
  }
  return sites;
}

/** The one place the sentinel sits, or `undefined` when it sits in none or in more than one. */
function siteOf(raw: string, sentinel: string): X12Site | undefined {
  const sites = sitesOf(raw, sentinel);
  return sites.length === 1 ? sites[0] : undefined;
}

/**
 * Whether the `NM1` / `N1` at `seg[occ]` of transaction set `tx` is a party the manifest records as
 * kept by its role. A manifest locus names the `ST-01` and not which transaction set, so two sets of
 * the same kind share loci: a party counts as kept only when every set of that kind with a party at
 * that locus has a kept-party row there, which never credits one set with another's party. Where the
 * sets disagree no party there counts as kept, which is stricter than the adapter; the generator writes
 * one transaction set, so a generated case never meets it.
 */
function partyKeptAt(
  lines: readonly X12Line[],
  keptRows: ReadonlyMap<string, number>,
  st: string,
  segId: string,
  occ: number,
): boolean {
  const locus = `${st}/${segId}[${String(occ)}]`;
  const rows = keptRows.get(locus) ?? 0;
  const parties = lines.filter((l) => l.st === st && l.id === segId && l.occ === occ).length;
  return rows > 0 && rows === parties;
}

/** Run the adapter on the text and read back the outcome. */
export function pass(raw: string): X12Outcome {
  try {
    const result = deidentifyX12String(raw, { context: ctx });
    const { lines } = linesOf(raw);
    const keptRows = new Map<string, number>();
    for (const m of result.manifest) {
      if (m.code !== "DEID_PARTY_ROLE_RETAINED") continue;
      const locus = m.locus.replace(/-\d+$/, "");
      keptRows.set(locus, (keptRows.get(locus) ?? 0) + 1);
    }
    const rowLoci = new Set(result.manifest.map((m) => m.locus));
    return {
      // A party its role kept, or a `REF` kept on purpose (see `adminReferenceKept`).
      decidedKeep: (s) => {
        const site = siteOf(raw, s);
        if (site === undefined) return false;
        if (site.segId === "NM1" || site.segId === "N1") {
          return partyKeptAt(lines, keptRows, site.st, site.segId, site.occ);
        }
        if (site.segId !== "REF" || site.element !== 2) return false;
        return adminReferenceKept(lines, site, keptRows, rowLoci);
      },
      // Where the sentinel sits in the input, for the pins that rest on a shape.
      siteOf: (s) => siteOf(raw, s),
      output: result.x12,
      manifest: result.manifest,
      unexaminedResiduals: result.unexaminedResiduals,
      // The adapter decides every position: no residual may stand for a surviving sentinel.
      residualAt: () => false,
      refused: false,
    };
  } catch (err) {
    if (err instanceof DeidError && FATAL.has(err.code)) {
      return {
        output: "",
        manifest: [],
        unexaminedResiduals: [],
        residualAt: () => false,
        refused: true,
      };
    }
    throw err;
  }
}

/** The outcome of one X12 pass: the shared outcome and where each sentinel sits in the input. */
type X12Outcome = PassOutcome & { readonly siteOf?: (sentinel: string) => X12Site | undefined };

/** Where the sentinel sits in the input, when the outcome can say. */
function site(outcome: PassOutcome, sentinel: string): X12Site | undefined {
  return (outcome as X12Outcome).siteOf?.(sentinel);
}

/** The `C003` qualifiers that give a procedure code a published shape the adapter checks it against. */
const SHAPED_PROCEDURE_QUALIFIERS: ReadonlySet<string> = new Set(["HC", "AD", "N4", "NU", "HP"]);

/**
 * The X12 keeps this suite pins rather than closes (named on the limitations page, pinned in
 * `./found.test.ts`). Each pin reads where the sentinel sits in the INPUT and the shape it has there,
 * never where the generator meant to put it:
 *
 * - the originating company id (`TRN-03`, up to 10 characters) and its supplemental code (`TRN-04`, up
 *   to 50), when the element is the sentinel alone; the trace number `TRN-02` is replaced, never pinned;
 * - a procedure code, the second component of `SV1-01`, `SV2-02` or `SV3-01`, under a qualifier with
 *   no published code shape, when it is 1 to 48 capitals and digits;
 * - a name or identifier element of a party its role keeps (a provider), where the manifest records
 *   that the party was kept by its role;
 * - a `REF-02` under an administrative qualifier the adapter keeps (a claim, authorization or
 *   classification number), read from the input as `adminReferenceKept` says.
 */
export const X12_PINS: readonly Pin[] = [
  {
    applies: (p, outcome) => {
      const at = site(outcome, p.sentinel);
      if (at?.segId !== "TRN" || at.elementValue !== p.sentinel) return false;
      return (at.element === 3 && p.sentinel.length <= 10) || at.element === 4;
    },
  },
  {
    applies: (p, outcome) => {
      const at = site(outcome, p.sentinel);
      if (at === undefined || at.component !== 2) return false;
      const procedure =
        (at.segId === "SV1" && at.element === 1) ||
        (at.segId === "SV2" && at.element === 2) ||
        (at.segId === "SV3" && at.element === 1);
      return (
        procedure &&
        !SHAPED_PROCEDURE_QUALIFIERS.has(at.firstComponent) &&
        /^[A-Z0-9]{1,48}$/.test(p.sentinel)
      );
    },
  },
  {
    // Only a name or identifier element, and only where the manifest records that the party's role
    // kept it: a person's party is never pinned.
    applies: (p, outcome) => {
      const at = site(outcome, p.sentinel);
      if (at === undefined) return false;
      const identity =
        (at.segId === "NM1" && [3, 4, 5, 6, 7, 9].includes(at.element)) ||
        (at.segId === "N1" && [2, 4].includes(at.element));
      return identity && outcome.decidedKeep?.(p.sentinel) === true;
    },
  },
  {
    // Only where the REF-01 the input carries is a retained administrative qualifier and no rule
    // recorded REF-02: never a REF position alone.
    applies: (p, outcome) => outcome.decidedKeep?.(p.sentinel) === true && isRef2(outcome, p),
  },
];

/** Whether the sentinel sits at `REF-02` in the input. */
function isRef2(outcome: PassOutcome, p: Placement): boolean {
  const at = site(outcome, p.sentinel);
  return at?.segId === "REF" && at.element === 2;
}

/**
 * The `REF-01` qualifiers that name a party's own number, written out here on purpose rather than
 * imported, so a qualifier dropped from the adapter's list is not dropped from the pin with it.
 */
const PARTY_NUMBER_QUALIFIERS: ReadonlySet<string> = new Set([
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
]);

/**
 * Whether the `REF` holding the sentinel is one the adapter keeps on purpose, read from the INPUT and
 * the manifest, never from the position alone:
 *
 * - its `REF-01` is a qualifier the adapter retains, and no rule recorded its `REF-02`; and
 * - when that qualifier names a party's own number, the last `NM1` / `N1` before it in its section is
 *   a party whose role the manifest records as kept. A section starts at the transaction set, at every
 *   `HL`, at every `ENT` (an 820 entity) and at every `INS` of an 834, so a party in an earlier section
 *   never vouches for it.
 *
 * The walk reads only the transaction set holding the `REF`. So a party number after the individual,
 * an unknown party or no party is never pinned: if the adapter keeps one, the property fails.
 */
function adminReferenceKept(
  lines: readonly X12Line[],
  at: X12Site,
  keptRows: ReadonlyMap<string, number>,
  rowLoci: ReadonlySet<string>,
): boolean {
  let lastPartyKept = false;
  for (const line of lines) {
    if (line.tx !== at.tx) continue;
    const id = line.id;
    if (id === "ST" || id === "HL" || id === "ENT" || (id === "INS" && line.st === "834")) {
      lastPartyKept = false;
    }
    if (id === "NM1" || id === "N1") {
      lastPartyKept = partyKeptAt(lines, keptRows, line.st, id, line.occ);
    }
    if (id !== "REF" || line.occ !== at.occ) continue;
    const qualifier = (line.parts[1] ?? "").toUpperCase();
    if (classifyRefQualifier(qualifier).kind !== "retain") return false;
    if (rowLoci.has(`${at.st}/REF[${String(at.occ)}]-2`)) return false;
    return !PARTY_NUMBER_QUALIFIERS.has(qualifier) || lastPartyKept;
  }
  return false;
}

/** One case through the property: build, check the sentinels are in the input, run, sweep. */
export function checkCase(
  value: {
    spec: InterchangeSpec;
    stem: string;
    placements: readonly X12Placement[];
    run?: PartyRun | undefined;
  },
  tally: LeakTally,
): string[] {
  const { raw, placed } = build(value.spec, value.stem, value.placements, value.run);
  // Non-vacuity: only a sentinel the input holds is swept, and a case must hold one. A later
  // placement can overwrite an earlier one at the same position.
  const present = placed.filter((p) => raw.includes(p.sentinel));
  if (present.length === 0) return ["no sentinel reached the input"];
  return sweep(present, pass(raw), tally, X12_PINS);
}

describe("the generated leak property: X12", () => {
  it("every sentinel is removed, or named as an unexamined residual at its locus", () => {
    runLeakProperty("x12", caseArb, checkCase);
  });

  it("the sweep has teeth: a sentinel put back into a real output, or the manifest, is caught", () => {
    // One fixed case for the tamper proof, not a property, so the shared depth does not apply.
    const [sample] = fc.sample(caseArb, { seed: 7, numRuns: 1 });
    if (sample === undefined) throw new Error("no sample");
    const { raw, placed } = build(sample.spec, sample.stem, sample.placements, sample.run);
    const caught = tamper(placed, pass(raw));
    expect(caught.inOutput).toContain("survives in the output");
    expect(caught.inManifest).toContain("is in the manifest");
  });
});

/**
 * The keeps the adapter closes, put through the same sweep and the same pins as a generated case. Each
 * is a leak the pins must NOT accept: with its fix taken out of the adapter, the sweep reports it.
 */
describe("the X12 pins never accept a leak a fix closes", () => {
  const envelope = (gs: string, st: string, guide: string): string =>
    "ISA*00*          *00*          *ZZ*A              *ZZ*A              *000101*0000*^*00501*000000001*0*P*:~" +
    `GS*${gs}*A*A*20000101*0000*1*X*${guide}~ST*${st}*0001*${guide}~`;
  function violations(head: string, body: string, sentinel: string): string[] {
    const count = body.split("~").length + 1;
    const raw = `${head}${body}SE*${String(count)}*0001~GE*1*1~IEA*1*000000001~`;
    const placed: Placement[] = [{ sentinel, shape: "plain", where: "fixed case" }];
    return sweep(placed, pass(raw), undefined, X12_PINS);
  }
  const inquiry = envelope("HS", "270", "005010X279A1");

  it.each(["ZQLKTRAC00X", "ZQVABA", "Zqvaba"])("a trace number (TRN-02): %s", (trace) => {
    expect(violations(inquiry, `TRN*1*${trace}*9ZZORIGIN~`, trace)).toEqual([]);
  });

  it("a party number after an 820 ENT, with the payee before it", () => {
    const premium = envelope("RA", "820", "005010X218");
    expect(violations(premium, "N1*PE*ZZPAYEE~ENT*1~REF*0B*ZQVREFA~", "ZQVREFA")).toEqual([]);
  });

  it("a party number after a provider NM1 that names nothing", () => {
    expect(violations(inquiry, "NM1*1P*2~REF*0B*ZQVREFB~", "ZQVREFB")).toEqual([]);
  });

  it("the pin reads each transaction set on its own: another set's provider never vouches", () => {
    // Two 270s. The first has the individual at NM1[0] and then a party number; the second has a
    // provider at NM1[0], which the manifest records as `270/NM1[0]-1`. Counted across the whole
    // interchange, that row would vouch for the first set's NM1[0] and pin the number after it.
    const head = envelope("HS", "270", "005010X279A1");
    const raw =
      `${head}NM1*IL*1*ZZFAMILY~REF*0B*ZQVREFC~SE*4*0001~ST*270*0002*005010X279A1~` +
      "NM1*1P*2*ZZORG~SE*3*0002~GE*2*1~IEA*1*000000001~";
    const outcome = pass(raw);
    expect(outcome.decidedKeep?.("ZQVREFC")).toBe(false);
    const placed: Placement[] = [{ sentinel: "ZQVREFC", shape: "plain", where: "fixed case" }];
    expect(sweep(placed, outcome, undefined, X12_PINS)).toEqual([]);
  });
});
