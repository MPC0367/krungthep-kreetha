// Shared booking UI pieces: money and time formatting, the summary card, the hold countdown and
// the per-tab booking flow record (kept in sessionStorage, never in the URL).
import { formatMoney, formatDate, formatClock, formatDateTime, bkkInstant, toMinutes } from "./core/util.js";

export const lang = document.documentElement.lang === "th" ? "th" : "en";
export const th = lang === "th";
export const root = document.documentElement.dataset.root;
export const explicit = document.documentElement.dataset.target === "artifact";
// Links and redirects follow the page's own route (/zh/, /ja/ too); `lang` stays the content language,
// since the Chinese and Japanese pages are translated from the English text.
export const route = ["th", "en", "zh", "ja"].includes(document.documentElement.lang) ? document.documentElement.lang : "en";
export const link = (p) => `${root}${route}/${p}${explicit && p.endsWith("/") ? "index.html" : ""}`;
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

/** Countdown driven by the server's clock: the client only displays it; the server decides.
 *  The ticking minutes and seconds are visual only. Screen readers get the fixed end time, and the page
 *  announces the hold once when it is two minutes from ending (onLow), never every second. */
export function countdown(el, { expiresAt, serverTime, onEnd, onLow }) {
  const skew = serverTime - Date.now();
  let timer, warned = false;
  const total = Math.max(1, expiresAt - serverTime);
  const until = formatClock(expiresAt, lang);
  el.className = "countdown";
  el.removeAttribute("aria-label");
  el.innerHTML = `<svg class="ring" viewBox="0 0 36 36" aria-hidden="true"><circle cx="18" cy="18" r="15" fill="none" stroke="currentColor" stroke-opacity=".2" stroke-width="4"/><circle data-ring cx="18" cy="18" r="15" fill="none" stroke="currentColor" stroke-width="4" transform="rotate(-90 18 18)"/></svg><span class="sr-only" data-cd-sr></span><span aria-hidden="true" data-cd-text></span>`;
  const ring = el.querySelector("[data-ring]"), text = el.querySelector("[data-cd-text]"), sr = el.querySelector("[data-cd-sr]");
  sr.textContent = th ? `กันเวลาไว้ให้ถึง ${until}` : `Held for you until ${until}`;
  const tick = () => {
    const left = expiresAt - (Date.now() + skew);
    const s = Math.max(0, Math.round(left / 1000));
    const mmss = `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
    el.className = "countdown" + (s === 0 ? " gone" : s < 120 ? " low" : "");
    ring.setAttribute("stroke-dasharray", `${(Math.max(0, Math.min(1, left / total)) * 94.2).toFixed(1)} 94.2`);
    // One text node per state, so the Chinese and Japanese pages translate the whole sentence.
    text.textContent = s === 0 ? (th ? "หมดเวลากันที่แล้ว" : "Your hold has ended") : th ? `กันเวลาไว้ให้ถึง ${until} (เหลือ ${mmss})` : `Held for you until ${until} (${mmss} left)`;
    if (s === 0) { sr.textContent = th ? "หมดเวลากันที่แล้ว" : "Your hold has ended"; clearInterval(timer); onEnd?.(); }
    else if (s <= 120 && !warned) { warned = true; onLow?.(); }
  };
  tick(); timer = setInterval(tick, 1000);
  return () => clearInterval(timer);
}

/** The held time and its price next to the decision: package, price per golfer, quantity, total,
 *  deposit and balance. Each sentence is its own text node so the Chinese and Japanese pages translate it. */
export function summaryHTML({ date, time: t, tee, partySize, category, quote, policy, linkedSlotId }) {
  const deadline = bkkInstant(date, t) - (policy?.cancellation?.freeUntilHoursBefore ?? 48) * 3600e3;
  const turn = linkedSlotId ? linkedSlotId.slice(11, 13) + ":" + linkedSlotId.slice(13, 15) : null;
  const memberAcct = quote?.priceMode === "member_account";
  const per = quote?.perGolferMinor ?? (quote?.totalMinor != null ? Math.round(quote.totalMinor / partySize) : null);
  const passed = deadline <= Date.now();
  const turnText = turn ? (linkedSlotId.endsWith("-10") ? (th ? ` เลี้ยวไปแท่นที 10 ประมาณ ${time(turn)}` : `, turning to the 10th tee at about ${turn}`) : (th ? ` เลี้ยวกลับแท่นที 1 ประมาณ ${time(turn)}` : `, turning to the 1st tee at about ${turn}`)) : "";
  return `<p class="label">${day(date)}</p>
  <p class="big num">${time(t)}</p>
  <p class="small"><span>${teeName(tee)}</span>${turnText ? `<span>${turnText}</span>` : ""}</p>
  <p class="small">${th ? `${partySize} ท่าน` : `${partySize} golfer${partySize > 1 ? "s" : ""}`}, ${CAT[category][lang]}</p>
  ${memberAcct ? `<div class="notice"><span>${th ? "ค่าบริการของสมาชิกเรียกเก็บผ่านบัญชีสมาชิก ไม่ต้องมัดจำออนไลน์" : "Member fees are charged to the member account. No online deposit."}</span></div>` : `
  <div class="money">
    <div class="item"><span><span>${quote.planName?.[lang] || ""}</span><br><span class="muted num">${money(per)} &times; ${partySize}</span></span><span>${money(quote.totalMinor)}</span></div>
    <div class="due"><span>${th ? "มัดจำที่ต้องชำระตอนนี้" : "Deposit due now"}</span><span>${money(quote.depositMinor)}</span></div>
    <div><span>${th ? "ยอดคงเหลือ ชำระที่สนาม" : "Balance, paid at the club"}</span><span>${money(quote.balanceMinor)}</span></div>
  </div>
  ${quote.includes ? `<p class="small muted">${th ? "รวมกรีนฟี แคดดี้ และรถกอล์ฟ" : "Includes green fee, caddie and cart"}</p>` : `<p class="small muted">${th ? "โปสเตอร์ไม่ได้ระบุว่าราคานี้รวมอะไรบ้าง สอบถามสมาคมได้" : "The poster does not say what this price includes; ask the club."}</p>`}
  ${quote.depositMinor ? `<p class="small muted">${th ? "มัดจำในระบบตัวอย่าง หักเป็นส่วนหนึ่งของกรีนฟีตามโปสเตอร์ของสมาคม วิธีเรียกเก็บจริงรอสมาคมยืนยัน" : "Demo deposit, credited to the green fee as the club's poster says. How the club charges it is still to be confirmed."}</p>` : ""}`}
  <p class="small">${passed ? (th ? "เลยกำหนดยกเลิกฟรีของเวลานี้แล้ว ตามเงื่อนไขตัวอย่าง หากยกเลิก สมาคมเก็บมัดจำไว้ และไม่เรียกเก็บเพิ่ม" : "Free cancellation has already passed for this time. Under the demo terms, if you cancel, the club keeps the deposit and charges nothing more.") : th ? `ยกเลิกฟรีก่อน ${formatDateTime(deadline, lang)}` : `Free cancellation until ${formatDateTime(deadline, lang)}`}</p>
  <details class="demo-ids"><summary class="photo-note">${th ? "รหัสอัตราและนโยบาย (ค่าตัวอย่าง)" : "Rate and policy versions (demo)"}</summary><p class="photo-note">${th ? `อัตรา ${quote?.rateVersion} นโยบาย ${quote?.policyVersion}` : `Rate ${quote?.rateVersion}, policy ${quote?.policyVersion}`}</p></details>`;
}

export { toMinutes };
