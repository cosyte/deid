/**
 * The six parser peers are declared at the releases this package is tested on, never wider.
 *
 * A peer range is a promise: every version it admits works with this package. `^0.1.0` admitted
 * releases no job had ever installed. Each range now starts at the release the lowest-peers job
 * (`.github/workflows/peers.yml`, the `lowest` end) installs and runs the full suite on, and the
 * `latest` end installs the highest published release the range admits. `TESTED_FLOOR` below names
 * those floors: lowering one is a claim the lowest-peers job has to prove first, and this file fails
 * when `package.json` and the floor disagree.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  compareVersions,
  highestOf,
  lowestOf,
  parseVersion,
  satisfies,
  type Version,
} from "../scripts/peer-range.js";

interface Manifest {
  peerDependencies: Record<string, string>;
  peerDependenciesMeta: Record<string, { optional?: boolean }>;
  devDependencies: Record<string, string>;
}

const read = (path: string): unknown =>
  JSON.parse(readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8"));

const pkg = read("../package.json") as Manifest;

/** The version of `name` the suite runs against: what the install put in `node_modules`. */
function installed(name: string): string {
  return (read(`../node_modules/${name}/package.json`) as { version: string }).version;
}

const v = (text: string): Version => {
  const parsed = parseVersion(text);
  if (parsed === null) throw new Error(`not a release version: ${text}`);
  return parsed;
};

/** The lowest release of each peer the lowest-peers job installs and passes the full suite on. */
const TESTED_FLOOR: Readonly<Record<string, string>> = {
  "@cosyte/ccda": "0.1.6",
  "@cosyte/dicom": "0.1.11",
  "@cosyte/fhir": "0.1.8",
  "@cosyte/hl7": "0.1.8",
  // The NCPDP refusal of a transmission whose decode carries the transaction count mismatch was
  // written against the 0.1.6 decode, which reads what precedes the first Group Separator as the
  // transmission's own segments. An earlier release decodes that request differently.
  "@cosyte/ncpdp": "0.1.6",
  "@cosyte/x12": "0.1.10",
};

const peers = Object.entries(pkg.peerDependencies);

describe("the range helper", () => {
  it("reads a caret range the way npm does below 1.0", () => {
    expect(satisfies("0.1.8", "^0.1.8")).toBe(true);
    expect(satisfies("0.1.12", "^0.1.8")).toBe(true);
    expect(satisfies("0.1.7", "^0.1.8")).toBe(false);
    expect(satisfies("0.2.0", "^0.1.8")).toBe(false);
    expect(satisfies("1.4.0", "^1.2.3")).toBe(true);
    expect(satisfies("2.0.0", "^1.2.3")).toBe(false);
    expect(satisfies("0.0.3", "^0.0.3")).toBe(true);
    expect(satisfies("0.0.4", "^0.0.3")).toBe(false);
  });

  it("takes either side of a union and names its lowest version", () => {
    expect(satisfies("0.1.9", "^0.1.8 || ^0.2.0")).toBe(true);
    expect(satisfies("0.2.3", "^0.1.8 || ^0.2.0")).toBe(true);
    expect(satisfies("0.3.0", "^0.1.8 || ^0.2.0")).toBe(false);
    expect(lowestOf("^0.2.0 || ^0.1.8")).toBe("0.1.8");
  });

  it("never matches a prerelease or a malformed version, and refuses a range it cannot read", () => {
    expect(satisfies("0.1.9-next.1", "^0.1.8")).toBe(false);
    expect(parseVersion("0.1")).toBeNull();
    expect(() => satisfies("0.1.9", ">=0.1.0")).toThrow(/unsupported range/);
  });

  it("names the highest published version a range admits", () => {
    const published = ["0.1.7", "0.1.8", "0.1.13", "0.1.14-next.0", "0.2.0"];
    expect(highestOf(published, "^0.1.8")).toBe("0.1.13");
    expect(highestOf(published, "^0.3.0")).toBeNull();
  });
});

describe("peer ranges", () => {
  it("declares exactly the six parsers, each optional", () => {
    expect(Object.keys(pkg.peerDependencies).sort()).toEqual(Object.keys(TESTED_FLOOR).sort());
    for (const name of Object.keys(TESTED_FLOOR)) {
      expect(pkg.peerDependenciesMeta[name]?.optional).toBe(true);
    }
  });

  it.each(peers)("%s starts at the release the lowest-peers job proves", (name, range) => {
    expect(lowestOf(range)).toBe(TESTED_FLOOR[name]);
  });

  it("starts @cosyte/ncpdp no lower than the decode the count-mismatch refusal reads", () => {
    const range = pkg.peerDependencies["@cosyte/ncpdp"] ?? "";
    expect(compareVersions(v(lowestOf(range)), v("0.1.6"))).toBeGreaterThanOrEqual(0);
  });

  it.each(peers)("%s has its floor in the installation guide's table", (name, range) => {
    const guide = readFileSync(
      fileURLToPath(new URL("../docs-content/installation.md", import.meta.url)),
      "utf8",
    );
    const row = guide.split("\n").find((line) => line.includes(`| \`${name}\``));
    expect(row).toBeDefined();
    expect(row?.split("|").map((cell) => cell.trim())).toContain(lowestOf(range));
  });

  it.each(peers)("%s admits the release the tests run against", (name, range) => {
    const dev = pkg.devDependencies[name];
    expect(dev).toBeDefined();
    expect(satisfies(installed(name), range)).toBe(true);
    // The tests never install below the range: the dev floor is at or above the peer floor. The
    // peers workflow installs an exact version, so the specifier is a version or a caret range.
    const devFloor = parseVersion(dev ?? "") ?? v(lowestOf(dev ?? ""));
    expect(compareVersions(devFloor, v(lowestOf(range)))).toBeGreaterThanOrEqual(0);
  });
});
