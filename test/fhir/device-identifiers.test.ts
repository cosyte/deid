/**
 * **FHIR R4: a Device's identifiers and serial numbers are category (M), removed under Safe Harbor
 * and the Limited Data Set.**
 *
 * Safe Harbor lists device identifiers and serial numbers as their own category (M), and the
 * Limited Data Set rule lists them among the direct identifiers it removes. On a `Device` they sit at
 * `serialNumber`, `lotNumber`, `distinctIdentifier`, `identifier` and the UDI carrier
 * (`udiCarrier.deviceIdentifier`, `carrierHRF`, `carrierAIDC`). Each is removed under both presets with
 * a category (M) row that carries no value, in a contained resource and a `Bundle` entry too. What
 * describes the kind of device rather than the one device (its name, model, type, status and the UDI
 * issuer) is kept.
 *
 * Every value is synthetic and built here.
 */

import { describe, expect, it } from "vitest";

import {
  createDeidContext,
  defineDeidPolicy,
  DEID_DISPOSITION_CODES,
  LIMITED_DATA_SET_PROFILE,
  profileOptions,
  SAFE_HARBOR_CATEGORIES,
  SAFE_HARBOR_PROFILE,
} from "../../src/index.js";
import {
  deidentifyFhirJson,
  extractFhirLoci,
  FHIR_EMBEDDED_CONTENT_KINDS,
  type FhirDeidOptions,
} from "../../src/fhir/index.js";
import { parseResource } from "@cosyte/fhir";

const ctx = createDeidContext({ key: "fhir-device-identifiers-synthetic-key", patientId: "p" });

const PROFILES = [SAFE_HARBOR_PROFILE, LIMITED_DATA_SET_PROFILE] as const;

/** The base64 of a made-up AIDC barcode payload. */
const AIDC = Buffer.from("(01)ZZAIDC0001(21)ZZAIDCSN01").toString("base64");

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

/**
 * Each position on a `Device` that holds a device identifier or serial number: a label, the
 * `Device` fields, the locus, and the value that must not come back.
 */
const POSITIONS: readonly (readonly [string, { [key: string]: Json }, string, string])[] = [
  ["serialNumber", { serialNumber: "ZZLEAK" }, "Device.serialNumber", "ZZLEAK"],
  ["lotNumber", { lotNumber: "ZZLOT0001" }, "Device.lotNumber", "ZZLOT0001"],
  [
    "distinctIdentifier",
    { distinctIdentifier: "ZZDISTINCT01" },
    "Device.distinctIdentifier",
    "ZZDISTINCT01",
  ],
  [
    "udiCarrier.deviceIdentifier",
    { udiCarrier: [{ deviceIdentifier: "ZZDI0000001" }] },
    "Device.udiCarrier[0].deviceIdentifier",
    "ZZDI0000001",
  ],
  [
    "udiCarrier.carrierHRF",
    { udiCarrier: [{ carrierHRF: "(01)ZZHRF0001(21)ZZHRFSN01" }] },
    "Device.udiCarrier[0].carrierHRF",
    "ZZHRF0001",
  ],
  [
    "udiCarrier.carrierAIDC",
    { udiCarrier: [{ carrierAIDC: AIDC }] },
    "Device.udiCarrier[0].carrierAIDC",
    AIDC,
  ],
  [
    "identifier.value",
    { identifier: [{ system: "http://example.org/zz-serial", value: "ZZIDSN0001" }] },
    "Device.identifier.value",
    "ZZIDSN0001",
  ],
  [
    "the second udiCarrier",
    {
      udiCarrier: [{ deviceIdentifier: "ZZDIFIRST01" }, { deviceIdentifier: "ZZDISECOND1" }],
    },
    "Device.udiCarrier[1].deviceIdentifier",
    "ZZDISECOND1",
  ],
];

/** Run the pass under a profile, with the given options on top. */
function run(doc: Json, profile: (typeof PROFILES)[number], options: FhirDeidOptions = {}) {
  return deidentifyFhirJson(JSON.stringify(doc), { ...profileOptions(profile, ctx), ...options });
}

/** A category (M) row, removed, at the locus. */
function deviceRow(locus: string): unknown {
  return expect.objectContaining({
    locus,
    category: SAFE_HARBOR_CATEGORIES.DEVICE,
    transform: "redact",
    disposition: "removed",
    code: DEID_DISPOSITION_CODES.DEID_CATEGORY_REMOVED,
  });
}

describe("a Device's identifiers and serial numbers are removed as category (M)", () => {
  for (const profile of PROFILES) {
    it.each(POSITIONS)(`%s, under ${profile.name}`, (_label, fields, locus, text) => {
      const doc = { resourceType: "Device", status: "active", ...fields };
      const { json, manifest, unexaminedResiduals } = run(doc, profile);
      expect(json).not.toContain(text);
      expect(manifest).toContainEqual(deviceRow(locus));
      expect(JSON.stringify(manifest)).not.toContain(text);
      expect(JSON.stringify(unexaminedResiduals)).not.toContain(text);
      expect(unexaminedResiduals.map((r) => r.locus)).not.toContain(locus);
      expect(JSON.parse(json)).toMatchObject({ resourceType: "Device", status: "active" });
    });
  }

  it("the probe the review ran: a bare serialNumber does not come out unchanged", () => {
    for (const profile of PROFILES) {
      const { json, manifest } = run({ resourceType: "Device", serialNumber: "ZZLEAK" }, profile);
      expect(JSON.parse(json)).toEqual({ resourceType: "Device" });
      expect(manifest).toEqual([deviceRow("Device.serialNumber")]);
    }
  });

  it("every field at once, each with its own row", () => {
    const doc = {
      resourceType: "Device",
      identifier: [
        { system: "http://example.org/zz-serial", value: "ZZIDSN0001" },
        { system: "http://example.org/zz-asset", value: "ZZIDAS0002" },
      ],
      udiCarrier: [
        {
          deviceIdentifier: "ZZDI0000001",
          issuer: "http://hl7.org/fhir/NamingSystem/gs1-di",
          jurisdiction: "http://hl7.org/fhir/NamingSystem/fda-udi",
          carrierAIDC: AIDC,
          carrierHRF: "(01)ZZHRF0001(21)ZZHRFSN01",
          entryType: "barcode",
        },
      ],
      status: "active",
      distinctIdentifier: "ZZDISTINCT01",
      manufacturer: "Zz Devices",
      lotNumber: "ZZLOT0001",
      serialNumber: "ZZSN000001",
      deviceName: [{ name: "zz infusion pump", type: "user-friendly-name" }],
      modelNumber: "ZZ-MODEL-9",
      type: { coding: [{ system: "http://snomed.info/sct", code: "469829004" }] },
    };
    for (const profile of PROFILES) {
      const { json, manifest } = run(doc, profile);
      for (const text of [
        "ZZIDSN0001",
        "ZZIDAS0002",
        "ZZDI0000001",
        AIDC,
        "ZZHRF0001",
        "ZZDISTINCT01",
        "ZZLOT0001",
        "ZZSN000001",
      ]) {
        expect(json).not.toContain(text);
        expect(JSON.stringify(manifest)).not.toContain(text);
      }
      expect(manifest.map((e) => e.locus)).toEqual([
        "Device.identifier[0].value",
        "Device.identifier[1].value",
        "Device.udiCarrier[0].deviceIdentifier",
        "Device.udiCarrier[0].carrierAIDC",
        "Device.udiCarrier[0].carrierHRF",
        "Device.distinctIdentifier",
        "Device.lotNumber",
        "Device.serialNumber",
      ]);
      for (const row of manifest) expect(row).toEqual(deviceRow(row.locus));
      // What describes the kind of device, not the one device, is kept.
      expect(JSON.parse(json)).toEqual({
        resourceType: "Device",
        identifier: [
          { system: "http://example.org/zz-serial" },
          { system: "http://example.org/zz-asset" },
        ],
        udiCarrier: [
          {
            issuer: "http://hl7.org/fhir/NamingSystem/gs1-di",
            jurisdiction: "http://hl7.org/fhir/NamingSystem/fda-udi",
            entryType: "barcode",
          },
        ],
        status: "active",
        manufacturer: "Zz Devices",
        deviceName: [{ name: "zz infusion pump", type: "user-friendly-name" }],
        modelNumber: "ZZ-MODEL-9",
        type: { coding: [{ system: "http://snomed.info/sct", code: "469829004" }] },
      });
    }
  });

  it("under the Limited Data Set a Device identifier is removed, not given a keyed surrogate", () => {
    const doc = {
      resourceType: "Device",
      identifier: [{ system: "http://example.org/zz-serial", value: "ZZIDSN0001" }],
    };
    const { json, manifest } = run(doc, LIMITED_DATA_SET_PROFILE);
    expect(JSON.parse(json)).toEqual({
      resourceType: "Device",
      identifier: [{ system: "http://example.org/zz-serial" }],
    });
    expect(manifest).toEqual([deviceRow("Device.identifier.value")]);
    expect(manifest[0]?.reidentificationCode).toBe(false);
  });

  it("an identifier elsewhere keeps its own category: a Patient's is still a record number", () => {
    const doc = {
      resourceType: "Patient",
      identifier: [{ system: "http://example.org/zz-mrn", value: "ZZMRN0001" }],
    };
    const { manifest } = run(doc, LIMITED_DATA_SET_PROFILE);
    expect(manifest).toEqual([
      expect.objectContaining({
        locus: "Patient.identifier.value",
        category: SAFE_HARBOR_CATEGORIES.MRN,
        transform: "pseudonymize",
      }),
    ]);
  });

  it("an SSN system on a Device identifier is still an SSN", () => {
    const doc = {
      resourceType: "Device",
      identifier: [{ system: "http://hl7.org/fhir/sid/us-ssn", value: "ZZSSN0001" }],
    };
    const { manifest } = run(doc, SAFE_HARBOR_PROFILE);
    expect(manifest).toEqual([
      expect.objectContaining({
        locus: "Device.identifier.value",
        category: SAFE_HARBOR_CATEGORIES.SSN,
      }),
    ]);
  });

  it("in a contained Device and in a Bundle entry", () => {
    const device = { resourceType: "Device", id: "zzdev", serialNumber: "ZZSNCONT01" };
    const obs = {
      resourceType: "Observation",
      status: "final",
      code: { text: "zz" },
      contained: [device],
      device: { reference: "#zzdev" },
    };
    const bundle = {
      resourceType: "Bundle",
      type: "collection",
      entry: [{ resource: obs }, { resource: { resourceType: "Device", lotNumber: "ZZLOTBNDL1" } }],
    };
    for (const profile of PROFILES) {
      const { json, manifest } = run(bundle, profile);
      expect(json).not.toContain("ZZSNCONT01");
      expect(json).not.toContain("ZZLOTBNDL1");
      expect(manifest).toContainEqual(
        deviceRow("Bundle.entry[0].resource.contained[0].serialNumber"),
      );
      expect(manifest).toContainEqual(deviceRow("Bundle.entry[1].resource.lotNumber"));
    }
  });

  it("the same element names on another resource are not read as a Device's", () => {
    // `Medication.batch.lotNumber` names a batch of a drug, not one device, and stays as it was.
    const doc = {
      resourceType: "Medication",
      batch: { lotNumber: "ZZMEDLOT01", expirationDate: "2030" },
    };
    for (const profile of PROFILES) {
      const { json, manifest, unexaminedResiduals } = run(doc, profile);
      expect(json).toContain("ZZMEDLOT01");
      expect(manifest).toEqual([]);
      expect(unexaminedResiduals.map((r) => r.locus)).toContain("Medication.batch.lotNumber");
    }
  });

  it("carrierAIDC is removed as category (M) even when the caller keeps base64 content", () => {
    const doc = { resourceType: "Device", udiCarrier: [{ carrierAIDC: AIDC }] };
    for (const profile of PROFILES) {
      const { json, manifest } = run(doc, profile, {
        keepEmbeddedContent: [...FHIR_EMBEDDED_CONTENT_KINDS],
      });
      expect(json).not.toContain(AIDC);
      expect(manifest).toEqual([deviceRow("Device.udiCarrier[0].carrierAIDC")]);
    }
  });

  it("a carrierAIDC that is not base64 is blocked whole, as any misfit is", () => {
    const doc = { resourceType: "Device", udiCarrier: [{ carrierAIDC: "ZZ AIDC not base64" }] };
    for (const profile of PROFILES) {
      const { json, manifest } = run(doc, profile);
      expect(json).not.toContain("ZZ AIDC");
      expect(manifest).toEqual([
        expect.objectContaining({
          locus: "Device.udiCarrier[0].carrierAIDC",
          disposition: "blocked",
        }),
      ]);
      expect(JSON.stringify(manifest)).not.toContain("ZZ AIDC");
    }
  });

  it("a serialNumber's `_`-sibling goes with it", () => {
    const doc = {
      resourceType: "Device",
      serialNumber: "ZZSNSIB001",
      _serialNumber: { id: "zzsib" },
    };
    for (const profile of PROFILES) {
      const { json } = run(doc, profile);
      expect(json).not.toContain("ZZSNSIB001");
      expect(json).not.toContain("zzsib");
      expect(JSON.parse(json)).toEqual({ resourceType: "Device" });
    }
  });

  it("a custom policy that pseudonymizes (M) writes a surrogate in place", () => {
    const policy = defineDeidPolicy({
      name: "zz-device-surrogates",
      transforms: { [SAFE_HARBOR_CATEGORIES.DEVICE]: "pseudonymize" },
    });
    const { json, manifest } = deidentifyFhirJson(
      JSON.stringify({ resourceType: "Device", serialNumber: "ZZSNPSEU01" }),
      { policy, context: ctx },
    );
    const out = JSON.parse(json) as { serialNumber?: unknown };
    expect(json).not.toContain("ZZSNPSEU01");
    expect(typeof out.serialNumber).toBe("string");
    expect(manifest).toEqual([
      expect.objectContaining({
        locus: "Device.serialNumber",
        category: SAFE_HARBOR_CATEGORIES.DEVICE,
        transform: "pseudonymize",
      }),
    ]);
  });
});

describe("the device rule's records", () => {
  it("each is an identifier locus of category (M), written back in place", () => {
    const { resource } = parseResource(
      JSON.stringify({
        resourceType: "Device",
        udiCarrier: [{ carrierAIDC: AIDC }],
        serialNumber: "ZZSNLOCUS1",
      }),
    );
    const { loci, coords } = extractFhirLoci(resource);
    expect(loci).toEqual([
      {
        path: "Device.udiCarrier[0].carrierAIDC",
        kind: "identifier",
        category: SAFE_HARBOR_CATEGORIES.DEVICE,
        value: AIDC,
      },
      {
        path: "Device.serialNumber",
        kind: "identifier",
        category: SAFE_HARBOR_CATEGORIES.DEVICE,
        value: "ZZSNLOCUS1",
      },
    ]);
    expect(coords.map((c) => c.edit)).toEqual(["set-primitive", "set-primitive"]);
  });

  it("a value of a shape R4 does not give the element is blocked whole", () => {
    const { resource } = parseResource(
      JSON.stringify({ resourceType: "Device", serialNumber: { zz: "ZZSNSHAPE1" } }),
    );
    const { loci } = extractFhirLoci(resource);
    expect(loci).toEqual([
      expect.objectContaining({ path: "Device.serialNumber", kind: "unknown" }),
    ]);
  });
});

describe("what the device rule does not reach, as the docs state it", () => {
  it("a DeviceDefinition's UDI device identifier is kept and counted", () => {
    const doc = {
      resourceType: "DeviceDefinition",
      udiDeviceIdentifier: [
        {
          deviceIdentifier: "ZZDEFDI001",
          issuer: "http://hl7.org/fhir/NamingSystem/gs1-di",
          jurisdiction: "http://hl7.org/fhir/NamingSystem/fda-udi",
        },
      ],
    };
    const { json, manifest, unexaminedResiduals } = run(doc, SAFE_HARBOR_PROFILE);
    expect(json).toContain("ZZDEFDI001");
    expect(manifest).toEqual([]);
    expect(unexaminedResiduals.map((r) => r.locus)).toContain(
      "DeviceDefinition.udiDeviceIdentifier[0].deviceIdentifier",
    );
  });

  it("an identifier that names a device from another resource is read as a record number", () => {
    const doc = {
      resourceType: "Observation",
      status: "final",
      code: { text: "zz" },
      device: { identifier: { system: "http://example.org/zz-serial", value: "ZZOBSDEV01" } },
    };
    const row = (transform: string): unknown =>
      expect.objectContaining({
        locus: "Observation.device.identifier.value",
        category: SAFE_HARBOR_CATEGORIES.MRN,
        transform,
      });
    expect(run(doc, SAFE_HARBOR_PROFILE).manifest).toEqual([row("redact")]);
    expect(run(doc, LIMITED_DATA_SET_PROFILE).manifest).toEqual([row("pseudonymize")]);
  });
});
