/**
 * The five de-identification transforms, re-exported. Each is a pure, `node:crypto`-backed unit; the
 * keyed transforms take a {@link DeidContext} that carries the consumer's key and never leaks it.
 *
 * @packageDocumentation
 */

export { redact } from "./redact.js";
export {
  generalizeDate,
  generalizeZip,
  generalizeAge,
  type GeneralizeOutcome,
} from "./generalize.js";
export { dateShift } from "./date-shift.js";
export { pseudonymize, keyedHash, unkeyedHash } from "./pseudonymize.js";
