/**
 * Which runtime and system the suite is running on, for the few tests that cannot run on one of
 * them. CI runs the suite on Node.js on Linux, macOS and Windows, and again under Bun on Linux; a
 * case skipped under Deno is ready for the day the `deno` job is turned on (see `ci.yml`). A test
 * skipped on one of them names the runtime or system and says why at its own site, so the list of
 * what does not run where is read off the tests.
 */

/** The JavaScript runtime the suite is running under. */
export const RUNTIME: "bun" | "deno" | "node" =
  "Bun" in globalThis ? "bun" : "Deno" in globalThis ? "deno" : "node";

/** Whether the suite is running on Windows. */
export const ON_WINDOWS = process.platform === "win32";
