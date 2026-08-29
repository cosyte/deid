/**
 * The **fence around the other five adapters**. The HL7 v2 retained-segment date sweep changed one
 * adapter; the C-CDA, FHIR, X12, NCPDP and DICOM passes must be indistinguishable from what they were,
 * and "indistinguishable" here is stronger than "the numbers still add up":
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

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import { parseCcda } from "@cosyte/ccda";
import { parseResource } from "@cosyte/fhir";

import {
  buildExpertDeterminationSupportReport,
  createDeidContext,
  formatExpertDeterminationSupportReport,
  profileOptions,
  SAFE_HARBOR_PROFILE,
  type DeidManifestEntry,
} from "../../src/index.js";
import { deidentifyCcda } from "../../src/ccda/index.js";
import { deidentifyFhir } from "../../src/fhir/index.js";
import { deidentifyX12String } from "../../src/x12/index.js";
import { deidentifyTelecomString } from "../../src/ncpdp/index.js";
import { deidentifyDicom } from "../../src/dicom/index.js";
import { buildPhiDataset } from "../dicom/helpers/fixtures.js";

const FIX = (fmt: string, file: string): string =>
  readFileSync(join(import.meta.dirname, "..", "fixtures", fmt, file), "utf8");

const ctx = createDeidContext({ key: "cross-format-key", patientId: "p-cross" });
const options = (): ReturnType<typeof profileOptions> => profileOptions(SAFE_HARBOR_PROFILE, ctx);

/** The ordered locus list of a manifest: the axis a shared re-sort would break. */
const order = (manifest: readonly DeidManifestEntry[]): string[] => manifest.map((m) => m.locus);

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
        "## Keyed surrogate residuals (re-identification codes, a separate kind of residual)",
      ]
    `);
  });
});
