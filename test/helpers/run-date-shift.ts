/**
 * Child-process helper for the timezone-independence test: shift a fixed zoneless datetime and print
 * the result. Run under two different `TZ` values, the output must be byte-identical. Synthetic value.
 */
import { createDeidContext, dateShift } from "../../src/index.js";

const ctx = createDeidContext({ key: "tz-proof-key", patientId: "patient-1" });
process.stdout.write(String(dateShift("2020-06-15T00:30:00", ctx)));
