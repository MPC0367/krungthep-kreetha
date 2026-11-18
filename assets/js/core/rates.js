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

/**
 * Build a quote. Returns integer satang throughout. Throws NO_RATE when no published rate fits,
 * so the interface can say "price not published" instead of inventing one.
 */
export function buildQuote({ rates, policy, holidays, slot, category, partySize }) {
  const version = rateVersionFor(rates, slot.date);
  if (!version) throw new DomainError("NO_RATE", "No rate version covers this date", { date: slot.date });
  const dt = dayType(slot.date, holidays);
  const plan = findPlan(version, { category, session: slot.session, dayType: dt });
  if (!plan) throw new DomainError("NO_RATE", "No published rate for this golfer category and session", { category, session: slot.session, dayType: dt });
  const base = { rateVersion: version.id, rateStatus: version.status, policyVersion: `${policy.id}@${policy.version}`, planId: plan.id, planName: plan.name, dayType: dt, session: slot.session, partySize, currency: "THB", includes: plan.includes || null };
  if (plan.priceMode === "member_account") {
    return { ...base, priceMode: "member_account", perGolferMinor: null, totalMinor: null, depositMinor: 0, balanceMinor: null, exemption: "member_account",
      lines: [{ code: "member-account", qty: partySize, unitMinor: null, totalMinor: null, kind: "account" }] };
  }
  const per = plan.perGolferMinor;
  const total = per * partySize;
  const dep = policy.deposit.basis === "per_golfer" ? policy.deposit.amountMinor * partySize : policy.deposit.amountMinor;
  const deposit = Math.min(dep, total);
  return {
    ...base, priceMode: "package", perGolferMinor: per, totalMinor: total, depositMinor: deposit, balanceMinor: total - deposit,
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
