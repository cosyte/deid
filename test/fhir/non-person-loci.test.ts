/**
 * **FHIR: the name and the address that are not on a person resource.**
 *
 * Which resource carries a person's name is a choice the producing system made, not a fact about the
 * document: the same home address arrives at `Patient.address` from one sender and at
 * `Location.address` from a home-health sender. A pass that decides by enclosing resource type
 * therefore hands a consumer coverage that depends on that choice. This suite pins the other rule: the
 * **element's own R4 datatype** decides, so a `HumanName` is removed and an `Address` is reduced
 * wherever the graph put them, with the same treatment and the same manifest shape a person resource
 * gets.
 *
 * Three halves, because the safe answer is not "act on more":
 *
 * - **Reach.** The name at `Organization.contact.name` and the address at `Location.address` are acted
 *   on, in a flat resource, in a `Bundle` entry and in a `contained` resource, and one manifest entry
 *   carrying the structural locus and no value is recorded for each.
 * - **Fail closed.** A swept `Address` the pass cannot read faithfully is removed **whole**: a
 *   four-digit `postalCode` yields no three-digit fragment, and an unexpected JSON shape at a part
 *   Safe Harbor would let it keep takes the element with it. At an element name R4 **types** as one of
 *   the two datatypes, so does a complex the classifier cannot pin down at all: a text-only
 *   representation, and equally a name or an address carrying a property R4 does not define, which the
 *   closed classification declines and which would otherwise ride out one primitive at a time. The
 *   residual that scoping leaves is asserted here too, so the limitation the package states is pinned
 *   by a test and not only by prose.
 * - **Measurement.** A position the widened sweep now examines leaves `unexaminedResiduals`, every
 *   position it still does not examine stays there, and the per-document totals still add up.
 *
 * Every value is a synthetic, ZZ-tagged sentinel declared in `scripts/phi-allow-list.txt`.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import { parseResource } from "@cosyte/fhir";

import {
  createDeidContext,
  DEID_DISPOSITION_CODES,
  profileOptions,
  SAFE_HARBOR_CATEGORIES,
  SAFE_HARBOR_PROFILE,
  type DeidManifestEntry,
} from "../../src/index.js";
import { deidentifyFhir, deidentifyFhirJson } from "../../src/fhir/index.js";

const C = SAFE_HARBOR_CATEGORIES;
const CODES = DEID_DISPOSITION_CODES;

const ctx = createDeidContext({ key: "non-person-key", patientId: "p-non-person" });
const options = (): ReturnType<typeof profileOptions> => profileOptions(SAFE_HARBOR_PROFILE, ctx);

const FIXTURE = readFileSync(
  join(import.meta.dirname, "..", "fixtures", "fhir", "non-person-loci.json"),
  "utf8",
);

function run(resource: unknown): ReturnType<typeof deidentifyFhirJson> {
  return deidentifyFhirJson(JSON.stringify(resource), options());
}

/** The manifest entries whose locus ends with the given suffix. */
function at(manifest: readonly DeidManifestEntry[], suffix: string): DeidManifestEntry[] {
  return manifest.filter((m) => m.locus.endsWith(suffix));
}

/** Every unexamined-residual locus, and the sum of their counts. */
function residuals(result: ReturnType<typeof deidentifyFhirJson>): {
  loci: string[];
  total: number;
} {
  return {
    loci: result.unexaminedResiduals.map((r) => r.locus),
    total: result.unexaminedResiduals.reduce((sum, r) => sum + r.count, 0),
  };
}

const LOCATION_ADDRESS = {
  line: ["ZZLOCSTREET"],
  city: "ZZLOCCITY",
  district: "ZZLOCCOUNTY",
  state: "MA",
  postalCode: "01103",
};

describe("a person name on a resource whose type is not a person type", () => {
  it("removes the HumanName at Organization.contact.name and records ONE named locus, value-free", () => {
    const { json, manifest } = run({
      resourceType: "Organization",
      id: "org1",
      name: "ZZORGOWNNAME",
      contact: [{ name: { family: "ZZORGCONTACTFAM", given: ["ZZORGCONTACTGIV"] } }],
    });

    expect(json).not.toContain("ZZORGCONTACTFAM");
    expect(json).not.toContain("ZZORGCONTACTGIV");

    const entries = at(manifest, "contact[0].name");
    expect(entries).toHaveLength(1);
    expect(entries[0]?.locus).toBe("Organization.contact[0].name");
    expect(entries[0]?.category).toBe(C.NAMES);
    expect(entries[0]?.disposition).toBe("removed");
    expect(entries[0]?.code).toBe(CODES.DEID_CATEGORY_REMOVED);
    // Value-free: the manifest names the position and never the name that sat there.
    expect(JSON.stringify(manifest)).not.toContain("ZZORGCONTACTFAM");
  });

  it("reaches the same name inside a Bundle entry and inside a contained resource", () => {
    const contact = [{ name: { family: "ZZORGCONTACTFAM" } }];
    const bundle = run({
      resourceType: "Bundle",
      type: "collection",
      entry: [{ resource: { resourceType: "Organization", name: "ZZORGOWNNAME", contact } }],
    });
    expect(bundle.json).not.toContain("ZZORGCONTACTFAM");
    expect(at(bundle.manifest, "contact[0].name")[0]?.locus).toBe(
      "Bundle.entry[0].resource.contact[0].name",
    );

    const contained = run({
      resourceType: "Encounter",
      status: "finished",
      contained: [{ resourceType: "Organization", name: "ZZORGOWNNAME", contact }],
    });
    expect(contained.json).not.toContain("ZZORGCONTACTFAM");
    expect(at(contained.manifest, "contact[0].name")[0]?.locus).toBe(
      "Encounter.contained[0].contact[0].name",
    );
  });

  it("removes a repeating name element per occurrence, each at its own locus", () => {
    const { json, manifest } = run({
      resourceType: "Organization",
      contact: [
        { name: { family: "ZZORGCONTACTFAM" } },
        { name: [{ family: "ZZORGCONTACTGIV" }, { family: "ZZLOCNAME" }] },
      ],
    });
    expect(json).not.toContain("ZZORGCONTACTFAM");
    expect(json).not.toContain("ZZORGCONTACTGIV");
    expect(json).not.toContain("ZZLOCNAME");
    expect(manifest.map((m) => m.locus)).toEqual([
      "Organization.contact[0].name",
      "Organization.contact[1].name[0]",
      "Organization.contact[1].name[1]",
    ]);
    for (const entry of manifest) expect(entry.category).toBe(C.NAMES);
  });
});

describe("a postal address on a resource whose type is not a person type", () => {
  it("reduces Location.address to EXACTLY what the same address gets on a person resource", () => {
    const location = run({ resourceType: "Location", address: LOCATION_ADDRESS });
    const patient = run({ resourceType: "Patient", address: [LOCATION_ADDRESS] });

    const locAddress: unknown = (JSON.parse(location.json) as { address?: unknown }).address;
    const patAddresses = (JSON.parse(patient.json) as { address?: unknown[] }).address ?? [];

    // The worked case: no street, no city, no county, and the same ZIP treatment.
    expect(locAddress).toEqual({ state: "MA", postalCode: "011" });
    expect(locAddress).toEqual(patAddresses[0]);
    expect(location.json).not.toContain("ZZLOCSTREET");
    expect(location.json).not.toContain("ZZLOCCITY");
    expect(location.json).not.toContain("ZZLOCCOUNTY");

    // And the manifest row is the same row, at the position the address actually occupied.
    const locEntry = at(location.manifest, "address")[0];
    const patEntry = at(patient.manifest, "address")[0];
    expect(locEntry?.locus).toBe("Location.address");
    expect(locEntry?.category).toBe(C.GEOGRAPHIC);
    expect(locEntry?.disposition).toBe(patEntry?.disposition);
    expect(locEntry?.code).toBe(patEntry?.code);
    expect(JSON.stringify(location.manifest)).not.toContain("ZZLOCSTREET");
  });

  it("substitutes 000 for a restricted three-digit prefix, exactly as a person address does", () => {
    const address = { line: ["ZZORGCONTACTSTREET"], state: "NH", postalCode: "03601" };
    const org = run({ resourceType: "Organization", contact: [{ address }] });
    const patient = run({ resourceType: "Patient", address: [address] });

    expect(JSON.parse(org.json)).toEqual({
      resourceType: "Organization",
      contact: [{ address: { state: "NH", postalCode: "000" } }],
    });
    expect((JSON.parse(patient.json) as { address: unknown[] }).address[0]).toEqual({
      state: "NH",
      postalCode: "000",
    });
    expect(at(org.manifest, "contact[0].address")[0]?.code).toBe(CODES.DEID_CATEGORY_GENERALIZED);
  });

  it("reaches an Address element R4 does not name `address` (a choice-type locationAddress)", () => {
    const { json, manifest } = run({
      resourceType: "Claim",
      status: "active",
      accident: { locationAddress: { line: ["ZZLOCSTREET"], city: "ZZLOCCITY", state: "MA" } },
    });
    // The datatype decides, so an Address under a name no rule lists is still an Address.
    expect(json).not.toContain("ZZLOCSTREET");
    expect(json).not.toContain("ZZLOCCITY");
    expect(manifest.map((m) => m.locus)).toEqual(["Claim.accident.locationAddress"]);
    expect(manifest[0]?.category).toBe(C.GEOGRAPHIC);
  });

  it("keeps the state and the country of a swept address, the parts Safe Harbor permits", () => {
    const { json } = run({
      resourceType: "Location",
      address: { line: ["ZZLOCSTREET"], state: "MA", country: "US", postalCode: "02138" },
    });
    expect(JSON.parse(json)).toEqual({
      resourceType: "Location",
      address: { state: "MA", country: "US", postalCode: "021" },
    });
  });
});

describe("fail closed: a newly reached element the pass cannot handle faithfully", () => {
  it("retains NO ZIP fragment when the postalCode is not a whole zip code (0110, four digits)", () => {
    const { json, manifest } = run({
      resourceType: "Location",
      address: {
        line: ["ZZLOCSTREET"],
        city: "ZZLOCCITY",
        state: "MA",
        country: "US",
        postalCode: "0110",
      },
    });
    // The whole element goes: not the street, not the city, not the state, not a partial prefix.
    expect(JSON.parse(json)).toEqual({ resourceType: "Location" });
    expect(json).not.toContain("011");
    expect(json).not.toContain("postalCode");
    expect(json).not.toContain("ZZLOCSTREET");
    // And the disposition is recorded rather than silent.
    expect(manifest).toHaveLength(1);
    expect(manifest[0]?.locus).toBe("Location.address");
    expect(manifest[0]?.category).toBe(C.GEOGRAPHIC);
    expect(manifest[0]?.disposition).toBe("blocked");
    expect(manifest[0]?.code).toBe(CODES.DEID_LOCUS_BLOCKED);
  });

  it("CONTROL: the same address with a whole zip code is reduced, not blocked", () => {
    const { json, manifest } = run({
      resourceType: "Location",
      address: {
        line: ["ZZLOCSTREET"],
        city: "ZZLOCCITY",
        state: "MA",
        country: "US",
        postalCode: "01103",
      },
    });
    expect(JSON.parse(json)).toEqual({
      resourceType: "Location",
      address: { state: "MA", country: "US", postalCode: "011" },
    });
    expect(manifest[0]?.disposition).toBe("transformed");
  });

  it("blocks the whole element when a part it would keep verbatim is not a plain value", () => {
    const { json, manifest } = run({
      resourceType: "Location",
      address: {
        city: "ZZLOCCITY",
        // An unexpected JSON shape where R4 types a string: the applier re-emits a kept part
        // verbatim, so anything riding inside one would leave the pass unread.
        state: { coding: [{ code: "MA", display: "ZZLOCNAME" }] },
        postalCode: "01103",
      },
    });
    expect(JSON.parse(json)).toEqual({ resourceType: "Location" });
    expect(json).not.toContain("ZZLOCNAME");
    expect(json).not.toContain("ZZLOCCITY");
    expect(manifest[0]?.disposition).toBe("blocked");
  });

  it("blocks a HumanName carrying a property R4 does not define, at a typed position", () => {
    // The marker says a person's name is in here; the unrecognized sibling says the pass cannot read
    // the structure it was promised. Descending would hand `family` and `given` to the output one
    // primitive at a time, which is the shape of leak this rule exists to stop.
    const { json, manifest } = run({
      resourceType: "Organization",
      name: "ZZORGOWNNAME",
      contact: [
        { name: { family: "ZZORGCONTACTFAM", given: ["ZZORGCONTACTGIV"], nickname: "ZZLOCNAME" } },
      ],
    });
    expect(json).not.toContain("ZZORGCONTACTFAM");
    expect(json).not.toContain("ZZORGCONTACTGIV");
    expect(json).not.toContain("ZZLOCNAME"); // the unrecognized sibling goes with the element
    expect(json).toContain("ZZORGOWNNAME"); // the organisation's own name is a string, untouched
    expect(manifest.map((m) => `${m.locus} ${m.disposition}`)).toEqual([
      "Organization.contact[0].name blocked",
    ]);
  });

  it("blocks an Address carrying a property R4 does not define, and keeps no ZIP fragment", () => {
    const { json, manifest } = run({
      resourceType: "Location",
      address: {
        line: ["ZZLOCSTREET"],
        city: "ZZLOCCITY",
        state: "MA",
        postalCode: "01103",
        county: "ZZLOCCOUNTY",
      },
    });
    expect(JSON.parse(json)).toEqual({ resourceType: "Location" });
    expect(json).not.toContain("011");
    expect(manifest.map((m) => `${m.locus} ${m.disposition}`)).toEqual([
      "Location.address blocked",
    ]);
  });

  it("reaches the same unreadable name inside a Bundle entry", () => {
    const { json, manifest } = run({
      resourceType: "Bundle",
      type: "collection",
      entry: [
        {
          resource: {
            resourceType: "Organization",
            contact: [{ name: { family: "ZZORGCONTACTFAM", nickname: "ZZLOCNAME" } }],
          },
        },
      ],
    });
    expect(json).not.toContain("ZZORGCONTACTFAM");
    expect(manifest.map((m) => m.locus)).toEqual(["Bundle.entry[0].resource.contact[0].name"]);
  });

  it("blocks a text-only Address at a choice-type locationAddress, the R4 name for that arm", () => {
    // F4's position: R4 types `Claim.accident.location[x]` as an Address, so a text-only form there is
    // an address the pass cannot key on, and the enumeration of typed element names carries the name.
    const { json, manifest } = run({
      resourceType: "Claim",
      status: "active",
      accident: { locationAddress: { text: "ZZLOCSTREET, ZZLOCCITY MA 01103" } },
    });
    expect(json).not.toContain("ZZLOCSTREET");
    expect(json).not.toContain("ZZLOCCITY");
    expect(manifest.map((m) => `${m.locus} ${m.disposition}`)).toEqual([
      "Claim.accident.locationAddress blocked",
    ]);
  });

  it("blocks a HumanName at an open value[x] arm R4 types as one", () => {
    const { json, manifest } = run({
      resourceType: "Task",
      status: "requested",
      intent: "order",
      input: [{ type: { text: "requester" }, valueHumanName: { text: "ZZORGCONTACTFAM" } }],
    });
    expect(json).not.toContain("ZZORGCONTACTFAM");
    expect(manifest.map((m) => `${m.locus} ${m.disposition}`)).toEqual([
      "Task.input[0].valueHumanName blocked",
    ]);
  });

  it("blocks a personal-datatype shape the classifier cannot pin down at a typed position", () => {
    const { json, manifest } = run({
      resourceType: "Organization",
      name: "ZZORGOWNNAME",
      contact: [{ name: { use: "official", text: "ZZORGCONTACTFAM ZZORGCONTACTGIV" } }],
      address: [{ text: "ZZORGSTREET, ZZORGCITY" }],
    });
    // A text-only name or address carries no marker the classifier can key on, and R4 types these two
    // positions as a HumanName and an Address, so the pass blocks rather than descends.
    expect(json).not.toContain("ZZORGCONTACTFAM");
    expect(json).not.toContain("ZZORGSTREET");
    expect(json).not.toContain("ZZORGCITY");
    // The organisation's OWN name is a plain string, not a HumanName, and is untouched.
    expect(json).toContain("ZZORGOWNNAME");
    expect(manifest.map((m) => `${m.locus} ${m.disposition}`)).toEqual([
      "Organization.contact[0].name blocked",
      "Organization.address blocked",
    ]);
  });

  it("leaves an EMPTY object at a typed position alone: there is nothing there to leak", () => {
    const { json, manifest } = run({ resourceType: "Location", id: "loc1", address: {} });
    expect(JSON.parse(json)).toEqual({ resourceType: "Location", id: "loc1", address: {} });
    expect(manifest).toEqual([]);
  });

  it("walks the unclaimed items of a list that mixes a swept element with something else", () => {
    const { json, manifest, unexaminedResiduals } = run({
      resourceType: "Organization",
      address: [
        { line: ["ZZORGSTREET"], city: "ZZORGCITY", state: "MA", postalCode: "02138" },
        // Not a personal datatype: no marker, and `description` is on neither property set. The item
        // beside it being swept must not take this one with it, in either direction.
        { description: "ZZLOCNAME", effectiveDateTime: "2019-03-14" },
      ],
    });
    expect(json).not.toContain("ZZORGSTREET");
    expect(json).not.toContain("ZZORGCITY");
    expect(json).toContain("ZZLOCNAME"); // walked, not swept
    expect(json).toContain('"effectiveDateTime":"2019"'); // and its universal date rule still ran
    expect(manifest.map((m) => `${m.locus} ${m.category}`)).toEqual([
      "Organization.address[0] GEOGRAPHIC",
      "Organization.address[1].effectiveDateTime DATES",
    ]);
    expect(unexaminedResiduals.map((r) => r.locus)).toEqual([
      "Organization.address[1].description",
    ]);
  });

  it("STATED RESIDUAL: an unreadable name shape at a position R4 does NOT type is left alone", () => {
    // The limit the package states rather than hides. `Questionnaire.item` carries `prefix` (a
    // HumanName marker) beside `linkId` (a property no personal datatype defines), and blocking that
    // shape wherever it appears would destroy conformant structural and clinical content. So outside
    // the enumerated typed element names the pass declines, counts the positions as unexamined, and
    // says so in `docs-content/limitations.md`.
    const { json, manifest, unexaminedResiduals } = run({
      resourceType: "Claim",
      status: "active",
      accident: {
        vendorLocation: { line: ["ZZLOCSTREET"], city: "ZZLOCCITY", county: "ZZLOCCOUNTY" },
      },
    });
    expect(json).toContain("ZZLOCSTREET");
    expect(manifest).toEqual([]);
    // Honest about it: every position it declined is on the unexamined inventory.
    expect(unexaminedResiduals.map((r) => r.locus)).toEqual([
      "Claim.status",
      "Claim.accident.vendorLocation.line[0]",
      "Claim.accident.vendorLocation.city",
      "Claim.accident.vendorLocation.county",
    ]);
  });

  it("leaves the same ambiguous shape alone at a position R4 does not type as one of these", () => {
    // `{ text }` at a coded element is a CodeableConcept carrying only its text: an Observation code,
    // a dose unit and an order status all take that shape, and scrubbing one destroys clinical meaning.
    const { json, manifest } = run({
      resourceType: "Observation",
      status: "final",
      code: { text: "Sodium" },
      valueCodeableConcept: { text: "Normal" },
    });
    expect(json).toContain("Sodium");
    expect(json).toContain("Normal");
    expect(json).toContain('"status":"final"');
    expect(manifest).toEqual([]);
  });
});

describe("the residual inventory after the sweep widened", () => {
  const withSwept = run({
    resourceType: "Location",
    id: "loc1",
    status: "active",
    name: "ZZLOCNAME",
    address: LOCATION_ADDRESS,
  });
  const withoutAddress = run({
    resourceType: "Location",
    id: "loc1",
    status: "active",
    name: "ZZLOCNAME",
  });
  const withUnsweptShape = run({
    resourceType: "Location",
    id: "loc1",
    status: "active",
    name: "ZZLOCNAME",
    // Not a personal datatype at all: no marker, and `description` is on neither property set, so the
    // sweep declines it and the walk descends exactly as it always did.
    address: { description: "ZZLOCSTREET" },
  });

  it("a position the sweep now examines is no longer reported as unexamined", () => {
    for (const locus of residuals(withSwept).loci) {
      expect(locus.startsWith("Location.address")).toBe(false);
    }
    expect(at(withSwept.manifest, "address")).toHaveLength(1);
  });

  it("and every position it still does not examine is still reported", () => {
    expect(residuals(withSwept).loci).toEqual(["Location.id", "Location.status", "Location.name"]);
  });

  it("so the two counts for one document sum to the same total as before", () => {
    // The swept address contributes NO unexamined position (the pass examined it and says so in the
    // manifest), which is exactly the total the same document without that element measures.
    expect(residuals(withSwept).total).toBe(residuals(withoutAddress).total);
    // NON-VACUITY: an element at the same position that the sweep does NOT reach still contributes
    // its positions, so the equality above is a measurement rather than an enumeration that stopped.
    expect(residuals(withUnsweptShape).total).toBe(residuals(withoutAddress).total + 1);
    expect(residuals(withUnsweptShape).loci).toContain("Location.address.description");
    expect(withUnsweptShape.manifest).toEqual([]);
  });

  it("nothing beneath a swept element is enumerated, and no record carries a value", () => {
    const org = run({
      resourceType: "Organization",
      contact: [{ name: { family: "ZZORGCONTACTFAM", given: ["ZZORGCONTACTGIV"] } }],
    });
    for (const locus of residuals(org).loci) {
      expect(locus.startsWith("Organization.contact[0].name")).toBe(false);
    }
    const serialized = JSON.stringify(org.unexaminedResiduals);
    for (const sentinel of ["ZZORGCONTACTFAM", "ZZORGCONTACTGIV"]) {
      expect(serialized).not.toContain(sentinel);
    }
  });
});

describe("the committed non-person fixture, end to end", () => {
  const { resource } = parseResource(FIXTURE);
  const { document, manifest, unexaminedResiduals } = deidentifyFhir(resource, options());

  it("acts on every name- and address-typed element it carries, and nothing else", () => {
    expect(manifest.map((m) => `${m.locus} ${m.category}`)).toEqual([
      "Bundle.entry[0].resource.address GEOGRAPHIC",
      "Bundle.entry[0].resource.contact[0].name NAMES",
      "Bundle.entry[0].resource.contact[0].address GEOGRAPHIC",
      "Bundle.entry[1].resource.address GEOGRAPHIC",
    ]);
  });

  it("leaves the organisation's own name, its telecom and the clinical values in place", () => {
    const json = JSON.stringify(document);
    for (const survivor of [
      "ZZORGOWNNAME",
      "ZZORGTYPEDISPLAY",
      "555-000-8881",
      "555-000-8882",
      "ZZLOCNAME",
      "2951-2",
      "mmol/L",
      "final",
      "Organization/org1",
      "Patient/pat9",
    ]) {
      expect(json).toContain(survivor);
    }
  });

  it("keeps the audit trail value-free, in both lists", () => {
    const trail = JSON.stringify({ manifest, unexaminedResiduals });
    for (const sentinel of [
      "ZZORGCONTACTFAM",
      "ZZORGCONTACTGIV",
      "ZZORGCONTACTSTREET",
      "ZZORGCONTACTCITY",
      "ZZORGSTREET",
      "ZZORGCITY",
      "ZZLOCSTREET",
      "ZZLOCCITY",
      "ZZLOCCOUNTY",
    ]) {
      expect(trail).not.toContain(sentinel);
    }
  });
});
