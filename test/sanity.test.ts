import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { VERSION } from "../src/index.js";

const pkg: unknown = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

/** Narrow the parsed manifest without an `as` cast: the sanity test must not lie about its input. */
function manifestVersion(manifest: unknown): string {
  if (typeof manifest !== "object" || manifest === null || !("version" in manifest)) {
    throw new Error("package.json did not parse to an object with a `version` field");
  }
  const { version } = manifest;
  if (typeof version !== "string") throw new Error("package.json `version` is not a string");
  return version;
}

describe("toolchain sanity", () => {
  it("resolves the public entry point and exports VERSION as a string", () => {
    expect(typeof VERSION).toBe("string");
    expect(VERSION.length).toBeGreaterThan(0);
  });

  it("package exports VERSION matching package.json", () => {
    // Compared against package.json, never a hardcoded literal. `changeset version` bumps
    // package.json alone, so a release that skipped `scripts/sync-version.mjs` (wired into the
    // `version` script) would publish a VERSION export that lies about the release. That is exactly
    // how 0.0.6 shipped exporting "0.0.0" - verified in the released tarball - while the two
    // shape-only assertions below stayed green throughout, which is why they were never enough.
    expect(VERSION).toBe(manifestVersion(pkg));
  });

  it("exposes VERSION as a semver-looking string", () => {
    // Shape only, so a bump needs no edit here: the value itself is pinned to package.json above.
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+(?:[.-].+)?$/);
  });
});
