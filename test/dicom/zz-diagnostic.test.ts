// TEMPORARY: prints where the DICOM round trip fails under Deno. Removed before merge.
import { deidentify, parseDicom, serializeDicom } from "@cosyte/dicom";
import { it } from "vitest";

import { attachMethodCodeSequence } from "../../src/dicom/method-sequence.js";
import {
  resolveMethodDeclaration,
  BASIC_PROFILE_CODE_VALUE,
} from "../../src/dicom/method-codes.js";
import { buildDicom } from "./helpers/build-dicom.js";
import { pad, TS_EXPLICIT_LE } from "./helpers/fixtures.js";

const say = (s: string): void => {
  process.stdout.write(`[diag] ${s}\n`);
};

function step<T>(name: string, run: () => T): T | undefined {
  try {
    const out = run();
    say(`${name}: ok`);
    return out;
  } catch (err) {
    const e = err as Error;
    say(`${name}: ${e.name}: ${e.message} ${String(e.stack).split("\n").slice(0, 8).join(" | ")}`);
    return undefined;
  }
}

it("diagnostic", () => {
  const bytes = buildDicom({
    transferSyntax: TS_EXPLICIT_LE,
    elements: [{ tag: "00080060", vr: "CS", value: pad("CT") }],
  });
  const ds = step("parse", () => parseDicom(bytes));
  if (ds === undefined) return;
  step("serialize parsed", () => serializeDicom(ds).length);
  const out = step("deidentify", () => deidentify(ds, { retain: [] }));
  if (out === undefined) return;
  const ser = step("serialize deid", () => serializeDicom(out.dataset));
  if (ser !== undefined) step("reparse deid", () => parseDicom(ser).elements().length);
  const decl = resolveMethodDeclaration(BASIC_PROFILE_CODE_VALUE, []);
  const attached = step("attach", () => attachMethodCodeSequence(out.dataset, decl.appliedTerms));
  if (attached === undefined) return;
  const ser2 = step("serialize attached", () => serializeDicom(attached));
  if (ser2 === undefined) return;
  const back = step("reparse attached", () => parseDicom(ser2));
  if (back === undefined) return;
  const items = back.get("00120064")?.items ?? [];
  say(`items read back: ${String(items.length)} of ${String(decl.appliedTerms.length)}`);
  for (const item of items) {
    say(
      `item: ${item
        .elements()
        .map((e) => `${e.tag}=${JSON.stringify(e.rawBytes.toString("latin1"))}`)
        .join(" ")}`,
    );
  }
  say(`Buffer.isBuffer(ser2)=${String(Buffer.isBuffer(ser2))} ctor=${ser2.constructor.name}`);
});
