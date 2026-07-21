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

/**
 * A parsed date. Only the **calendar-date** portion (Y/M/D) participates in the shift; a datetime's
 * time-of-day and zone travel through untouched as an opaque `suffix`, so the result is **independent
 * of the host machine's timezone** and the original precision/offset is preserved exactly.
 */
interface ParsedDate {
  readonly y: number;
  readonly m: number;
  readonly d: number;
  /** How the date part is re-emitted: hyphenated (ISO) or packed (HL7). */
  readonly style: "iso" | "hl7";
  /** The verbatim time-of-day + zone remainder for a datetime (e.g. `T12:30:45.5+05:00`), else "". */
  readonly suffix: string;
}

/** Two-digit zero-pad. */
function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * Parse a supported date encoding, or `null` (fail closed) if unsupported. Recognizes ISO
 * `YYYY-MM-DD`, HL7 `YYYYMMDD`, and an ISO datetime `YYYY-MM-DDThh:mm[:ss[.sss]][Z|±hh:mm]`. The
 * datetime's time-and-zone remainder is captured verbatim and never interpreted — the shift is a pure
 * calendar-date operation, so the machine timezone can never move the result across a day boundary.
 */
function parseDate(value: string): ParsedDate | null {
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (iso !== null) {
    return fromParts(Number(iso[1]), Number(iso[2]), Number(iso[3]), "iso", "");
  }
  const hl7 = /^(\d{4})(\d{2})(\d{2})$/.exec(value);
  if (hl7 !== null) {
    return fromParts(Number(hl7[1]), Number(hl7[2]), Number(hl7[3]), "hl7", "");
  }
  // ISO datetime: split the calendar date from the time-and-zone remainder, which we carry verbatim.
  const dt =
    /^(\d{4})-(\d{2})-(\d{2})(T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})?)$/.exec(
      value,
    );
  if (dt !== null) {
    return fromParts(Number(dt[1]), Number(dt[2]), Number(dt[3]), "iso", dt[4] ?? "");
  }
  return null;
}

/** Build a date from Y/M/D parts, rejecting invalid calendar dates (e.g. 2019-02-30). */
function fromParts(
  y: number,
  m: number,
  d: number,
  style: "iso" | "hl7",
  suffix: string,
): ParsedDate | null {
  // Validate the calendar date via a UTC probe (no wall-clock/timezone involvement).
  const probe = new Date(Date.UTC(y, m - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) {
    return null;
  }
  return { y, m, d, style, suffix };
}

/** Re-emit a shifted calendar date at the original style, re-attaching the untouched time/zone suffix. */
function format(y: number, m: number, d: number, style: "iso" | "hl7", suffix: string): string {
  const sep = style === "iso" ? "-" : "";
  return `${y}${sep}${pad2(m)}${sep}${pad2(d)}${suffix}`;
}

const MS_PER_DAY = 86_400_000;

/**
 * Shift a date by the context's deterministic per-patient offset, preserving intervals. Supports ISO
 * `YYYY-MM-DD`, HL7 `YYYYMMDD`, and an ISO datetime (`YYYY-MM-DDThh:mm…`). Fails closed (`null`) on an
 * unparseable or invalid date.
 *
 * **Timezone-independent.** Only the calendar-date portion is shifted (via UTC calendar math); a
 * datetime's time-of-day and zone designator are preserved **verbatim**, so the same input yields the
 * same output on every host regardless of the machine's `TZ`. Because the offset is a whole number of
 * days and the clock/zone are untouched, intervals are preserved exactly.
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
  // Shift the calendar date only, using UTC math so no local timezone can nudge the day boundary.
  const shifted = new Date(Date.UTC(parsed.y, parsed.m - 1, parsed.d) + offsetDays * MS_PER_DAY);
  return format(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth() + 1,
    shifted.getUTCDate(),
    parsed.style,
    parsed.suffix,
  );
}
