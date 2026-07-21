/**
 * The **date-shifting** transform — shift every date for a patient by a **single consistent
 * per-patient offset**, preserving intervals while destroying the absolute calendar position (the
 * MIMIC longitudinal-research methodology).
 *
 * The offset is **deterministic per patient** (derived from the context's key/seed and patient scope,
 * so the same patient shifts identically across every document and run) and the **offset is never
 * leaked** — it is applied here and never returned to the caller or written to the manifest.
 *
 * **Honesty note (§164.514):** a shifted-but-real date is still "an element of a date," so
 * date-shifting is an **Expert-Determination-supporting** technique, **not** Safe Harbor. Under a
 * `safe-harbor` policy, dates are generalized to year instead (see `generalizeDate`).
 *
 * @packageDocumentation
 */

import { type DeidContext, deriveShiftDays } from "../context.js";

const MS_PER_DAY = 86_400_000;

/** A parsed date plus the precision to re-emit it at. */
interface ParsedDate {
  readonly epochMs: number;
  readonly precision: "iso-date" | "hl7-date" | "datetime";
}

/** Two-digit zero-pad. */
function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** Parse a supported date encoding to an epoch + precision, or `null` (fail closed) if unsupported. */
function parseDate(value: string): ParsedDate | null {
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (iso !== null) {
    return fromParts(Number(iso[1]), Number(iso[2]), Number(iso[3]), "iso-date");
  }
  const hl7 = /^(\d{4})(\d{2})(\d{2})$/.exec(value);
  if (hl7 !== null) {
    return fromParts(Number(hl7[1]), Number(hl7[2]), Number(hl7[3]), "hl7-date");
  }
  if (value.includes("T")) {
    const ms = Date.parse(value);
    if (!Number.isNaN(ms)) {
      return { epochMs: ms, precision: "datetime" };
    }
  }
  return null;
}

/** Build a UTC date from Y/M/D parts, rejecting invalid calendar dates (e.g. 2019-02-30). */
function fromParts(
  y: number,
  m: number,
  d: number,
  precision: "iso-date" | "hl7-date",
): ParsedDate | null {
  const epochMs = Date.UTC(y, m - 1, d);
  const check = new Date(epochMs);
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) {
    return null;
  }
  return { epochMs, precision };
}

/** Re-emit a shifted instant at the original precision. */
function format(epochMs: number, precision: ParsedDate["precision"]): string {
  const d = new Date(epochMs);
  if (precision === "datetime") {
    return d.toISOString();
  }
  const ymd = `${d.getUTCFullYear()}${precision === "iso-date" ? "-" : ""}${pad2(d.getUTCMonth() + 1)}${
    precision === "iso-date" ? "-" : ""
  }${pad2(d.getUTCDate())}`;
  return ymd;
}

/**
 * Shift a date by the context's deterministic per-patient offset, preserving intervals. Supports ISO
 * `YYYY-MM-DD`, HL7 `YYYYMMDD`, and full ISO datetime (`…T…`). Fails closed (`null`) on an
 * unparseable or invalid date.
 *
 * The **offset is not returned** — only the shifted value is. Two dates for the same patient move by
 * the same amount, so the number of days between them is unchanged.
 *
 * @param value - The date value to shift.
 * @param ctx - The de-identification context (must carry a `patientId` scope for the offset).
 * @returns The shifted date at the original precision, or `null` if it could not be parsed.
 * @throws {@link DeidError} with code `DEID_NO_KEY` if the context has no per-patient scope.
 * @example
 * ```ts
 * import { dateShift, createDeidContext } from "@cosyte/deid";
 *
 * const ctx = createDeidContext({ key: "secret", patientId: "patient-1" });
 * const a = dateShift("2020-01-01", ctx);
 * const b = dateShift("2020-01-11", ctx);
 * // a and b are shifted, but remain exactly 10 days apart.
 * ```
 */
export function dateShift(value: string, ctx: DeidContext): string | null {
  const parsed = parseDate(value);
  if (parsed === null) {
    return null;
  }
  const offsetDays = deriveShiftDays(ctx);
  return format(parsed.epochMs + offsetDays * MS_PER_DAY, parsed.precision);
}
