// Operations console: tee sheet, phone bookings, check-in and no-shows, closures, conditions
// publishing, exceptions and refunds, the calendar-sheet adapter, a scenario lab and the audit log.
import { getApi, clientId } from "./api.js";
import { addDays, bkkDate, bkkInstant, formatMoney } from "./core/util.js";
import { lang, th, esc, money, time, day, CAT, formatDateTime, formatClock, errorText } from "./ui.js";

const root = document.querySelector("[data-staff]");
const drawer = root.querySelector("[data-drawer]");
let api, me, cfg, sheetDate;
const T = (a, b) => (th ? a : b);
const toast = (m) => window.kk.toast?.(m);
const run = async (fn, okMsg) => { try { const r = await fn(); if (okMsg) toast(okMsg); return r; } catch (e) { toast(errorText(e)); throw e; } };

async function boot() {
  api = await getApi();
  cfg = await api.getPublicConfig();
  sheetDate = addDays(cfg.today, 1);
  me = await api.staffSession();
  show();
  api.subscribe("availability", () => { if (!root.querySelector('[data-panel="sheet"]').hidden) renderSheet(); });
  api.subscribe("conditions", () => { if (!root.querySelector('[data-panel="conditions"]').hidden) renderConditions(); });
}
function show() {
  root.querySelector("[data-login]").hidden = !!me;
  root.querySelector("[data-console]").hidden = !me;
  root.querySelector("[data-who]").innerHTML = me ? `<span class="tag info">${esc(me.name[lang])}</span><span class="tag outline">${me.role}</span><button class="btn small secondary" type="button" data-logout>${T("ออกจากระบบ", "Sign out")}</button>` : "";
  if (me) { const tab = location.hash.slice(1) || "sheet"; select(["sheet", "conditions", "exceptions", "sync", "lab", "audit"].includes(tab) ? tab : "sheet"); refreshCounts(); }
}
root.addEventListener("click", async (e) => {
  const u = e.target.closest("[data-user]"); if (u) { me = await run(() => api.staffLogin(u.dataset.user)); show(); }
  if (e.target.closest("[data-logout]")) { await api.staffLogout(); me = null; show(); }
  const tab = e.target.closest("[data-tab]"); if (tab) { select(tab.dataset.tab); try { history.replaceState(null, "", "#" + tab.dataset.tab); } catch {} }
});
function select(tab) {
  root.querySelectorAll("[data-tab]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === tab)));
  root.querySelectorAll("[data-panel]").forEach((p) => (p.hidden = p.dataset.panel !== tab));
  ({ sheet: renderSheet, conditions: renderConditions, exceptions: renderExceptions, sync: renderSync, lab: renderLab, audit: renderAudit })[tab]();
}
async function refreshCounts() {
  try { const ex = await api.listExceptions({}); const n = ex.exceptions.filter((x) => x.status === "OPEN").length; const c = root.querySelector("[data-ex-count]"); c.hidden = !n; c.textContent = n; } catch { /* role without access */ }
}
const denied = (panel, e) => { panel.innerHTML = `<div class="notice warn"><span>${e.code === "FORBIDDEN" ? T(`บทบาท ${me.role} ไม่มีสิทธิ์ใช้ส่วนนี้ ระบบตรวจสิทธิ์ที่บริการ`, `The ${me.role} role cannot use this section. The service enforces it.`) : esc(errorText(e))}</span></div>`; };

// ---------- tee sheet ----------
async function renderSheet() {
  const panel = root.querySelector('[data-panel="sheet"]');
  let data;
  try { data = await api.staffTeeSheet({ date: sheetDate }); } catch (e) { return denied(panel, e); }
  const days = Array.from({ length: 14 }, (_, i) => addDays(cfg.today, i));
  const booked = data.rows.reduce((s, r) => s + r.items.filter((i) => i.type === "booking" && !i.turn).reduce((a, b) => a + b.seats, 0), 0);
  const ext = data.rows.reduce((s, r) => s + r.items.filter((i) => i.type === "external").reduce((a, b) => a + b.seats, 0), 0);
  panel.innerHTML = `
  <div class="row" style="justify-content:space-between;margin-bottom:14px"><label class="row small">${T("วันที่", "Date")} <select class="input" data-day style="width:auto">${days.map((d) => `<option value="${d}"${d === sheetDate ? " selected" : ""}>${day(d, { weekday: "short", day: "numeric", month: "short" })}</option>`).join("")}</select></label>
  <div class="row small"><span class="capbar"><i class="b"></i></span>${T("จองออนไลน์/เคาน์เตอร์", "Online or counter")} <span class="capbar"><i class="x"></i></span>${T("จากตารางของสมาคม", "From the club sheet")} <span class="capbar"><i class="h"></i></span>${T("กันไว้ชั่วคราว", "Hold")} <span class="capbar"><i class="c"></i></span>${T("ปิด", "Closed")}</div></div>
  <div class="grid-3" style="margin-bottom:16px"><div class="kpi"><span class="small muted">${T("ที่นั่งที่จองผ่านระบบ", "Seats booked in this system")}</span><b class="num">${booked}</b></div><div class="kpi"><span class="small muted">${T("ที่นั่งจากตารางของสมาคม (ตัวอย่าง)", "Seats from the club sheet (demo)")}</span><b class="num">${ext}</b></div><div class="kpi"><span class="small muted">${T("เวลาออกรอบทั้งหมด", "Tee times")}</span><b class="num">${data.rows.length}</b></div></div>
  ${data.rows.length ? `<details class="panel" style="margin-bottom:16px"><summary><b>${T("ปิดช่วงเวลา (ซ่อมบำรุง สภาพอากาศ การแข่งขัน)", "Close a period (maintenance, weather, tournament)")}</b></summary><form class="row" data-close style="margin-top:12px"><label class="small">${T("จาก", "From")} <input class="input" name="from" type="time" value="06:00" style="width:auto"></label><label class="small">${T("ถึง", "To")} <input class="input" name="to" type="time" value="07:00" style="width:auto"></label><label class="small">${T("แท่นที", "Tees")} <select class="input" name="tees" style="width:auto"><option value="all">${T("ทั้งหมด", "All")}</option><option value="1">1</option><option value="10">10</option></select></label><label class="small">${T("เหตุผล", "Reason")} <input class="input" name="reason" required placeholder="${T("ซ่อมบำรุงกรีน", "Greens maintenance")}"></label><button class="btn small" type="submit">${T("ปิดช่วงเวลา", "Close period")}</button></form><p class="small muted" style="margin-top:8px">${T("การจองที่ยืนยันแล้วในช่วงนี้จะไม่ถูกลบ แต่จะขึ้นในรายการผิดปกติเพื่อให้เจ้าหน้าที่ติดต่อคืนเงินหรือเลื่อนวัน", "Confirmed bookings in the period are never deleted; they appear under exceptions for staff to refund or reschedule.")}</p></details>` : `<div class="notice"><span>${T("ไม่มีเวลาออกรอบในวันนี้ (วันจันทร์ในระบบตัวอย่าง)", "No tee times this day (Mondays in the demo).")}</span></div>`}
  <div class="table-wrap"><table class="data sheet-table"><thead><tr><th>${T("เวลา", "Time")}</th><th>${T("แท่นที", "Tee")}</th><th>${T("ที่นั่ง", "Places")}</th><th>${T("รายการ", "Allocations")}</th><th></th></tr></thead><tbody>
  ${data.rows.map((r) => {
    const cells = []; let n = 0;
    for (const it of r.items) { const k = it.type === "booking" ? "b" : it.type === "hold" ? "h" : "x"; for (let i = 0; i < it.seats; i++) if (n++ < r.capacity) cells.push(k); }
    while (cells.length < r.capacity) cells.push(r.closure ? "c" : "");
    return `<tr><td class="t">${r.time}</td><td>${r.tee}${r.memberOnly ? ` <span class="tag">${T("สมาชิก", "Members")}</span>` : ""}</td><td><span class="capbar" aria-label="${r.used} / ${r.capacity}">${cells.map((c) => `<i class="${c}"></i>`).join("")}</span></td><td>${r.closure ? `<span class="tag bad">${T("ปิด", "Closed")}: ${esc(r.closure.reason)}</span> <button class="btn small secondary" type="button" data-reopen="${r.closure.id}">${T("เปิดอีกครั้ง", "Reopen")}</button> ` : ""}${r.items.map((it) => it.type === "booking" ? `<button type="button" class="item" data-booking="${it.id}"><b>${it.ref}</b> ${esc(it.lead.name)} &times;${it.partySize} <span class="tag ${it.status === "CONFIRMED" ? "ok" : it.status === "NO_SHOW" ? "bad" : "info"}">${it.status}</span>${it.turn ? `<span class="tag">${T("เลี้ยว", "turn")}</span>` : ""}<span class="small muted">${it.channel}</span></button>` : it.type === "hold" ? `<span class="item hold">${T("กันไว้", "Hold")} &times;${it.seats} ${T("ถึง", "until")} ${formatClock(it.expiresAt, lang)}</span>` : `<span class="item ext">${T("ตาราง", "Sheet")} &times;${it.seats} <span class="small muted">${it.kind}</span></span>`).join("")}</td><td>${!r.closure && r.used < r.capacity ? `<button class="btn small secondary" type="button" data-phone="${r.id}" data-left="${r.capacity - r.used}">${T("จองทางโทรศัพท์", "Phone booking")}</button>` : ""}</td></tr>`;
  }).join("")}</tbody></table></div>`;
  panel.querySelector("[data-day]")?.addEventListener("change", (e) => { sheetDate = e.target.value; renderSheet(); });
  panel.querySelector("[data-close]")?.addEventListener("submit", async (e) => { e.preventDefault(); const f = e.target; const r = await run(() => api.staffCloseSlots({ date: sheetDate, from: f.from.value, to: f.to.value, tees: [f.tees.value], reason: f.reason.value })); toast(T(`ปิดแล้ว การจองที่ต้องตรวจสอบ ${r.bookingsToReview} รายการ`, `Closed. ${r.bookingsToReview} booking(s) to review.`)); renderSheet(); refreshCounts(); });
}
root.addEventListener("click", async (e) => {
  const ph = e.target.closest("[data-phone]");
  if (ph) openDrawer(`<h2 class="h3">${T("จองทางโทรศัพท์", "Phone booking")}</h2><p class="small">${ph.dataset.phone}</p><form class="stack" data-phone-form><div class="field"><label for="pb-name">${T("ชื่อผู้จอง", "Name")}</label><input class="input" id="pb-name" name="name" required></div><div class="field"><label for="pb-phone">${T("เบอร์โทร", "Phone")}</label><input class="input" id="pb-phone" name="phone" type="tel"></div><div class="field"><label for="pb-n">${T("จำนวนผู้เล่น", "Golfers")} (${T("ว่าง", "free")} ${ph.dataset.left})</label><input class="input" id="pb-n" name="n" type="number" min="1" max="${ph.dataset.left}" value="1"></div><div class="field"><label for="pb-cat">${T("ประเภท", "Category")}</label><select class="input" id="pb-cat" name="cat">${Object.entries(CAT).map(([k, v]) => `<option value="${k}">${v[lang]}</option>`).join("")}</select></div><button class="btn" type="submit">${T("ยืนยันการจอง ชำระที่เคาน์เตอร์", "Confirm, pay at the counter")}</button><p class="small muted">${T("ใช้การตรวจที่ว่างเดียวกับการจองออนไลน์ จองซ้อนไม่ได้", "Uses the same capacity check as online booking, so it cannot double-sell.")}</p></form>`, (d) => d.querySelector("[data-phone-form]").addEventListener("submit", async (ev) => { ev.preventDefault(); const f = ev.target; await run(() => api.staffCreateBooking({ slotId: ph.dataset.phone, partySize: Number(f.n.value), category: f.cat.value, lead: { name: f.name.value, phone: f.phone.value }, channel: "phone" }), T("จองแล้ว", "Booked")); closeDrawer(); renderSheet(); }));
  const ro = e.target.closest("[data-reopen]"); if (ro) { await run(() => api.staffReopen({ closureId: ro.dataset.reopen }), T("เปิดแล้ว", "Reopened")); renderSheet(); }
  const bk = e.target.closest("[data-booking]"); if (bk) bookingDrawer(bk.dataset.booking);
  if (e.target.closest("[data-drawer-close]")) closeDrawer();
});
async function bookingDrawer(id) {
  const data = await api.staffTeeSheet({ date: sheetDate });
  const b = data.rows.flatMap((r) => r.items).find((i) => i.type === "booking" && i.id === id);
  if (!b) return;
  const p = b.payment;
  openDrawer(`<div class="row" style="justify-content:space-between"><h2 class="h3">${b.ref}</h2><span class="tag">${b.status}</span></div>
    <p><b>${day(b.date)} ${b.time}</b>, ${T("แท่นที", "tee")} ${b.tee}<br>${esc(b.lead.name)}${b.lead.phone ? ` <span class="num">${esc(b.lead.phone)}</span>` : ` <span class="small muted">(${T("ซ่อนเบอร์ตามสิทธิ์", "contact hidden for this role")})</span>`}<br>${b.partySize} ${T("ท่าน", "golfers")}, ${CAT[b.category][lang]}, ${b.channel}</p>
    <div class="money"><div><span>${T("ราคารวม", "Total")}</span><span>${b.quote.totalMinor != null ? money(b.quote.totalMinor) : T("ที่เคาน์เตอร์", "At counter")}</span></div><div><span>${T("มัดจำที่ได้รับ", "Deposit received")}</span><span>${p ? money(p.capturedMinor) : b.exemption || "-"}</span></div>${p?.retainedMinor ? `<div><span>${T("มัดจำที่เก็บไว้", "Deposit retained")}</span><span>${money(p.retainedMinor)}</span></div>` : ""}${p?.refundedMinor ? `<div><span>${T("คืนแล้ว", "Refunded")}</span><span>${money(p.refundedMinor)}</span></div>` : ""}</div>
    <p class="small muted">${T("ซิงก์", "Sync")}: ${b.syncStatus}. ${T("การเข้าร่วม", "Attendance")}: ${b.attendance}${p ? `. ${T("อ้างอิงผู้ให้บริการ", "Provider ref")}: ${p.providerRef || "-"}` : ""}</p>
    <div class="stack" data-acts>
      ${b.status === "CONFIRMED" ? `<div class="row"><label class="small">${T("มาถึง", "Arrived")} <input class="input" type="number" min="1" max="${b.partySize}" value="${b.partySize}" data-arrived style="width:80px"></label><button class="btn small" type="button" data-act="checkin">${T("เช็กอิน", "Check in")}</button></div>
      <div class="field"><label for="d-reason">${T("เหตุผล (จำเป็นสำหรับไม่มาตามนัดและยกเลิก)", "Reason (needed for no-show and cancel)")}</label><input class="input" id="d-reason" data-reason></div>
      <div class="row"><button class="btn small secondary" type="button" data-act="noshow">${T("บันทึกไม่มาตามนัด", "Mark no-show")}</button><button class="btn small secondary" type="button" data-act="cancel">${T("ยกเลิกตามนโยบาย", "Cancel under policy")}</button><button class="btn small secondary" type="button" data-act="club">${T("สมาคมยกเลิก (คืนเต็ม)", "Club cancels (full refund)")}</button></div>` : ""}
      ${b.status === "NO_SHOW" ? `<div class="field"><label for="d-reason2">${T("เหตุผลการแก้ไข", "Reason for correction")}</label><input class="input" id="d-reason2" data-reason></div><button class="btn small" type="button" data-act="correct">${T("แก้เป็นมาแล้ว (ต้องมีสิทธิ์)", "Correct to arrived (supervised)")}</button>` : ""}
      ${p && ["SUCCEEDED", "PARTIALLY_REFUNDED"].includes(p.status) ? `<div class="row"><input class="input" type="number" min="1" step="1" value="${(p.capturedMinor - (p.refundedMinor || 0)) / 100}" data-refund style="width:120px" aria-label="${T("จำนวนเงินคืน (บาท)", "Refund amount (THB)")}"><button class="btn small secondary" type="button" data-act="refund">${T("คืนเงิน (ฝ่ายการเงิน)", "Refund (finance)")}</button></div>` : ""}
    </div>
    <details><summary class="small">${T("ประวัติสถานะ", "Status history")}</summary><ol class="small">${(b.history || []).map((h) => `<li>${formatDateTime(h.at, lang)}: ${h.from || "-"} &rarr; ${h.to} (${h.actor})${h.note ? `, ${esc(h.note)}` : ""}</li>`).join("")}</ol></details>`,
  (d) => d.querySelector("[data-acts]").addEventListener("click", async (ev) => {
    const a = ev.target.closest("[data-act]")?.dataset.act; if (!a) return;
    const reason = d.querySelector("[data-reason]")?.value;
    try {
      if (a === "checkin") await run(() => api.staffCheckIn({ bookingId: b.id, arrived: Number(d.querySelector("[data-arrived]").value) }), T("เช็กอินแล้ว", "Checked in"));
      if (a === "noshow") await run(() => api.staffNoShow({ bookingId: b.id, reason }), T("บันทึกแล้ว มัดจำถูกเก็บไว้ ไม่มีการเรียกเก็บเพิ่ม", "Recorded. The deposit is kept; nothing more is charged."));
      if (a === "cancel") await run(() => api.staffCancel({ bookingId: b.id, reason }), T("ยกเลิกแล้ว", "Cancelled"));
      if (a === "club") await run(() => api.staffCancel({ bookingId: b.id, reason: reason || "Club closure", clubInitiated: true }), T("ยกเลิกและส่งคำขอคืนเงินแล้ว", "Cancelled; refund requested"));
      if (a === "correct") await run(() => api.staffCorrectAttendance({ bookingId: b.id, reason }), T("แก้ไขแล้ว", "Corrected"));
      if (a === "refund") await run(() => api.staffRefund({ paymentId: p.id, amountMinor: Math.round(Number(d.querySelector("[data-refund]").value) * 100), reason: reason || "Goodwill" }), T("ส่งคำขอคืนเงินแล้ว", "Refund submitted"));
      closeDrawer(); renderSheet(); refreshCounts();
    } catch {}
  }));
}
let lastFocus;
function openDrawer(html, wire) { lastFocus = document.activeElement; drawer.innerHTML = `<div class="row" style="justify-content:flex-end"><button class="icon-btn dark" type="button" data-drawer-close aria-label="${T("ปิด", "Close")}">&times;</button></div>${html}`; drawer.hidden = false; wire?.(drawer); drawer.querySelector("input, button:not([data-drawer-close])")?.focus(); }
function closeDrawer() { drawer.hidden = true; lastFocus?.focus?.(); }
drawer.addEventListener("keydown", (e) => { if (e.key === "Escape") closeDrawer(); });

// ---------- conditions ----------
async function renderConditions() {
  const panel = root.querySelector('[data-panel="conditions"]');
  let list, pub;
  try { [list, pub] = await Promise.all([api.listReadings({}), api.getConditions()]); } catch (e) { return denied(panel, e); }
  const now = new Date(list.serverTime + 7 * 3600e3).toISOString().slice(0, 16);
  panel.innerHTML = `<div class="grid-2">
    <form class="panel" data-reading novalidate><h2 class="h3">${T("บันทึกความเร็วกรีน", "Record green speed")}</h2>
      <div class="field"><label for="r-at">${T("วัดเมื่อ (เวลากรุงเทพฯ)", "Measured at (Bangkok time)")}</label><input class="input" type="datetime-local" id="r-at" name="at" value="${now}" max="${now}"></div>
      <div class="field"><label for="r-v">${T("ค่าที่วัด (ฟุต)", "Reading (feet)")}</label><input class="input" id="r-v" name="v" inputmode="decimal" placeholder="10.5" aria-describedby="r-vh"><span class="hint" id="r-vh">${T("พิมพ์ 10.5 หรือ 10' 6\" ก็ได้ ระบบแปลงเป็นฟุตทศนิยม", "Type 10.5 or 10' 6\"; it is stored in decimal feet")}</span></div>
      <div class="field"><label for="r-scope">${T("ขอบเขต", "Scope")}</label><select class="input" id="r-scope" name="scope"><option value="course">${T("ค่าสรุปทั้งสนาม", "Course summary")}</option><option value="holes">${T("รายกรีน", "Specific greens")}</option></select></div>
      <div class="field" data-holes hidden><label for="r-holes">${T("หลุม (คั่นด้วยจุลภาค)", "Holes (comma separated)")}</label><input class="input" id="r-holes" name="holes" placeholder="7, 16"></div>
      <div class="field"><label for="r-th">${T("หมายเหตุ ภาษาไทย", "Note, Thai")}</label><input class="input" id="r-th" name="nth"></div>
      <div class="field"><label for="r-en">${T("หมายเหตุ ภาษาอังกฤษ", "Note, English")}</label><input class="input" id="r-en" name="nen"></div>
      <p class="error" data-r-err hidden></p>
      <p class="row"><button class="btn secondary" type="submit" data-mode="draft">${T("บันทึกร่าง", "Save draft")}</button><button class="btn" type="submit" data-mode="publish">${T("บันทึกและเผยแพร่", "Save and publish")}</button></p>
      <p class="small muted">${T("ร่างยังไม่แสดงบนเว็บไซต์ จนกว่าผู้มีสิทธิ์จะเผยแพร่", "A draft does not appear on the website until someone with publish rights publishes it.")}</p></form>
    <div class="stack">
      <div class="panel"><h2 class="h3">${T("สถานะสนาม", "Course status")}</h2><form class="row" data-status><select class="input" name="s" style="width:auto">${["open", "partial", "closed"].map((s) => `<option value="${s}"${pub.course?.status === s ? " selected" : ""}>${{ open: T("เปิด", "Open"), partial: T("เปิดบางส่วน", "Partly open"), closed: T("ปิด", "Closed") }[s]}</option>`).join("")}</select><input class="input" name="nth" placeholder="${T("หมายเหตุไทย", "Thai note")}" value="${esc(pub.course?.note?.th || "")}"><input class="input" name="nen" placeholder="${T("หมายเหตุอังกฤษ", "English note")}" value="${esc(pub.course?.note?.en || "")}"><button class="btn small" type="submit">${T("อัปเดต", "Update")}</button></form></div>
      <div class="panel"><h2 class="h3">${T("ประกาศ", "Notices")}</h2>${pub.notices.map((n) => `<p class="row small" style="justify-content:space-between">${esc(n[lang])}<button class="btn small secondary" type="button" data-rm-notice="${n.id}">${T("นำออก", "Remove")}</button></p>`).join("") || `<p class="muted small">${T("ไม่มี", "None")}</p>`}<form class="stack" data-notice><input class="input" name="th" placeholder="${T("ข้อความภาษาไทย", "Thai text")}"><input class="input" name="en" placeholder="${T("ข้อความภาษาอังกฤษ", "English text")}"><button class="btn small secondary" type="submit">${T("เพิ่มประกาศ", "Add notice")}</button></form></div>
    </div></div>
    <h2 class="h3" style="margin:24px 0 10px">${T("ค่าที่บันทึกไว้", "Readings")}</h2>
    <div class="table-wrap"><table class="data"><thead><tr><th>${T("วัดเมื่อ", "Measured")}</th><th class="r">${T("ฟุต", "ft")}</th><th>${T("ขอบเขต", "Scope")}</th><th>${T("สถานะ", "Status")}</th><th>${T("ฉบับ", "Ver.")}</th><th></th></tr></thead><tbody>${list.readings.map((r) => `<tr><td>${formatDateTime(r.measuredAt, lang)}</td><td class="r">${r.range ? r.range.join("-") : r.value}</td><td>${r.scope === "course" ? T("ทั้งสนาม", "Course") : r.holeIds.join(", ")}</td><td><span class="tag ${r.status === "PUBLISHED" ? "ok" : r.status === "DRAFT" ? "warn" : ""}">${r.status}</span>${r.warnings?.length ? ` <span class="tag warn">${r.warnings.join(", ")}</span>` : ""}</td><td>${r.version}</td><td class="row">${r.status === "DRAFT" ? `<button class="btn small" type="button" data-pub="${r.id}">${T("เผยแพร่", "Publish")}</button>` : ""}${r.status === "PUBLISHED" ? `<button class="btn small secondary" type="button" data-fix="${r.id}">${T("แก้ไขค่า", "Correct")}</button><button class="btn small secondary" type="button" data-wd="${r.id}">${T("ถอน", "Withdraw")}</button>` : ""}</td></tr>`).join("")}</tbody></table></div>`;
  const f = panel.querySelector("[data-reading]");
  f.scope.addEventListener("change", () => (panel.querySelector("[data-holes]").hidden = f.scope.value !== "holes"));
  let mode = "draft";
  f.querySelectorAll("[data-mode]").forEach((b) => b.addEventListener("click", () => (mode = b.dataset.mode)));
  f.addEventListener("submit", async (e) => {
    e.preventDefault();
    const err = panel.querySelector("[data-r-err]"); err.hidden = true;
    const measuredAt = f.at.value ? bkkInstant(f.at.value.slice(0, 10), f.at.value.slice(11, 16)) : NaN;
    try {
      const r = await api.draftReading({ measuredAt, value: f.v.value, scope: f.scope.value, holeIds: f.scope.value === "holes" ? f.holes.value.split(",").map((x) => Number(x.trim())).filter(Boolean) : [], notes: { th: f.nth.value, en: f.nen.value } });
      if (mode === "publish") await api.publishReading({ id: r.reading.id, acknowledgeWarnings: true });
      toast(mode === "publish" ? T("เผยแพร่แล้ว ทุกหน้าที่แสดงสภาพสนามอัปเดตทันที", "Published. Every conditions view updates now.") : T("บันทึกร่างแล้ว", "Draft saved"));
      renderConditions();
    } catch (x) { err.hidden = false; err.textContent = x.code === "VALIDATION" ? Object.entries(x.detail.errors || {}).map(([k, v]) => (k === "measuredAt" && v === "future" ? T("เวลาที่วัดอยู่ในอนาคต", "The measurement time is in the future") : `${k}: ${v}`)).join(". ") : errorText(x); }
  });
  panel.querySelector("[data-status]").addEventListener("submit", async (e) => { e.preventDefault(); const s = e.target; await run(() => api.setCourseStatus({ status: s.s.value, note: { th: s.nth.value, en: s.nen.value } }), T("อัปเดตแล้ว", "Updated")); renderConditions(); });
  panel.querySelector("[data-notice]").addEventListener("submit", async (e) => { e.preventDefault(); const s = e.target; await run(() => api.addNotice({ th: s.th.value, en: s.en.value }), T("เพิ่มแล้ว", "Added")); renderConditions(); });
  panel.onclick = async (e) => {
    const p = e.target.closest("[data-pub]"); if (p) { await run(() => api.publishReading({ id: p.dataset.pub, acknowledgeWarnings: true }), T("เผยแพร่แล้ว", "Published")); renderConditions(); }
    const w = e.target.closest("[data-wd]"); if (w) { await run(() => api.withdrawReading({ id: w.dataset.wd, reason: "Withdrawn by staff" }), T("ถอนแล้ว", "Withdrawn")); renderConditions(); }
    const x = e.target.closest("[data-fix]"); if (x) { const v = panel.querySelector("#r-v").value; if (!v) { toast(T("พิมพ์ค่าที่ถูกต้องในช่องค่าที่วัดก่อน แล้วกดแก้ไขค่า", "Type the corrected value in the reading field first, then press Correct")); panel.querySelector("#r-v").focus(); return; } await run(() => api.correctReading({ id: x.dataset.fix, input: { value: v }, reason: "Corrected by staff" }), T("แก้ไขแล้ว เวลาที่วัดยังคงเดิม", "Corrected; the measurement time is unchanged")); renderConditions(); }
    const rm = e.target.closest("[data-rm-notice]"); if (rm) { await run(() => api.removeNotice({ id: rm.dataset.rmNotice })); renderConditions(); }
  };
}

// ---------- exceptions ----------
async function renderExceptions() {
  const panel = root.querySelector('[data-panel="exceptions"]');
  let ex; try { ex = await api.listExceptions({}); } catch (e) { return denied(panel, e); }
  const KIND = { LATE_PAYMENT_NO_CAPACITY: T("ชำระเงินหลังหมดเวลากัน และเวลานั้นเต็มแล้ว ระบบส่งคำขอคืนเงินอัตโนมัติ", "Paid after the hold ended and the time was sold; refund requested automatically"), CLOSURE_REVIEW: T("การจองที่ยืนยันแล้วอยู่ในช่วงที่ปิด ติดต่อลูกค้าเพื่อคืนเงินหรือเลื่อนวัน", "A confirmed booking falls in a closed period; contact the golfer to refund or reschedule") };
  panel.innerHTML = `<div class="grid-2"><div class="stack"><h2 class="h3">${T("รายการผิดปกติ", "Exceptions")}</h2>${ex.exceptions.length ? ex.exceptions.map((x) => `<div class="panel" style="gap:8px"><div class="row" style="justify-content:space-between"><b>${x.detail?.ref || x.bookingId}</b><span class="tag ${x.status === "OPEN" ? "bad" : "ok"}">${x.status}</span></div><p class="small">${KIND[x.kind] || x.kind}</p><p class="small muted">${formatDateTime(x.createdAt, lang)}</p>${x.status === "OPEN" ? `<button class="btn small secondary" type="button" data-resolve="${x.id}">${T("ปิดรายการ", "Resolve")}</button>` : `<p class="small muted">${esc(x.resolution?.note || "")}</p>`}</div>`).join("") : `<p class="muted">${T("ไม่มีรายการผิดปกติ", "No exceptions")}</p>`}</div>
    <div class="stack"><h2 class="h3">${T("การคืนเงิน", "Refunds")}</h2>${ex.refunds.length ? `<div class="table-wrap"><table class="data"><thead><tr><th>${T("เมื่อ", "When")}</th><th class="r">${T("จำนวน", "Amount")}</th><th>${T("สถานะ", "Status")}</th><th>${T("เหตุผล", "Reason")}</th></tr></thead><tbody>${ex.refunds.map((r) => `<tr><td>${formatDateTime(r.createdAt, lang)}</td><td class="r">${money(r.amountMinor)}</td><td><span class="tag ${r.status === "COMPLETED" ? "ok" : "warn"}">${r.status}</span></td><td style="white-space:normal">${esc(r.reason || "")}</td></tr>`).join("")}</tbody></table></div><button class="btn small secondary" type="button" data-settle>${T("จำลองว่าผู้ให้บริการคืนเงินเสร็จ", "Simulate provider refund confirmation")}</button><p class="small muted">${T("คำขอคืนเงินที่ส่งแล้ว ยังไม่ใช่การคืนเงินที่เสร็จ จนกว่าผู้ให้บริการจะยืนยัน", "A submitted refund is not complete until the provider confirms it.")}</p>` : `<p class="muted">${T("ไม่มีการคืนเงิน", "No refunds")}</p>`}
    <h2 class="h3" style="margin-top:12px">${T("รายการชำระที่รออยู่", "Pending payments")}</h2><p class="small">${ex.pendingPayments.length ? ex.pendingPayments.map((p) => `${money(p.amountMinor)} ${p.method}, ${T("หมดอายุ", "expires")} ${formatClock(p.expiresAt, lang)}`).join("<br>") : T("ไม่มี", "None")}</p></div></div>`;
  panel.querySelector("[data-settle]")?.addEventListener("click", async () => { await run(() => api.staffSettleRefunds({}), T("ผู้ให้บริการยืนยันการคืนเงินแล้ว", "Provider confirmed the refunds")); renderExceptions(); });
  panel.querySelectorAll("[data-resolve]").forEach((b) => b.addEventListener("click", async () => { await run(() => api.resolveException({ id: b.dataset.resolve, note: T("ติดต่อลูกค้าแล้ว", "Golfer contacted") }), T("ปิดรายการแล้ว", "Resolved")); renderExceptions(); refreshCounts(); }));
}

// ---------- calendar sheet ----------
async function renderSync() {
  const panel = root.querySelector('[data-panel="sync"]');
  let s; try { s = await api.syncHealth({}); } catch (e) { return denied(panel, e); }
  const mapping = [["Slot ID", "slot_id", T("รหัสถาวร ไม่ใช่เลขแถว", "Durable ID, never a row number")], ["Date", "date", "YYYY-MM-DD"], ["Start time", "start_local", T("เวลากรุงเทพฯ", "Bangkok time")], ["Tee", "start_tee", "1 / 10"], ["Booked seats", "seats", "0 to 4"], ["Booking ID", "booking_id", T("รหัสถาวรของการจอง", "Durable booking ID")], ["Status", "status", "CONFIRMED / CANCELLED"], ["Version", "version", T("กันการเขียนทับ", "Prevents overwrites")], ["Updated by", "source", "website / staff"]];
  panel.innerHTML = `<div class="grid-3" style="margin-bottom:16px">
    <div class="kpi"><span class="small muted">${T("สถานะการเชื่อมต่อ", "Connection")}</span><b>${s.source.status === "ok" ? `<span class="tag ok">${T("ปกติ", "Healthy")}</span>` : `<span class="tag bad">${T("ขาดการเชื่อมต่อ", "Outage")}</span>`}</b><span class="small muted">${T("ยืนยันล่าสุด", "Last verified")} ${s.source.lastVerifiedAt ? formatClock(s.source.lastVerifiedAt, lang) : "-"}</span></div>
    <div class="kpi"><span class="small muted">${T("นำเข้าล่าสุด", "Last import")}</span><b class="num">${formatClock(s.lastImportAt, lang)}</b><span class="small muted">${T("ส่งออกล่าสุด", "Last export")} ${formatClock(s.lastExportAt, lang)}</span></div>
    <div class="kpi"><span class="small muted">${T("คิวส่งออก", "Export queue")}</span><b class="num">${s.outbox.pending + s.outbox.failed}</b><span class="small muted">${T("ล้มเหลว", "failed")} ${s.outbox.failed}, ${T("สำเร็จ", "done")} ${s.outbox.done}</span></div></div>
  <div class="notice ${s.status === "CLEAN" ? "ok" : "warn"}" style="margin-bottom:14px"><span>${T("สถานะ", "Status")}: <b>${s.status}</b>. ${s.status === "CLEAN" ? T("ข้อมูลตรงกัน", "In step") : T("มีรายการต้องตรวจสอบ", "Needs attention")}</span></div>
  <div class="row" style="margin-bottom:16px"><button class="btn small" type="button" data-sync="import">${T("นำเข้าจากตาราง (ตัวอย่าง)", "Import from the sheet (demo)")}</button><button class="btn small secondary" type="button" data-sync="export">${T("ส่งออกการเปลี่ยนแปลง", "Export changes")}</button><button class="btn small secondary" type="button" data-sim="outage">${s.source.status === "ok" ? T("จำลองตารางขัดข้อง", "Simulate sheet outage") : T("ยกเลิกการจำลองขัดข้อง", "End simulated outage")}</button><button class="btn small secondary" type="button" data-sim="fail">${s.failExports ? T("ให้ส่งออกสำเร็จ", "Let exports succeed") : T("จำลองส่งออกล้มเหลว", "Simulate export failures")}</button></div>
  ${s.conflicts.length ? `<h2 class="h3">${T("ความขัดแย้งที่ต้องตรวจ", "Conflicts to review")}</h2>${s.conflicts.map((c) => `<div class="panel" style="gap:6px;margin-bottom:8px"><b>${c.kind}</b><span class="small">${esc(c.detail)} ${c.extId || c.slotId || ""}</span><button class="btn small secondary" type="button" data-resolve-conflict="${c.id}">${T("แก้ไขแล้ว", "Mark resolved")}</button></div>`).join("")}` : ""}
  <h2 class="h3" style="margin:18px 0 8px">${T("ตัวอย่างการจับคู่คอลัมน์", "Column mapping example")}</h2><p class="small muted" style="margin-bottom:10px">${T("ระบบจริงจะเชื่อมกับสำเนาทดสอบของตารางสมาคมก่อน เมื่อได้รับตัวอย่างและสิทธิ์การเข้าถึง ไม่เขียนลงตารางจริงเพื่อสาธิต", "The live link starts with a test copy of the club's sheet once we have a sample and access. Nothing is written to the real sheet for a demo.")}</p>
  <div class="table-wrap"><table class="data"><thead><tr><th>${T("คอลัมน์ในตาราง", "Sheet column")}</th><th>${T("ฟิลด์ในระบบ", "System field")}</th><th>${T("หมายเหตุ", "Note")}</th></tr></thead><tbody>${mapping.map(([a, b, c]) => `<tr><td>${a}</td><td class="mono">${b}</td><td>${c}</td></tr>`).join("")}</tbody></table></div>`;
  panel.onclick = async (e) => {
    const b = e.target.closest("[data-sync]"); if (b) { const r = await run(() => (b.dataset.sync === "import" ? api.syncImport({}) : api.syncExport({}))); toast(b.dataset.sync === "import" ? T(`นำเข้า ${r.applied} รายการ ขัดแย้ง ${r.conflicts.length}`, `Imported ${r.applied}, ${r.conflicts.length} conflict(s)`) : T(`ส่งออก ${r.done} ล้มเหลว ${r.failed}`, `Exported ${r.done}, failed ${r.failed}`)); renderSync(); }
    const m = e.target.closest("[data-sim]"); if (m) { await run(() => api.setSimulation(m.dataset.sim === "outage" ? { outage: s.source.status === "ok" } : { failExports: !s.failExports })); renderSync(); }
    const c = e.target.closest("[data-resolve-conflict]"); if (c) { await run(() => api.resolveConflict({ id: c.dataset.resolveConflict, note: "Checked with staff" })); renderSync(); }
  };
}

// ---------- scenario lab ----------
function renderLab() {
  const panel = root.querySelector('[data-panel="lab"]');
  const S = [
    ["race", T("ลูกค้าสองคนแย่งที่สุดท้าย", "Two customers want the last place"), T("เติมเวลาหนึ่งให้เหลือ 1 ที่ แล้วให้ลูกค้าสองคนกดพร้อมกัน", "Fill a time to one free place, then two customers press at the same moment")],
    ["phone", T("จองทางโทรศัพท์ระหว่างลูกค้ากำลังชำระ", "Phone booking during online checkout"), T("ลูกค้ากันสองที่สุดท้ายไว้ เจ้าหน้าที่พยายามรับจองทางโทรศัพท์", "A customer holds the last two places while reception tries a phone booking")],
    ["dupe", T("ผู้ให้บริการแจ้งผลซ้ำ", "The provider sends the same event twice"), T("ชำระเงินหนึ่งครั้ง เหตุการณ์ถูกส่งสองครั้ง", "One payment, two identical events")],
    ["late", T("ชำระช้าหลังหมดเวลากัน", "Payment after the hold has ended"), T("ลูกค้าชำระแต่ผู้ให้บริการแจ้งช้า ระหว่างนั้นมีผู้จองเวลาเดียวกันจนเต็ม", "The provider reports late; meanwhile someone else fills the time")],
    ["closure", T("ปิดสนามช่วงที่มีการจอง", "Closing a period that has bookings"), T("ปิดช่วงเวลาที่มีการจองยืนยันแล้ว", "Close a period with a confirmed booking in it")],
  ];
  panel.innerHTML = `<div class="grid-2"><div class="stack">${S.map(([k, t, d]) => `<div class="scen"><b>${t}</b><span class="small muted">${d}</span><button class="btn small" type="button" data-scen="${k}">${T("เริ่ม", "Run")}</button></div>`).join("")}
  <div class="scen"><b>${T("นาฬิกาเดโม", "Demo clock")}</b><div class="row"><button class="btn small secondary" type="button" data-clock="11">+11 ${T("นาที", "min")}</button><button class="btn small secondary" type="button" data-clock="45">+45 ${T("นาที", "min")}</button><button class="btn small secondary" type="button" data-clock="1500">+25 ${T("ชม.", "h")}</button><button class="btn small secondary" type="button" data-clock="0">${T("กลับเวลาจริง", "Real time")}</button><button class="btn small secondary" type="button" data-deliver>${T("ส่งเหตุการณ์ที่ค้าง", "Deliver queued events")}</button></div>${api.kind === "browser" ? `<button class="btn small secondary" type="button" data-reset>${T("ล้างข้อมูลเดโมในเบราว์เซอร์นี้", "Reset the demo data in this browser")}</button>` : ""}</div></div>
  <div><div class="log" data-log aria-live="polite">${T("ผลลัพธ์จะแสดงที่นี่", "Results appear here")}</div></div></div>`;
  const log = panel.querySelector("[data-log]");
  const say = (msg, cls = "") => { log.innerHTML += `\n<span class="${cls}">${esc(msg)}</span>`; log.scrollTop = log.scrollHeight; };
  panel.onclick = async (e) => {
    const c = e.target.closest("[data-clock]"); if (c) { await run(() => api.setClockOffset({ minutes: Number(c.dataset.clock) }), T("ตั้งเวลาแล้ว", "Clock set")); return; }
    if (e.target.closest("[data-deliver]")) { const r = await run(() => api.deliverQueuedEvents({})); say(`${T("ส่งเหตุการณ์", "Delivered")} ${r.delivered.length}: ${r.delivered.map((x) => x.result || (x.duplicate ? "duplicate" : "")).join(", ")}`); return; }
    if (e.target.closest("[data-reset]")) { await api.resetDemo(); say(T("ล้างข้อมูลแล้ว", "Demo data reset"), "ok"); return; }
    const s = e.target.closest("[data-scen]")?.dataset.scen; if (!s) return;
    log.textContent = `> ${s}`;
    try { await SCEN[s](say); } catch (x) { say(`${x.code || "ERROR"}: ${x.message}`, "bad"); }
  };
}
async function freeSlot(minFree = 4) {
  for (let i = 2; i < 13; i++) {
    const d = addDays(cfg.today, i);
    const a = await api.listAvailability({ date: d, partySize: 1, clientId: "lab" });
    const s = a.sessions?.flatMap((x) => x.slots).find((x) => x.state === "available" && x.remaining >= minFree && x.session === "afternoon");
    if (s) return s;
  }
  throw new Error("No free slot found");
}
const SCEN = {
  async race(say) {
    const s = await freeSlot(); say(`${T("เวลา", "Slot")} ${s.id}, ${T("ว่าง", "free")} ${s.remaining}`);
    await api.staffCreateBooking({ slotId: s.id, partySize: s.remaining - 1, lead: { name: "Lab phone" }, channel: "phone" }); say(T("เจ้าหน้าที่จองจนเหลือ 1 ที่", "Reception fills it to one free place"));
    const [a, b] = await Promise.allSettled(["lab-A", "lab-B"].map((cidv) => api.createHold({ slotId: s.id, partySize: 1, category: "visitor", clientId: cidv })));
    say(`A: ${a.status === "fulfilled" ? T("ได้ที่", "held the place") : a.reason.code}`, a.status === "fulfilled" ? "ok" : "bad");
    say(`B: ${b.status === "fulfilled" ? T("ได้ที่", "held the place") : b.reason.code}`, b.status === "fulfilled" ? "ok" : "bad");
    const after = (await api.staffTeeSheet({ date: s.id.slice(0, 10) })).rows.find((r) => r.id === s.id);
    say(`${T("ที่นั่งที่ใช้", "Seats used")}: ${after.used} / ${after.capacity} ${after.used <= after.capacity ? "OK" : "OVERBOOKED"}`, after.used <= after.capacity ? "ok" : "bad");
  },
  async phone(say) {
    const s = await freeSlot(); await api.staffCreateBooking({ slotId: s.id, partySize: 2, lead: { name: "Lab phone" }, channel: "phone" });
    const h = await api.createHold({ slotId: s.id, partySize: 2, category: "visitor", clientId: "lab-C" }); say(T("ลูกค้ากัน 2 ที่สุดท้าย", "Customer holds the last 2 places"), "ok");
    try { await api.staffCreateBooking({ slotId: s.id, partySize: 2, lead: { name: "Caller" }, channel: "phone" }); say("Phone booking accepted (unexpected)", "bad"); } catch (x) { say(`${T("จองทางโทรศัพท์ถูกปฏิเสธ", "Phone booking refused")}: ${x.code}`, "ok"); }
    await api.releaseHold({ holdId: h.hold.id, clientId: "lab-C" }); say(T("ลูกค้าปล่อยที่ เจ้าหน้าที่ลองใหม่", "Customer releases; reception tries again"));
    await api.staffCreateBooking({ slotId: s.id, partySize: 2, lead: { name: "Caller" }, channel: "phone" }); say(T("จองทางโทรศัพท์สำเร็จ", "Phone booking accepted"), "ok");
  },
  async dupe(say) {
    const s = await freeSlot(); const cidv = "lab-D";
    const h = await api.createHold({ slotId: s.id, partySize: 1, category: "visitor", clientId: cidv });
    const b = await api.createBooking({ holdId: h.hold.id, clientId: cidv, lead: { name: "Lab Golfer", phone: "0800000000" }, acceptTerms: true });
    const p = await api.startPayment({ bookingId: b.booking.id, clientId: cidv, method: "promptpay" });
    const r = await api.sandboxAct({ paymentId: p.payment.id, outcome: "succeed", deliver: "twice" });
    say(`${T("ครั้งแรก", "First")}: ${r.first.result}`, "ok"); say(`${T("ครั้งที่สอง", "Second")}: ${r.second.duplicate ? T("ซ้ำ ไม่มีผล", "duplicate, ignored") : r.second.result}`, "ok");
    const st = await api.getBookingStatus({ bookingId: b.booking.id, token: b.token });
    say(`${b.booking.ref}: ${st.booking.status}, ${T("รับเงิน", "captured")} ${formatMoney(st.booking.payment.capturedMinor, lang)}`, "ok");
  },
  async late(say) {
    const s = await freeSlot(); const cidv = "lab-L";
    await api.staffCreateBooking({ slotId: s.id, partySize: 2, lead: { name: "Lab phone" }, channel: "phone" });
    const h = await api.createHold({ slotId: s.id, partySize: 2, category: "visitor", clientId: cidv });
    const b = await api.createBooking({ holdId: h.hold.id, clientId: cidv, lead: { name: "Late Payer", phone: "0800000001" }, acceptTerms: true });
    const p = await api.startPayment({ bookingId: b.booking.id, clientId: cidv, method: "promptpay" });
    await api.sandboxAct({ paymentId: p.payment.id, outcome: "succeed", deliver: "later" }); say(T("ลูกค้าชำระแล้ว แต่ผู้ให้บริการยังไม่แจ้ง", "Customer paid; the provider has not reported yet"));
    await api.setClockOffset({ minutes: 30 }); say(T("เลื่อนนาฬิกาเดโม 30 นาที การกันหมดอายุ", "Demo clock +30 min; the hold expires"));
    await api.staffCreateBooking({ slotId: s.id, partySize: 2, lead: { name: "Walk-in" }, channel: "walk_in" }); say(T("ผู้เล่นวอล์กอินได้ 2 ที่สุดท้าย", "A walk-in takes the last two places"));
    const r = await api.deliverQueuedEvents({}); say(`${T("ผู้ให้บริการแจ้งช้า", "Late provider event")}: ${r.delivered[0]?.result}`, "ok");
    const ex = await api.listExceptions({}); say(`${T("รายการผิดปกติ", "Exception")}: ${ex.exceptions[0]?.kind}, ${T("คืนเงิน", "refund")} ${formatMoney(ex.refunds[0]?.amountMinor, lang)} ${ex.refunds[0]?.status}`, "ok");
    await api.setClockOffset({ minutes: 0 }); say(T("กลับเวลาจริง", "Clock back to real time")); refreshCounts();
  },
  async closure(say) {
    const s = await freeSlot(); const b = await api.staffCreateBooking({ slotId: s.id, partySize: 2, lead: { name: "Lab member" }, channel: "phone" });
    say(`${T("การจอง", "Booking")} ${b.booking.ref} ${b.booking.status}`);
    const r = await api.staffCloseSlots({ date: s.id.slice(0, 10), from: s.time, to: s.time, tees: [s.tee], reason: "Lab: greens maintenance" });
    say(`${T("ต้องตรวจสอบ", "To review")}: ${r.bookingsToReview}`, "ok");
    const sheet = await api.staffTeeSheet({ date: s.id.slice(0, 10) });
    const still = sheet.rows.find((x) => x.id === s.id).items.find((i) => i.ref === b.booking.ref);
    say(`${b.booking.ref} ${T("ยังอยู่", "still")} ${still?.status}`, still ? "ok" : "bad");
    await api.staffReopen({ closureId: r.closure.id }); say(T("เปิดอีกครั้งหลังทดสอบ", "Reopened after the test")); refreshCounts();
  },
};

// ---------- audit ----------
async function renderAudit() {
  const panel = root.querySelector('[data-panel="audit"]');
  let a; try { a = await api.auditLog({ limit: 120 }); } catch (e) { return denied(panel, e); }
  panel.innerHTML = `<div class="table-wrap"><table class="data"><thead><tr><th>${T("เวลา", "When")}</th><th>${T("ผู้ทำ", "Actor")}</th><th>${T("การกระทำ", "Action")}</th><th>${T("รายการ", "Entity")}</th><th>${T("ก่อน", "Before")}</th><th>${T("หลัง", "After")}</th><th>${T("เหตุผล", "Reason")}</th></tr></thead><tbody>${a.entries.map((x) => `<tr><td>${formatDateTime(x.at, lang)}</td><td>${x.actor} <span class="small muted">${x.role}</span></td><td class="mono small">${x.action}</td><td class="mono small">${esc(String(x.entity).slice(0, 18))}</td><td class="small" style="white-space:normal">${esc(typeof x.before === "object" ? JSON.stringify(x.before) : x.before ?? "")}</td><td class="small" style="white-space:normal">${esc(typeof x.after === "object" ? JSON.stringify(x.after) : x.after ?? "")}</td><td class="small" style="white-space:normal">${esc(x.reason || "")}</td></tr>`).join("")}</tbody></table></div>`;
}

boot();
