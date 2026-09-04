/**
 * The **fence around what a pass emits**. A change that only means to *measure* something must leave
 * every transformed document and every manifest entry describing an acted-on position exactly where it
 * was, so the two are pinned here: each adapter's output is digested, and each adapter's manifest is
 * snapshotted, from the pass as it stood before the measurement existed.
 *
 * "Indistinguishable" here is stronger than "the numbers still add up":
 *
 * - the manifest's **entry ORDER**, not only its contents. The manifest builder is shared by all six
 *   adapters, so a sort imposed there to satisfy one format's ordering requirement would re-order every
 *   other format's manifest with nothing else noticing. The snapshots below are the wire the pinned
 *   tree produced, so an ordering change reds here.
 * - the support report's **section set, field set and field order**, machine-readable and rendered,
 *   for the same reason: it is built from the same shared manifest shape.
 *
 * Every value is a synthetic sentinel from the committed fixtures.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import { parseCcda } from "@cosyte/ccda";
import { parseResource, serializeResource } from "@cosyte/fhir";
import { parseHL7 } from "@cosyte/hl7";
import { Dataset, serializeDicom } from "@cosyte/dicom";

import {
  buildExpertDeterminationSupportReport,
  createDeidContext,
  formatExpertDeterminationSupportReport,
  profileOptions,
  SAFE_HARBOR_PROFILE,
  type DeidManifestEntry,
} from "../../src/index.js";
import { deidentifyHl7 } from "../../src/hl7/index.js";
import { deidentifyCcda } from "../../src/ccda/index.js";
import { deidentifyFhir } from "../../src/fhir/index.js";
import { deidentifyX12String } from "../../src/x12/index.js";
import { deidentifyTelecomString } from "../../src/ncpdp/index.js";
import { deidentifyDicom } from "../../src/dicom/index.js";
import { buildPhiDataset } from "../dicom/helpers/fixtures.js";

const FIX = (fmt: string, file: string): string =>
  readFileSync(join(import.meta.dirname, "..", "fixtures", fmt, file), "utf8");

const hl7Wire = (name: string): string =>
  FIX("hl7", `${name}.hl7`).trim().split(/\r?\n/).join("\r");

const ctx = createDeidContext({ key: "cross-format-key", patientId: "p-cross" });
const options = (): ReturnType<typeof profileOptions> => profileOptions(SAFE_HARBOR_PROFILE, ctx);

/** The ordered locus list of a manifest: the axis a shared re-sort would break. */
const order = (manifest: readonly DeidManifestEntry[]): string[] => manifest.map((m) => m.locus);

/**
 * A compact, exact fingerprint of one transformed document. A digest rather than the whole wire: the
 * assertion is *identity*, and a hash makes a single moved byte as loud as a rewritten document while
 * keeping the pinned expectation readable. It carries nothing of the document itself.
 */
const digest = (wire: string): string =>
  createHash("sha256").update(wire, "utf8").digest("hex").slice(0, 32);

/**
 * Every adapter's transformed document, digested. Deterministic: one fixed key context, one profile,
 * committed fixtures, and content-derived (never random) surrogates in every adapter.
 */
function transformedDocumentDigests(): Record<string, string> {
  const { resource } = parseResource(FIX("fhir", "bundle.json"));
  return {
    hl7: digest(deidentifyHl7(parseHL7(hl7Wire("oru-r01")), options()).document.toString()),
    "hl7-encounter": digest(
      deidentifyHl7(parseHL7(hl7Wire("adt-a03")), options()).document.toString(),
    ),
    ccda: digest(deidentifyCcda(parseCcda(FIX("ccda", "ccd.xml")), options()).document.toString()),
    fhir: digest(serializeResource(deidentifyFhir(resource, options()).document)),
    x12: digest(deidentifyX12String(FIX("x12", "837p.edi"), options()).x12),
    ncpdp: digest(deidentifyTelecomString(FIX("ncpdp", "telecom-b1.ncpdp"), options()).telecom),
    dicom: digest(serializeDicom(deidentifyDicom(buildPhiDataset()).dataset).toString("latin1")),
  };
}

/**
 * The **fence around the transformed documents themselves**, pinned so that a change which only means
 * to *measure* something cannot move a single emitted byte. The digests below were captured from the
 * pass as it stood before the unexamined-residual measurement existed, so a later run that reproduces
 * them is a run that emits the document a pass without the measurement emits.
 *
 * Byte identity is the assertion, deliberately: the mirror hazard of any counting change is that the
 * enumeration walk perturbs the tree it walks, or that a position enumerated for the count also gets
 * acted on. Both show up here as a changed digest, whatever the manifest says.
 */
describe("every adapter emits the same transformed document, byte for byte", () => {
  // THE DICOM DIGEST MOVED ONCE, DELIBERATELY, AND THE CONTROL BELOW IS WHY IT IS SAFE TO MOVE IT.
  // This fence forbids a change that only means to MEASURE something from moving an emitted byte. The
  // DICOM adapter now also DECLARES something: it writes the coded De-identification Method Code
  // Sequence `(0012,0064)` that PS3.15 E.1.1 asks for beside the method text, so its document really is
  // a byte longer on purpose. What must NOT have changed is anything else, and the next test asserts
  // exactly that by digesting the same document with the new element taken back out and matching the
  // pre-existing pin. The other five adapters are untouched and their digests are unmoved.
  it("the six adapters' transformed documents are unchanged", () => {
    expect(transformedDocumentDigests()).toMatchInlineSnapshot(`
      {
        "ccda": "152ba0fce5feff3fa707d6c25c868ee9",
        "dicom": "c5b02868abb92c9221aa105af00ac5cd",
        "fhir": "a9237473c3c96a54b5ad915ad10afe34",
        "hl7": "b0e71b72dd6f4078c43d1d7b767ef843",
        "hl7-encounter": "7aef4fa7fa7ed2ffd1ce4c05158e4773",
        "ncpdp": "e8a8259ce46ed5764268f2c0a51dbfc5",
        "x12": "9c207e831fde066fd4ce03e11fdb6b77",
      }
    `);
  });

  /**
   * THE SECOND CONTROL OF THE SAME SHAPE, FOR THE SAME REASON. The FHIR sweep now decides on an
   * element's DATATYPE rather than on the type of the resource carrying it, so it visits every
   * resource in a graph instead of the four person types. The fixture above carries no name- or
   * address-typed element outside a person resource, so its digest is unmoved and that is asserted by
   * the pin above. What that pin cannot say is whether the widened walk PERTURBED anything on its way
   * past, which is the mirror hazard of any reach change: this adds the newly-swept shapes to the same
   * graph, proves they really are acted on, then takes them back out and requires the pinned digest,
   * the pinned manifest ORDER and the pre-existing residual inventory back, exactly.
   */
  const fhirWithNonPersonLoci = (): unknown => {
    const graph: unknown = JSON.parse(FIX("fhir", "bundle.json"));
    const entries = (graph as { entry: unknown[] }).entry;
    entries.push({
      fullUrl: "urn:uuid:organization-cross",
      resource: {
        resourceType: "Organization",
        id: "orgCross",
        name: "ZZORGOWNNAME",
        contact: [{ name: { family: "ZZORGCONTACTFAM" } }],
      },
    });
    entries.push({
      fullUrl: "urn:uuid:location-cross",
      resource: {
        resourceType: "Location",
        id: "locCross",
        address: { line: ["ZZLOCSTREET"], state: "MA", postalCode: "01103" },
      },
    });
    return graph;
  };

  it("the FHIR sweep really does act on the newly-reached shapes (non-vacuity)", () => {
    const { resource } = parseResource(JSON.stringify(fhirWithNonPersonLoci()));
    const { document, manifest } = deidentifyFhir(resource, options());
    const wire = serializeResource(document);
    expect(wire).not.toContain("ZZORGCONTACTFAM");
    expect(wire).not.toContain("ZZLOCSTREET");
    expect(manifest.map((m) => m.locus)).toContain("Bundle.entry[6].resource.contact[0].name");
    expect(manifest.map((m) => m.locus)).toContain("Bundle.entry[7].resource.address");
    expect(digest(wire)).not.toBe("a9237473c3c96a54b5ad915ad10afe34");
  });

  it("and the FHIR document, manifest and residual inventory are unchanged with them taken back out", () => {
    const graph = fhirWithNonPersonLoci() as { entry: unknown[] };
    graph.entry = graph.entry.slice(0, -2); // the two added resources, removed again
    const { resource } = parseResource(JSON.stringify(graph));
    const { document, manifest, unexaminedResiduals } = deidentifyFhir(resource, options());

    // The pinned digest above, reached from a graph the widened walk has just been through.
    expect(digest(serializeResource(document))).toBe("a9237473c3c96a54b5ad915ad10afe34");
    // The manifest, contents and order both: the same list the `FHIR` case below pins.
    expect(order(manifest)).toEqual(
      order(deidentifyFhir(parseResource(FIX("fhir", "bundle.json")).resource, options()).manifest),
    );
    // And the THIRD artifact, which no pin covered before: an empty result has to be readable as
    // measured-and-empty rather than as a pass that measured nothing, so the inventory is pinned by
    // its total and by a digest of its (locus, count) pairs, both captured from the pass as it stood
    // before the sweep widened.
    expect(unexaminedResiduals.reduce((sum, r) => sum + r.count, 0)).toBe(51);
    expect(
      createHash("sha256")
        .update(JSON.stringify(unexaminedResiduals.map((r) => [r.locus, r.count])), "utf8")
        .digest("hex")
        .slice(0, 32),
    ).toBe("7d75d422c369f12b3c5875996c705564");
  });

  it("and the DICOM document is unchanged once the added declaration is taken back out", () => {
    // The pinned value is the ORIGINAL digest, captured before `(0012,0064)` was ever written. Removing
    // that one element and re-serializing has to reproduce it exactly: that is what makes the digest
    // above an ADDITION rather than a rewrite, and it holds the coded declaration to the same bar the
    // measurement was held to. Every other byte of the pass, the `(0012,0063)` method text and the
    // `(0012,0062) YES` marker included, is inside this assertion.
    const { dataset } = deidentifyDicom(buildPhiDataset());
    const withoutDeclaration = new Dataset({
      warnings: [],
      elements: new Map(
        dataset
          .elements()
          .filter((el) => el.tag !== "00120064")
          .map((el) => [el.tag, el]),
      ),
      ...(dataset.fileMeta !== undefined ? { fileMeta: dataset.fileMeta } : {}),
    });
    expect(digest(serializeDicom(withoutDeclaration).toString("latin1"))).toBe(
      "8f9e91a91cc7b3a4461af53838c8843e",
    );
  });
});

describe("the HL7 v2 manifest is unchanged, contents and order", () => {
  it("HL7 v2 (ORU-R01)", () => {
    const { manifest } = deidentifyHl7(parseHL7(hl7Wire("oru-r01")), options());
    expect(order(manifest)).toMatchInlineSnapshot(`
      [
        "MSH-7[0]",
        "PID-3[0]",
        "PID-5",
        "PID-7",
        "PID-11[0]",
        "PID-12",
        "PID-13",
        "PID-18[0]",
        "PID-19",
        "OBR-2",
        "OBR-3",
        "OBR-7",
        "OBX[3]-5",
        "OBX[4]-5",
        "NTE-3",
      ]
    `);
  });

  it("HL7 v2 (ADT-A03, the retained encounter loci)", () => {
    const { manifest } = deidentifyHl7(parseHL7(hl7Wire("adt-a03")), options());
    expect(manifest.map((m) => `${m.locus} ${m.category} ${m.disposition} ${m.code}`))
      .toMatchInlineSnapshot(`
      [
        "MSH-7[0] DATES transformed DEID_RESIDUAL_RETAINED",
        "PID-3[0] MRN removed DEID_CATEGORY_REMOVED",
        "PID-5 NAMES removed DEID_CATEGORY_REMOVED",
        "PID-7 DATES transformed DEID_RESIDUAL_RETAINED",
        "PID-11[0] GEOGRAPHIC transformed DEID_RESIDUAL_RETAINED",
        "PID-13 PHONE removed DEID_CATEGORY_REMOVED",
        "PID-18[0] ACCOUNT removed DEID_CATEGORY_REMOVED",
        "PV1-19[0] OTHER_UNIQUE_ID blocked DEID_LOCUS_BLOCKED",
        "PV1-44 DATES transformed DEID_RESIDUAL_RETAINED",
        "PV1-45 DATES transformed DEID_RESIDUAL_RETAINED",
        "ORC-2 OTHER_UNIQUE_ID blocked DEID_LOCUS_BLOCKED",
        "ORC-3 OTHER_UNIQUE_ID blocked DEID_LOCUS_BLOCKED",
        "OBR-2 OTHER_UNIQUE_ID blocked DEID_LOCUS_BLOCKED",
        "OBR-3 OTHER_UNIQUE_ID blocked DEID_LOCUS_BLOCKED",
        "OBR-7 DATES transformed DEID_RESIDUAL_RETAINED",
        "DG1-5 DATES transformed DEID_RESIDUAL_RETAINED",
      ]
    `);
  });
});

describe("the other five adapters produce the same manifests, in the same order", () => {
  it("C-CDA", () => {
    const { manifest } = deidentifyCcda(parseCcda(FIX("ccda", "ccd.xml")), options());
    expect(order(manifest)).toMatchInlineSnapshot(`
      [
        "effectiveTime",
        "recordTarget/patientRole/id[0]",
        "recordTarget/patientRole/id[1]",
        "recordTarget/patientRole/addr",
        "recordTarget/patientRole/telecom",
        "recordTarget/patientRole/patient/name",
        "recordTarget/patientRole/patient/birthTime",
        "recordTarget/patientRole/patient/guardian/addr",
        "recordTarget/patientRole/patient/guardian/telecom",
        "recordTarget/patientRole/patient/guardian/guardianPerson/name",
        "recordTarget/patientRole/patient/patientID",
        "recordTarget/patientRole/patient/vendorNote",
        "author/time",
        "author/assignedAuthor/id",
        "author/assignedAuthor/addr",
        "author/assignedAuthor/telecom",
        "author/assignedAuthor/assignedPerson/name",
        "author/assignedAuthor/representedOrganization/name",
        "author/assignedAuthor/representedOrganization/telecom",
        "informant/relatedEntity/relatedPerson/name",
        "custodian/assignedCustodian/representedCustodianOrganization/id",
        "custodian/assignedCustodian/representedCustodianOrganization/name",
        "custodian/assignedCustodian/representedCustodianOrganization/telecom",
        "custodian/assignedCustodian/representedCustodianOrganization/addr",
        "componentOf/encompassingEncounter/id",
        "componentOf/encompassingEncounter/effectiveTime/low",
        "componentOf/encompassingEncounter/effectiveTime/high",
        "component/structuredBody/component[0]/section/text",
        "component/structuredBody/component[1]/section/text",
      ]
    `);
  });

  it("FHIR", () => {
    const { resource } = parseResource(FIX("fhir", "bundle.json"));
    const { manifest } = deidentifyFhir(resource, options());
    expect(order(manifest)).toMatchInlineSnapshot(`
      [
        "Bundle.entry[0].resource.text.div",
        "Bundle.entry[0].resource.identifier[0].value",
        "Bundle.entry[0].resource.identifier[1].value",
        "Bundle.entry[0].resource.name",
        "Bundle.entry[0].resource.telecom",
        "Bundle.entry[0].resource.birthDate",
        "Bundle.entry[0].resource.deceasedDateTime",
        "Bundle.entry[0].resource.address",
        "Bundle.entry[0].resource.photo",
        "Bundle.entry[0].resource.contact[0].name",
        "Bundle.entry[0].resource.contact[0].telecom",
        "Bundle.entry[0].resource.contact[0].address",
        "Bundle.entry[0].resource.extension[0].valueString",
        "Bundle.entry[0].resource.extension[1].extension[0].valueString",
        "Bundle.entry[0].resource.vendorMotherMaidenName",
        "Bundle.entry[1].resource.identifier.value",
        "Bundle.entry[1].resource.name",
        "Bundle.entry[1].resource.telecom",
        "Bundle.entry[1].resource.address",
        "Bundle.entry[2].resource.name",
        "Bundle.entry[2].resource.telecom",
        "Bundle.entry[2].resource.birthDate",
        "Bundle.entry[3].resource.subject.display",
        "Bundle.entry[3].resource.performer[1].display",
        "Bundle.entry[3].resource.effectiveDateTime",
        "Bundle.entry[3].resource.issued",
        "Bundle.entry[3].resource.identifier.value",
        "Bundle.entry[3].resource.note",
        "Bundle.entry[4].resource.subject.display",
        "Bundle.entry[4].resource.payload[0].contentString",
        "Bundle.entry[5].resource.period.start",
        "Bundle.entry[5].resource.period.end",
        "Bundle.entry[5].resource.contained[0].name",
        "Bundle.entry[5].resource.contained[0].telecom",
      ]
    `);
  });

  it("X12", () => {
    const { manifest } = deidentifyX12String(FIX("x12", "837p.edi"), options());
    expect(order(manifest)).toMatchInlineSnapshot(`
      [
        "837/N1[0]-1",
        "837/NM1[0]-1",
        "837/PER[0]-2",
        "837/PER[0]-4",
        "837/NM1[1]-1",
        "837/N3[0]-1",
        "837/N4[0]-1",
        "837/N4[0]-3",
        "837/SBR[0]-3",
        "837/SBR[0]-4",
        "837/NM1[2]-3",
        "837/NM1[2]-9",
        "837/N3[1]-1",
        "837/N4[1]-1",
        "837/N4[1]-3",
        "837/N4[1]-5",
        "837/N4[1]-6",
        "837/DMG[0]-2",
        "837/REF[1]-2",
        "837/REF[2]-2",
        "837/PER[1]-2",
        "837/PER[1]-4",
        "837/NM1[3]-3",
        "837/NM1[3]-9",
        "837/NM1[4]-3",
        "837/NM1[4]-9",
        "837/N3[2]-1",
        "837/N4[2]-1",
        "837/N4[2]-3",
        "837/DMG[1]-2",
        "837/CLM[0]-1",
        "837/REF[3]-2",
        "837/NM1[5]-1",
        "837/DTP[0]-3",
        "837/NTE[0]-2",
        "837/MSG[0]-1",
        "837/III[0]-4",
        "837/K3[0]-1",
        "837/ZZZ[0]-1",
      ]
    `);
  });

  it("DICOM", () => {
    const { manifest } = deidentifyDicom(buildPhiDataset());
    expect(order(manifest)).toMatchInlineSnapshot(`
      [
        "(0008,0018) SOP Instance UID",
        "(0008,0020) Study Date",
        "(0008,0050) Accession Number",
        "(0008,0080) Institution Name",
        "(0008,0090) Referring Physician's Name",
        "(0010,0010) Patient's Name",
        "(0010,0020) Patient ID",
        "(0010,0030) Patient's Birth Date",
        "(0010,1000) Other Patient IDs",
        "(0020,000d) Study Instance UID",
        "(0020,000e) Series Instance UID",
        "(0009,1001) PrivateTag",
      ]
    `);
  });

  it("NCPDP Telecom", () => {
    const { manifest } = deidentifyTelecomString(FIX("ncpdp", "telecom-b1.ncpdp"), options());
    expect(order(manifest)).toMatchInlineSnapshot(`
      [
        "header/dateOfService",
        "01/CA",
        "01/CB",
        "01/C4",
        "01/CM",
        "01/CN",
        "01/CP",
        "01/CQ",
        "01/CY",
        "01/HN",
        "01/CW",
        "03/DB",
        "03/DR",
        "04/C2",
        "04/C1",
        "04/CC",
        "04/CD",
        "04/2A",
        "05/NU",
        "05/MJ",
        "05/E8",
        "08/FY",
        "08/FQ",
        "99/ZZ",
      ]
    `);
  });
});

describe("the Expert-Determination support report keeps its shape, not only its numbers", () => {
  const { manifest } = deidentifyCcda(parseCcda(FIX("ccda", "ccd.xml")), options());
  const report = buildExpertDeterminationSupportReport(manifest, { policy: "safe-harbor" });

  it("has the same top-level field set, in the same order", () => {
    expect(Object.keys(report)).toMatchInlineSnapshot(`
      [
        "kind",
        "determination",
        "disclaimer",
        "outputLabel",
        "policy",
        "documentCount",
        "totals",
        "dispositionSummary",
        "perLocus",
        "categoryCoverage",
        "retainedQuasiIdentifiers",
        "keyedSurrogateResiduals",
        "unexaminedResiduals",
        "unexaminedResidualsMeasured",
        "quasiIdentifierStatistics",
      ]
    `);
  });

  it("has the same per-category field set and the same category order", () => {
    expect(Object.keys(report.categoryCoverage[0] ?? {})).toMatchInlineSnapshot(`
      [
        "category",
        "letter",
        "number",
        "title",
        "actedOn",
        "totalCount",
        "dispositions",
        "transforms",
        "codes",
        "residualRetained",
      ]
    `);
    expect(report.categoryCoverage.map((c) => c.letter).join("")).toBe("ABCDEFGHIJKLMNOPQR");
  });

  it("renders the same section set, in the same order", () => {
    const headings = formatExpertDeterminationSupportReport(report)
      .split("\n")
      .filter((line) => line.startsWith("#"));
    expect(headings).toMatchInlineSnapshot(`
      [
        "# Expert-Determination support report",
        "## Safe Harbor category coverage (§164.514(b)(2)(i) A–R)",
        "## Retained quasi-identifiers (identifying residuals recorded as retained)",
        "## Unexamined residual positions (handed through, no locus rule reached them)",
        "## Keyed surrogate residuals (re-identification codes, a separate kind of residual)",
      ]
    `);
  });
});
