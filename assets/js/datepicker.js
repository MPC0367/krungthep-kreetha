// The playing-date picker shared by the homepage finder and the tee sheet (Phase 2 brief, pp. 5 to 7).
// One month at a time from a single aggregate call (listCalendar), the chosen day's starts from the same
// listAvailability the tee sheet uses, so every state leads to the same result as the tee sheet. Choosing a
// day never holds anything; only choosing a time does, through the page's own hold path.
// Keyboard: one tab stop in the grid, arrows for days and weeks, Home and End for the week's edges,
// Page Up and Page Down for months, Enter or Space to choose, Escape to close (W3C date picker dialog).
import { addDays, formatDate } from "./core/util.js";
import { lang, th, money, time, day, esc, depositText, dueNowText } from "./ui.js";

const still = () => matchMedia("(prefers-reduced-motion: reduce)").matches || document.documentElement.classList.contains("is-paused");
const monthOf = (d) => d.slice(0, 7);
const firstOf = (ym) => `${ym}-01`;
const shiftMonth = (ym, n) => { let [y, m] = ym.split("-").map(Number); m += n; while (m > 12) { m -= 12; y++; } while (m < 1) { m += 12; y--; } return `${y}-${String(m).padStart(2, "0")}`; };
const lastOf = (ym) => addDays(firstOf(shiftMonth(ym, 1)), -1);
const isoDow = (d) => (new Date(`${d}T12:00:00Z`).getUTCDay() + 6) % 7; // Monday 0 ... Sunday 6
const golfersText = (n) => (th ? `${n} ท่าน` : `${n} golfer${n > 1 ? "s" : ""}`);
const CAT = { visitor: th ? "นักกอล์ฟทั่วไป" : "Visitor", member_guest: th ? "แขกของสมาชิก" : "Member's guest", member: th ? "สมาชิก" : "Member" };
let uid = 0;

/** The words for a day's state, used for the cell's accessible name, the legend and the readout. */
export function dayStateText(d, golfers) {
  if (!d) return th ? "กำลังตรวจสอบ" : "Checking";
  switch (d.state) {
    case "open": return th ? `มี ${d.bookable} เวลาให้จอง` : d.bookable === 1 ? "1 tee time to book" : `${d.bookable} tee times to book`;
    case "full": return th ? "เต็มแล้ว" : "Full";
    case "no_fit": return th ? `ที่ว่างไม่พอสำหรับ ${golfers} ท่าน` : `Not enough places for ${golfers}`;
    case "no_rate": return th ? "ยังไม่มีราคาประกาศสำหรับผู้เล่นประเภทนี้" : "No published rate for this golfer type";
    case "closed": return d.reason === "course-hire" ? (th ? "สงวนไว้สำหรับปิดสนาม ไม่มีเวลาออนไลน์" : "Course hire, no online tee times") : (th ? `ปิด ${d.reason || ""}` : `Closed: ${d.reason || "see notices"}`);
    case "stale": return th ? "ยังยืนยันเวลาไม่ได้ในขณะนี้" : "Times cannot be confirmed right now";
    case "past": return th ? "หมดเวลาจองของวันนี้แล้ว" : "No more tee times today";
    case "not_eligible": return th ? "ยืนยันสิทธิ์สมาชิกก่อน" : "Verify membership first";
    case "outside": return th ? "อยู่นอกช่วงที่เปิดจองออนไลน์" : "Outside the online booking window";
    default: return th ? "ตรวจสอบเวลา" : "Check times";
  }
}

export { depositText, dueNowText };

/**
 * createPicker({ trigger, api, getCfg, getCriteria, getValue, onCommit, onPickTime, timesNote })
 *  getCriteria() -> { partySize, category, memberNumber }; getValue() -> committed date
 *  onCommit(date) when a day is chosen; onPickTime(slot, date) when a start is chosen in the panel.
 */
export function createPicker({ trigger, api, getCfg, getCriteria, getValue, onCommit, onPickTime, anchor, sheetTitle }) {
  const id = `cal${++uid}`;
  const layer = document.createElement("div");
  layer.className = "cal-layer"; layer.hidden = true;
  const dow = Array.from({ length: 7 }, (_, i) => formatDate(addDays("2026-11-23", i), lang, { weekday: "short" }));
  const dowLong = Array.from({ length: 7 }, (_, i) => formatDate(addDays("2026-11-23", i), lang, { weekday: "long" }));
  layer.innerHTML = `<div class="cal-backdrop" data-cal-close></div>
  <div class="cal-pop" role="dialog" aria-modal="true" aria-labelledby="${id}-h" tabindex="-1">
    <div class="cal-top"><h2 class="cal-h" id="${id}-h">${sheetTitle || (th ? "เลือกวันที่เล่น" : "Choose a playing date")}</h2><button type="button" class="cal-x" data-cal-close aria-label="${th ? "ปิด" : "Close"}"><span aria-hidden="true">&times;</span></button></div>
    <div class="cal-body">
      <div class="cal-month">
        <div class="cal-nav"><button type="button" class="cal-arrow" data-cal-prev aria-label="${th ? "เดือนก่อน" : "Previous month"}"><span aria-hidden="true">&lsaquo;</span></button><p class="cal-label" id="${id}-m" data-cal-label></p><button type="button" class="cal-arrow" data-cal-next aria-label="${th ? "เดือนถัดไป" : "Next month"}"><span aria-hidden="true">&rsaquo;</span></button></div>
        <table class="cal-grid" role="grid" aria-labelledby="${id}-m"><thead><tr>${dow.map((d, i) => `<th scope="col" abbr="${esc(dowLong[i])}">${esc(d)}</th>`).join("")}</tr></thead><tbody data-cal-days></tbody></table>
        <p class="cal-legend small" aria-hidden="true"><span><i class="lg-open"></i>${th ? "มีเวลาว่าง" : "Times to book"}</span><span><i class="lg-full"></i>${th ? "เต็มหรือจองไม่ได้" : "Full or not bookable"}</span><span><i class="lg-hire"></i>${th ? "วันจันทร์ ปิดสนาม" : "Mondays: course hire"}</span></p>
        <div class="cal-tools"><button type="button" class="btn small secondary" data-cal-today hidden>${th ? "กลับไปวันนี้" : "Back to today"}</button><label class="cal-type small"><span>${th ? "หรือพิมพ์วันที่" : "Or type a date"}</span><input class="input" type="date" data-cal-input></label></div>
        <p class="sr-only" aria-live="polite" data-cal-live></p>
      </div>
      <div class="cal-times" data-cal-times></div>
    </div>
    <div class="cal-foot"><p class="photo-note">${th ? "ต้นแบบสำหรับเดโม ยอดเงินใช้อัตรามัดจำตัวอย่าง เวลาที่ว่างเป็นข้อมูลตัวอย่าง" : "Concept for the local demo. Amounts use the demo deposit tiers. Availability shown is sample data."}</p><button type="button" class="btn small" data-cal-close>${th ? "เสร็จ" : "Done"}</button></div>
  </div>`;
  document.body.append(layer);
  const pop = layer.querySelector(".cal-pop");
  const tbody = layer.querySelector("[data-cal-days]");
  const label = layer.querySelector("[data-cal-label]");
  const live = layer.querySelector("[data-cal-live]");
  const timesEl = layer.querySelector("[data-cal-times]");
  const typed = layer.querySelector("[data-cal-input]");
  const months = new Map(), daysCache = new Map();
  let view = null, focus = null, isOpen = false, seqM = 0, seqD = 0, restore = null, monthData = null;

  const crit = () => { const c = getCriteria(); return { partySize: c.partySize, category: c.category, memberNumber: c.memberNumber || undefined }; };
  const key = (ym) => { const c = crit(); return `${ym}|${c.partySize}|${c.category}|${c.memberNumber || ""}`; };
  function loadMonth(ym) {
    const k = key(ym);
    if (!months.has(k)) { const p = api.listCalendar({ from: firstOf(ym), to: lastOf(ym), ...crit() }); p.catch(() => months.delete(k)); months.set(k, p); }
    return months.get(k);
  }
  const invalidate = () => { months.clear(); daysCache.clear(); if (isOpen) { renderMonth(); renderTimes(getValue()); } };
  const unsubscribe = api.subscribe?.("availability", invalidate) || (() => {});

  const cfg = () => getCfg();
  const bounds = () => ({ first: cfg().horizon.first, last: cfg().horizon.last });
  const inRange = (d) => d >= bounds().first && d <= bounds().last;
  const clampMonth = (ym) => (ym < monthOf(bounds().first) ? monthOf(bounds().first) : ym > monthOf(bounds().last) ? monthOf(bounds().last) : ym);

  async function renderMonth() {
    const ym = view, my = ++seqM;
    label.textContent = formatDate(firstOf(ym), lang, { month: "long", year: "numeric" });
    layer.querySelector("[data-cal-prev]").disabled = ym <= monthOf(bounds().first);
    layer.querySelector("[data-cal-next]").disabled = ym >= monthOf(bounds().last);
    layer.querySelector("[data-cal-today]").hidden = monthOf(cfg().today) === ym && focus === cfg().today;
    drawGrid(ym, null);
    try {
      const data = await loadMonth(ym);
      if (my !== seqM) return; // a newer month or criteria replaced this request
      monthData = data;
      drawGrid(ym, data);
      const open = data.days.filter((d) => d.state === "open").length;
      live.innerHTML = `<span>${esc(label.textContent)}.</span> <span>${th ? `มี ${open} วันที่มีเวลาให้จอง` : open === 1 ? "1 date with tee times" : `${open} dates with tee times`}</span>`;
    } catch { if (my === seqM) live.textContent = th ? "โหลดปฏิทินไม่สำเร็จ ลองอีกครั้ง" : "The calendar could not load. Try again."; }
  }
  function drawGrid(ym, data) {
    const first = firstOf(ym), last = lastOf(ym), lead = isoDow(first);
    const sel = getValue(), today = cfg().today, g = crit().partySize;
    const byDate = new Map((data?.days || []).map((d) => [d.date, d]));
    let html = "", cells = [];
    for (let i = 0; i < lead; i++) cells.push(`<td role="gridcell" class="cal-pad"></td>`);
    for (let d = first; d <= last; d = addDays(d, 1)) {
      const info = byDate.get(d) || (inRange(d) ? null : { state: "outside" });
      const st = info ? info.state : "loading";
      const cls = ["cal-d", `is-${st === "closed" && info?.reason === "course-hire" ? "hire" : st}`];
      if (d === today) cls.push("is-today");
      const sr = `<span class="sr-only">${esc(formatDate(d, lang))},</span> <span class="sr-only">${esc(dayStateText(info, g))}</span>${d === today ? ` <span class="sr-only">${th ? "วันนี้" : "today"}</span>` : ""}${d === sel ? ` <span class="sr-only">${th ? "วันที่เลือก" : "selected"}</span>` : ""}`;
      cells.push(`<td role="gridcell" aria-selected="${d === sel}"><button type="button" class="${cls.join(" ")}" data-date="${d}" tabindex="${d === focus ? 0 : -1}"${st === "outside" ? ' aria-disabled="true"' : ""}${d === sel ? ' aria-pressed="true"' : ""}><span class="n" aria-hidden="true">${Number(d.slice(8))}</span><span class="mk" aria-hidden="true"></span>${sr}</button></td>`);
    }
    while (cells.length % 7) cells.push(`<td role="gridcell" class="cal-pad"></td>`);
    for (let i = 0; i < cells.length; i += 7) html += `<tr>${cells.slice(i, i + 7).join("")}</tr>`;
    // Keep six rows so the panel never changes height between months.
    while ((html.match(/<tr>/g) || []).length < 6) html += `<tr>${'<td role="gridcell" class="cal-pad"></td>'.repeat(7)}</tr>`;
    const hadFocus = tbody.contains(document.activeElement);
    tbody.innerHTML = html;
    // One tab stop: the focused day, else the chosen day, else the first bookable-window day in this month.
    if (!tbody.querySelector('[tabindex="0"]')) (tbody.querySelector(`[data-date="${sel}"]`) || tbody.querySelector(".cal-d:not(.is-outside)") || tbody.querySelector("[data-date]"))?.setAttribute("tabindex", "0");
    if (hadFocus) tbody.querySelector('[tabindex="0"]')?.focus();
  }

  function setFocus(d, { move = true } = {}) {
    const b = bounds();
    // Keyboard movement stays inside the months that hold bookable dates.
    if (d < firstOf(monthOf(b.first))) d = b.first;
    if (d > lastOf(monthOf(b.last))) d = b.last;
    focus = d;
    if (monthOf(d) !== view) { view = monthOf(d); renderMonth().then(() => move && tbody.querySelector(`[data-date="${d}"]`)?.focus()); return; }
    tbody.querySelectorAll("[data-date]").forEach((x) => x.setAttribute("tabindex", x.dataset.date === d ? "0" : "-1"));
    if (move) tbody.querySelector(`[data-date="${d}"]`)?.focus();
    layer.querySelector("[data-cal-today]").hidden = d === cfg().today;
  }
  function choose(d) {
    if (!inRange(d)) { const lastDay = formatDate(bounds().last, lang); timesEl.innerHTML = `<p class="cal-readout"><span>${esc(formatDate(d, lang))}.</span> <span>${dayStateText({ state: "outside" })}.</span> <span>${th ? `จองออนไลน์ได้ถึง ${lastDay}` : `Online booking runs to ${lastDay}.`}</span></p>`; return; }
    onCommit(d);
    focus = d; typed.value = d;
    if (monthOf(d) === view && monthData?.from.slice(0, 7) === view) { drawGrid(view, monthData); setFocus(d); }
    else setFocus(d);
    renderTimes(d);
  }

  async function renderTimes(d) {
    if (!d) return;
    const my = ++seqD, c = crit();
    timesEl.classList.add("is-updating");
    const head = `<p class="cal-day">${esc(day(d))}</p><p class="small muted">${th ? `เวลากรุงเทพฯ ${golfersText(c.partySize)} ${CAT[c.category]}` : `Bangkok time, ${golfersText(c.partySize)}, ${CAT[c.category]}`}</p>`;
    if (!inRange(d)) { timesEl.innerHTML = head + `<p class="cal-readout">${dayStateText({ state: "outside" })}</p>`; timesEl.classList.remove("is-updating"); return; }
    if (!timesEl.querySelector(".cal-day") || timesEl.dataset.date !== d) timesEl.innerHTML = head + `<p class="small muted cal-wait">${th ? "กำลังอัปเดตเวลา" : "Updating times"}</p>`;
    timesEl.dataset.date = d;
    const k = `${d}|${c.partySize}|${c.category}|${c.memberNumber || ""}`;
    try {
      if (!daysCache.has(k)) { const p = api.listAvailability({ date: d, ...c, clientId: getCriteria().clientId }); p.catch(() => daysCache.delete(k)); daysCache.set(k, p); }
      const a = await daysCache.get(k);
      if (my !== seqD) return;
      const slots = a.sessions?.flatMap((s) => s.slots) || [];
      const ok = slots.filter((s) => ["available", "partial", "yours"].includes(s.state));
      let body = "";
      if (a.dayState === "closed") body = `<p class="cal-readout"><b>${dayStateText({ state: "closed", reason: a.reason })}</b><br><span class="small">${a.reason === "course-hire" ? (th ? "สนามแจ้งเวลาเปิดวันจันทร์ 08.00 ถึง 19.00 น. แต่ระบบตัวอย่างนี้สงวนวันจันทร์ไว้สำหรับปิดสนามจัดการแข่งขัน โทรสอบถาม 0-2736-0378-9" : "The club lists Monday hours of 08:00 to 19:00, but this demo keeps Mondays for course hire. Call 0-2736-0378-9 to ask.") : ""}</span></p>${nextButton(d)}`;
      else if (a.dayState === "stale") body = `<p class="cal-readout"><b>${dayStateText({ state: "stale" })}</b><br><span class="small">${th ? "เราไม่สรุปว่าสนามปิด ลองอีกครั้ง หรือโทร 0-2736-0378-9" : "We do not assume the course is closed. Try again, or call 0-2736-0378-9."}</span></p>`;
      else if (!a.eligibility?.ok) body = `<p class="cal-readout">${dayStateText({ state: "not_eligible" })}</p>`;
      else if (!ok.length) {
        const st = slots.every((s) => s.state === "past") ? "past" : slots.some((s) => s.state === "too_small") ? "no_fit" : slots.some((s) => s.state === "full") ? "full" : "no_rate";
        body = `<p class="cal-readout"><b>${dayStateText({ state: st }, c.partySize)}</b><br><span class="small">${st === "no_fit" ? (th ? "ลองลดจำนวนผู้เล่น หรือเลือกวันอื่น" : "Try a smaller group or another date.") : (th ? "ลองวันอื่น หรือโทรหาแผนกจอง" : "Try another date, or call the booking desk.")}</span></p>${nextButton(d)}`;
      } else {
        const q = ok[0].quote;
        body = `<div class="cal-dep">${q.priceMode === "member_account" ? `<p class="small"><b>${esc(depositText(q))}</b></p>` : `<p class="small"><b>${esc(dueNowText(q, c.partySize))}</b></p><p class="small muted">${esc(depositText(q))}</p>`}</div>
        <div class="cal-slots" role="list">${ok.map((s) => `<div role="listitem"><button type="button" class="cal-slot" data-cal-slot="${s.id}"><b class="num">${time(s.time)}</b><span>${th ? `ที ${s.tee}` : `Tee ${s.tee}`}</span><span class="small muted">${th ? `ว่าง ${s.remaining}` : `${s.remaining} places`}</span></button></div>`).join("")}</div>
        <p class="small muted">${th ? "การเลือกวันยังไม่กันที่ เมื่อเลือกเวลา ระบบจึงกันที่ไว้ให้" : "Choosing a day holds nothing. Choosing a time holds the places."}</p>`;
      }
      timesEl.innerHTML = head + body;
      live.innerHTML = `<span>${esc(day(d))}.</span> <span>${ok.length ? (th ? `มี ${ok.length} เวลาให้จอง` : ok.length === 1 ? "1 tee time to book" : `${ok.length} tee times to book`) : (th ? "ไม่มีเวลาให้จอง" : "No tee times to book")}</span>`;
      if (!still() && timesEl.animate) timesEl.animate([{ opacity: 0.4 }, { opacity: 1 }], { duration: 140, easing: "ease-out" });
    } catch (e) {
      if (my !== seqD) return;
      timesEl.innerHTML = head + `<p class="cal-readout">${th ? "โหลดเวลาไม่สำเร็จ" : "The times could not load."} <button type="button" class="btn small secondary" data-cal-retry>${th ? "ลองใหม่" : "Try again"}</button></p>`;
    } finally { if (my === seqD) timesEl.classList.remove("is-updating"); }
  }
  function nextButton(d) {
    const next = monthData?.days.find((x) => x.date > d && x.state === "open");
    if (!next) return "";
    const when = formatDate(next.date, lang, { weekday: "long", day: "numeric", month: "short" });
    return `<p><button type="button" class="btn small secondary" data-cal-go="${next.date}">${th ? `ดูวันถัดไปที่มีเวลา ${when}` : `Next date with times: ${when}`}</button></p>`;
  }

  // ---- open, place and close
  const sheet = () => innerWidth < 760;
  function place() {
    layer.classList.toggle("is-sheet", sheet());
    if (sheet()) { pop.style.cssText = ""; return; }
    const a = (anchor || trigger).getBoundingClientRect();
    const w = Math.min(Math.max(a.width, 640), innerWidth - 32, 1000);
    const left = Math.max(16, Math.min(a.left, innerWidth - w - 16));
    pop.style.width = `${w}px`; pop.style.left = `${left}px`;
    const h = pop.offsetHeight, header = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--header-h")) || 72;
    const below = innerHeight - a.bottom - 12, above = a.top - header - 12;
    // Below the field when it fits, above it when that fits better, otherwise inside the viewport.
    const top = h <= below ? a.bottom + 8 : h <= above ? a.top - h - 8 : Math.max(header + 8, innerHeight - h - 12);
    pop.style.top = `${Math.round(top)}px`;
  }
  // The month and the day's times arrive after the panel opens, so it is placed again whenever its size changes.
  let lastH = 0;
  const ro = typeof ResizeObserver === "function" ? new ResizeObserver(() => { if (!isOpen || sheet()) return; const h = pop.offsetHeight; if (Math.abs(h - lastH) > 1) { lastH = h; place(); } }) : null;
  ro?.observe(pop);
  function trap(e) {
    if (e.key === "Escape") { e.preventDefault(); close(); return; }
    if (e.key !== "Tab") return;
    const f = [...pop.querySelectorAll('button:not([disabled]):not([tabindex="-1"]), input, a[href], [tabindex="0"]')].filter((x) => x.offsetParent !== null);
    if (!f.length) return;
    const i = f.indexOf(document.activeElement);
    if (e.shiftKey && (i <= 0)) { e.preventDefault(); f.at(-1).focus(); }
    else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
  }
  function open() {
    if (isOpen) return close();
    isOpen = true;
    restore = { focus: document.activeElement, scroll: scrollY };
    const v = getValue();
    focus = inRange(v) ? v : bounds().first;
    view = clampMonth(monthOf(focus));
    typed.min = bounds().first; typed.max = bounds().last; typed.value = v || "";
    layer.hidden = false;
    // Everything behind the dialog is inert while it is open.
    [...document.body.children].forEach((el) => { if (el !== layer && !el.hasAttribute("inert")) { el.setAttribute("inert", ""); el.dataset.calInert = "1"; } });
    if (sheet()) document.documentElement.classList.add("cal-lock");
    trigger.setAttribute("aria-expanded", "true");
    place();
    renderMonth().then(() => tbody.querySelector(`[data-date="${focus}"]`)?.focus());
    renderTimes(v);
    if (!still() && pop.animate) pop.animate([{ opacity: 0, transform: "translateY(4px)" }, { opacity: 1, transform: "none" }], { duration: 160, easing: "cubic-bezier(.2,.7,.2,1)" });
    document.addEventListener("keydown", trap, true);
    addEventListener("resize", place);
  }
  function close() {
    if (!isOpen) return;
    isOpen = false; seqM++; seqD++;
    layer.hidden = true;
    document.querySelectorAll("[data-cal-inert]").forEach((el) => { el.removeAttribute("inert"); delete el.dataset.calInert; });
    document.documentElement.classList.remove("cal-lock");
    trigger.setAttribute("aria-expanded", "false");
    document.removeEventListener("keydown", trap, true);
    removeEventListener("resize", place);
    if (restore) { scrollTo({ top: restore.scroll, behavior: "instant" }); trigger.focus({ preventScroll: true }); }
  }

  trigger.addEventListener("click", (e) => { e.preventDefault(); open(); });
  layer.addEventListener("click", (e) => {
    if (e.target.closest("[data-cal-close]")) return close();
    if (e.target.closest("[data-cal-prev]")) { view = shiftMonth(view, -1); focus = null; renderMonth(); return; }
    if (e.target.closest("[data-cal-next]")) { view = shiftMonth(view, 1); focus = null; renderMonth(); return; }
    if (e.target.closest("[data-cal-today]")) { setFocus(cfg().today); choose(cfg().today); return; }
    if (e.target.closest("[data-cal-retry]")) { daysCache.clear(); renderTimes(getValue()); return; }
    const go = e.target.closest("[data-cal-go]"); if (go) { setFocus(go.dataset.calGo); choose(go.dataset.calGo); return; }
    const s = e.target.closest("[data-cal-slot]");
    if (s) { const d = getValue(); close(); onPickTime?.(s.dataset.calSlot, d); return; }
    const b = e.target.closest("[data-date]");
    if (b) { if (b.getAttribute("aria-disabled") === "true") { choose(b.dataset.date); return; } choose(b.dataset.date); }
  });
  tbody.addEventListener("keydown", (e) => {
    const b = e.target.closest("[data-date]"); if (!b) return;
    const d = b.dataset.date, i = isoDow(d);
    const k = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7, Home: -i, End: 6 - i }[e.key];
    if (k != null) { e.preventDefault(); setFocus(addDays(d, k)); return; }
    if (e.key === "PageUp" || e.key === "PageDown") {
      e.preventDefault();
      const ym = shiftMonth(monthOf(d), e.key === "PageUp" ? -1 : 1);
      const dd = Math.min(Number(d.slice(8)), Number(lastOf(ym).slice(8)));
      setFocus(`${ym}-${String(dd).padStart(2, "0")}`); return;
    }
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); choose(d); }
  });
  typed.addEventListener("change", () => { const d = typed.value; if (/^\d{4}-\d{2}-\d{2}$/.test(d)) { setFocus(d, { move: false }); choose(d); } });

  return {
    open, close, get isOpen() { return isOpen; },
    /** Party, golfer type or member changed: forget cached months and redraw if open. */
    refresh() { months.clear(); daysCache.clear(); if (isOpen) { renderMonth(); renderTimes(getValue()); } },
    destroy() { close(); unsubscribe(); ro?.disconnect(); layer.remove(); },
  };
}

/** Calls back just after the next Bangkok midnight (by the service's clock), then every midnight after. */
export function onBangkokMidnight(serverTime, cb) {
  const skew = (serverTime || Date.now()) - Date.now();
  let timer;
  const arm = () => {
    const now = Date.now() + skew;
    const next = Date.parse(`${new Date(now + 7 * 3600e3).toISOString().slice(0, 10)}T00:00:00+07:00`) + 864e5;
    timer = setTimeout(() => { cb(); arm(); }, Math.min(next - now + 1500, 2 ** 31 - 1));
  };
  arm();
  return () => clearTimeout(timer);
}
