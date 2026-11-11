#!/usr/bin/env tsx
/**
 * scripts/peer-ends.ts
 *
 * Prints one end of every parser peer's range, as `name@version` specifiers published on npm, one
 * per line:
 *
 *   tsx scripts/peer-ends.ts lowest   the lowest version each range admits
 *   tsx scripts/peer-ends.ts latest   the highest published version each range admits
 *
 * The peers workflow installs every peer at one end and runs the full suite, so both ends of each
 * range are proved, not only the version the lockfile pins.
 *
 * `lowest` refuses when npm does not carry a range's floor. `latest` also refuses when the release
 * npm tags `latest` is outside the range: a consumer who installs the peer today gets that release,
 * and a range that refuses it is the defect this check exists to catch (npm reports it to the
 * consumer as ERESOLVE).
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { highestOf, lowestOf, satisfies } from "./peer-range.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function refuse(message: string): never {
  console.error(`peer-ends: ${message}`);
  process.exit(1);
}

/** `npm view <name> <field> --json`, parsed. */
function npmView(name: string, field: string): unknown {
  const run = spawnSync("npm", ["view", name, field, "--json"], { encoding: "utf8" });
  if (run.status !== 0) refuse(`npm view ${name} ${field} failed:\n${run.stderr}`);
  return JSON.parse(run.stdout) as unknown;
}

const [end] = process.argv.slice(2);
if (end !== "lowest" && end !== "latest") refuse("usage: tsx scripts/peer-ends.ts lowest|latest");

const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
  peerDependencies?: Record<string, string>;
};
const peers = Object.entries(pkg.peerDependencies ?? {});
if (peers.length === 0) refuse("package.json declares no peer dependency");

const specs: string[] = [];
for (const [name, range] of peers) {
  const listed = npmView(name, "versions");
  const published = Array.isArray(listed) ? listed.map(String) : [String(listed)];
  if (end === "lowest") {
    const lowest = lowestOf(range);
    if (!published.includes(lowest))
      refuse(`${name} ${range} starts at ${lowest}, which npm does not carry`);
    specs.push(`${name}@${lowest}`);
  } else {
    const tagged = String(npmView(name, "dist-tags.latest"));
    if (!satisfies(tagged, range)) {
      refuse(
        `${name} ${tagged} is the release npm installs, and the peer range ${range} refuses it`,
      );
    }
    const latest = highestOf(published, range);
    if (latest === null) refuse(`no published ${name} satisfies ${range}`);
    specs.push(`${name}@${latest}`);
  }
}
console.log(specs.join("\n"));
