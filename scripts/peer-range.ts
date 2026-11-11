/**
 * scripts/peer-range.ts
 *
 * The small part of npm's range grammar this repository's peer ranges use: caret ranges joined by
 * `||`. It exists so the peer-range test and the peers workflow can ask which versions a range
 * admits without a semver dependency. Anything else in a range throws, so a range written in a
 * form this file does not read fails loudly instead of matching by accident.
 */

/** A release version as three numbers. Prereleases and build metadata are not releases. */
export type Version = readonly [number, number, number];

const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const CARET = /^\^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

/** `x.y.z` as numbers, or `null` for anything else (a prerelease included). */
export function parseVersion(text: string): Version | null {
  const m = VERSION.exec(text.trim());
  return m === null ? null : [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** Negative, zero or positive as `a` sorts before, with or after `b`. */
export function compareVersions(a: Version, b: Version): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

/** The floor and the exclusive ceiling of one caret range, as npm reads it. */
function caretBounds(part: string): [Version, Version] {
  const m = CARET.exec(part.trim());
  if (m === null) throw new Error(`unsupported range \`${part.trim()}\`: only ^x.y.z joined by ||`);
  const floor: Version = [Number(m[1]), Number(m[2]), Number(m[3])];
  const [major, minor, patch] = floor;
  if (major > 0) return [floor, [major + 1, 0, 0]];
  if (minor > 0) return [floor, [0, minor + 1, 0]];
  return [floor, [0, 0, patch + 1]];
}

/** Each caret range of a `||` union, as its floor and exclusive ceiling. */
function bounds(range: string): [Version, Version][] {
  return range.split("||").map(caretBounds);
}

/** Whether `version` is a release the range admits. */
export function satisfies(version: string, range: string): boolean {
  const all = bounds(range);
  const v = parseVersion(version);
  if (v === null) return false;
  return all.some(([lo, hi]) => compareVersions(v, lo) >= 0 && compareVersions(v, hi) < 0);
}

/** The lowest version the range admits: the smallest floor of its parts. */
export function lowestOf(range: string): string {
  const floors = bounds(range).map(([lo]) => lo);
  floors.sort(compareVersions);
  return (floors[0] as Version).join(".");
}

/** The highest of `versions` the range admits, or `null` when it admits none of them. */
export function highestOf(versions: readonly string[], range: string): string | null {
  const admitted = versions.filter((v) => satisfies(v, range));
  admitted.sort((a, b) => compareVersions(parseVersion(a) as Version, parseVersion(b) as Version));
  return admitted.at(-1) ?? null;
}
