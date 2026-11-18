// Course conditions: freshness is derived from the measurement time and the club's rule, never from
// when a page fetched the data (brief sections 26-27).
import { bkkDate, bkkInstant, DomainError } from "./util.js";

export const FRESHNESS = ["CURRENT", "AGING", "STALE", "NOT_MEASURED"];

export function freshness(reading, now, rules) {
  if (!reading) return "NOT_MEASURED";
  if (now > reading.validUntil) return "STALE";
  if (now - reading.measuredAt > rules.agingAfterHours * 3600e3) return "AGING";
  return "CURRENT";
}

/** The latest valid published course-wide reading: by measurement time, not by record order. */
export function latestReading(readings, scope = "course") {
  return readings.filter((r) => r.status === "PUBLISHED" && r.scope === scope).sort((a, b) => b.measuredAt - a.measuredAt)[0] || null;
}

/** Readings are stored in decimal feet. 10.5 ft is ten and a half feet, not 10 ft 5 in. */
export function toDecimalFeet(input) {
  if (input == null || input === "") throw new DomainError("INVALID", "Enter a reading", { field: "value" });
  if (typeof input === "number") return input;
  const s = String(input).trim();
  const fi = /^(\d+)\s*(?:ft|')\s*(\d+(?:\.\d+)?)\s*(?:in|")?$/i.exec(s);
  if (fi) return +(Number(fi[1]) + Number(fi[2]) / 12).toFixed(2);
  const n = Number(s.replace(",", "."));
  if (!Number.isFinite(n)) throw new DomainError("INVALID", "The reading must be a number of feet, such as 10.5", { field: "value" });
  return n;
}

export function validateReading(input, now, rules) {
  const errors = {};
  const warnings = [];
  if (!Number.isFinite(input.measuredAt)) errors.measuredAt = "required";
  else if (input.measuredAt > now + 5 * 60e3) errors.measuredAt = "future";
  let value = null, range = null;
  try {
    if (input.range && input.range.length === 2) { range = input.range.map(toDecimalFeet).sort((a, b) => a - b); }
    else value = toDecimalFeet(input.value);
  } catch (e) { errors.value = e.message; }
  const [lo, hi] = rules.plausibleFeet;
  const check = range || (value != null ? [value] : []);
  if (check.some((v) => v < lo || v > hi)) warnings.push("outside-plausible-range");
  if (Number.isFinite(input.measuredAt) && bkkDate(input.measuredAt) !== bkkDate(now)) warnings.push("not-today");
  if (input.scope === "holes" && !(input.holeIds && input.holeIds.length)) errors.holeIds = "required";
  return { ok: !Object.keys(errors).length, errors, warnings, value, range };
}

/** Readings stay valid until the end of the Bangkok day they were measured, unless set otherwise. */
export function defaultValidUntil(measuredAt) {
  return bkkInstant(bkkDate(measuredAt), "23:59") + 59e3;
}
