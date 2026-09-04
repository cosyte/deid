/**
 * The **NCPDP SCRIPT refusal**: the documented non-goal, made into a behaviour a caller can observe
 * and a test can pin.
 *
 * `@cosyte/ncpdp` publishes two NCPDP surfaces. This adapter de-identifies the
 * **Telecommunication (vD.0)** one. It does not de-identify **SCRIPT** (ePrescribing XML), and the
 * reason is a property of that parser surface rather than a gap in this map: `serializeScript` emits
 * **only the modeled fields**, so a parse and re-serialize round-trip drops every unmodeled XML
 * element, and the SCRIPT `Patient` model carries **no address, phone or patient-identifier** field
 * at all. A pass built on that surface would hand back a document a consumer reads as
 * Safe-Harbor-transformed while unmodeled content, patient identifiers included, rode straight
 * through it.
 *
 * Saying so in prose is not the same as doing it. Before this refusal existed, a caller who handed
 * SCRIPT XML to a Telecom entry point got whatever the Telecom parser made of it, not a stated no,
 * which is exactly the false-safety outcome the deferral was written to avoid. So the entry points
 * refuse: a typed {@link "@cosyte/deid".DeidError} carrying `DEID_FORMAT_UNSUPPORTED`, a message that
 * names the format and the parser-surface reason and reads nothing out of the document, and no
 * transformed document, no manifest and no partial output of any kind.
 *
 * **Nothing here reaches into `@cosyte/ncpdp`'s SCRIPT subpath.** Recognition is structural, from the
 * shape of what the caller passed, so refusing costs no dependency on the very surface the refusal is
 * about. A Telecom caller's behaviour is untouched: a parsed `TelecomTransaction` carries a
 * `segments` array and is never a candidate.
 *
 * @packageDocumentation
 */

import { DeidError, FATAL_CODES } from "../codes.js";

/**
 * The refusal diagnostic, in full. Fixed text this library owns: it names the format and states the
 * parser-surface reason, and it carries no value read from the document, no key and no offset, so it
 * is safe to log wherever a `DeidError` message is safe to log.
 *
 * @example
 * ```ts
 * import { NCPDP_SCRIPT_REFUSAL_MESSAGE } from "@cosyte/deid/ncpdp";
 *
 * NCPDP_SCRIPT_REFUSAL_MESSAGE.includes("SCRIPT"); // => true
 * ```
 */
export const NCPDP_SCRIPT_REFUSAL_MESSAGE: string =
  "NCPDP SCRIPT (ePrescribing XML) is refused, not partially handled: its parser surface " +
  "re-serializes only the modeled fields, so a round-trip drops every unmodeled element, and its " +
  "patient model carries no address, phone or patient identifier. A partial structural pass would " +
  "be a false-safety hazard. This entry point de-identifies NCPDP Telecommunication (vD.0) only.";

/** Refuse the input outright with the typed, value-free diagnostic. Never returns. */
function refuseScript(): never {
  throw new DeidError(FATAL_CODES.DEID_FORMAT_UNSUPPORTED, NCPDP_SCRIPT_REFUSAL_MESSAGE);
}

/**
 * `true` when raw text is an **XML document** rather than an NCPDP Telecom transmission.
 *
 * XML is the only shape SCRIPT takes, and a Telecom transmission never takes it: its first bytes are
 * the fixed Transaction Header (a BIN number on a request, a version on a response), so a leading `<`
 * cannot be one. The test is therefore a **format** test and not a SCRIPT-vocabulary test, which is
 * the fail-closed direction: an XML document this library cannot name is still not a Telecom
 * transmission, and guessing at one would be the partial handling the refusal exists to prevent.
 *
 * Leading whitespace is stepped over first, and a leading **byte-order mark** with it: `\s` is
 * ECMAScript's WhiteSpace class, which includes U+FEFF, so the class covers both without spelling an
 * invisible character into this source file. Both are legal in front of an XML declaration.
 *
 * @param raw - The raw text handed to a Telecom entry point.
 * @returns `true` when the text opens as XML.
 * @internal
 */
export function isXmlDocumentText(raw: string): boolean {
  return /^\s*</.test(raw);
}

/**
 * `true` when a parsed model is a **SCRIPT message** rather than a Telecom transaction.
 *
 * Structural, and negative-first so a Telecom caller can never be caught by it: a
 * `TelecomTransaction` carries a `segments` array, and anything carrying one is accepted here
 * whatever else it has. What remains is refused when it carries the SCRIPT message shape, a typed
 * transaction `body`, or the `asNewRx` accessor that model exposes.
 *
 * @param value - Whatever was handed to the model entry point.
 * @returns `true` when the value looks like a SCRIPT message and not a Telecom transaction.
 * @internal
 */
export function isScriptMessageModel(value: unknown): boolean {
  if (value === null || typeof value !== "object") return false;
  const candidate = value as { segments?: unknown; body?: unknown; asNewRx?: unknown };
  if (Array.isArray(candidate.segments)) return false;
  return candidate.body !== undefined || typeof candidate.asNewRx === "function";
}

/**
 * Guard a raw-text Telecom entry point: refuse an XML document before anything is parsed, so no
 * partial output can exist to hand back.
 *
 * @param raw - The raw text handed to the entry point.
 * @throws {@link "@cosyte/deid".DeidError} `DEID_FORMAT_UNSUPPORTED` when the text opens as XML.
 * @internal
 */
export function assertNotScriptText(raw: string): void {
  if (isXmlDocumentText(raw)) refuseScript();
}

/**
 * Guard a model Telecom entry point: refuse a SCRIPT message before any locus is extracted.
 *
 * @param tx - Whatever was handed to the entry point.
 * @throws {@link "@cosyte/deid".DeidError} `DEID_FORMAT_UNSUPPORTED` when the model is a SCRIPT message.
 * @internal
 */
export function assertNotScriptModel(tx: unknown): void {
  if (isScriptMessageModel(tx)) refuseScript();
}
