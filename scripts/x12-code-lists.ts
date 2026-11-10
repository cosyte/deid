/**
 * Regenerates the X12 005010 code lists the X12 adapter checks its code positions against
 * (`src/x12/code-lists.ts`), and the segment definitions a test checks the shape table against
 * (`test/fixtures/x12/segments-005010.json`).
 *
 * Both are read from the published 005010 data dictionary at
 * `https://www.stedi.com/edi/x12-005010/element/<element>` and `.../segment/<segment>`, the same
 * reference `@cosyte/x12` reads its functional identifier codes from. Only the code values are kept,
 * never a description. Nothing reads the network at build, test or run time: this script is run by
 * hand when the lists are refreshed, and its output is reviewed and committed.
 *
 *     pnpm exec tsx scripts/x12-code-lists.ts
 */

import { writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const BASE = "https://www.stedi.com/edi/x12-005010";

/**
 * The data elements whose code lists the adapter reads: every code position the shape table keeps,
 * and the code positions the locus rules route on (98, 66, 128).
 */
const ELEMENTS: readonly string[] = [
  ...[
    "26",
    "98",
    "66",
    "128",
    "143",
    "235",
    "305",
    "306",
    "353",
    "355",
    "363",
    "365",
    "366",
    "374",
  ],
  ...[
    "455",
    "478",
    "479",
    "480",
    "481",
    "506",
    "522",
    "569",
    "584",
    "591",
    "594",
    "615",
    "618",
    "620",
  ],
  ...["621", "623", "640", "673", "678", "679", "715", "716", "717", "735", "736", "737", "738"],
  ...["755", "756", "786", "812", "875", "889", "901", "923", "1005", "1029", "1032", "1033"],
  ...["1065", "1066", "1067", "1068", "1069", "1073", "1109", "1136", "1138", "1146", "1165"],
  ...["1166", "1203", "1205", "1207", "1216", "1218", "1219", "1220", "1221", "1250", "1270"],
  ...["1317", "1321", "1322", "1327", "1332", "1336", "1338", "1342", "1351", "1358", "1359"],
  ...["1360", "1362", "1363", "1365", "1366", "1367", "1368", "1369", "1383", "1390", "1473"],
  ...["1514", "1525", "1526", "1527", "I01", "I03", "I05", "I11", "I13", "I14", "I17", "I18"],
];

/** The segments whose definitions the shape-table test reads. */
const SEGMENTS: readonly string[] = [
  ...["ISA", "TA1", "GS", "GE", "IEA", "ST", "SE", "BHT", "BGN", "BPR", "TRN", "HL", "NM1", "N1"],
  ...[
    "N3",
    "N4",
    "DMG",
    "PER",
    "DTP",
    "DTM",
    "SBR",
    "CLM",
    "CLP",
    "MSG",
    "III",
    "K3",
    "NTE",
    "AMT",
  ],
  ...[
    "PAT",
    "CAS",
    "MOA",
    "MIA",
    "QTY",
    "LQ",
    "LX",
    "HI",
    "SV1",
    "SV2",
    "SV3",
    "SV5",
    "SVC",
    "SVD",
  ],
  ...["TOO", "CR1", "CR2", "CR3", "CRC", "HCP", "CN1", "PS1", "MEA", "PWK", "LIN", "CTP", "HSD"],
  ...["UR", "EB", "EQ", "AAA", "INS", "HD", "DSB", "REL", "CL1", "STC", "UM", "HCR", "LS", "LE"],
  ...["AK1", "AK2", "IK3", "IK4", "IK5", "AK9", "CTX", "REF", "PRV", "OI", "DN1", "DN2"],
];

interface PageElement {
  readonly data_element_number?: string | null;
  readonly data_element_type?: string | null;
  readonly codeCount?: number;
  readonly elements?: readonly PageElement[];
}

/** Read the page's embedded data (`__NEXT_DATA__`) and return its `pageProps`. */
async function pageProps(url: string): Promise<Record<string, unknown>> {
  const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`${url}: HTTP ${String(response.status)}`);
  const html = await response.text();
  const match = /<script id="__NEXT_DATA__" type="application\/json">(.*?)<\/script>/s.exec(html);
  if (match?.[1] === undefined) throw new Error(`${url}: no page data`);
  const data = JSON.parse(match[1]) as { props: { pageProps: Record<string, unknown> } };
  return data.props.pageProps;
}

/** One element's code values, in the dictionary's order. */
async function codes(element: string): Promise<string[]> {
  const props = await pageProps(`${BASE}/element/${element}`);
  const elt = props["elt"] as { codeCount: number; codes: { code_value: string }[] };
  const values = elt.codes.map((c) => c.code_value);
  if (values.length === 0 || values.length !== elt.codeCount) {
    throw new Error(
      `element ${element}: ${String(values.length)} of ${String(elt.codeCount)} codes`,
    );
  }
  return values;
}

/** One position of a segment definition: its element number, or the elements of its composite. */
type Position = string | string[];

/** The data elements the segments name that carry an X12 code list of their own. */
const coded = new Set<string>();

/** One element's number, noting it when the dictionary gives it a code list. */
function number(e: PageElement): string {
  const n = e.data_element_number ?? "";
  if ((e.codeCount ?? 0) > 0) coded.add(n);
  return n;
}

async function segment(id: string): Promise<Record<string, Position>> {
  const props = await pageProps(`${BASE}/segment/${id}`);
  const seg = props["seg"] as { elements: (PageElement & { sequence: string })[] };
  const out: Record<string, Position> = {};
  for (const e of seg.elements) {
    out[String(Number(e.sequence))] =
      e.elements === undefined || e.elements.length === 0 ? number(e) : e.elements.map(number);
  }
  return out;
}

/** Wrap a code list into lines of at most 90 characters. */
function wrap(values: readonly string[]): string[] {
  const lines: string[] = [];
  let line = "";
  for (const value of values) {
    if (line.length + value.length + 1 > 90) {
      lines.push(line);
      line = value;
    } else {
      line = line === "" ? value : `${line} ${value}`;
    }
  }
  lines.push(line);
  return lines;
}

const retrieved = new Date().toISOString().slice(0, 10);
const lists: string[] = [];
for (const element of ELEMENTS) {
  const values = await codes(element);
  const lines = wrap(values);
  // The formatter quotes a key only when it is not an identifier (`"98"`, but `I01`).
  const key = /^[A-Za-z_]\w*$/.test(element) ? element : `"${element}"`;
  // A list that fits on one line is written as one string, the way the formatter would leave it.
  const single = `  ${key}: ${JSON.stringify(lines[0])},`;
  if (lines.length === 1 && single.length <= 100) {
    lists.push(single);
    continue;
  }
  const body = lines.map((line) => `    ${JSON.stringify(line)},`).join("\n");
  lists.push(`  ${key}: [\n${body}\n  ].join(" "),`);
}

const header = `/**
 * The **X12 005010 code lists** the X12 adapter checks a code position against: the complete code list
 * of each data element a code position the pass keeps or routes on holds, as the 005010 data dictionary
 * publishes it (retrieved ${retrieved} from
 * \`${BASE}/element/<element>\`). Code values only, keyed by data element
 * number (\`I01\` and so on for the interchange header's own elements).
 *
 * Generated by \`scripts/x12-code-lists.ts\`; refresh by running it, never by hand.
 *
 * @packageDocumentation
 * @internal
 */

const LISTS = {
${lists.join("\n")}
} as const;

/** A data element this module holds the complete 005010 code list of. */
export type X12CodeListElement = keyof typeof LISTS;

/** The data element numbers this module holds a code list for. */
export const X12_CODE_LIST_ELEMENTS: readonly X12CodeListElement[] = Object.freeze(
  Object.keys(LISTS) as X12CodeListElement[],
);

const SETS = new Map<string, ReadonlySet<string>>(
  Object.entries(LISTS).map(([element, values]) => [element, new Set<string>(values.split(" "))]),
);

/**
 * The complete 005010 code list of one data element, exactly as the dictionary spells each code.
 *
 * @param element - The data element number, e.g. \`"128"\` for the reference identification qualifier.
 * @returns The element's code values.
 * @internal
 */
export function x12CodeList(element: X12CodeListElement): ReadonlySet<string> {
  return SETS.get(element) as ReadonlySet<string>;
}
`;
writeFileSync(join(ROOT, "src", "x12", "code-lists.ts"), header);

const segments: Record<string, Record<string, Position>> = {};
for (const id of SEGMENTS) segments[id] = await segment(id);
writeFileSync(
  join(ROOT, "test", "fixtures", "x12", "segments-005010.json"),
  `${JSON.stringify(
    { source: `${BASE}/segment/<segment>`, retrieved, coded: [...coded].sort(), segments },
    null,
    2,
  )}\n`,
);
console.log(
  `[x12-code-lists] ${String(ELEMENTS.length)} elements, ${String(SEGMENTS.length)} segments`,
);
