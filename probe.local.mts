import { parseHL7 } from "@cosyte/hl7";
import { deidentifyHl7 } from "./src/hl7/index.js";
import { createDeidContext, SAFE_HARBOR_PROFILE, LIMITED_DATA_SET_PROFILE, profileOptions } from "./src/index.js";

const wire = [
  "MSH|^~\\&|A|B|C|D|20200101120000||ADT^A01|M1|P|2.5",
  "PID|1||ZZMRN001^^^HOSP^MR||ZZFAM^ZZGIV||19850302|F",
  "PV1|1|I|WARD^ROOM^BED|||||ATTEND^DOCFAMILY^DOCGIVEN|||||||||||ZZVISIT999^^^HOSP^VN|||||||||||||||||||||||||20200103040500|20200109060700",
  "OBR|1|ZZPLACER777|ZZFILLER888|2951-2^Sodium^LN|||20200104080000",
  "ORC|NW|ZZPLACER777|ZZFILLER888",
  "DG1|1|I10|E11.9^Type 2 diabetes^I10||20200105090000",
].join("\r");

const ctx = createDeidContext({ key: "probe-key", patientId: "p1" });

for (const [label, profile] of [["safe-harbor", SAFE_HARBOR_PROFILE], ["limited-data-set", LIMITED_DATA_SET_PROFILE]] as const) {
  const { document, manifest } = deidentifyHl7(parseHL7(wire), profileOptions(profile, ctx));
  const out = document.toString();
  console.log(`\n=== ${label} ===`);
  const sentinels = {
    "PV1-19 visit number": "ZZVISIT999",
    "PV1-44 admit date": "20200103040500",
    "PV1-45 discharge date": "20200109060700",
    "OBR-7 observation date": "20200104080000",
    "DG1-5 diagnosis date": "20200105090000",
    "placer order number": "ZZPLACER777",
    "filler order number": "ZZFILLER888",
  };
  for (const [name, s] of Object.entries(sentinels)) {
    console.log(`  ${out.includes(s) ? "SURVIVES" : "gone    "}  ${name}`);
  }
  console.log("  manifest:", manifest.map((m) => `${m.locus}:${m.disposition}`).join(" "));
  console.log("  wire:", out.split("\r").join("\n        "));
}
