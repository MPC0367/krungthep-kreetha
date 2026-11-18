// Shared helpers for money, Bangkok time and identifiers. Runs unchanged in the browser and in Node 24.

export const TZ = "Asia/Bangkok";
export const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const BKK_OFFSET = 7 * 3600e3; // Thailand has no daylight saving

export const pad = (n, w = 2) => String(n).padStart(w, "0");

/** Calendar parts of an instant, in Bangkok. */
export function bkkParts(ms) {
  const d = new Date(ms + BKK_OFFSET);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), h: d.getUTCHours(), mi: d.getUTCMinutes(), s: d.getUTCSeconds(), dow: d.getUTCDay() };
}
export function bkkDate(ms) { const p = bkkParts(ms); return `${p.y}-${pad(p.m)}-${pad(p.d)}`; }
export function bkkTime(ms) { const p = bkkParts(ms); return `${pad(p.h)}:${pad(p.mi)}`; }
/** The UTC instant of a Bangkok local date and time. */
export function bkkInstant(date, hhmm = "00:00") {
  const [y, m, d] = date.split("-").map(Number);
  const [h, mi] = hhmm.split(":").map(Number);
  return Date.UTC(y, m - 1, d, h, mi) - BKK_OFFSET;
}
export function addDays(date, n) { return bkkDate(bkkInstant(date, "12:00") + n * 864e5); }
export function dayKey(date) { return DAY_KEYS[bkkParts(bkkInstant(date, "12:00")).dow]; }
export function toMinutes(hhmm) { const [h, m] = hhmm.split(":").map(Number); return h * 60 + m; }
export function fromMinutes(min) { return `${pad(Math.floor(min / 60))}:${pad(min % 60)}`; }
export function isValidDate(s) { return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && bkkDate(bkkInstant(s, "12:00")) === s; }

/** THB from integer satang. Thai shows "3,600 บาท", English "THB 3,600". */
// In the browser, Chinese and Japanese pages format dates and money in their own language.
const PAGE = typeof document !== "undefined" ? document.documentElement?.lang : null;
const loc = (l) => (l === "en" && (PAGE === "zh" || PAGE === "ja") ? PAGE : l);
const INTL = { th: "th-TH-u-ca-buddhist", zh: "zh-CN", ja: "ja-JP" };
export function formatMoney(minor, locale = "en", { sign = false } = {}) {
  if (minor == null) return "";
  locale = loc(locale);
  const baht = minor / 100;
  const n = new Intl.NumberFormat(locale === "th" ? "th-TH" : "en-US", { minimumFractionDigits: Number.isInteger(baht) ? 0 : 2, maximumFractionDigits: 2 }).format(Math.abs(baht));
  const s = sign && minor < 0 ? "-" : "";
  return locale === "th" ? `${s}${n} บาท` : locale === "zh" ? `${s}${n} 泰铢` : locale === "ja" ? `${s}${n}バーツ` : `${s}THB ${n}`;
}

/** Dates shown to people: Thai uses the Buddhist Era (as the club does); storage stays ISO. */
export function formatDate(date, locale = "en", opts = { weekday: "long", day: "numeric", month: "long", year: "numeric" }) {
  const ms = bkkInstant(date, "12:00");
  locale = loc(locale);
  return new Intl.DateTimeFormat(INTL[locale] || "en-GB", { timeZone: TZ, ...opts }).format(ms);
}
export function formatDateTime(ms, locale = "en") {
  locale = loc(locale);
  return new Intl.DateTimeFormat(INTL[locale] || "en-GB", { timeZone: TZ, day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(ms);
}
export function formatClock(ms, locale = "en") {
  const t = bkkTime(ms);
  return locale === "th" ? `${t.replace(":", ".")} น.` : t;
}

const ALPHA = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
function rnd(bytes) { const a = new Uint8Array(bytes); globalThis.crypto.getRandomValues(a); return a; }
export function randomId(prefix = "id", bytes = 9) {
  return `${prefix}_${[...rnd(bytes)].map((b) => b.toString(36).padStart(2, "0")).join("").slice(0, bytes * 2)}`;
}
export function bookingRef() { return "KK-" + [...rnd(6)].map((b) => ALPHA[b % ALPHA.length]).join(""); }
export function secretToken() { return [...rnd(24)].map((b) => b.toString(16).padStart(2, "0")).join(""); }

export async function sha256Hex(text) {
  const buf = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
export async function hmacHex(secret, body) {
  const key = await globalThis.crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await globalThis.crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
/** Constant-time string compare for signatures. */
export function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
/** Small deterministic hash for synthetic demo fixtures (FNV-1a). */
export function hash32(s) { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); } return h >>> 0; }
export function stableStringify(v) {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  return `{${Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => JSON.stringify(k) + ":" + stableStringify(v[k])).join(",")}}`;
}
export const clone = (o) => (o == null ? o : JSON.parse(JSON.stringify(o)));

/** Errors the interface can recover from carry a stable code. */
export class DomainError extends Error {
  constructor(code, message, detail = {}) { super(message || code); this.code = code; this.detail = detail; }
  toJSON() { return { code: this.code, message: this.message, detail: this.detail }; }
}
