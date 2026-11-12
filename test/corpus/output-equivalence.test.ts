/**
 * The **output-equivalence fence** for performance work. A change that only means to make a pass
 * faster or smaller must leave everything a caller reads exactly where it was: the transformed
 * document, every manifest row and its order, the unexamined residuals, the warnings and every other
 * field of each result. This suite runs every adapter, and the policy engine, over a synthetic corpus
 * (the committed fixtures and the benchmark shapes, built in code) under four option sets, and
 * digests each result. The digests in `__snapshots__/output-equivalence.json` were captured from the
 * code as it stood before the performance work, so a run that reproduces them is a run whose output
 * a caller cannot tell apart from the earlier code's.
 *
 * A deliberate change moves a digest on purpose: it is named in the changeset with how a caller
 * adapts, and the snapshot is re-captured in the same change.
 *
 * Every value is synthetic: the fixtures are the repository's own synthetic sentinels, and the shapes
 * use ZZ-tagged names, 555 phone numbers and 900-range identifiers.
 */

import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import { parseCcda } from "@cosyte/ccda";
import { parseDicom, serializeDicom } from "@cosyte/dicom";
import { parseResource, serializeResource } from "@cosyte/fhir";
import { parseHL7, splitBatch } from "@cosyte/hl7";
import { parseX12 } from "@cosyte/x12";

import {
  createDeidContext,
  deidentify,
  defineDeidPolicy,
  LIMITED_DATA_SET_PROFILE,
  profileOptions,
  SAFE_HARBOR_CATEGORIES as C,
  SAFE_HARBOR_PROFILE,
  type DeidOptions,
} from "../../src/index.js";
import { deidentifyCcda } from "../../src/ccda/index.js";
import { deidentifyDicom, deidentifyDicomBuffer } from "../../src/dicom/index.js";
import { deidentifyFhir, deidentifyFhirJson } from "../../src/fhir/index.js";
import { deidentifyHl7 } from "../../src/hl7/index.js";
import { deidentifyTelecomString } from "../../src/ncpdp/index.js";
import { deidentifyX12, deidentifyX12String } from "../../src/x12/index.js";
import {
  ccdaDocument,
  ctImage,
  enhancedCt,
  fhirBundle,
  fhirPatient,
  hl7Batch,
  hl7Message,
  locusModel,
  ncpdpClaim,
  x12Claims,
} from "../../bench/shapes.mjs";
import { buildPhiDataset } from "../dicom/helpers/fixtures.js";

const FIX = (fmt: string, file: string): string =>
  readFileSync(join(import.meta.dirname, "..", "fixtures", fmt, file), "utf8");

const hl7Wire = (name: string): string =>
  FIX("hl7", `${name}.hl7`).trim().split(/\r?\n/).join("\r");

/** A key-ordered JSON of anything a result carries: a Buffer becomes its digest, a Map its entries. */
function stable(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) => {
    if (Buffer.isBuffer(v) || v instanceof Uint8Array) return `bytes:${digest(Buffer.from(v))}`;
    if (v instanceof Map) return { map: [...(v as Map<unknown, unknown>).entries()] };
    if (v instanceof Set) return { set: [...(v as Set<unknown>).values()] };
    if (typeof v === "bigint") return `bigint:${v.toString()}`;
    return v;
  });
}

/** sha256 of text or bytes, shortened: identity is the assertion, not readability of the content. */
function digest(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex").slice(0, 32);
}

/** The digest of every field of a result other than the document, which each case digests itself. */
function rest(result: object, omit: readonly string[]): string {
  const kept = Object.entries(result).filter(([key]) => !omit.includes(key));
  return digest(stable(Object.fromEntries(kept)));
}

const keyedContext = createDeidContext({
  key: "equivalence-synthetic-key-0123456789",
  patientId: "equivalence",
});

/** The option sets every case runs under. */
const OPTION_SETS: readonly (readonly [string, () => DeidOptions])[] = [
  ["default", () => ({})],
  ["safe-harbor profile", () => profileOptions(SAFE_HARBOR_PROFILE, keyedContext)],
  ["limited data set profile", () => profileOptions(LIMITED_DATA_SET_PROFILE, keyedContext)],
  [
    "keyed policy",
    () => ({
      policy: defineDeidPolicy({
        name: "equivalence-keyed",
        transforms: {
          [C.NAMES]: "pseudonymize",
          [C.MRN]: "pseudonymize",
          [C.ACCOUNT]: "pseudonymize",
          [C.DATES]: "date-shift",
          [C.SSN]: "hash",
        },
      }),
      context: keyedContext,
    }),
  ],
];

/** One digest line for a call, or the name and code of what it threw. */
function attempt(run: () => string): string {
  try {
    return run();
  } catch (error) {
    const e = error as { name?: string; code?: string };
    return `threw ${String(e.name)} ${String(e.code)}`;
  }
}

const HL7_INPUTS: readonly (readonly [string, string])[] = [
  ["adt-a01", hl7Wire("adt-a01")],
  ["adt-a03", hl7Wire("adt-a03")],
  ["orm-o01-retained-dates", hl7Wire("orm-o01-retained-dates")],
  ["oru-r01", hl7Wire("oru-r01")],
  ["shape 0", hl7Message(0)],
  ["shape 7", hl7Message(7)],
];

const FHIR_INPUTS: readonly (readonly [string, string])[] = [
  ["bundle", FIX("fhir", "bundle.json")],
  ["non-person-loci", FIX("fhir", "non-person-loci.json")],
  ["patient shape", fhirPatient(3)],
  ["bundle shape", fhirBundle(2, 12)],
];

const CCDA_INPUTS: readonly (readonly [string, string])[] = [
  ["ccd", FIX("ccda", "ccd.xml")],
  ["shape", ccdaDocument(1, 6)],
];

const X12_INPUTS: readonly (readonly [string, string])[] = [
  ...[
    "820-premium",
    "837p",
    "837p-fail-closed",
    "837p-shifted",
    "other-insured-and-responsible",
    "shifted-dates",
    "shifted-numbers",
  ].map((name) => [name, FIX("x12", `${name}.edi`)] as const),
  ["shape", x12Claims(4, 5)],
];

const NCPDP_INPUTS: readonly (readonly [string, string])[] = [
  ["telecom-b1", FIX("ncpdp", "telecom-b1.ncpdp")],
  ["telecom-b1-response", FIX("ncpdp", "telecom-b1-response.ncpdp")],
  ["claim shape 0", ncpdpClaim(0)],
  ["claim shape 9", ncpdpClaim(9)],
];

const DICOM_INPUTS: readonly (readonly [string, Buffer])[] = [
  ["phi dataset", serializeDicom(buildPhiDataset())],
  ["ct shape", ctImage(2, 16)],
  ["enhanced ct shape", enhancedCt(5, 3, 8)],
];

/** Every case's digests, keyed `<format> <input> | <options> | <entry point>`. */
function corpusDigests(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [optionName, options] of OPTION_SETS) {
    for (const [name, text] of HL7_INPUTS) {
      out[`hl7 ${name} | ${optionName} | deidentifyHl7`] = attempt(() => {
        const result = deidentifyHl7(parseHL7(text), options());
        // The wire on `hl7` was added by the performance work: it must be the document's own text.
        if (result.hl7 !== result.document.toString()) return "hl7 is not the document's wire";
        return [
          digest(result.document.toString()),
          digest(stable(result.document.toJSON())),
          rest(result, ["document", "hl7"]),
        ].join(" ");
      });
    }
    out[`hl7 batch shape | ${optionName} | deidentifyHl7 per message`] = attempt(() => {
      const parts: string[] = [];
      for (const entry of splitBatch(hl7Batch(3, 4)).messages) {
        if (!entry.ok) {
          parts.push("refused");
          continue;
        }
        const result = deidentifyHl7(entry.message, options());
        parts.push(result.hl7, stable(result.manifest));
      }
      return digest(parts.join("\n"));
    });
    for (const [name, text] of FHIR_INPUTS) {
      out[`fhir ${name} | ${optionName} | deidentifyFhir`] = attempt(() => {
        const result = deidentifyFhir(parseResource(text).resource, options());
        return [
          digest(serializeResource(result.document)),
          digest(stable(result.document)),
          rest(result, ["document"]),
        ].join(" ");
      });
      out[`fhir ${name} | ${optionName} | deidentifyFhirJson`] = attempt(() => {
        const result = deidentifyFhirJson(text, options());
        return [digest(result.json), rest(result, ["document", "json"])].join(" ");
      });
    }
    for (const [name, text] of CCDA_INPUTS) {
      out[`ccda ${name} | ${optionName} | deidentifyCcda`] = attempt(() => {
        const result = deidentifyCcda(parseCcda(text), options());
        return [
          digest(result.document.toString()),
          digest(stable(result.document.warnings)),
          rest(result, ["document"]),
        ].join(" ");
      });
    }
    for (const [name, text] of X12_INPUTS) {
      out[`x12 ${name} | ${optionName} | deidentifyX12String`] = attempt(() => {
        const result = deidentifyX12String(text, options());
        return [digest(result.x12), rest(result, ["x12", "interchange"])].join(" ");
      });
      out[`x12 ${name} | ${optionName} | deidentifyX12`] = attempt(() => {
        const result = deidentifyX12(parseX12(text), options());
        return [digest(result.x12), rest(result, ["x12", "interchange"])].join(" ");
      });
    }
    for (const [name, text] of NCPDP_INPUTS) {
      out[`ncpdp ${name} | ${optionName} | deidentifyTelecomString`] = attempt(() => {
        const result = deidentifyTelecomString(text, options());
        return [digest(result.telecom), rest(result, ["telecom", "transaction", "document"])].join(
          " ",
        );
      });
    }
    out[`engine 1,000 loci | ${optionName} | deidentify`] = attempt(() =>
      digest(stable(deidentify(locusModel(4, 1_000), options()))),
    );
  }
  for (const [name, bytes] of DICOM_INPUTS) {
    out[`dicom ${name} | default | deidentifyDicomBuffer`] = attempt(() => {
      const result = deidentifyDicomBuffer(bytes);
      return [digest(result.bytes), rest(result, ["bytes"])].join(" ");
    });
    out[`dicom ${name} | default | deidentifyDicom`] = attempt(() => {
      const result = deidentifyDicom(parseDicom(bytes));
      return [digest(serializeDicom(result.dataset)), rest(result, ["dataset"])].join(" ");
    });
  }
  return out;
}

describe("every output is identical to the one the code before the performance work emitted", () => {
  it("matches the digests captured from the earlier code", async () => {
    const digests = corpusDigests();
    await expect(`${JSON.stringify(digests, null, 2)}\n`).toMatchFileSnapshot(
      "./__snapshots__/output-equivalence.json",
    );
  });
});
