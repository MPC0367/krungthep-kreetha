// The booking, payment, conditions and operations services. One implementation serves both the
// static demo (running in the visitor's browser over a persisted in-memory store) and the Node
// server (over SQLite). Every state change happens inside repo.run(), which is atomic.
import { buildQuote, dayType, leadDays } from "./rates.js";
import { findSlot, linkedSlot, slotsForDate, demoSheetRows, parseSlotId, dayConfig } from "./schedule.js";
import { assertTransition } from "./states.js";
import { freshness, latestReading, validateReading, defaultValidUntil } from "./conditions.js";
import { require as requirePerm, can, maskName } from "./permissions.js";
import { addDays, bkkDate, bkkInstant, bookingRef, clone, DomainError, isValidDate, randomId, secretToken, sha256Hex, stableStringify, toMinutes } from "./util.js";

const LIVE_BOOKING = ["CONFIRMED", "CHECKED_IN", "COMPLETED"];
const CATEGORIES = ["visitor", "member_guest", "member"];

export function createHost({ repo, config, rates, provider, clock = () => Date.now(), notify = () => {}, source = "demo-sheet" }) {
  const S = config.schedule;
  const policy = config.policy;

  // ---------- transaction helpers ----------
  const offsetOf = (t) => (t.get("kv", "clock")?.offsetMs) || 0;
  function run(fn) {
    return repo.run((t) => {
      const now = clock() + offsetOf(t);
      seedIfEmpty(t, now);
      expireHolds(t, now);
      return fn(t, now);
    });
  }
  function audit(t, now, actor, action, entity, before, after, reason) {
    t.put("audit", { id: randomId("aud"), at: now, actor: actor ? actor.id : "system", role: actor ? actor.role : "system", action, entity, before: before ?? null, after: after ?? null, reason: reason || null });
  }
  function outbox(t, now, kind, opId, payload) {
    if (t.list("outbox", { opId }).length) return; // retries never duplicate a projection or a message
    t.put("outbox", { id: randomId("ob"), opId, kind, payload, status: "PENDING", attempts: 0, createdAt: now });
  }
  function setBooking(t, now, b, to, actor, note) {
    assertTransition("booking", b.status, to);
    b.history = [...(b.history || []), { at: now, from: b.status, to, actor: actor ? actor.id : "system", note: note || null }];
    b.status = to;
    b.updatedAt = now;
    return b;
  }
  function setPayment(p, to) { assertTransition("payment", p.status, to); p.status = to; return p; }

  function expireHolds(t, now) {
    for (const h of t.list("holds", (x) => x.status === "ACTIVE" && x.expiresAt <= now)) {
      h.status = "EXPIRED"; t.put("holds", h);
      if (h.bookingId) {
        const b = t.get("bookings", h.bookingId);
        if (b && (b.status === "HELD" || b.status === "PAYMENT_PENDING")) { setBooking(t, now, b, "EXPIRED", null, "Hold expired"); t.put("bookings", b); }
      }
    }
  }

  function ensureSheetDay(t, date, now) {
    const key = `sheet:${date}`;
    if (t.get("kv", key)) return;
    for (const row of demoSheetRows(config, date)) t.put("external", { id: row.extId, ...row, source, active: true, importedAt: now });
    t.put("kv", { id: key, at: now });
  }

  function closureFor(t, slot) {
    return t.list("closures", (c) => c.active !== false && c.date === slot.date && (c.tees.includes("all") || c.tees.includes(slot.tee)) && toMinutes(c.from) <= toMinutes(slot.time) && toMinutes(slot.time) <= toMinutes(c.to))[0] || null;
  }

  function usedSeats(t, slotIdValue, now, { excludeHold, excludeBooking } = {}) {
    let used = 0;
    for (const h of t.list("holds", (x) => x.status === "ACTIVE" && x.expiresAt > now && (x.slotId === slotIdValue || x.linkedSlotId === slotIdValue))) if (h.id !== excludeHold) used += h.seats;
    for (const b of t.list("bookings", (x) => LIVE_BOOKING.includes(x.status) && (x.slotId === slotIdValue || x.linkedSlotId === slotIdValue))) if (b.id !== excludeBooking) used += b.seats;
    for (const e of t.list("external", (x) => x.active !== false && x.slotId === slotIdValue)) used += e.seats;
    return used;
  }
  function seatsFor(slot, partySize) { return S.capacityModel === "flight" ? slot.capacity : partySize; }
  function remaining(t, slot, linked, now, opts) {
    const r1 = slot.capacity - usedSeats(t, slot.id, now, opts);
    if (S.capacityModel === "flight" && r1 < slot.capacity) return 0;
    if (!linked) return r1;
    const r2 = linked.capacity - usedSeats(t, linked.id, now, opts);
    if (S.capacityModel === "flight" && r2 < linked.capacity) return 0;
    return Math.min(r1, r2);
  }

  function sourceHealth(t, now) {
    const s = t.get("kv", "source") || { id: "source", status: "ok" };
    return { status: s.status, lastVerifiedAt: s.status === "ok" ? now : s.lastVerifiedAt || null, adapter: source };
  }

  function horizon(now) { const today = bkkDate(now); return { first: today, last: addDays(today, S.horizonDays - 1), days: S.horizonDays }; }
  const horizonText = () => `Online booking covers ${S.horizonDays} days, starting today`;

  function memberStatus(number) {
    const m = (config.demoMembers || []).find((x) => x.number.toUpperCase() === String(number || "").trim().toUpperCase());
    if (!m) return "unknown";
    return m.status;
  }

  // Every quote is priced on the service's own Bangkok date (the injected clock), never the browser's.
  function quoteFor(slot, category, partySize, now) {
    return buildQuote({ rates, policy, holidays: config.holidays.dates, slot, category, partySize, bookingDate: bkkDate(now) });
  }

  /** Seats used per slot for a set of dates, from one pass over each table. A day whose sheet has not been
   *  imported yet counts its deterministic sheet rows without writing them, so a month view stays a read. */
  function seatIndex(t, now, dates) {
    const idx = new Map();
    const add = (id, n) => { if (id) idx.set(id, (idx.get(id) || 0) + n); };
    for (const h of t.list("holds", (x) => x.status === "ACTIVE" && x.expiresAt > now)) { add(h.slotId, h.seats); add(h.linkedSlotId, h.seats); }
    for (const b of t.list("bookings", (x) => LIVE_BOOKING.includes(x.status))) { add(b.slotId, b.seats); add(b.linkedSlotId, b.seats); }
    for (const e of t.list("external", (x) => x.active !== false && dates.has(String(x.slotId).slice(0, 10)))) add(e.slotId, e.seats);
    for (const d of dates) if (!t.get("kv", `sheet:${d}`)) for (const r of demoSheetRows(config, d)) add(r.slotId, r.seats);
    return idx;
  }
  function remainingIn(idx, slot, linked) {
    const r1 = slot.capacity - (idx.get(slot.id) || 0);
    if (S.capacityModel === "flight" && r1 < slot.capacity) return 0;
    if (!linked) return r1;
    const r2 = linked.capacity - (idx.get(linked.id) || 0);
    if (S.capacityModel === "flight" && r2 < linked.capacity) return 0;
    return Math.min(r1, r2);
  }
  const quoteSummary = (q) => ({ perGolferMinor: q.perGolferMinor, totalMinor: q.totalMinor, depositMinor: q.depositMinor, balanceMinor: q.balanceMinor, priceMode: q.priceMode, deposit: q.deposit, planId: q.planId });

  /** One day of the tee sheet for a party and golfer type. The tee sheet and the month calendar both read
   *  it, so a calendar state always leads to the same result as opening that date. */
  function dayView(t, now, date, { partySize, category, eligibility, clientId, idx }) {
    const src = sourceHealth(t, now);
    const slots = slotsForDate(config, date);
    if (!slots.length) return { dayState: "closed", reason: dayConfig(config, date).reason || "closed", sessions: [], source: src };
    if (src.status !== "ok") return { dayState: "stale", sessions: [], source: src };
    idx ||= seatIndex(t, now, new Set([date]));
    const mine = clientId ? t.list("holds", (x) => x.status === "ACTIVE" && x.expiresAt > now && x.clientId === clientId) : [];
    const sessions = {};
    for (const s of slots) {
      if (s.tee !== "1" && s.tee !== "10") continue;
      const linked = linkedSlot(config, s, slots);
      let state = "available", reason = null, quote = null;
      const rem = remainingIn(idx, s, linked);
      const yours = mine.find((x) => x.slotId === s.id) || null;
      const cl = closureFor(t, s);
      if (s.startMs < now + 30 * 60e3) state = "past";
      else if (cl) { state = "closed"; reason = cl.reason; }
      else if (s.memberOnly && category !== "member") state = "member_only";
      else if (!eligibility.ok) state = "not_eligible";
      else {
        try { quote = quoteSummary(quoteFor(s, category, partySize, now)); } catch { state = "no_rate"; }
        if (state === "available") {
          if (yours) state = "yours";
          else if (rem <= 0) state = "full";
          else if (rem < partySize) state = "too_small";
          else if (rem < s.capacity) state = "partial";
        }
      }
      (sessions[s.session] ||= []).push({ id: s.id, time: s.time, tee: s.tee, session: s.session, capacity: s.capacity, remaining: Math.max(0, rem), state, reason, quote, linkedSlotId: linked?.id || null, memberOnly: s.memberOnly, holdId: yours?.id || null });
    }
    const order = ["morning", "afternoon", "twilight"];
    return { dayState: "open", source: src, sessions: order.filter((k) => sessions[k]).map((k) => ({ id: k, slots: sessions[k] })) };
  }
  function eligibilityFor(category, memberNumber) {
    if (category !== "member") return { ok: true };
    const st = memberStatus(memberNumber);
    return st === "active" ? { ok: true } : { ok: false, reason: st === "suspended" ? "MEMBER_INACTIVE" : "MEMBER_NOT_VERIFIED" };
  }
  function checkParty(partySize) {
    if (!Number.isInteger(partySize) || partySize < 1 || partySize > S.maxGroup) throw new DomainError("INVALID", `A group can be 1 to ${S.maxGroup} golfers`, { field: "partySize" });
  }

  // ---------- seed ----------
  function seedIfEmpty(t, now) {
    if (t.get("kv", "seeded")) return;
    const today = bkkDate(now);
    let measured = bkkInstant(today, "06:40");
    if (measured > now) measured = bkkInstant(addDays(today, -1), "06:40");
    t.put("kv", { id: "course", status: "open", note: { th: "สนามเปิดให้บริการตามปกติ", en: "The course is open as normal" }, updatedAt: measured, demo: true });
    t.put("readings", { id: "rd_seed_1", version: 1, supersedes: null, measuredAt: measured, publishedAt: measured + 25 * 60e3, validUntil: defaultValidUntil(measured), scope: "course", holeIds: [], method: "stimpmeter", unit: "ft", value: 10.5, range: null, operator: "Greenkeeper (demo)", notes: { th: "ค่าเฉลี่ยจากการวัดกรีนตัวอย่าง 3 กรีน ตามวิธีของสมาคม (ข้อมูลตัวอย่าง)", en: "Average of three sample greens measured with the club's method (demo reading)" }, status: "PUBLISHED", createdBy: "u-green", approvedBy: "u-green", demo: true });
    t.put("notices", { id: "nt_seed_1", kind: "carts", th: "ตัวอย่างประกาศ: รถกอล์ฟวิ่งบนทางรถเท่านั้นที่หลุม 3 และ 4 หลังฝนตกเมื่อคืน", en: "Sample notice: carts stay on paths at holes 3 and 4 after overnight rain", status: "ACTIVE", createdAt: measured, demo: true });
    t.put("kv", { id: "source", status: "ok" });
    t.put("kv", { id: "sync", status: "CLEAN", lastImportAt: now, lastExportAt: now, conflicts: [], failExports: false });
    t.put("kv", { id: "seeded", at: now });
  }

  // ---------- public views ----------
  function bookingView(t, b, { forStaff = false, actor = null } = {}) {
    const payments = t.list("payments", { bookingId: b.id }).sort((a, c) => c.createdAt - a.createdAt);
    const pay = payments.find((p) => p.status !== "FAILED" && p.status !== "EXPIRED") || payments[0] || null;
    const refunds = t.list("refunds", { bookingId: b.id });
    const deadline = b.startMs - policy.cancellation.freeUntilHoursBefore * 3600e3;
    const showContact = forStaff ? can(actor, "contact.view") : true;
    return {
      id: b.id, ref: b.ref, status: b.status, attendance: b.attendance, syncStatus: b.syncStatus, channel: b.channel,
      slotId: b.slotId, date: b.date, time: b.time, tee: b.tee, linkedSlotId: b.linkedSlotId, session: b.session,
      partySize: b.partySize, seats: b.seats, category: b.category, quote: b.quote, policy: b.policy, exemption: b.exemption || null,
      cancelDeadline: deadline, startMs: b.startMs, createdAt: b.createdAt, confirmedAt: b.confirmedAt || null, locale: b.locale,
      lead: { name: showContact ? b.lead?.name : maskName(b.lead?.name), phone: showContact ? b.lead?.phone : null, email: showContact ? b.lead?.email : null },
      payment: pay ? { id: pay.id, status: pay.status, method: pay.method, amountMinor: pay.amountMinor, capturedMinor: pay.capturedMinor || 0, refundedMinor: pay.refundedMinor || 0, retainedMinor: pay.retainedMinor || 0, expiresAt: pay.expiresAt, providerRef: forStaff ? pay.providerRef : undefined, qrPayload: pay.status === "PENDING" ? pay.qrPayload : null } : null,
      refunds: refunds.map((r) => ({ id: r.id, status: r.status, amountMinor: r.amountMinor, reason: r.reason, createdAt: r.createdAt })),
      disposition: b.disposition || null, rescheduleCount: b.rescheduleCount || 0, history: forStaff ? b.history : undefined,
      pass: passFor(b),
    };
  }
  /** The check-in card is derived on read from the confirmed record, so bookings made before the card
   *  existed get one too. It encodes only the public reference: never the private code, contact details,
   *  payment data or a link. After check-in it reports the real state instead of an admission card. */
  function passFor(b) {
    if (b.status === "CONFIRMED") return { state: "active", payload: `KKD1|${b.ref}` };
    if (b.status === "CHECKED_IN" || b.status === "COMPLETED") return { state: b.status === "CHECKED_IN" ? "checked_in" : "completed" };
    return null;
  }

  function alternatives(t, date, partySize, category, now, excludeId) {
    const slots = slotsForDate(config, date);
    const out = [];
    for (const s of slots) {
      if (s.id === excludeId || s.startMs < now + 30 * 60e3 || closureFor(t, s) || (s.memberOnly && category !== "member")) continue;
      try { quoteFor(s, category, partySize, now); } catch { continue; }
      const linked = linkedSlot(config, s, slots);
      if (remaining(t, s, linked, now) >= partySize) out.push({ id: s.id, time: s.time, tee: s.tee });
      if (out.length >= 3) break;
    }
    return out;
  }

  function checkSelection(t, now, { slotId, partySize, category, memberNumber }) {
    const slot = findSlot(config, slotId);
    if (!slot) throw new DomainError("INVALID", "That tee time does not exist", { field: "slotId" });
    const h = horizon(now);
    if (slot.date < h.first || slot.date > h.last) throw new DomainError("OUTSIDE_HORIZON", horizonText(), { date: slot.date, first: h.first, last: h.last });
    if (!Number.isInteger(partySize) || partySize < 1 || partySize > S.maxGroup) throw new DomainError("INVALID", `A group can be 1 to ${S.maxGroup} golfers`, { field: "partySize" });
    if (!CATEGORIES.includes(category)) throw new DomainError("INVALID", "Choose who is playing", { field: "category" });
    if (slot.startMs < now + 30 * 60e3) throw new DomainError("PAST", "This tee time has passed or starts too soon to book online");
    const cl = closureFor(t, slot);
    if (cl) throw new DomainError("CLOSED", "This tee time is closed", { reason: cl.reason });
    if (category === "member") {
      const st = memberStatus(memberNumber);
      if (st !== "active") throw new DomainError("NOT_ELIGIBLE", st === "suspended" ? "This membership is not active. Please contact the office." : "We could not verify this member number", { field: "memberNumber", status: st });
    }
    if (slot.memberOnly && category !== "member") throw new DomainError("NOT_ELIGIBLE", "This time is reserved for members", { reason: "member_only" });
    const src = sourceHealth(t, now);
    if (src.status !== "ok") throw new DomainError("STALE_SOURCE", "Availability cannot be confirmed right now");
    return slot;
  }

  // ---------- public API ----------
  const api = {
    async health() {
      return run((t, now) => ({ ok: true, mode: config.mode, repo: repo.describe(), provider: provider.id, providerLive: provider.live, source: sourceHealth(t, now), serverTime: now, clockOffsetMs: offsetOf(t) }));
    },

    async getPublicConfig() {
      return run((t, now) => {
        const h = horizon(now);
        return { mode: config.mode, horizon: h, horizonDays: S.horizonDays, maxGroup: S.maxGroup, holdMinutes: S.holdMinutes, paymentWindowMinutes: S.paymentWindowMinutes, capacityModel: S.capacityModel, policy: clone(policy), today: bkkDate(now), serverTime: now, rateVersion: rates.versions[0]?.id, holidays: [...(config.holidays.dates || [])], closedDays: Object.entries(S.days).filter(([, d]) => d.closed).map(([k, d]) => ({ day: k, reason: d.reason })), store: repo.describe() };
      });
    },

    async listAvailability({ date, partySize = 2, category = "visitor", memberNumber, clientId } = {}) {
      return run((t, now) => {
        const h = horizon(now);
        if (!date || date < h.first || date > h.last) throw new DomainError("OUTSIDE_HORIZON", horizonText(), { first: h.first, last: h.last });
        partySize = Number(partySize);
        checkParty(partySize);
        const eligibility = eligibilityFor(category, memberNumber);
        if (slotsForDate(config, date).length && sourceHealth(t, now).status === "ok") ensureSheetDay(t, date, now);
        const v = dayView(t, now, date, { partySize, category, eligibility, clientId });
        return { date, ...v, capacityModel: S.capacityModel, serverTime: now, eligibility, rateVersion: rates.versions[0]?.id };
      });
    },

    /** One aggregate call for a calendar month (or any range inside the horizon): a state per date, the
     *  number of bookable starts for this party and golfer type, and the deposit that date would take now.
     *  Dates outside the horizon come back as "outside" so the picker never guesses. */
    async listCalendar({ from, to, partySize = 2, category = "visitor", memberNumber } = {}) {
      return run((t, now) => {
        const h = horizon(now);
        partySize = Number(partySize);
        checkParty(partySize);
        if (!isValidDate(from) || !isValidDate(to) || to < from) throw new DomainError("INVALID", "Give a date range", { field: "from" });
        if (leadDays(from, to) > 42) throw new DomainError("INVALID", "Ask for one month at a time", { field: "to" });
        const eligibility = eligibilityFor(category, memberNumber);
        const dates = []; for (let d = from; d <= to; d = addDays(d, 1)) dates.push(d);
        const inside = dates.filter((d) => d >= h.first && d <= h.last);
        const idx = seatIndex(t, now, new Set(inside));
        const days = dates.map((date) => {
          const base = { date, dayType: dayType(date, config.holidays.dates), holiday: config.holidays.dates.includes(date) };
          if (date < h.first || date > h.last) return { ...base, state: "outside" };
          const v = dayView(t, now, date, { partySize, category, eligibility, idx });
          if (v.dayState !== "open") return { ...base, state: v.dayState, reason: v.reason || null };
          const all = v.sessions.flatMap((s) => s.slots);
          const ok = all.filter((s) => ["available", "partial", "yours"].includes(s.state));
          const live = all.filter((s) => s.state !== "past");
          let state = "open";
          if (!ok.length) {
            if (!live.length) state = "past";
            else if (!eligibility.ok) state = "not_eligible";
            else if (live.every((s) => s.state === "closed")) state = "closed";
            else if (live.some((s) => s.state === "too_small")) state = "no_fit";
            else if (live.some((s) => s.state === "full")) state = "full";
            else if (live.every((s) => ["no_rate", "member_only"].includes(s.state))) state = "no_rate";
            else state = "full";
          }
          const q = ok[0]?.quote || null;
          const prices = ok.map((s) => s.quote?.perGolferMinor).filter((p) => p != null);
          return { ...base, state, reason: state === "closed" ? (live.find((s) => s.reason)?.reason || null) : null, bookable: ok.length, starts: live.length,
            fromMinor: prices.length ? Math.min(...prices) : null, depositMinor: q?.depositMinor ?? null, deposit: q?.deposit || null, priceMode: q?.priceMode || null };
        });
        return { from, to, horizon: h, partySize, category, eligibility, serverTime: now, source: sourceHealth(t, now), days };
      });
    },

    async createHold({ slotId, partySize, category, memberNumber, idemKey, clientId } = {}) {
      if (!clientId) throw new DomainError("INVALID", "Missing client identity");
      const reqHash = stableStringify({ slotId, partySize, category, memberNumber: memberNumber || null });
      return run((t, now) => {
        const key = `hold:${clientId}:${idemKey || reqHash}`;
        const prior = t.get("idem", key);
        if (prior) {
          if (prior.requestHash !== reqHash) throw new DomainError("IDEMPOTENCY_MISMATCH", "This request key was already used for a different selection");
          const h = t.get("holds", prior.response.holdId);
          if (h && h.status === "ACTIVE" && h.expiresAt > now) return { hold: holdView(h, now), quote: h.quote, replayed: true };
        }
        const slot = checkSelection(t, now, { slotId, partySize, category, memberNumber });
        const daySlots = slotsForDate(config, slot.date);
        const linked = linkedSlot(config, slot, daySlots);
        // One live hold per visitor: a second tab or a new choice replaces the earlier hold.
        for (const old of t.list("holds", (x) => x.status === "ACTIVE" && x.clientId === clientId)) {
          const b = old.bookingId ? t.get("bookings", old.bookingId) : null;
          if (b && b.status === "PAYMENT_PENDING") throw new DomainError("PAYMENT_IN_PROGRESS", "A payment is already in progress for your earlier selection", { bookingId: b.id });
          old.status = "RELEASED"; t.put("holds", old);
          if (b && b.status === "HELD") { setBooking(t, now, b, "CANCELLED", null, "Replaced by a new selection"); t.put("bookings", b); }
        }
        // The quote is a snapshot of this moment: a hold made before Bangkok midnight keeps its tier.
        const quote = quoteFor(slot, category, partySize, now);
        ensureSheetDay(t, slot.date, now);
        const seats = seatsFor(slot, partySize);
        const rem = remaining(t, slot, linked, now);
        if (rem < seats) throw new DomainError("NO_CAPACITY", rem > 0 ? `Only ${rem} place(s) left at this time` : "This tee time has just filled", { remaining: rem, alternatives: alternatives(t, slot.date, partySize, category, now, slot.id) });
        const hold = { id: randomId("hold"), slotId: slot.id, linkedSlotId: linked?.id || null, date: slot.date, time: slot.time, tee: slot.tee, session: slot.session, startMs: slot.startMs, seats, partySize, category, memberNumber: category === "member" ? memberNumber : null, status: "ACTIVE", createdAt: now, expiresAt: now + S.holdMinutes * 60e3, clientId, quote, bookingId: null };
        t.insert("holds", hold);
        t.put("idem", { id: key, requestHash: reqHash, response: { holdId: hold.id }, at: now });
        audit(t, now, null, "hold.create", hold.id, null, { slotId: slot.id, seats }, null);
        return { hold: holdView(hold, now), quote };
      }).then((r) => { notify("availability", { slotId }); return r; });
    },

    async getHold({ holdId, clientId }) {
      return run((t, now) => {
        const h = t.get("holds", holdId);
        if (!h || h.clientId !== clientId) throw new DomainError("NOT_FOUND", "This selection is no longer available");
        return { hold: holdView(h, now), quote: h.quote };
      });
    },

    async releaseHold({ holdId, clientId }) {
      const r = await run((t, now) => {
        const h = t.get("holds", holdId);
        if (!h || h.clientId !== clientId) return { released: false };
        if (h.status === "ACTIVE") {
          const b = h.bookingId ? t.get("bookings", h.bookingId) : null;
          if (b && b.status === "PAYMENT_PENDING") throw new DomainError("PAYMENT_IN_PROGRESS", "A payment is in progress; it cannot be released now");
          h.status = "RELEASED"; t.put("holds", h);
          if (b && b.status === "HELD") { setBooking(t, now, b, "CANCELLED", null, "Released by the customer"); t.put("bookings", b); }
          audit(t, now, null, "hold.release", h.id, "ACTIVE", "RELEASED", null);
        }
        return { released: true };
      });
      notify("availability", {});
      return r;
    },

    async createBooking({ holdId, clientId, lead = {}, acceptTerms, marketing = false, locale = "th" }) {
      const errors = {};
      const name = String(lead.name || "").trim();
      const phone = String(lead.phone || "").replace(/[\s-]/g, "");
      const email = String(lead.email || "").trim();
      if (name.length < 2) errors.name = "required";
      if (!/^\+?\d{9,15}$/.test(phone)) errors.phone = "invalid";
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) errors.email = "invalid";
      if (!acceptTerms) errors.acceptTerms = "required";
      if (Object.keys(errors).length) throw new DomainError("VALIDATION", "Please check the highlighted fields", { errors });
      const token = secretToken();
      const tokenHash = await sha256Hex(token);
      const result = await run((t, now) => {
        const h = t.get("holds", holdId);
        if (!h || h.clientId !== clientId) throw new DomainError("NOT_FOUND", "This selection is no longer held");
        if (h.status !== "ACTIVE" || h.expiresAt <= now) throw new DomainError("HOLD_EXPIRED", "Your hold has expired. Choose a time again.", { slotId: h.slotId });
        if (h.bookingId) {
          const b = t.get("bookings", h.bookingId);
          b.lead = { name, phone, email }; b.marketing = !!marketing; b.locale = locale; t.put("bookings", b);
          return { booking: bookingView(t, b), token: null, existing: true };
        }
        const b = {
          id: randomId("bk"), ref: bookingRef(), holdId: h.id, slotId: h.slotId, linkedSlotId: h.linkedSlotId, date: h.date, time: h.time, tee: h.tee, session: h.session, startMs: h.startMs,
          seats: h.seats, partySize: h.partySize, category: h.category, memberNumber: h.memberNumber, status: "HELD", attendance: "EXPECTED", syncStatus: "CLEAN", channel: "online",
          lead: { name, phone, email }, marketing: !!marketing, locale, quote: h.quote, policy: clone(policy), termsAcceptedAt: now, termsLocale: locale,
          manageTokenHash: tokenHash, createdAt: now, history: [{ at: now, from: null, to: "HELD", actor: "customer", note: null }],
        };
        t.insert("bookings", b);
        h.bookingId = b.id; t.put("holds", h);
        if (h.quote.exemption === "member_account") {
          setBooking(t, now, b, "CONFIRMED", null, "Member account; no online deposit");
          b.exemption = "member_account"; b.confirmedAt = now; b.syncStatus = "PENDING_EXPORT";
          h.status = "CONVERTED"; t.put("holds", h); t.put("bookings", b);
          outbox(t, now, "export-booking", `${b.id}:confirm`, { bookingId: b.id });
          outbox(t, now, "confirmation-message", `${b.id}:confirmed`, { bookingId: b.id, locale });
        }
        audit(t, now, null, "booking.create", b.id, null, { ref: b.ref, status: b.status }, null);
        return { booking: bookingView(t, b), token };
      });
      return result;
    },

    async startPayment({ bookingId, clientId, method = "promptpay", idemKey }) {
      if (!provider.methods.includes(method)) throw new DomainError("INVALID", "That payment method is not available", { field: "method" });
      return run((t, now) => {
        const b = t.get("bookings", bookingId);
        const h = b && t.get("holds", b.holdId);
        if (!b || !h || h.clientId !== clientId) throw new DomainError("NOT_FOUND", "Booking not found");
        if (b.status === "CONFIRMED") return { booking: bookingView(t, b), alreadyConfirmed: true };
        const key = `pay:${bookingId}:${idemKey || "default"}`;
        const prior = t.get("idem", key);
        if (prior) return { booking: bookingView(t, b), payment: clone(t.get("payments", prior.response.paymentId)), replayed: true };
        const pending = t.list("payments", (p) => p.bookingId === b.id && p.status === "PENDING" && p.expiresAt > now)[0];
        if (pending) return { booking: bookingView(t, b), payment: pending, replayed: true };
        if (b.status !== "HELD" && b.status !== "PAYMENT_PENDING") throw new DomainError("HOLD_EXPIRED", "This hold has ended. Choose a time again.");
        if (h.status !== "ACTIVE" || h.expiresAt <= now) throw new DomainError("HOLD_EXPIRED", "Your hold has expired. Choose a time again.");
        // An earlier request that ran out of time is closed here too, so only one request can settle.
        for (const old of t.list("payments", (x) => x.bookingId === b.id && x.status === "PENDING")) { setPayment(old, "EXPIRED"); t.put("payments", old); }
        const amount = b.quote.depositMinor; // from the stored quote, never from the browser
        const expiresAt = Math.min(now + S.paymentWindowMinutes * 60e3, h.createdAt + (S.holdMinutes + S.paymentWindowMinutes) * 60e3);
        const intent = provider.createIntent({ amountMinor: amount, method, reference: b.ref, expiresAt });
        const p = { id: randomId("pay"), bookingId: b.id, provider: provider.id, providerRef: intent.providerRef, method, amountMinor: amount, status: "PENDING", qrPayload: intent.qrPayload, createdAt: now, expiresAt, capturedMinor: 0, refundedMinor: 0, retainedMinor: 0 };
        t.insert("payments", p);
        h.expiresAt = Math.max(h.expiresAt, expiresAt); t.put("holds", h);
        if (b.status === "HELD") setBooking(t, now, b, "PAYMENT_PENDING", null, `${method} request created`);
        t.put("bookings", b);
        t.put("idem", { id: key, requestHash: method, response: { paymentId: p.id }, at: now });
        audit(t, now, null, "payment.create", p.id, null, { amountMinor: amount, method }, null);
        return { booking: bookingView(t, b), payment: p };
      });
    },

    /** Stands in for the customer's banking app in the sandbox. */
    async sandboxAct({ paymentId, outcome, deliver = "now" }) {
      const p = await run((t) => t.get("payments", paymentId));
      if (!p) throw new DomainError("NOT_FOUND", "Payment not found");
      const type = { succeed: "payment.succeeded", fail: "payment.failed", expire: "payment.expired" }[outcome];
      if (!type) throw new DomainError("INVALID", "Unknown sandbox outcome");
      const now = await run((t, n) => n);
      const ev = provider.makeEvent(type, { paymentId: p.id, providerRef: p.providerRef, amountMinor: p.amountMinor }, now);
      const signed = await provider.signEvent(ev);
      if (deliver === "later") { await run((t, n) => t.put("pending", { id: ev.id, ...signed, queuedAt: n })); return { queued: true, eventId: ev.id }; }
      const r = await api.receiveWebhook(signed.body, signed.signature);
      if (deliver === "twice") { const r2 = await api.receiveWebhook(signed.body, signed.signature); return { first: r, second: r2 }; }
      return r;
    },

    async receiveWebhook(body, signature) {
      if (!(await provider.verify(body, signature))) throw new DomainError("BAD_SIGNATURE", "Webhook signature did not verify");
      const ev = JSON.parse(body);
      const res = await run((t, now) => {
        if (t.get("events", ev.id)) return { duplicate: true, eventId: ev.id };
        const record = (result) => { t.insert("events", { id: ev.id, type: ev.type, at: now, paymentId: ev.data.paymentId || null, result }); return { eventId: ev.id, result }; };
        if (ev.type.startsWith("refund.")) return record(applyRefundEvent(t, now, ev));
        const p = t.get("payments", ev.data.paymentId);
        if (!p) return record("unknown-payment");
        const b = t.get("bookings", p.bookingId);
        if (ev.type === "payment.succeeded") {
          if (p.status === "SUCCEEDED" || p.status.startsWith("REFUND") || p.status.endsWith("REFUNDED")) return record("already-settled");
          // The provider must report the amount this intent asked for; anything else waits for staff.
          if (ev.data.amountMinor !== p.amountMinor) { t.insert("exceptions", { id: randomId("ex"), kind: "AMOUNT_MISMATCH", bookingId: b?.id || null, paymentId: p.id, status: "OPEN", createdAt: now, detail: { expected: p.amountMinor, reported: ev.data.amountMinor } }); return record("amount-mismatch"); }
          setPayment(p, "SUCCEEDED"); p.capturedMinor = ev.data.amountMinor; p.settledAt = now; t.put("payments", p);
          const h = t.get("holds", b.holdId);
          if (b.status === "PAYMENT_PENDING" && h && h.status === "ACTIVE" && h.expiresAt > now) {
            confirm(t, now, b, h, "Verified settlement");
            return record("confirmed");
          }
          if (b.status === "CONFIRMED") return record("already-confirmed");
          // Late settlement: the hold has gone. Never evict another golfer.
          const slot = findSlot(config, b.slotId);
          const linked = b.linkedSlotId ? findSlot(config, b.linkedSlotId) : null;
          if (slot && !closureFor(t, slot) && remaining(t, slot, linked, now) >= b.seats && (b.status === "EXPIRED" || b.status === "HELD")) {
            if (b.status === "HELD") setBooking(t, now, b, "PAYMENT_PENDING", null, "Late settlement");
            confirm(t, now, b, h, "Late settlement; capacity still free");
            return record("confirmed-late");
          }
          const ex = { id: randomId("ex"), kind: "LATE_PAYMENT_NO_CAPACITY", bookingId: b.id, paymentId: p.id, status: "OPEN", createdAt: now, detail: { ref: b.ref, amountMinor: p.capturedMinor } };
          t.insert("exceptions", ex);
          requestRefund(t, now, p, b, p.capturedMinor, "Automatic: paid after the hold expired and the time was sold", null);
          audit(t, now, null, "exception.open", ex.id, null, ex.kind, null);
          return record("exception-refund-queued");
        }
        if (ev.type === "payment.failed" || ev.type === "payment.expired") {
          if (p.status !== "PENDING") return record("ignored-out-of-order");
          setPayment(p, ev.type === "payment.failed" ? "FAILED" : "EXPIRED"); t.put("payments", p);
          const h = t.get("holds", b.holdId);
          if (b.status === "PAYMENT_PENDING") {
            if (h && h.status === "ACTIVE" && h.expiresAt > now) setBooking(t, now, b, "HELD", null, "Payment did not complete; hold still valid");
            else setBooking(t, now, b, "EXPIRED", null, "Payment did not complete and the hold ended");
            t.put("bookings", b);
          }
          return record(p.status.toLowerCase());
        }
        return record("ignored-type");
      });
      notify("booking", { eventId: ev.id });
      notify("availability", {});
      return res;
    },

    async getBookingStatus({ bookingId, token, ref }) {
      const hash = await sha256Hex(String(token || ""));
      return run((t, now) => {
        const b = bookingId ? t.get("bookings", bookingId) : t.list("bookings", { ref: String(ref || "").toUpperCase() })[0];
        if (!b || b.manageTokenHash !== hash) throw new DomainError("NOT_FOUND", "We could not find a booking with those details");
        return { booking: bookingView(t, b), serverTime: now, cancellation: cancellationOutcome(t, b, now) };
      });
    },

    async lookupBooking({ ref, token }) {
      const key = `lookup:${String(ref || "").toUpperCase()}`;
      await run((t, now) => {
        const k = t.get("kv", key) || { id: key, attempts: [] };
        k.attempts = k.attempts.filter((a) => a > now - 10 * 60e3);
        if (k.attempts.length >= 5) throw new DomainError("RATE_LIMITED", "Too many attempts. Try again in 10 minutes or contact the booking desk.");
        k.attempts.push(now); t.put("kv", k);
      });
      return api.getBookingStatus({ ref, token });
    },

    async cancelBooking({ ref, token, confirm: doIt = false }) {
      const hash = await sha256Hex(String(token || ""));
      const r = await run((t, now) => {
        const b = t.list("bookings", { ref: String(ref || "").toUpperCase() })[0];
        if (!b || b.manageTokenHash !== hash) throw new DomainError("NOT_FOUND", "We could not find a booking with those details");
        if (b.status === "CANCELLED") return { booking: bookingView(t, b), alreadyCancelled: true };
        if (b.status !== "CONFIRMED") throw new DomainError("NOT_CANCELLABLE", "This booking cannot be cancelled online. Please call the booking desk.");
        const outcome = cancellationOutcome(t, b, now);
        if (!doIt) return { preview: outcome, booking: bookingView(t, b) };
        applyCancellation(t, now, b, outcome, null, "Cancelled by the customer");
        return { booking: bookingView(t, b), outcome };
      });
      notify("availability", {});
      return r;
    },

    /** preview: true shows the new total, the deposit already paid and the revised balance without moving. */
    async rescheduleBooking({ ref, token, newSlotId, preview = false }) {
      const hash = await sha256Hex(String(token || ""));
      const r = await run((t, now) => {
        const b = t.list("bookings", { ref: String(ref || "").toUpperCase() })[0];
        if (!b || b.manageTokenHash !== hash) throw new DomainError("NOT_FOUND", "We could not find a booking with those details");
        if (b.status !== "CONFIRMED") throw new DomainError("NOT_CHANGEABLE", "Only confirmed bookings can be moved");
        const pol = b.policy?.reschedule || policy.reschedule;
        if ((b.rescheduleCount || 0) >= pol.limit) throw new DomainError("LIMIT", "This booking has already been moved once. Please call the booking desk.");
        if (now > b.startMs - pol.untilHoursBefore * 3600e3) throw new DomainError("TOO_LATE", `Online changes close ${pol.untilHoursBefore} hours before the tee time`);
        return move(t, now, b, newSlotId, null, { preview });
      });
      if (!preview) notify("availability", {});
      return r;
    },

    async getConditions() {
      return run((t, now) => conditionsView(t, now));
    },

    // ---------- operations console ----------
    async staffTeeSheet({ date }, actor) {
      requirePerm(actor, "teesheet.view");
      return run((t, now) => {
        const slots = slotsForDate(config, date);
        ensureSheetDay(t, date, now);
        const rows = slots.map((s) => {
          const items = [];
          for (const b of t.list("bookings", (x) => (x.slotId === s.id || x.linkedSlotId === s.id) && !["CANCELLED", "EXPIRED"].includes(x.status))) items.push({ type: "booking", turn: b.slotId !== s.id, ...bookingView(t, b, { forStaff: true, actor }) });
          for (const h of t.list("holds", (x) => x.status === "ACTIVE" && x.expiresAt > now && (x.slotId === s.id || x.linkedSlotId === s.id) && !x.bookingId)) items.push({ type: "hold", id: h.id, seats: h.seats, expiresAt: h.expiresAt, turn: h.slotId !== s.id });
          for (const e of t.list("external", (x) => x.active !== false && x.slotId === s.id)) items.push({ type: "external", id: e.id, seats: e.seats, kind: e.kind, source: e.source });
          const cl = closureFor(t, s);
          return { ...s, used: usedSeats(t, s.id, now), closure: cl, items };
        });
        return { date, serverTime: now, capacityModel: S.capacityModel, rows };
      });
    },

    async staffCreateBooking({ slotId, partySize, category = "visitor", lead = {}, channel = "phone" }, actor) {
      requirePerm(actor, "booking.create");
      const r = await run((t, now) => {
        const slot = findSlot(config, slotId);
        if (!slot) throw new DomainError("INVALID", "Unknown tee time");
        if (closureFor(t, slot)) throw new DomainError("CLOSED", "This tee time is closed");
        const linked = linkedSlot(config, slot, slotsForDate(config, slot.date));
        ensureSheetDay(t, slot.date, now);
        const seats = seatsFor(slot, Number(partySize));
        const rem = remaining(t, slot, linked, now);
        if (rem < seats) throw new DomainError("NO_CAPACITY", `Only ${rem} place(s) left at this time`, { remaining: rem });
        let quote;
        try { quote = quoteFor(slot, category, Number(partySize), now); } catch { quote = { priceMode: "at_counter", totalMinor: null, depositMinor: 0, balanceMinor: null, rateVersion: rates.versions[0]?.id, policyVersion: `${policy.id}@${policy.version}` }; }
        const b = { id: randomId("bk"), ref: bookingRef(), holdId: null, slotId: slot.id, linkedSlotId: linked?.id || null, date: slot.date, time: slot.time, tee: slot.tee, session: slot.session, startMs: slot.startMs, seats, partySize: Number(partySize), category,
          status: "HELD", attendance: "EXPECTED", syncStatus: "PENDING_EXPORT", channel, lead: { name: String(lead.name || "").trim() || "Walk-in", phone: String(lead.phone || ""), email: "" }, quote, policy: clone(policy), createdAt: now, history: [{ at: now, from: null, to: "HELD", actor: actor.id, note: `${channel} booking` }], exemption: "pay_at_club" };
        setBooking(t, now, b, "CONFIRMED", actor, "Staff booking, deposit taken at the counter");
        b.confirmedAt = now;
        t.insert("bookings", b);
        outbox(t, now, "export-booking", `${b.id}:confirm`, { bookingId: b.id });
        audit(t, now, actor, "booking.create.staff", b.id, null, { ref: b.ref, slotId: b.slotId, seats }, channel);
        return { booking: bookingView(t, b, { forStaff: true, actor }) };
      });
      notify("availability", {});
      return r;
    },

    async staffCheckIn({ bookingId, arrived }, actor) {
      requirePerm(actor, "booking.checkin");
      return run((t, now) => {
        const b = t.get("bookings", bookingId);
        if (!b) throw new DomainError("NOT_FOUND", "Booking not found");
        const n = arrived == null ? b.partySize : Number(arrived);
        if (!(n >= 1 && n <= b.partySize)) throw new DomainError("INVALID", "Arrived golfers must be between 1 and the party size");
        const before = b.status;
        setBooking(t, now, b, "CHECKED_IN", actor, `${n} of ${b.partySize} arrived`);
        b.attendance = n < b.partySize ? "PARTIAL" : "CHECKED_IN";
        b.arrived = n;
        const p = t.list("payments", (x) => x.bookingId === b.id && x.status === "SUCCEEDED")[0];
        const basis = b.quote?.deposit?.basis || b.policy?.deposit?.basis;
        if (p && n < b.partySize && (b.policy?.partialAttendance || policy.partialAttendance) === "retain_absent_share" && basis === "per_golfer") {
          // The absent golfers' share of what was actually captured (THB 500 for two on the advance tier
          // gives THB 250 each), never the policy's flat amount, and never more than is still held.
          const share = Math.floor((p.capturedMinor * (b.partySize - n)) / b.partySize);
          p.retainedMinor = Math.max(0, Math.min(share, heldOf(t, p))); t.put("payments", p);
          b.disposition = { kind: "partial", retainedMinor: p.retainedMinor, creditedMinor: p.capturedMinor - p.retainedMinor, perGolferMinor: Math.floor(p.capturedMinor / b.partySize) };
        } else if (p) b.disposition = { kind: "credited", creditedMinor: p.capturedMinor };
        t.put("bookings", b);
        audit(t, now, actor, "booking.checkin", b.id, before, { status: b.status, attendance: b.attendance, arrived: n }, null);
        return { booking: bookingView(t, b, { forStaff: true, actor }) };
      });
    },

    async staffNoShow({ bookingId, reason }, actor) {
      requirePerm(actor, "booking.noshow");
      if (!reason || String(reason).trim().length < 3) throw new DomainError("VALIDATION", "Give a reason for the no-show record", { errors: { reason: "required" } });
      return run((t, now) => {
        const b = t.get("bookings", bookingId);
        if (!b) throw new DomainError("NOT_FOUND", "Booking not found");
        const graceEnds = b.startMs + b.policy.noShow.graceMinutes * 60e3;
        if (now < graceEnds) throw new DomainError("TOO_EARLY", "The grace period has not ended yet", { graceEnds });
        const before = b.status;
        setBooking(t, now, b, "NO_SHOW", actor, reason);
        b.attendance = "NO_SHOW";
        const p = t.list("payments", (x) => x.bookingId === b.id && x.status === "SUCCEEDED")[0];
        // The deposit still held is kept as the no-show fee. No new charge is created.
        if (p) { p.retainedMinor = heldOf(t, p); t.put("payments", p); }
        b.disposition = { kind: "no_show", retainedMinor: p ? p.retainedMinor : 0 };
        t.put("bookings", b);
        audit(t, now, actor, "booking.noshow", b.id, before, { status: "NO_SHOW", retainedMinor: b.disposition.retainedMinor }, reason);
        return { booking: bookingView(t, b, { forStaff: true, actor }) };
      });
    },

    async staffCorrectAttendance({ bookingId, reason }, actor) {
      requirePerm(actor, "attendance.correct");
      if (!reason) throw new DomainError("VALIDATION", "Give a reason for the correction", { errors: { reason: "required" } });
      return run((t, now) => {
        const b = t.get("bookings", bookingId);
        if (!b) throw new DomainError("NOT_FOUND", "Booking not found");
        setBooking(t, now, b, "CHECKED_IN", actor, `Correction: ${reason}`);
        b.attendance = "CHECKED_IN";
        const p = t.list("payments", (x) => x.bookingId === b.id && x.status === "SUCCEEDED")[0];
        if (p) { p.retainedMinor = 0; t.put("payments", p); }
        b.disposition = { kind: "credited", creditedMinor: p ? p.capturedMinor : 0 };
        t.put("bookings", b);
        audit(t, now, actor, "attendance.correct", b.id, "NO_SHOW", "CHECKED_IN", reason);
        return { booking: bookingView(t, b, { forStaff: true, actor }) };
      });
    },

    async staffCancel({ bookingId, reason, clubInitiated = false }, actor) {
      requirePerm(actor, "booking.cancel");
      const r = await run((t, now) => {
        const b = t.get("bookings", bookingId);
        if (!b) throw new DomainError("NOT_FOUND", "Booking not found");
        if (b.status === "CANCELLED") return { booking: bookingView(t, b, { forStaff: true, actor }), alreadyCancelled: true };
        if (b.status !== "CONFIRMED") throw new DomainError("NOT_CANCELLABLE", `A ${b.status} booking cannot be cancelled here`);
        const outcome = clubInitiated ? { kind: "refund", refundMinor: paidOf(t, b), retainedMinor: 0, reason: "club" } : cancellationOutcome(t, b, now);
        applyCancellation(t, now, b, outcome, actor, reason || (clubInitiated ? "Club-initiated" : "Cancelled by staff"));
        return { booking: bookingView(t, b, { forStaff: true, actor }), outcome };
      });
      notify("availability", {});
      return r;
    },

    async staffMove({ bookingId, newSlotId, preview = false }, actor) {
      requirePerm(actor, "booking.move");
      return run((t, now) => {
        const b = t.get("bookings", bookingId);
        if (!b || b.status !== "CONFIRMED") throw new DomainError("NOT_CHANGEABLE", "Only confirmed bookings can be moved");
        return move(t, now, b, newSlotId, actor, { preview });
      });
    },

    /** Desk lookup for the check-in card: a staff member with tee-sheet access reads the booking by its
     *  public reference. Reading it changes nothing; check-in stays a separate, deliberate action. */
    async staffFindBooking({ ref }, actor) {
      requirePerm(actor, "teesheet.view");
      const raw = String(ref || "").trim().toUpperCase();
      const clean = raw.startsWith("KKD1|") ? raw.slice(5) : raw;
      return run((t) => {
        const b = t.list("bookings", { ref: clean })[0];
        if (!b) throw new DomainError("NOT_FOUND", "No booking has that reference");
        return { booking: bookingView(t, b, { forStaff: true, actor }) };
      });
    },

    async staffRefund({ paymentId, amountMinor, reason }, actor) {
      requirePerm(actor, "refund.issue");
      if (!reason) throw new DomainError("VALIDATION", "Give a reason for the refund", { errors: { reason: "required" } });
      return run((t, now) => {
        const p = t.get("payments", paymentId);
        if (!p) throw new DomainError("NOT_FOUND", "Payment not found");
        const available = heldOf(t, p) - (p.retainedMinor || 0); // captured, less refunds and what the club keeps
        const amt = Number(amountMinor);
        if (!(amt > 0 && amt <= available)) throw new DomainError("INVALID", "Refund must be more than zero and no more than the amount still held", { available });
        const b = t.get("bookings", p.bookingId);
        const r = requestRefund(t, now, p, b, amt, reason, actor);
        return { refund: r };
      });
    },

    async staffSettleRefunds(_, actor) {
      requirePerm(actor, "refund.issue");
      const open = await run((t) => t.list("refunds", { status: "SUBMITTED" }));
      const out = [];
      for (const r of open) {
        const ev = provider.makeEvent("refund.succeeded", { refundId: r.id, paymentId: r.paymentId, amountMinor: r.amountMinor }, Date.now());
        const s = await provider.signEvent(ev);
        out.push(await api.receiveWebhook(s.body, s.signature));
      }
      return { settled: out.length };
    },

    async staffCloseSlots({ date, from, to, tees = ["all"], reason, kind = "maintenance" }, actor) {
      requirePerm(actor, "closure.manage");
      if (!reason) throw new DomainError("VALIDATION", "Give a reason", { errors: { reason: "required" } });
      const r = await run((t, now) => {
        const c = { id: randomId("cl"), date, from, to, tees, reason, kind, active: true, createdAt: now, actor: actor.id };
        t.insert("closures", c);
        let review = 0;
        for (const s of slotsForDate(config, date).filter((s) => closureFor(t, s)?.id === c.id)) {
          for (const h of t.list("holds", (x) => x.status === "ACTIVE" && x.slotId === s.id)) {
            const b = h.bookingId ? t.get("bookings", h.bookingId) : null;
            if (b && b.status === "PAYMENT_PENDING") continue; // let payment finish; it becomes an exception
            h.status = "RELEASED"; t.put("holds", h);
            if (b && b.status === "HELD") { setBooking(t, now, b, "CANCELLED", actor, "Time closed"); t.put("bookings", b); }
          }
          for (const b of t.list("bookings", (x) => x.slotId === s.id && x.status === "CONFIRMED")) {
            t.insert("exceptions", { id: randomId("ex"), kind: "CLOSURE_REVIEW", bookingId: b.id, status: "OPEN", createdAt: now, detail: { ref: b.ref, reason, closureId: c.id } });
            review++;
          }
        }
        audit(t, now, actor, "closure.create", c.id, null, c, reason);
        return { closure: c, bookingsToReview: review };
      });
      notify("availability", {});
      return r;
    },

    async staffReopen({ closureId }, actor) {
      requirePerm(actor, "closure.manage");
      return run((t, now) => { const c = t.get("closures", closureId); if (!c) throw new DomainError("NOT_FOUND", "Closure not found"); c.active = false; t.put("closures", c); audit(t, now, actor, "closure.reopen", c.id, true, false, null); return { closure: c }; });
    },

    async listExceptions(_, actor) {
      requirePerm(actor, "exception.view");
      return run((t) => ({ exceptions: t.list("exceptions").sort((a, b) => b.createdAt - a.createdAt), refunds: t.list("refunds").sort((a, b) => b.createdAt - a.createdAt), pendingPayments: t.list("payments", { status: "PENDING" }) }));
    },

    async resolveException({ id, note }, actor) {
      requirePerm(actor, "exception.resolve");
      return run((t, now) => { const e = t.get("exceptions", id); if (!e) throw new DomainError("NOT_FOUND", "Not found"); e.status = "RESOLVED"; e.resolution = { note, by: actor.id, at: now }; t.put("exceptions", e); audit(t, now, actor, "exception.resolve", id, "OPEN", "RESOLVED", note); return { exception: e }; });
    },

    async auditLog({ limit = 80 } = {}, actor) {
      requirePerm(actor, "audit.view");
      return run((t) => ({ entries: t.list("audit").sort((a, b) => b.at - a.at).slice(0, limit) }));
    },

    // conditions publishing
    async draftReading(input, actor) {
      requirePerm(actor, "conditions.draft");
      return run((t, now) => {
        const v = validateReading(input, now, config.conditions);
        if (!v.ok) throw new DomainError("VALIDATION", "Please check the reading", { errors: v.errors });
        const rec = { id: randomId("rd"), version: 1, supersedes: null, measuredAt: input.measuredAt, publishedAt: null, validUntil: input.validUntil || defaultValidUntil(input.measuredAt), scope: input.scope || "course", holeIds: input.holeIds || [], method: "stimpmeter", unit: "ft", value: v.value, range: v.range, operator: input.operator || actor.name?.en || actor.id, notes: input.notes || { th: "", en: "" }, status: "DRAFT", warnings: v.warnings, createdBy: actor.id, createdAt: now };
        t.insert("readings", rec);
        audit(t, now, actor, "reading.draft", rec.id, null, { value: rec.value, range: rec.range, scope: rec.scope }, null);
        return { reading: rec };
      });
    },
    async publishReading({ id, acknowledgeWarnings = false }, actor) {
      requirePerm(actor, "conditions.publish");
      const r = await run((t, now) => {
        const rec = t.get("readings", id);
        if (!rec || rec.status !== "DRAFT") throw new DomainError("INVALID", "Only a draft can be published");
        if (rec.measuredAt > now + 5 * 60e3) throw new DomainError("VALIDATION", "A reading cannot be measured in the future", { errors: { measuredAt: "future" } });
        if (rec.warnings?.length && !acknowledgeWarnings) throw new DomainError("NEEDS_ACK", "Confirm the warnings before publishing", { warnings: rec.warnings });
        rec.status = "PUBLISHED"; rec.publishedAt = now; rec.approvedBy = actor.id; t.put("readings", rec);
        audit(t, now, actor, "reading.publish", rec.id, "DRAFT", "PUBLISHED", null);
        return { reading: rec };
      });
      notify("conditions", {});
      return r;
    },
    async correctReading({ id, input, reason }, actor) {
      requirePerm(actor, "conditions.publish");
      const r = await run((t, now) => {
        const old = t.get("readings", id);
        if (!old || old.status !== "PUBLISHED") throw new DomainError("INVALID", "Only a published reading can be corrected");
        const merged = { measuredAt: old.measuredAt, scope: old.scope, holeIds: old.holeIds, ...input };
        const v = validateReading(merged, now, config.conditions);
        if (!v.ok) throw new DomainError("VALIDATION", "Please check the reading", { errors: v.errors });
        old.status = "SUPERSEDED"; t.put("readings", old);
        const rec = { ...old, id: randomId("rd"), version: old.version + 1, supersedes: old.id, measuredAt: merged.measuredAt, value: v.value, range: v.range, status: "PUBLISHED", publishedAt: now, validUntil: merged.validUntil || defaultValidUntil(merged.measuredAt), correctionReason: reason || null, approvedBy: actor.id, createdBy: actor.id, createdAt: now, warnings: v.warnings };
        t.insert("readings", rec);
        audit(t, now, actor, "reading.correct", rec.id, { id: old.id, value: old.value }, { id: rec.id, value: rec.value }, reason);
        return { reading: rec };
      });
      notify("conditions", {});
      return r;
    },
    async withdrawReading({ id, reason }, actor) {
      requirePerm(actor, "conditions.publish");
      const r = await run((t, now) => {
        const rec = t.get("readings", id);
        if (!rec || !["PUBLISHED", "DRAFT"].includes(rec.status)) throw new DomainError("INVALID", "Nothing to withdraw");
        const before = rec.status; rec.status = "WITHDRAWN"; rec.withdrawnReason = reason || null; t.put("readings", rec);
        audit(t, now, actor, "reading.withdraw", rec.id, before, "WITHDRAWN", reason);
        return { reading: rec };
      });
      notify("conditions", {});
      return r;
    },
    async setCourseStatus({ status, note }, actor) {
      requirePerm(actor, "conditions.publish");
      if (!["open", "partial", "closed"].includes(status)) throw new DomainError("INVALID", "Unknown course status");
      const r = await run((t, now) => { const before = t.get("kv", "course"); const rec = { id: "course", status, note, updatedAt: now, actor: actor.id }; t.put("kv", rec); audit(t, now, actor, "course.status", "course", before?.status, status, note?.en); return { course: rec }; });
      notify("conditions", {});
      return r;
    },
    async addNotice({ th, en, kind = "general" }, actor) {
      requirePerm(actor, "notice.manage");
      if (!th || !en) throw new DomainError("VALIDATION", "Write the notice in Thai and English", { errors: { th: !th && "required", en: !en && "required" } });
      const r = await run((t, now) => { const n = { id: randomId("nt"), kind, th, en, status: "ACTIVE", createdAt: now, actor: actor.id }; t.insert("notices", n); audit(t, now, actor, "notice.add", n.id, null, en, null); return { notice: n }; });
      notify("conditions", {});
      return r;
    },
    async removeNotice({ id }, actor) {
      requirePerm(actor, "notice.manage");
      const r = await run((t, now) => { const n = t.get("notices", id); if (n) { n.status = "REMOVED"; t.put("notices", n); audit(t, now, actor, "notice.remove", id, "ACTIVE", "REMOVED", null); } return { ok: true }; });
      notify("conditions", {});
      return r;
    },
    async listReadings(_, actor) {
      requirePerm(actor, "conditions.draft");
      return run((t, now) => ({ readings: t.list("readings").sort((a, b) => b.measuredAt - a.measuredAt || b.version - a.version), serverTime: now }));
    },

    // calendar-sheet integration (fake adapter in the demo)
    async syncHealth(_, actor) {
      requirePerm(actor, "teesheet.view");
      return run((t, now) => {
        const s = t.get("kv", "sync");
        const out = t.list("outbox");
        return { ...s, source: sourceHealth(t, now), outbox: { pending: out.filter((o) => o.status === "PENDING").length, failed: out.filter((o) => o.status === "FAILED").length, done: out.filter((o) => o.status === "DONE").length }, conflicts: s.conflicts || [], serverTime: now };
      });
    },
    async syncImport(_, actor) {
      requirePerm(actor, "sync.manage");
      return run((t, now) => {
        const date = addDays(bkkDate(now), 2);
        ensureSheetDay(t, date, now);
        const rows = demoSheetRows(config, date).slice(0, 3).map((r) => ({ ...r }));
        // A realistic import: one edited row, one duplicated ID, one row that would overfill a slot.
        const conflicts = [];
        if (rows[0]) { rows[0].version = 2; rows[0].seats = Math.min(4, rows[0].seats + 1); }
        if (rows[1]) conflicts.push({ id: randomId("cf"), kind: "DUPLICATE_ID", extId: rows[1].extId, detail: "The same booking ID appears on two rows", at: now });
        const slots = slotsForDate(config, date);
        const busy = slots.find((s) => usedSeats(t, s.id, now) >= 4);
        if (busy) conflicts.push({ id: randomId("cf"), kind: "CAPACITY_OVERFLOW", slotId: busy.id, detail: "A sheet row would put more than four golfers on a full tee time", at: now });
        let applied = 0;
        if (rows[0]) {
          const cur = t.get("external", rows[0].extId);
          if (cur && cur.version < rows[0].version) {
            const slot = findSlot(config, cur.slotId);
            const room = slot.capacity - (usedSeats(t, slot.id, now) - cur.seats);
            if (rows[0].seats <= room) { t.put("external", { ...cur, seats: rows[0].seats, version: rows[0].version, importedAt: now }); applied++; }
            else conflicts.push({ id: randomId("cf"), kind: "CAPACITY_REDUCTION", extId: cur.extId, detail: "Edited row no longer fits", at: now });
          }
        }
        const s = t.get("kv", "sync");
        s.lastImportAt = now; s.status = conflicts.length ? "CONFLICT" : "CLEAN"; s.conflicts = [...(s.conflicts || []), ...conflicts];
        t.put("kv", s);
        audit(t, now, actor, "sync.import", "sheet", null, { applied, conflicts: conflicts.length }, null);
        return { applied, conflicts };
      });
    },
    async syncExport(_, actor) {
      requirePerm(actor, "sync.manage");
      return run((t, now) => {
        const s = t.get("kv", "sync");
        let done = 0, failed = 0;
        for (const o of t.list("outbox", (x) => x.status === "PENDING" || x.status === "FAILED")) {
          o.attempts++;
          if (s.failExports) { o.status = "FAILED"; o.lastError = "Sheet quota exceeded (simulated)"; failed++; }
          else {
            o.status = "DONE"; o.doneAt = now; done++;
            if (o.kind === "export-booking") { const b = t.get("bookings", o.payload.bookingId); if (b) { b.syncStatus = "CLEAN"; t.put("bookings", b); } }
          }
          t.put("outbox", o);
        }
        s.lastExportAt = failed ? s.lastExportAt : now; s.status = failed ? "FAILED" : (s.conflicts?.length ? "CONFLICT" : "CLEAN"); t.put("kv", s);
        audit(t, now, actor, "sync.export", "sheet", null, { done, failed }, null);
        return { done, failed };
      });
    },
    async resolveConflict({ id, note }, actor) {
      requirePerm(actor, "sync.manage");
      return run((t, now) => { const s = t.get("kv", "sync"); s.conflicts = (s.conflicts || []).filter((c) => c.id !== id); s.status = s.conflicts.length ? "CONFLICT" : "CLEAN"; t.put("kv", s); audit(t, now, actor, "sync.resolve", id, "CONFLICT", "RESOLVED", note); return { ok: true }; });
    },
    async setSimulation({ outage, failExports }, actor) {
      requirePerm(actor, "demo.control");
      const r = await run((t, now) => {
        if (outage != null) t.put("kv", { id: "source", status: outage ? "outage" : "ok", lastVerifiedAt: now - 3 * 60e3 });
        if (failExports != null) { const s = t.get("kv", "sync"); s.failExports = !!failExports; t.put("kv", s); }
        audit(t, now, actor, "demo.simulation", "kv", null, { outage, failExports }, null);
        return { ok: true };
      });
      notify("availability", {});
      return r;
    },
    async setClockOffset({ minutes }, actor) {
      requirePerm(actor, "demo.control");
      const r = await run((t, now) => { const prev = offsetOf(t); t.put("kv", { id: "clock", offsetMs: Math.max(0, Number(minutes) || 0) * 60e3 }); audit(t, now, actor, "demo.clock", "clock", prev, minutes, null); return { offsetMinutes: Number(minutes) || 0 }; });
      notify("availability", {}); notify("conditions", {});
      return r;
    },
    async deliverQueuedEvents(_, actor) {
      requirePerm(actor, "demo.control");
      const q = await run((t) => t.list("pending"));
      const results = [];
      for (const e of q) { results.push(await api.receiveWebhook(e.body, e.signature)); await run((t) => t.del("pending", e.id)); }
      return { delivered: results };
    },
  };

  // ---------- internal operations ----------
  function holdView(h, now) { return { id: h.id, slotId: h.slotId, linkedSlotId: h.linkedSlotId, date: h.date, time: h.time, tee: h.tee, session: h.session, partySize: h.partySize, category: h.category, status: h.status === "ACTIVE" && h.expiresAt <= now ? "EXPIRED" : h.status, expiresAt: h.expiresAt, serverTime: now, bookingId: h.bookingId }; }

  function confirm(t, now, b, h, note) {
    setBooking(t, now, b, "CONFIRMED", null, note);
    b.confirmedAt = now; b.syncStatus = "PENDING_EXPORT";
    t.put("bookings", b);
    if (h) { h.status = "CONVERTED"; t.put("holds", h); }
    outbox(t, now, "export-booking", `${b.id}:confirm`, { bookingId: b.id });
    outbox(t, now, "confirmation-message", `${b.id}:confirmed`, { bookingId: b.id, locale: b.locale });
    audit(t, now, null, "booking.confirm", b.id, "PAYMENT_PENDING", "CONFIRMED", note);
  }

  function paidOf(t, b) { return t.list("payments", (x) => x.bookingId === b.id && ["SUCCEEDED", "REFUND_PENDING", "PARTIALLY_REFUNDED"].includes(x.status)).reduce((s, p) => s + p.capturedMinor - (p.refundedMinor || 0), 0); }
  function pendingRefunds(t, paymentId) { return t.list("refunds", (r) => r.paymentId === paymentId && ["REQUESTED", "SUBMITTED"].includes(r.status)).reduce((s, r) => s + r.amountMinor, 0); }
  /** Funds still held on a payment: captured, less refunds completed or in flight. */
  function heldOf(t, p) { return Math.max(0, p.capturedMinor - (p.refundedMinor || 0) - pendingRefunds(t, p.id)); }

  function cancellationOutcome(t, b, now) {
    const deadline = b.startMs - b.policy.cancellation.freeUntilHoursBefore * 3600e3;
    const paid = paidOf(t, b);
    if (now < deadline) return { kind: "refund", refundMinor: paid, retainedMinor: 0, deadline };
    return { kind: "retain", refundMinor: 0, retainedMinor: paid, deadline };
  }

  function applyCancellation(t, now, b, outcome, actor, note) {
    setBooking(t, now, b, "CANCELLED", actor, note);
    b.cancelledAt = now; b.syncStatus = "PENDING_EXPORT";
    b.disposition = { kind: outcome.kind === "refund" ? "refunded" : "retained", refundMinor: outcome.refundMinor, retainedMinor: outcome.retainedMinor };
    t.put("bookings", b);
    const p = t.list("payments", (x) => x.bookingId === b.id && x.status === "SUCCEEDED")[0];
    if (p && outcome.refundMinor > 0) requestRefund(t, now, p, b, outcome.refundMinor, note, actor);
    if (p && outcome.retainedMinor > 0) { p.retainedMinor = outcome.retainedMinor; t.put("payments", p); }
    outbox(t, now, "export-booking", `${b.id}:cancel`, { bookingId: b.id });
    outbox(t, now, "cancellation-message", `${b.id}:cancelled`, { bookingId: b.id, locale: b.locale });
    audit(t, now, actor, "booking.cancel", b.id, "CONFIRMED", { status: "CANCELLED", ...b.disposition }, note);
  }

  function requestRefund(t, now, p, b, amount, reason, actor) {
    const r = { id: randomId("rf"), paymentId: p.id, bookingId: b?.id || null, amountMinor: amount, status: "SUBMITTED", reason, actor: actor ? actor.id : "system", createdAt: now };
    t.insert("refunds", r);
    if (p.status === "SUCCEEDED" || p.status === "PARTIALLY_REFUNDED") { setPayment(p, "REFUND_PENDING"); t.put("payments", p); }
    audit(t, now, actor, "refund.request", r.id, null, { amountMinor: amount, paymentId: p.id }, reason);
    return r;
  }

  function applyRefundEvent(t, now, ev) {
    const r = t.get("refunds", ev.data.refundId);
    if (!r || r.status === "COMPLETED") return "ignored";
    r.status = "COMPLETED"; r.completedAt = now; t.put("refunds", r);
    const p = t.get("payments", r.paymentId);
    p.refundedMinor = (p.refundedMinor || 0) + r.amountMinor;
    const stillPending = pendingRefunds(t, p.id) > 0;
    if (!stillPending) setPayment(p, p.refundedMinor >= p.capturedMinor ? "REFUNDED" : "PARTIALLY_REFUNDED");
    t.put("payments", p);
    audit(t, now, null, "refund.complete", r.id, "SUBMITTED", "COMPLETED", null);
    return "refund-completed";
  }

  function move(t, now, b, newSlotId, actor, { preview = false } = {}) {
    const slot = findSlot(config, newSlotId);
    if (!slot) throw new DomainError("INVALID", "Unknown tee time");
    const h = horizon(now);
    if (slot.date > h.last) throw new DomainError("OUTSIDE_HORIZON", horizonText(), { first: h.first, last: h.last });
    if (slot.id === b.slotId) throw new DomainError("INVALID", "That is the booking's current time");
    if (slot.startMs < now + 30 * 60e3) throw new DomainError("PAST", "That tee time has passed");
    if (closureFor(t, slot)) throw new DomainError("CLOSED", "That tee time is closed");
    if (slot.memberOnly && b.category !== "member") throw new DomainError("NOT_ELIGIBLE", "That time is reserved for members");
    const linked = linkedSlot(config, slot, slotsForDate(config, slot.date));
    ensureSheetDay(t, slot.date, now);
    // Secure the new capacity before the old booking lets go of its own.
    const rem = remaining(t, slot, linked, now, { excludeBooking: b.id });
    if (rem < b.seats) throw new DomainError("NO_CAPACITY", "The new time does not have room for your group", { remaining: rem });
    // No published rate for the new time: the booking stays exactly as it is.
    let newQuote;
    try { newQuote = quoteFor(slot, b.category, b.partySize, now); }
    catch (e) { throw new DomainError("NO_RATE", "The new time has no published rate for this booking, so it has not been moved", { slotId: slot.id }); }
    // The deposit already paid moves with the booking, even across the advance-deposit boundary.
    const paid = b.quote.depositMinor ?? 0;
    const balance = newQuote.totalMinor != null ? newQuote.totalMinor - paid : null;
    const before = { slotId: b.slotId, totalMinor: b.quote.totalMinor };
    const diff = (newQuote.totalMinor ?? 0) - (b.quote.totalMinor ?? 0);
    const summary = { slotId: slot.id, date: slot.date, time: slot.time, tee: slot.tee, totalMinor: newQuote.totalMinor, depositPaidMinor: paid, balanceMinor: balance, priceDifferenceMinor: diff, planName: newQuote.planName, priceMode: newQuote.priceMode };
    if (preview) return { preview: summary, booking: bookingView(t, b, { forStaff: !!actor, actor }) };
    Object.assign(b, { slotId: slot.id, linkedSlotId: linked?.id || null, date: slot.date, time: slot.time, tee: slot.tee, session: slot.session, startMs: slot.startMs, quote: { ...newQuote, depositMinor: paid, balanceMinor: balance, deposit: b.quote.deposit || null, depositKeptFrom: before.slotId, lines: undefined }, rescheduleCount: (b.rescheduleCount || 0) + 1, syncStatus: "PENDING_EXPORT", updatedAt: now });
    b.history.push({ at: now, from: "CONFIRMED", to: "CONFIRMED", actor: actor ? actor.id : "customer", note: `Moved from ${before.slotId} to ${slot.id}` });
    t.put("bookings", b);
    outbox(t, now, "export-booking", `${b.id}:move:${b.rescheduleCount}`, { bookingId: b.id });
    audit(t, now, actor, "booking.move", b.id, before, { slotId: slot.id, priceDifferenceMinor: diff }, null);
    return { booking: bookingView(t, b, { forStaff: !!actor, actor }), priceDifferenceMinor: diff, moved: summary };
  }

  function conditionsView(t, now) {
    const readings = t.list("readings");
    const latest = latestReading(readings, "course");
    const perHole = readings.filter((r) => r.status === "PUBLISHED" && r.scope === "holes");
    const course = t.get("kv", "course");
    return {
      serverTime: now,
      course,
      reading: latest ? { ...latest, freshness: freshness(latest, now, config.conditions) } : null,
      freshness: freshness(latest, now, config.conditions),
      perHole: perHole.map((r) => ({ ...r, freshness: freshness(r, now, config.conditions) })),
      notices: t.list("notices", { status: "ACTIVE" }).sort((a, b) => b.createdAt - a.createdAt),
      history: readings.filter((r) => r.status !== "DRAFT").sort((a, b) => b.measuredAt - a.measuredAt || b.version - a.version).slice(0, 8),
      rules: { agingAfterHours: config.conditions.agingAfterHours, unit: "ft", method: "stimpmeter" },
    };
  }

  api.parseSlotId = parseSlotId;
  return api;
}

export const PUBLIC_METHODS = ["health", "getPublicConfig", "listAvailability", "listCalendar", "createHold", "getHold", "releaseHold", "createBooking", "startPayment", "sandboxAct", "getBookingStatus", "lookupBooking", "cancelBooking", "rescheduleBooking", "getConditions"];
export const STAFF_METHODS = ["staffTeeSheet", "staffFindBooking", "staffCreateBooking", "staffCheckIn", "staffNoShow", "staffCorrectAttendance", "staffCancel", "staffMove", "staffRefund", "staffSettleRefunds", "staffCloseSlots", "staffReopen", "listExceptions", "resolveException", "auditLog", "draftReading", "publishReading", "correctReading", "withdrawReading", "setCourseStatus", "addNotice", "removeNotice", "listReadings", "syncHealth", "syncImport", "syncExport", "resolveConflict", "setSimulation", "setClockOffset", "deliverQueuedEvents"];
