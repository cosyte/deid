/**
 * Child-process helper for the timezone-independence test: shift a fixed zoneless datetime and print
 * the result. Run under two different `TZ` values, the output must be byte-identical. Synthetic value.
 *
 * IT IMPORTS THE TWO SOURCE MODULES DIRECTLY RATHER THAN THE ROOT ENTRY, and that is load-bearing
 * rather than a style choice. `pnpm check:test-selection` requires every module that imports a
 * PUBLISHED ENTRY POINT to be a file vitest actually runs, with no exemption for helpers, because
 * every exemption a sibling repo offered was walked through by a rename. This file is spawned by
 * `test/date-shift-hardening.test.ts`, so it can never be selected; importing the source modules it
 * actually exercises keeps it out of that subject without an exemption existing at all. Same
 * function objects, so the proof is unchanged: the root entry only re-exports these two.
 */
import { createDeidContext } from "../../src/context.js";
import { dateShift } from "../../src/transforms/date-shift.js";

const ctx = createDeidContext({ key: "tz-proof-key", patientId: "patient-1" });
process.stdout.write(String(dateShift("2020-06-15T00:30:00", ctx)));
