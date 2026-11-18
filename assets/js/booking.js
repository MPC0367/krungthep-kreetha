// Booking steps after a time is held: details, deposit (sandbox provider), server-verified
// confirmation, and self-service management. Nothing here can confirm a booking by itself;
// only a verified provider event or an approved exemption does.
import { getApi, clientId } from "./api.js";
import { bkkInstant } from "./core/util.js";
import { lang, th, esc, money, time, day, CAT, teeName, flow, errorText, countdown, summaryHTML, link, formatDateTime } from "./ui.js";

const step = document.querySelector("[data-booking-step]")?.dataset.bookingStep;
const cid = clientId();
let api;

const STATUS = {
  HELD: th ? "กันเวลาไว้ รอชำระมัดจำ" : "Held, waiting for the deposit",
  PAYMENT_PENDING: th ? "รอยืนยันการชำระเงิน" : "Payment pending verification",
  CONFIRMED: th ? "ยืนยันแล้ว" : "Confirmed",
  CHECKED_IN: th ? "เช็กอินแล้ว" : "Checked in",
  COMPLETED: th ? "เล่นจบแล้ว" : "Completed",
  CANCELLED: th ? "ยกเลิกแล้ว" : "Cancelled",
  EXPIRED: th ? "หมดเวลา" : "Expired",
  NO_SHOW: th ? "ไม่มาตามนัด" : "No-show",
};
const PAY = { PENDING: th ? "รอชำระ" : "Pending", SUCCEEDED: th ? "ชำระแล้ว" : "Paid", FAILED: th ? "ไม่สำเร็จ" : "Failed", EXPIRED: th ? "หมดอายุ" : "Expired", REFUND_PENDING: th ? "กำลังคืนเงิน" : "Refund in progress", PARTIALLY_REFUNDED: th ? "คืนเงินบางส่วนแล้ว" : "Partly refunded", REFUNDED: th ? "คืนเงินแล้ว" : "Refunded" };

function setSummary(html) { const el = document.querySelector("[data-summary-body]"); if (el) el.innerHTML = html; }
function missing() { document.querySelectorAll("[data-flow-missing]").forEach((x) => (x.hidden = false)); document.querySelectorAll("[data-details-form], [data-pay-panel], [data-summary], [data-confirm-body]").forEach((x) => (x.hidden = true)); }

// ---------- details ----------
async function details() {
  const f = flow.get();
  if (!f?.holdId) return missing();
  let hold;
  try { hold = await api.getHold({ holdId: f.holdId, clientId: cid }); } catch { return missing(); }
  if (hold.hold.status !== "ACTIVE") { if (f.bookingId && f.token) location.replace(link("booking/payment/")); return missing(); }
  const cfg = await api.getPublicConfig();
  setSummary(`${summaryHTML({ ...hold.hold, quote: hold.quote, policy: cfg.policy })}<div data-cd></div>`);
  countdown(document.querySelector("[data-cd]"), { expiresAt: hold.hold.expiresAt, serverTime: hold.hold.serverTime, onEnd: () => { window.kk.toast?.(th ? "การกันเวลาหมดอายุ" : "Your hold ended"); setTimeout(() => location.assign(link("tee-times/")), 2500); } });
  const form = document.querySelector("[data-details-form]");
  try { const d = JSON.parse(sessionStorage.getItem("kk.details") || "{}"); for (const [k, v] of Object.entries(d)) { const el = form.elements[k]; if (el && el.type !== "checkbox") el.value = v; } } catch {}
  form.addEventListener("input", () => { try { sessionStorage.setItem("kk.details", JSON.stringify({ name: form.name.value, phone: form.phone.value, email: form.email.value })); } catch {} });
  const MSG = { name: { required: th ? "กรอกชื่อและนามสกุล" : "Enter the lead golfer's name" }, phone: { invalid: th ? "ตรวจสอบเบอร์มือถือ ตัวเลข 9 ถึง 15 หลัก" : "Check the mobile number: 9 to 15 digits" }, email: { invalid: th ? "รูปแบบอีเมลไม่ถูกต้อง" : "This email address does not look right" }, acceptTerms: { required: th ? "กรุณายอมรับเงื่อนไขการจองก่อนดำเนินการต่อ" : "Please accept the booking terms to continue" } };
  const showErrors = (errors) => {
    const map = { name: "e-name", phone: "e-phone", email: "e-email", acceptTerms: "e-terms" };
    for (const [k, id] of Object.entries(map)) {
      const el = document.getElementById(id); const msg = errors[k] ? MSG[k][errors[k]] || errors[k] : "";
      el.hidden = !msg; el.textContent = msg; el.closest(".field")?.classList.toggle("has-error", !!msg);
      const input = form.elements[k]; input?.setAttribute("aria-invalid", String(!!msg));
    }
    const first = Object.keys(errors)[0]; if (first) form.elements[first]?.focus();
  };
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = form.querySelector("[data-submit]"); btn.classList.add("is-loading");
    try {
      const r = await api.createBooking({ holdId: f.holdId, clientId: cid, lead: { name: form.name.value, phone: form.phone.value, email: form.email.value }, acceptTerms: form.acceptTerms.checked, marketing: form.marketing.checked, locale: lang });
      flow.set({ bookingId: r.booking.id, ref: r.booking.ref, ...(r.token ? { token: r.token } : {}) });
      showErrors({});
      location.assign(link(r.booking.status === "CONFIRMED" ? "booking/confirmation/" : "booking/payment/"));
    } catch (err) {
      if (err.code === "VALIDATION") showErrors(err.detail.errors || {});
      else { window.kk.toast?.(errorText(err)); if (err.code === "HOLD_EXPIRED") setTimeout(() => location.assign(link("tee-times/")), 2500); }
    } finally { btn.classList.remove("is-loading"); }
  });
}

// ---------- payment ----------
function fakeQR(seed) {
  let h = 2166136261; for (const c of seed) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  const n = 25, cells = [];
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; const finder = (x < 7 && y < 7) || (x > 17 && y < 7) || (x < 7 && y > 17); if (finder ? ((x % 6 === 0 || y % 6 === 0 || (x % 24 > 1 && x % 24 < 5 && y % 24 > 1 && y % 24 < 5)) && !(x > 17 && x < 18)) : (h & 3) === 0) cells.push(`<rect x="${x}" y="${y}" width="1" height="1"/>`); }
  return `<svg viewBox="0 0 ${n} ${n}" fill="#152A24" aria-hidden="true">${cells.join("")}</svg>`;
}
async function payment() {
  const f = flow.get();
  if (!f?.bookingId || !f?.token) return missing();
  let st, leaving = false;
  const refresh = async () => {
    if (leaving) return;
    try { st = await api.getBookingStatus({ bookingId: f.bookingId, token: f.token }); } catch { return missing(); }
    const b = st.booking;
    // Live updates and the sandbox result can both report the confirmation; navigate only once.
    if (b.status === "CONFIRMED") { if (!leaving) { leaving = true; location.assign(link("booking/confirmation/")); } return; }
    const cfg = await api.getPublicConfig();
    setSummary(`${summaryHTML({ ...b, quote: b.quote, policy: b.policy || cfg.policy })}<div data-cd></div><p class="small">${th ? "สถานะ" : "Status"}: <b>${STATUS[b.status]}</b></p>`);
    if (b.status === "EXPIRED") {
      document.querySelector("[data-pay-panel]").innerHTML = `<div class="notice bad"><span>${th ? "การกันเวลาหมดอายุก่อนได้รับการชำระเงิน หากคุณชำระเงินไปแล้ว ระบบจะคืนเงินอัตโนมัติหรือยืนยันให้ถ้ายังมีที่ว่าง เจ้าหน้าที่จะตรวจสอบรายการนี้" : "The hold ended before payment arrived. If you did pay, the system confirms the booking when places are still free, or refunds you automatically; staff review it either way."}</span></div><a class="btn" href="${link("tee-times/")}">${th ? "เลือกเวลาใหม่" : "Choose a time again"}</a>`;
      document.querySelector("[data-sandbox]").hidden = true; return;
    }
    const hold = await api.getHold({ holdId: f.holdId, clientId: cid }).catch(() => null);
    if (hold) countdown(document.querySelector("[data-cd]"), { expiresAt: hold.hold.expiresAt, serverTime: hold.hold.serverTime, onEnd: refresh });
    const p = b.payment;
    if (p && p.status === "PENDING") showPending(p);
    else if (p && (p.status === "FAILED" || p.status === "EXPIRED")) { document.querySelector("[data-pay-live]").hidden = true; document.querySelector("[data-start-pay]").textContent = th ? "ลองชำระอีกครั้ง" : "Try the payment again"; window.kk.toast?.(p.status === "FAILED" ? (th ? "การชำระเงินไม่สำเร็จ เวลาของคุณยังกันไว้อยู่" : "The payment did not go through. Your time is still held.") : (th ? "QR หมดอายุ สร้างรายการใหม่ได้" : "The QR expired. Create a new one.")); }
  };
  const showPending = (p) => {
    document.querySelector("[data-pay-live]").hidden = false;
    document.querySelector("[data-sandbox]").hidden = false;
    document.querySelector("[data-qr]").innerHTML = p.method === "promptpay" ? fakeQR(p.qrPayload || p.id) : `<p class="small" style="padding:12px">${th ? "ในระบบจริง ปุ่มนี้พาไปหน้าชำระบัตรของผู้ให้บริการ" : "In the live system this opens the provider's secure card page."}</p>`;
    document.querySelector("[data-pay-expiry]").textContent = `${th ? "ยอดชำระ" : "Amount"} ${money(p.amountMinor)}. ${th ? "รายการนี้หมดอายุ" : "This request expires at"} ${formatDateTime(p.expiresAt, lang)}`;
    document.querySelector("[data-sandbox]").dataset.payment = p.id;
  };
  document.querySelector("[data-start-pay]").addEventListener("click", async (e) => {
    const btn = e.currentTarget; btn.classList.add("is-loading");
    const method = document.querySelector('[name="method"]:checked').value;
    try {
      const r = await api.startPayment({ bookingId: f.bookingId, clientId: cid, method, idemKey: `${f.bookingId}:${method}:${Date.now() >> 15}` });
      if (r.alreadyConfirmed) return location.assign(link("booking/confirmation/"));
      showPending(r.payment);
    } catch (err) { window.kk.toast?.(errorText(err)); if (err.code === "HOLD_EXPIRED") refresh(); }
    finally { btn.classList.remove("is-loading"); }
  });
  const log = document.querySelector("[data-sandbox-log]");
  document.querySelector("[data-sandbox]").addEventListener("click", async (e) => {
    const b = e.target.closest("[data-act]"); if (!b) return;
    const pid = document.querySelector("[data-sandbox]").dataset.payment; if (!pid) return;
    const act = b.dataset.act;
    try {
      if (act === "later") {
        await api.sandboxAct({ paymentId: pid, outcome: "succeed", deliver: "later" });
        log.textContent = th ? "จำลองว่าลูกค้าชำระแล้ว แต่ผู้ให้บริการแจ้งช้า เปิดหน้าเจ้าหน้าที่ แล้วเลื่อนเวลาให้เลยการกันที่ จากนั้นกดส่งเหตุการณ์ที่ค้างอยู่ เพื่อดูเส้นทางกรณีพิเศษ" : "Simulated: you paid, but the provider's message is delayed. In the staff console, move the demo clock past the hold and deliver queued events to see the exception path.";
        return;
      }
      const r = await api.sandboxAct({ paymentId: pid, outcome: act === "twice" ? "succeed" : act, deliver: act === "twice" ? "twice" : "now" });
      if (act === "twice") log.textContent = th ? `ครั้งแรก: ${r.first.result} ครั้งที่สอง: ซ้ำ ไม่มีผลเพิ่ม` : `First event: ${r.first.result}. Second: duplicate, ignored.`;
      else log.textContent = `${th ? "ผลจากผู้ให้บริการ" : "Provider result"}: ${r.result || (r.duplicate ? "duplicate" : "")}`;
      await refresh();
    } catch (err) { log.textContent = errorText(err); }
  });
  api.subscribe("booking", refresh);
  await refresh();
  setInterval(() => { if (document.visibilityState === "visible") refresh(); }, 6000);
}

// ---------- confirmation ----------
function calendarLink(b) {
  const start = bkkInstant(b.date, b.time), end = start + 5 * 3600e3;
  const z = (ms) => new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const text = encodeURIComponent(th ? "ออกรอบที่สนามกอล์ฟกรุงเทพกรีฑา" : "Golf at Krungthep Kreetha");
  const loc = encodeURIComponent("282 Krungthep Kreetha Road, Hua Mak, Bang Kapi, Bangkok 10240");
  return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${text}&dates=${z(start)}/${z(end)}&location=${loc}`;
}
async function confirmation() {
  const f = flow.get();
  if (!f?.bookingId || !f?.token) return missing();
  const body = document.querySelector("[data-confirm-body]");
  const render = async () => {
    let st; try { st = await api.getBookingStatus({ bookingId: f.bookingId, token: f.token }); } catch { return missing(); }
    const b = st.booking;
    if (b.status === "PAYMENT_PENDING" || b.status === "HELD") {
      body.innerHTML = `<div class="panel"><div class="status-big"><span class="dot"></span><div><b>${th ? "กำลังรอการยืนยันการชำระเงิน" : "Waiting for payment verification"}</b><p class="small muted">${th ? `หมายเลขอ้างอิง ${b.ref} หน้านี้จะอัปเดตเอง ไม่ต้องชำระซ้ำ` : `Reference ${b.ref}. This page updates by itself; do not pay twice.`}</p></div></div><a class="btn secondary" href="${link("booking/payment/")}">${th ? "กลับไปหน้าชำระเงิน" : "Back to the payment page"}</a></div>`;
      return;
    }
    if (b.status !== "CONFIRMED") { body.innerHTML = `<div class="notice warn"><span>${th ? "สถานะการจอง" : "Booking status"}: <b>${STATUS[b.status]}</b>. <a href="${link("booking/manage/")}">${th ? "ดูรายละเอียด" : "See details"}</a></span></div>`; return; }
    const p = b.payment;
    body.innerHTML = `
      <div class="confirm-hero"><p class="eyebrow" style="color:var(--on-dark-2)">${th ? "ยืนยันการจองแล้ว (ตัวอย่าง)" : "Booking confirmed (demo)"}</p><h2 class="h1">${day(b.date)}<br>${time(b.time)}</h2><p class="muted">${teeName(b.tee)}, ${th ? `${b.partySize} ท่าน` : `${b.partySize} golfers`}, ${CAT[b.category][lang]}</p><p><span class="small muted">${th ? "หมายเลขการจอง" : "Booking reference"}</span><br><span class="ref">${b.ref}</span></p></div>
      <div class="split-2">
        <div class="panel"><h2 class="label">${th ? "การชำระเงิน" : "Payment"}</h2><div class="money">
          ${b.exemption ? `<div><span>${th ? "ไม่ต้องมัดจำ" : "No deposit"}</span><span>${b.exemption === "member_account" ? (th ? "บัญชีสมาชิก" : "Member account") : (th ? "ชำระที่สนาม" : "Pay at the club")}</span></div>` : `
          <div><span>${th ? "ราคารวม" : "Total"}</span><span>${money(b.quote.totalMinor)}</span></div>
          <div class="due"><span>${th ? "มัดจำที่ชำระแล้ว" : "Deposit paid"}</span><span>${money(p?.capturedMinor)}</span></div>
          <div><span>${th ? "ชำระที่สนาม" : "To pay at the club"}</span><span>${money(b.quote.balanceMinor)}</span></div>`}
        </div><p class="small muted">${th ? `ยกเลิกและรับมัดจำคืนได้ถึง ${formatDateTime(b.cancelDeadline, lang)} หลังจากนั้นและกรณีไม่มาตามนัด สมาคมเก็บมัดจำไว้ ไม่เรียกเก็บเพิ่ม` : `Cancel with a refund until ${formatDateTime(b.cancelDeadline, lang)}. After that, or if nobody arrives, the club keeps the deposit and charges nothing more.`}</p></div>
        <div class="panel"><h2 class="label">${th ? "เก็บรหัสนี้ไว้เพื่อจัดการการจอง" : "Keep this code to manage your booking"}</h2><p class="code-box" data-code>${esc(f.token)}</p><p class="small muted">${th ? "ใช้คู่กับหมายเลขการจองที่หน้าจัดการการจอง ในระบบจริงจะส่งทางอีเมลหรือ SMS ห้ามแชร์รหัสนี้" : "Use it with your reference on the manage page. The live system sends it by email or SMS. Do not share it."}</p><p class="row"><button class="btn small secondary" type="button" data-copy>${th ? "คัดลอกรหัส" : "Copy code"}</button><a class="btn small secondary" href="${link("booking/manage/")}">${th ? "จัดการการจอง" : "Manage booking"}</a></p></div>
      </div>
      <div class="panel"><h2 class="label">${th ? "วันเล่น" : "On the day"}</h2><p>${th ? "แจ้งหมายเลขการจองที่เคาน์เตอร์ ชำระยอดคงเหลือที่สนาม และเผื่อเวลาเช็กอินก่อนเวลาออกรอบ" : "Give your reference at the counter, pay the balance at the club and allow time to check in before your tee time."}</p><p class="row"><a class="btn secondary" href="${calendarLink(b)}" target="_blank" rel="noopener">${th ? "เพิ่มใน Google Calendar" : "Add to Google Calendar"}</a><a class="btn secondary" href="${link("visit/")}">${th ? "การเดินทาง" : "Directions"}</a><a class="btn secondary" href="${link("course/holes/01/")}">${th ? "ดูหลุมแรก" : "Preview hole 1"}</a></p></div>`;
    body.querySelector("[data-copy]")?.addEventListener("click", async () => { try { await navigator.clipboard.writeText(f.token); window.kk.toast?.(th ? "คัดลอกแล้ว" : "Copied"); } catch { const r = document.createRange(); r.selectNodeContents(body.querySelector("[data-code]")); getSelection().removeAllRanges(); getSelection().addRange(r); } });
  };
  api.subscribe("booking", render);
  await render();
}

// ---------- manage ----------
async function manage() {
  const form = document.querySelector("[data-lookup]");
  const out = document.querySelector("[data-manage-body]");
  const err = document.querySelector("[data-lookup-error]");
  const f = flow.get();
  if (f?.ref) { form.ref.value = f.ref; if (f.token) form.token.value = f.token; }
  let current = null;
  const view = (st) => {
    const b = st.booking; current = { ref: b.ref, token: form.token.value.trim() };
    const c = st.cancellation;
    out.innerHTML = `<div class="panel"><div class="row" style="justify-content:space-between"><span class="ref">${b.ref}</span><span class="tag ${b.status === "CONFIRMED" ? "ok" : b.status === "CANCELLED" ? "bad" : "warn"}">${STATUS[b.status]}</span></div>
      <p><b>${day(b.date)}, ${time(b.time)}</b><br>${teeName(b.tee)}, ${th ? `${b.partySize} ท่าน` : `${b.partySize} golfers`}</p>
      ${b.payment ? `<p class="small">${th ? "การชำระเงิน" : "Payment"}: ${PAY[b.payment.status] || b.payment.status}, ${money(b.payment.capturedMinor)}${b.payment.retainedMinor ? `, ${th ? "สมาคมเก็บไว้" : "kept by the club"} ${money(b.payment.retainedMinor)}` : ""}</p>` : ""}
      ${b.refunds?.length ? `<p class="small">${th ? "การคืนเงิน" : "Refunds"}: ${b.refunds.map((r) => `${money(r.amountMinor)} (${r.status === "COMPLETED" ? (th ? "เสร็จแล้ว" : "completed") : (th ? "ส่งคำขอแล้ว รอผู้ให้บริการยืนยัน" : "submitted, waiting for the provider")})`).join(", ")}</p>` : ""}
      ${b.status === "CONFIRMED" ? `<div class="stack" data-cancel-box><h2 class="label">${th ? "ยกเลิก" : "Cancel"}</h2><p class="small">${c.kind === "refund" ? (th ? `ยกเลิกตอนนี้ได้รับมัดจำคืน ${money(c.refundMinor)} ภายในเงื่อนไข (ก่อน ${formatDateTime(c.deadline, lang)})` : `Cancel now and ${money(c.refundMinor)} is refunded (before ${formatDateTime(c.deadline, lang)}).`) : (th ? `เลยกำหนดยกเลิกฟรีแล้ว (${formatDateTime(c.deadline, lang)}) หากยกเลิก สมาคมเก็บมัดจำ ${money(c.retainedMinor)} ไว้ ไม่เรียกเก็บเพิ่ม` : `The free-cancellation deadline (${formatDateTime(c.deadline, lang)}) has passed. If you cancel, the club keeps the ${money(c.retainedMinor)} deposit and charges nothing more.`)}</p><p class="row"><button class="btn secondary" type="button" data-cancel-confirm>${th ? "ยืนยันการยกเลิก" : "Confirm cancellation"}</button></p></div>
      <div class="stack" data-move-box><h2 class="label">${th ? "เปลี่ยนเวลา (ได้ 1 ครั้ง ก่อน 48 ชั่วโมง)" : "Move to another time (once, up to 48 hours ahead)"}</h2><div class="row"><input class="input" type="date" data-move-date style="max-width:220px" value="${b.date}" aria-label="${th ? "วันที่ใหม่" : "New date"}"><button class="btn secondary small" type="button" data-move-load>${th ? "ดูเวลาที่ว่าง" : "Show free times"}</button></div><div data-move-list class="row"></div></div>` : ""}</div>`;
  };
  form.addEventListener("submit", async (e) => {
    e.preventDefault(); err.hidden = true;
    try { view(await api.lookupBooking({ ref: form.ref.value.trim(), token: form.token.value.trim() })); }
    catch (x) { err.hidden = false; err.textContent = x.code === "NOT_FOUND" ? (th ? "ไม่พบการจองตามข้อมูลนี้ ตรวจสอบหมายเลขและรหัสอีกครั้ง" : "No booking matches those details. Check the reference and code.") : errorText(x); out.innerHTML = ""; }
  });
  out.addEventListener("click", async (e) => {
    if (e.target.closest("[data-cancel-confirm]")) {
      try { const r = await api.cancelBooking({ ...current, confirm: true }); window.kk.toast?.(th ? "ยกเลิกแล้ว" : "Cancelled"); view({ booking: r.booking, cancellation: r.outcome || { kind: "refund", refundMinor: 0, retainedMinor: 0, deadline: 0 } }); } catch (x) { window.kk.toast?.(errorText(x)); }
    }
    if (e.target.closest("[data-move-load]")) {
      const date = out.querySelector("[data-move-date]").value; const list = out.querySelector("[data-move-list]");
      try {
        const st = await api.lookupBooking(current);
        const a = await api.listAvailability({ date, partySize: st.booking.partySize, category: st.booking.category, clientId: cid });
        const slots = a.sessions.flatMap((s) => s.slots).filter((s) => ["available", "partial"].includes(s.state)).slice(0, 12);
        list.innerHTML = slots.length ? slots.map((s) => `<button class="btn small secondary" type="button" data-move="${s.id}">${time(s.time)}</button>`).join("") : `<span class="small muted">${th ? "ไม่มีเวลาว่างในวันนั้น" : "No free times that day"}</span>`;
      } catch (x) { list.textContent = errorText(x); }
    }
    const mv = e.target.closest("[data-move]");
    if (mv) {
      try { const r = await api.rescheduleBooking({ ...current, newSlotId: mv.dataset.move }); window.kk.toast?.(th ? `ย้ายไป ${time(r.booking.time)} แล้ว` : `Moved to ${r.booking.time}`); view(await api.lookupBooking(current)); } catch (x) { window.kk.toast?.(errorText(x)); }
    }
  });
  if (f?.ref && f?.token) form.requestSubmit();
}

(async () => {
  try { api = await getApi(); } catch (e) { window.kk.toast?.(errorText(e)); return; }
  ({ details, payment, confirmation, manage })[step]?.();
})();
