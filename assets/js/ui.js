// Shared booking UI pieces: money and time formatting, the summary card, the hold countdown and
// the per-tab booking flow record (kept in sessionStorage, never in the URL).
import { formatMoney, formatDate, formatClock, formatDateTime, bkkInstant, toMinutes } from "./core/util.js";

export const lang = document.documentElement.lang === "th" ? "th" : "en";
export const th = lang === "th";
export const root = document.documentElement.dataset.root;
export const explicit = document.documentElement.dataset.target === "artifact";
export const link = (p) => `${root}${lang}/${p}${explicit && p.endsWith("/") ? "index.html" : ""}`;
export const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
export const money = (m) => formatMoney(m, lang);
export const time = (hhmm) => (th ? `${hhmm.replace(":", ".")} น.` : hhmm);
export const day = (d, o) => formatDate(d, lang, o);
export { formatClock, formatDateTime };

export const CAT = { visitor: { th: "นักกอล์ฟทั่วไป", en: "Visitor" }, member_guest: { th: "แขกของสมาชิก", en: "Member's guest" }, member: { th: "สมาชิก", en: "Member" } };
export const SESSION = { morning: { th: "รอบเช้า", en: "Morning" }, afternoon: { th: "รอบบ่าย", en: "Afternoon" }, twilight: { th: "ทไวไลท์", en: "Twilight" } };
export const teeName = (t) => (th ? `แท่นที ${t}` : t === "10" ? "10th tee" : "1st tee");

export const flow = {
  get() { try { return JSON.parse(sessionStorage.getItem("kk.flow") || "null"); } catch { return null; } },
  set(v) { try { sessionStorage.setItem("kk.flow", JSON.stringify({ ...(flow.get() || {}), ...v })); } catch {} },
  clear() { try { sessionStorage.removeItem("kk.flow"); } catch {} },
};

export function errorText(e) {
  const map = {
    NO_CAPACITY: th ? "เวลานี้เพิ่งเต็ม ลองเวลาใกล้เคียงด้านล่าง" : "This time has just filled. Try one of the nearby times below.",
    HOLD_EXPIRED: th ? "การกันเวลาหมดอายุแล้ว กรุณาเลือกเวลาใหม่" : "Your hold has expired. Please choose a time again.",
    STALE_SOURCE: th ? "ตอนนี้ยังยืนยันเวลาที่ว่างไม่ได้ ลองใหม่อีกครั้ง หรือโทรจองโดยตรง" : "We cannot confirm availability right now. Try again, or call the booking desk.",
    NETWORK: th ? "การเชื่อมต่อขาดหาย ข้อมูลที่กรอกยังอยู่ ลองใหม่อีกครั้ง" : "Connection lost. What you entered is kept; try again.",
    NOT_ELIGIBLE: th ? "ไม่สามารถยืนยันสิทธิ์สำหรับเวลานี้ได้" : "We could not confirm eligibility for this time.",
    CLOSED: th ? "เวลานี้ปิดรับจอง" : "This time is closed.",
    PAST: th ? "เวลานี้ผ่านไปแล้วหรือใกล้เกินกว่าจะจองออนไลน์" : "This time has passed or is too soon to book online.",
    PAYMENT_IN_PROGRESS: th ? "มีรายการชำระเงินค้างอยู่สำหรับเวลาที่คุณเลือกไว้ก่อนหน้า" : "A payment is already in progress for your earlier selection.",
    NO_RATE: th ? "ยังไม่มีอัตราค่าบริการที่ประกาศสำหรับผู้เล่นประเภทนี้ในช่วงเวลานี้" : "No published rate for this golfer type at this time.",
    RATE_LIMITED: th ? "ลองหลายครั้งเกินไป รอสักครู่แล้วลองใหม่" : "Too many attempts. Wait a moment and try again.",
  };
  return map[e?.code] || e?.message || (th ? "เกิดข้อผิดพลาด ลองใหม่อีกครั้ง" : "Something went wrong. Please try again.");
}

/** Countdown driven by the server's clock: the client only displays it; the server decides. */
export function countdown(el, { expiresAt, serverTime, onEnd }) {
  const skew = serverTime - Date.now();
  let timer;
  const total = Math.max(1, expiresAt - serverTime);
  const tick = () => {
    const left = expiresAt - (Date.now() + skew);
    const s = Math.max(0, Math.round(left / 1000));
    const mm = String(Math.floor(s / 60)).padStart(2, "0"), ss = String(s % 60).padStart(2, "0");
    el.className = "countdown" + (s === 0 ? " gone" : s < 120 ? " low" : "");
    const frac = Math.max(0, Math.min(1, left / total));
    el.innerHTML = `<svg class="ring" viewBox="0 0 36 36" aria-hidden="true"><circle cx="18" cy="18" r="15" fill="none" stroke="currentColor" stroke-opacity=".2" stroke-width="4"/><circle cx="18" cy="18" r="15" fill="none" stroke="currentColor" stroke-width="4" stroke-dasharray="${(frac * 94.2).toFixed(1)} 94.2" transform="rotate(-90 18 18)"/></svg><span>${s === 0 ? (th ? "หมดเวลากันที่แล้ว" : "Your hold has ended") : th ? `กันเวลาไว้ให้ถึง ${formatClock(expiresAt, lang)} (เหลือ <span class="num">${mm}:${ss}</span>)` : `Held for you until ${formatClock(expiresAt, lang)} (<span class="num">${mm}:${ss}</span> left)`}</span>`;
    el.setAttribute("aria-label", s === 0 ? (th ? "หมดเวลากันที่แล้ว" : "Hold ended") : (th ? `เหลือเวลา ${Math.ceil(s / 60)} นาที` : `${Math.ceil(s / 60)} minutes left`));
    if (s === 0) { clearInterval(timer); onEnd?.(); }
  };
  tick(); timer = setInterval(tick, 1000);
  return () => clearInterval(timer);
}

export function summaryHTML({ date, time: t, tee, partySize, category, quote, policy, linkedSlotId }) {
  const deadline = bkkInstant(date, t) - (policy?.cancellation?.freeUntilHoursBefore ?? 48) * 3600e3;
  const turn = linkedSlotId ? linkedSlotId.slice(11, 13) + ":" + linkedSlotId.slice(13, 15) : null;
  const memberAcct = quote?.priceMode === "member_account";
  return `<p class="label">${day(date)}</p>
  <p class="big num">${time(t)}</p>
  <p class="small">${teeName(tee)}${turn ? (linkedSlotId.endsWith("-10") ? (th ? ` เลี้ยวไปแท่นที 10 ประมาณ ${time(turn)}` : `, turning to the 10th tee at about ${turn}`) : (th ? ` เลี้ยวกลับแท่นที 1 ประมาณ ${time(turn)}` : `, turning to the 1st tee at about ${turn}`)) : ""}</p>
  <p class="small">${th ? `${partySize} ท่าน` : `${partySize} golfer${partySize > 1 ? "s" : ""}`}, ${CAT[category][lang]}</p>
  ${memberAcct ? `<div class="notice"><span>${th ? "ค่าบริการของสมาชิกเรียกเก็บผ่านบัญชีสมาชิก ไม่ต้องมัดจำออนไลน์" : "Member fees are charged to the member account. No online deposit."}</span></div>` : `
  <div class="money">
    <div><span>${quote.planName?.[lang] || ""} &times; ${partySize}</span><span>${money(quote.totalMinor)}</span></div>
    <div class="due"><span>${th ? "มัดจำที่ต้องชำระตอนนี้" : "Deposit due now"}</span><span>${money(quote.depositMinor)}</span></div>
    <div><span>${th ? "ยอดคงเหลือ ชำระที่สนาม" : "Balance, paid at the club"}</span><span>${money(quote.balanceMinor)}</span></div>
  </div>
  ${quote.includes ? `<p class="small muted">${th ? "รวมกรีนฟี แคดดี้ และรถกอล์ฟ" : "Includes green fee, caddie and cart"}</p>` : `<p class="small muted">${th ? "โปสเตอร์ไม่ได้ระบุว่าราคานี้รวมอะไรบ้าง สอบถามสมาคมได้" : "The poster does not say what this price includes; ask the club."}</p>`}`}
  <p class="small">${th ? `ยกเลิกฟรีก่อน ${formatDateTime(deadline, lang)}` : `Free cancellation until ${formatDateTime(deadline, lang)}`}</p>
  <p class="photo-note">${th ? `อัตรา ${quote.rateVersion} นโยบาย ${quote.policyVersion} (ค่าตัวอย่าง)` : `Rate ${quote.rateVersion}, policy ${quote.policyVersion} (illustrative)`}</p>`;
}

export { toMinutes };
