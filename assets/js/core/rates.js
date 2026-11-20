// The one rate engine. Every price on the site is derived here from content/rates.json and the
// policy snapshot, so a quote can be reproduced from its rate version and inputs (brief section 12).
import { dayKey, DomainError } from "./util.js";

export function dayType(date, holidays = []) {
  const k = dayKey(date);
  return k === "sat" || k === "sun" || holidays.includes(date) ? "weekend_holiday" : "weekday";
}

export function rateVersionFor(rates, date) {
  const v = rates.versions.filter((x) => x.effectiveFrom <= date && (!x.effectiveTo || date <= x.effectiveTo));
  return v.sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : -1))[0] || null;
}

export function findPlan(version, { category, session, dayType: dt }) {
  // Precedence: an exact day-type match beats a plan valid on any day.
  const fits = version.plans.filter((p) => p.category === category && p.sessions.includes(session) && (p.dayType === dt || p.dayType === "any"));
  return fits.find((p) => p.dayType === dt) || fits[0] || null;
}

/** Whole Bangkok calendar days from one civil date to another ("2026-11-20" to "2026-11-28" is 8).
 *  Both are plain dates, so the browser's time zone and the time of day cannot move the boundary. */
export function leadDays(fromDate, toDate) {
  const ord = (d) => { const [y, m, dd] = d.split("-").map(Number); return Date.UTC(y, m - 1, dd) / 864e5; };
  return ord(toDate) - ord(fromDate);
}

/** The deposit rule for a lead time. A policy without tiers (version 1) has one flat amount. With no
 *  booking date the standard (first, shortest-lead) tier applies, never the lower advance amount. */
export function depositRule(policy, lead) {
  const d = policy.deposit;
  const tiers = d.tiers?.length ? d.tiers : [{ id: "standard", minLeadDays: 0, amountMinor: d.amountMinor }];
  const first = [...tiers].sort((a, b) => (a.minLeadDays ?? 0) - (b.minLeadDays ?? 0))[0];
  const t = lead == null ? first : tiers.find((x) => lead >= (x.minLeadDays ?? 0) && (x.maxLeadDays == null || lead <= x.maxLeadDays)) || first;
  return { tier: t.id, unitMinor: t.amountMinor, basis: t.basis || d.basis, assumption: !!t.assumption };
}

/**
 * Build a quote. Returns integer satang throughout. Throws NO_RATE when no published rate fits,
 * so the interface can say "price not published" instead of inventing one. `bookingDate` is the
 * service's Bangkok date when the hold is made; it decides the deposit tier (Phase 2 brief, p. 8-9).
 * The quote stores its own breakdown, so a held or booked quote never reprices later.
 */
export function buildQuote({ rates, policy, holidays, slot, category, partySize, bookingDate = null }) {
  const version = rateVersionFor(rates, slot.date);
  if (!version) throw new DomainError("NO_RATE", "No rate version covers this date", { date: slot.date });
  const dt = dayType(slot.date, holidays);
  const plan = findPlan(version, { category, session: slot.session, dayType: dt });
  if (!plan) throw new DomainError("NO_RATE", "No published rate for this golfer category and session", { category, session: slot.session, dayType: dt });
  const lead = bookingDate ? leadDays(bookingDate, slot.date) : null;
  const base = { rateVersion: version.id, rateStatus: version.status, policyVersion: `${policy.id}@${policy.version}`, planId: plan.id, planName: plan.name, dayType: dt, session: slot.session, partySize, currency: "THB", includes: plan.includes || null, bookingDate, leadDays: lead };
  if (plan.priceMode === "member_account") {
    return { ...base, priceMode: "member_account", perGolferMinor: null, totalMinor: null, depositMinor: 0, balanceMinor: null, exemption: "member_account",
      deposit: { tier: null, unitMinor: 0, basis: null, partySize, leadDays: lead, exempt: "member_account" },
      lines: [{ code: "member-account", qty: partySize, unitMinor: null, totalMinor: null, kind: "account" }] };
  }
  const per = plan.perGolferMinor;
  const total = per * partySize;
  const rule = depositRule(policy, lead);
  const dep = rule.basis === "per_golfer" ? rule.unitMinor * partySize : rule.unitMinor;
  const deposit = Math.min(dep, total); // never collect more than the priced package
  return {
    ...base, priceMode: "package", perGolferMinor: per, totalMinor: total, depositMinor: deposit, balanceMinor: total - deposit,
    deposit: { tier: rule.tier, unitMinor: rule.unitMinor, basis: rule.basis, partySize, leadDays: lead, assumption: rule.assumption, capped: deposit < dep },
    lines: [
      { code: plan.id, qty: partySize, unitMinor: per, totalMinor: total, kind: "fee" },
      { code: "deposit-now", qty: 1, unitMinor: deposit, totalMinor: deposit, kind: "deposit" },
      { code: "balance-at-club", qty: 1, unitMinor: total - deposit, totalMinor: total - deposit, kind: "balance" },
    ],
  };
}

/** Lowest published visitor price for a day type, used by the homepage and rates page. */
export function fromPrice(rates, date, dt) {
  const v = rateVersionFor(rates, date);
  if (!v) return null;
  const prices = v.plans.filter((p) => p.category === "visitor" && (p.dayType === dt || p.dayType === "any") && p.perGolferMinor).map((p) => p.perGolferMinor);
  return prices.length ? Math.min(...prices) : null;
}
