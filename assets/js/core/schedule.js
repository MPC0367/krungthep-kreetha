// Tee-sheet structure: which slots exist on a date, which slot a two-tee start turns onto, and the
// deterministic synthetic occupancy the demo sheet adapter reports. Slot IDs are stable strings,
// never row numbers (brief section 16).
import { bkkInstant, dayKey, fromMinutes, hash32, toMinutes } from "./util.js";

export function dayConfig(cfg, date) {
  const k = dayKey(date);
  return cfg.schedule.days[k] || cfg.schedule.days.default;
}

export function slotId(date, time, tee) { return `${date}T${time.replace(":", "")}-${tee}`; }
export function parseSlotId(id) {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2})(\d{2})-(\w+)$/.exec(id || "");
  return m ? { date: m[1], time: `${m[2]}:${m[3]}`, tee: m[4] } : null;
}

export function slotsForDate(cfg, date) {
  const day = dayConfig(cfg, date);
  if (day.closed) return [];
  const out = [];
  const memberRules = cfg.schedule.memberOnly || [];
  for (const s of day.sessions) {
    for (let t = toMinutes(s.start); t <= toMinutes(s.end); t += s.interval) {
      const time = fromMinutes(t);
      for (const tee of s.tees) {
        const memberOnly = memberRules.some((r) => r.days.includes(dayKey(date)) && toMinutes(r.from) <= t && t <= toMinutes(r.to));
        out.push({ id: slotId(date, time, tee), date, time, tee, session: s.id, startMs: bkkInstant(date, time), capacity: cfg.schedule.maxGroup, memberOnly });
      }
    }
  }
  return out.sort((a, b) => a.startMs - b.startMs || a.tee.localeCompare(b.tee));
}

export function findSlot(cfg, id) {
  const p = parseSlotId(id);
  if (!p) return null;
  return slotsForDate(cfg, p.date).find((s) => s.id === id) || null;
}

/**
 * A morning group starting on the 10th tee must come back to the 1st tee after nine holes (and the
 * reverse while both tees run starts). The turn uses the club's own pace rule, 2 h 15 min per nine,
 * rounded up to the next slot on the other tee. Returns null when no start is scheduled there.
 */
export function linkedSlot(cfg, slot, daySlots) {
  const other = slot.tee === "1" ? "10" : slot.tee === "10" ? "1" : null;
  if (!other) return null;
  const target = toMinutes(slot.time) + cfg.schedule.turnMinutes;
  // The next start on the other tee within one slot interval of the turn time.
  const step = Math.max(10, ...(cfg.schedule.days.default?.sessions || []).map((s) => s.interval || 0));
  const candidates = daySlots.filter((s) => s.tee === other && toMinutes(s.time) >= target && toMinutes(s.time) < target + step);
  if (!candidates.length) return null;
  // Only link while the other tee is part of a two-tee start window (otherwise the turn is free play).
  const twoTee = daySlots.some((s) => s.tee === "10");
  return twoTee ? candidates[0] : null;
}

/**
 * Synthetic phone and member bookings that the fake calendar-sheet adapter reports for a date.
 * Deterministic: the same date always gives the same sheet, so screenshots and tests are repeatable.
 */
export function demoSheetRows(cfg, date) {
  const rows = [];
  for (const s of slotsForDate(cfg, date)) {
    const h = hash32(s.id);
    const weekend = ["sat", "sun"].includes(dayKey(date));
    const minute = toMinutes(s.time);
    // Sample fill for the demo tee sheet (tuned for half-hourly times): busier early and at weekends.
    let busy = minute < 9 * 60 ? 0.42 : minute < 11 * 60 ? 0.34 : minute < 14 * 60 ? 0.22 : 0.3;
    if (weekend) busy += 0.18;
    if (s.memberOnly) busy += 0.15;
    const r = (h % 1000) / 1000;
    if (r < busy) {
      const seats = r < busy * 0.45 ? 4 : r < busy * 0.75 ? 2 : r < busy * 0.9 ? 3 : 1;
      rows.push({ extId: `SHEET-${s.id}-${(h >>> 8) % 97}`, slotId: s.id, seats, kind: s.memberOnly ? "member" : (h & 1 ? "phone" : "member"), version: 1 });
    }
  }
  return rows;
}
