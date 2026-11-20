// Booking steps after a time is held: details, deposit (sandbox provider), server-verified
// confirmation, and self-service management. Nothing here can confirm a booking by itself;
// only a verified provider event or an approved exemption does.
import { getApi, clientId } from "./api.js";
import { bkkInstant } from "./core/util.js";
import { lang, th, esc, money, time, day, CAT, teeName, flow, errorText, countdown, summaryHTML, link, formatDateTime, depositText } from "./ui.js";

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
  countdown(document.querySelector("[data-cd]"), { expiresAt: hold.hold.expiresAt, serverTime: hold.hold.serverTime, onLow: () => window.kk.toast?.(th ? "เหลือเวลากันที่อีก 2 นาที" : "Two minutes left on your hold"), onEnd: () => { window.kk.toast?.(th ? "การกันเวลาหมดอายุ" : "Your hold ended"); setTimeout(() => location.assign(link("tee-times/")), 2500); } });
  const form = document.querySelector("[data-details-form]");
  // The draft survives a validation error or a trip back to change the time, until the golfer clears it.
  // It stays in this tab only (sessionStorage) and is never sent anywhere before submission.
  try { const d = JSON.parse(sessionStorage.getItem("kk.details") || "{}"); for (const [k, v] of Object.entries(d)) { const el = form.elements[k]; if (!el) continue; if (el.type === "checkbox") { if (k === "marketing") el.checked = !!v; } else el.value = v; } } catch {}
  const saveDraft = () => { try { sessionStorage.setItem("kk.details", JSON.stringify({ name: form.name.value, phone: form.phone.value, email: form.email.value, marketing: form.marketing.checked })); } catch {} };
  form.addEventListener("input", saveDraft); form.addEventListener("change", saveDraft);
  form.querySelector("[data-clear-draft]")?.addEventListener("click", () => { try { sessionStorage.removeItem("kk.details"); } catch {} form.name.value = form.phone.value = form.email.value = ""; form.marketing.checked = false; form.acceptTerms.checked = false; showErrors({}); form.name.focus(); window.kk.toast?.(th ? "ล้างข้อมูลที่กรอกแล้ว" : "Details cleared"); });
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
// The sandbox stands in for the provider. The visible action is what a reviewer can really do here:
// simulate the deposit. The QR on this page is a labelled illustration; the other outcomes sit in a
// secondary disclosure. Only the provider's verified event confirms the booking.
function fakeQR(seed) {
  let h = 2166136261; for (const c of seed) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  const n = 25, cells = [];
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; const finder = (x < 7 && y < 7) || (x > 17 && y < 7) || (x < 7 && y > 17); if (finder ? ((x % 6 === 0 || y % 6 === 0 || (x % 24 > 1 && x % 24 < 5 && y % 24 > 1 && y % 24 < 5)) && !(x > 17 && x < 18)) : (h & 3) === 0) cells.push(`<rect x="${x}" y="${y}" width="1" height="1"/>`); }
  return `<svg viewBox="0 0 ${n} ${n}" fill="#152A24" aria-hidden="true">${cells.join("")}</svg>`;
}
async function payment() {
  const f = flow.get();
  if (!f?.bookingId || !f?.token) return missing();
  const sim = document.querySelector("[data-pay-sim]");
  const live = document.querySelector("[data-pay-live]");
  const statusEl = document.querySelector("[data-pay-status]");
  const sandbox = document.querySelector("[data-sandbox]");
  const log = document.querySelector("[data-sandbox-log]");
  const note = document.querySelector("[data-pay-note]");
  let st = null, leaving = false, busy = false, announced = false, stopCd = () => {};
  const go = (p) => { if (!leaving) { leaving = true; location.assign(link(p)); } };
  const amount = () => st?.booking?.quote?.depositMinor;
  const setBusy = (on) => { busy = on; [sim, ...sandbox.querySelectorAll("button")].forEach((b) => { b.disabled = on; }); sim.classList.toggle("is-loading", on); };
  const simLabel = () => { sim.textContent = amount() != null ? (th ? `จำลองการชำระมัดจำ ${money(amount())}` : `Simulate deposit of ${money(amount())}`) : (th ? "จำลองการชำระมัดจำ" : "Simulate the deposit"); };
  const refresh = async () => {
    if (leaving) return;
    try { st = await api.getBookingStatus({ bookingId: f.bookingId, token: f.token }); } catch { return missing(); }
    const b = st.booking;
    // Live updates and the sandbox result can both report the confirmation; navigate only once.
    if (b.status === "CONFIRMED") return go("booking/confirmation/");
    const cfg = await api.getPublicConfig();
    setSummary(`${summaryHTML({ ...b, quote: b.quote, policy: b.policy || cfg.policy })}<div data-cd></div><p class="small"><span>${th ? "สถานะ:" : "Status:"}</span> <b>${STATUS[b.status]}</b></p>`);
    simLabel();
    if (b.status === "EXPIRED") {
      document.querySelector("[data-pay-panel]").innerHTML = `<div class="notice bad"><span>${th ? "การกันเวลาหมดอายุก่อนได้รับการชำระเงิน หากคุณชำระเงินไปแล้ว ระบบจะคืนเงินอัตโนมัติหรือยืนยันให้ถ้ายังมีที่ว่าง เจ้าหน้าที่จะตรวจสอบรายการนี้" : "The hold ended before payment arrived. If you did pay, the system confirms the booking when places are still free, or refunds you automatically; staff review it either way."}</span></div><a class="btn" href="${link("tee-times/")}?date=${b.date}&golfers=${b.partySize}">${th ? "เลือกเวลาใหม่ในวันเดิม" : "Choose a new time on the same date"}</a>`;
      sandbox.hidden = true; return;
    }
    const hold = await api.getHold({ holdId: f.holdId, clientId: cid }).catch(() => null);
    stopCd();
    if (hold) stopCd = countdown(document.querySelector("[data-cd]"), { expiresAt: hold.hold.expiresAt, serverTime: hold.hold.serverTime, onEnd: refresh });
    const p = b.payment;
    if (p && p.status === "PENDING") showPending(p, hold);
    else if (p && (p.status === "FAILED" || p.status === "EXPIRED")) {
      live.hidden = true;
      note.innerHTML = `<div class="notice warn"><span>${p.status === "FAILED" ? (th ? "การชำระเงินไม่สำเร็จ เวลาของคุณยังกันไว้อยู่ ลองอีกครั้ง หรือกลับไปเลือกเวลาอื่น" : "The payment did not go through. Your time is still held: try again, or go back and choose another time.") : (th ? "คำขอชำระเงินหมดอายุ เวลาของคุณยังกันไว้อยู่ สร้างคำขอใหม่ได้" : "The payment request expired. Your time is still held; you can start a new request.")}</span></div><p><a class="link-arrow" href="${link("tee-times/")}?date=${b.date}&golfers=${b.partySize}">${th ? "เลือกเวลาอื่นในวันเดิม" : "Choose another time on the same date"}</a></p>`;
    }
  };
  const showPending = (p, hold) => {
    live.hidden = false;
    document.querySelector("[data-qr]").innerHTML = p.method === "promptpay" ? fakeQR(p.qrPayload || p.id) : `<p class="small" style="padding:12px">${th ? "ในระบบจริง ปุ่มนี้พาไปหน้าชำระบัตรของผู้ให้บริการ ในเดโมไม่มีการกรอกบัตร" : "In the live system this opens the provider's secure card page. The demo asks for no card details."}</p>`;
    const holdUntil = hold?.hold?.expiresAt;
    document.querySelector("[data-pay-expiry]").innerHTML = `<span>${th ? `ยอดคำขอนี้ ${money(p.amountMinor)}` : `This request is for ${money(p.amountMinor)}.`}</span> <span>${th ? `คำขอชำระเงินหมดอายุ ${formatDateTime(p.expiresAt, lang)}` : `The payment request expires at ${formatDateTime(p.expiresAt, lang)}.`}</span>${holdUntil ? ` <span>${th ? `เวลาออกรอบกันไว้ถึง ${formatDateTime(holdUntil, lang)}` : `Your tee time is held until ${formatDateTime(holdUntil, lang)}.`}</span>` : ""}`;
    // Waiting is announced once, not on every refresh.
    if (!announced) { announced = true; statusEl.textContent = th ? "รอการยืนยันจากผู้ให้บริการชำระเงิน" : "Waiting for the payment provider to confirm"; }
    sandbox.dataset.payment = p.id;
  };
  // Creates the payment request, or returns the one already pending for this booking.
  const ensureIntent = async () => {
    const method = document.querySelector('[name="method"]:checked').value;
    const r = await api.startPayment({ bookingId: f.bookingId, clientId: cid, method, idemKey: `${f.bookingId}:${method}:${Date.now() >> 15}` });
    if (r.alreadyConfirmed) { go("booking/confirmation/"); return null; }
    const hold = await api.getHold({ holdId: f.holdId, clientId: cid }).catch(() => null);
    showPending(r.payment, hold);
    return r.payment;
  };
  sim.addEventListener("click", async () => {
    if (busy) return; setBusy(true); note.innerHTML = "";
    try {
      const p = await ensureIntent(); if (!p) return;
      const r = await api.sandboxAct({ paymentId: p.id, outcome: "succeed" });
      log.textContent = `${th ? "ผลจากผู้ให้บริการ" : "Provider result"}: ${r.result || (r.duplicate ? "duplicate" : "")}`;
      await refresh();
    } catch (err) { window.kk.toast?.(errorText(err)); if (err.code === "HOLD_EXPIRED") refresh(); }
    finally { setBusy(false); }
  });
  sandbox.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-act]"); if (!b || busy) return;
    setBusy(true); note.innerHTML = "";
    const act = b.dataset.act;
    try {
      const p = await ensureIntent(); if (!p) return;
      if (act === "pending") { await refresh(); log.textContent = th ? "สร้างคำขอชำระเงินแล้ว รอผลจากผู้ให้บริการ ลองรีเฟรชหน้านี้ได้" : "Payment request created and left pending. You can refresh this page."; return; }
      if (act === "later") {
        await api.sandboxAct({ paymentId: p.id, outcome: "succeed", deliver: "later" });
        log.textContent = th ? "จำลองว่าลูกค้าชำระแล้ว แต่ผู้ให้บริการแจ้งช้า เปิดหน้าเจ้าหน้าที่ แล้วเลื่อนเวลาให้เลยการกันที่ จากนั้นกดส่งเหตุการณ์ที่ค้างอยู่ เพื่อดูเส้นทางกรณีพิเศษ" : "Simulated: you paid, but the provider's message is delayed. In the staff console, move the demo clock past the hold and deliver queued events to see the exception path.";
        return;
      }
      const r = await api.sandboxAct({ paymentId: p.id, outcome: act === "twice" ? "succeed" : act, deliver: act === "twice" ? "twice" : "now" });
      if (act === "twice") log.textContent = th ? `ครั้งแรก: ${r.first.result} ครั้งที่สอง: ซ้ำ ไม่มีผลเพิ่ม` : `First event: ${r.first.result}. Second: duplicate, ignored.`;
      else log.textContent = `${th ? "ผลจากผู้ให้บริการ" : "Provider result"}: ${r.result || (r.duplicate ? "duplicate" : "")}`;
      await refresh();
    } catch (err) { log.textContent = errorText(err); }
    finally { setBusy(false); }
  });
  api.subscribe("booking", refresh);
  await refresh();
  setInterval(() => { if (document.visibilityState === "visible") refresh(); }, 6000);
}

// ---------- the check-in card ----------
// Built from the confirmed record (date, local time, starting tee, group, reference, deposit, balance).
// The QR carries only "KKD1|<reference>": no private code, contact details, payment data or link.
function calendarLink(b) {
  const start = bkkInstant(b.date, b.time), end = start + 5 * 3600e3;
  const z = (ms) => new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const text = encodeURIComponent(th ? "ออกรอบที่สนามกอล์ฟกรุงเทพกรีฑา" : "Golf at Krungthep Kreetha");
  const loc = encodeURIComponent("282 Krungthep Kreetha Road, Hua Mak, Bang Kapi, Bangkok 10240");
  return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${text}&dates=${z(start)}/${z(end)}&location=${loc}`;
}
const holeLink = (b) => link(`course/holes/${String(b.tee === "10" ? 10 : 1).padStart(2, "0")}/`);
const holeLabel = (b) => (b.tee === "10" ? (th ? "ดูหลุมที่ 10 หลุมแรกของคุณ" : "Preview hole 10, your first hole") : (th ? "ดูหลุมที่ 1 หลุมแรกของคุณ" : "Preview hole 1, your first hole"));
const teeTime = (b) => (th ? `${time(b.time)} เวลากรุงเทพฯ แท่นที ${b.tee}` : `${time(b.time)} Bangkok time, Tee ${b.tee}`);
function passMoney(b) {
  if (b.exemption) return `<div><dt>${th ? "ไม่ต้องมัดจำ" : "No deposit"}</dt><dd>${b.exemption === "member_account" ? (th ? "บัญชีสมาชิก" : "Member account") : (th ? "ชำระที่สนาม" : "Pay at the club")}</dd></div>`;
  const paid = b.payment?.capturedMinor ?? b.quote.depositMinor;
  return `<div><dt>${th ? "มัดจำตัวอย่างที่ชำระแล้ว" : "Demo deposit paid"}</dt><dd class="num">${money(paid)}</dd></div><div><dt>${th ? "ยอดคงเหลือ ชำระที่สนาม" : "Balance at the club"}</dt><dd class="num">${money(b.quote.balanceMinor)}</dd></div>`;
}
function passHTML(b) {
  if (!b.pass) return "";
  if (b.pass.state !== "active") return `<div class="notice ok"><span>${b.pass.state === "checked_in" ? (th ? "เช็กอินที่สนามแล้ว ไม่ต้องใช้บัตรนี้อีก" : "Checked in at the club. This card is no longer needed.") : (th ? "เล่นจบแล้ว ขอบคุณที่มาเล่น" : "Round completed. Thank you for playing.")}</span></div>`;
  return `<section class="pass" data-pass aria-labelledby="pass-date">
    <div class="pass-head"><span class="pass-club">${th ? "สนามกอล์ฟกรุงเทพกรีฑา" : "Krungthep Kreetha"}</span><span class="pass-kind">${th ? "บัตรเช็กอินตัวอย่าง" : "Demo check-in card"}</span></div>
    <div class="pass-main">
      <div class="pass-info">
        <h2 class="pass-date" id="pass-date">${day(b.date)}</h2>
        <p class="pass-time"><span>${teeTime(b)}</span></p>
        <p><span>${th ? `${b.partySize} ท่าน` : `${b.partySize} golfer${b.partySize > 1 ? "s" : ""}`}</span>, <span>${esc(b.quote?.planName?.[lang] || CAT[b.category][lang])}</span></p>
        <dl class="pass-money">${passMoney(b)}</dl>
        <p class="pass-ref"><span class="small">${th ? "หมายเลขการจอง" : "Booking reference"}</span><b class="ref" data-pass-ref>${esc(b.ref)}</b><button type="button" class="btn small secondary no-print" data-copy-ref>${th ? "คัดลอกหมายเลข" : "Copy reference"}</button></p>
      </div>
      <figure class="pass-qr"><div class="qr-box" data-pass-qr data-payload="${esc(b.pass.payload)}"></div><figcaption class="small">${th ? "โค้ดตัวอย่างเท่านั้น" : "Sample code only"}</figcaption></figure>
    </div>
    <p class="pass-note small"><span>${th ? "บัตรตัวอย่าง QR นี้เก็บเฉพาะหมายเลขการจองตัวอย่างเป็นข้อความธรรมดา ไม่มีหน้าที่ชำระเงินหรือจัดการการจอง" : "Illustrative pass. This QR holds only the demo booking reference as plain text. It has no payment or management function."}</span> <span>${th ? "สำเนาที่บันทึกหรือพิมพ์ไว้เป็นภาพ ณ เวลานั้น เคาน์เตอร์ตรวจสอบการจองปัจจุบันทุกครั้ง" : "A saved or printed copy is a snapshot; the desk checks the current booking."}</span></p>
  </section>`;
}
async function drawQR(root) {
  const box = root.querySelector("[data-pass-qr]"); if (!box) return;
  try {
    const { qrSVG } = await import("./qr.js"); // loaded only on confirmation and manage
    // The label sits on the wrapper (the translation runtime does not enter SVG); the drawing itself is hidden from assistive tech.
    box.innerHTML = qrSVG(box.dataset.payload);
    box.setAttribute("role", "img");
    box.setAttribute("aria-label", th ? `QR ของหมายเลขการจอง ${box.dataset.payload.split("|")[1]}` : `QR code for booking reference ${box.dataset.payload.split("|")[1]}`);
  } catch { box.innerHTML = `<p class="small">${th ? "แสดง QR ไม่ได้ แจ้งหมายเลขการจองที่เคาน์เตอร์แทน" : "The QR could not be drawn. Give the reference at the counter instead."}</p>`; }
}
function copyWithFeedback(btn, text, el) {
  const done = () => { const old = btn.textContent; btn.textContent = th ? "คัดลอกแล้ว" : "Copied"; window.kk.toast?.(th ? "คัดลอกแล้ว" : "Copied"); setTimeout(() => { btn.textContent = old; }, 1600); };
  navigator.clipboard?.writeText(text).then(done, () => { const r = document.createRange(); r.selectNodeContents(el); getSelection().removeAllRanges(); getSelection().addRange(r); window.kk.toast?.(th ? "เลือกข้อความแล้ว กดคัดลอกได้เลย" : "Selected. Copy it with your keyboard or menu."); }) ?? (() => { const r = document.createRange(); r.selectNodeContents(el); getSelection().removeAllRanges(); getSelection().addRange(r); })();
}
function storageNote() {
  if (api.kind === "server") return th ? "เดโมนี้เก็บการจองไว้ในฐานข้อมูลบนเครื่องที่รันเซิร์ฟเวอร์ตัวอย่างเท่านั้น" : "This demo keeps the booking in the local demo server's database on this computer only.";
  if (api.storageOk && !api.storageOk()) return th ? "เบราว์เซอร์นี้ไม่บันทึกข้อมูลเดโม การจองนี้อยู่ได้จนกว่าจะปิดแท็บ" : "This browser is not saving demo data, so this booking lasts only until you close the tab.";
  return th ? "เดโมเก็บการจองไว้ในเบราว์เซอร์นี้เท่านั้น จนกว่าจะล้างข้อมูลเว็บไซต์ อุปกรณ์อื่นมองไม่เห็นการจองนี้" : "The demo keeps this booking in this browser only, until its site data is cleared. Other devices cannot see it.";
}

// ---------- confirmation ----------
async function confirmation() {
  const f = flow.get();
  if (!f?.bookingId || !f?.token) return missing();
  const body = document.querySelector("[data-confirm-body]");
  let shown = null;
  const render = async () => {
    let st; try { st = await api.getBookingStatus({ bookingId: f.bookingId, token: f.token }); } catch { return missing(); }
    const b = st.booking;
    const key = `${b.status}|${b.slotId}|${b.payment?.status}`;
    if (key === shown) return; shown = key;
    if (b.status === "PAYMENT_PENDING" || b.status === "HELD") {
      body.innerHTML = `<div class="panel"><div class="status-big"><span class="dot"></span><div><b>${th ? "กำลังรอการยืนยันการชำระเงิน" : "Waiting for payment verification"}</b><p class="small muted">${th ? `หมายเลขอ้างอิง ${b.ref} หน้านี้จะอัปเดตเอง ไม่ต้องชำระซ้ำ` : `Reference ${b.ref}. This page updates by itself; do not pay twice.`}</p></div></div><a class="btn secondary" href="${link("booking/payment/")}">${th ? "กลับไปหน้าชำระเงิน" : "Back to the payment page"}</a></div>`;
      return;
    }
    if (b.status !== "CONFIRMED" && !b.pass) { body.innerHTML = `<div class="notice warn"><span>${th ? "สถานะการจอง" : "Booking status"}: <b>${STATUS[b.status]}</b>. <a href="${link("booking/manage/")}">${th ? "ดูรายละเอียด" : "See details"}</a></span></div>`; return; }
    const p = b.payment;
    const printable = document.documentElement.dataset.target !== "artifact";
    body.innerHTML = `
      <p class="confirm-ok"><span class="tick" aria-hidden="true"></span><b>${th ? "ยืนยันการจองแล้ว (ตัวอย่าง)" : "Booking confirmed (demo)"}</b></p>
      ${passHTML(b)}
      <p class="row no-print">${printable ? `<button class="btn secondary" type="button" data-print>${th ? "พิมพ์หรือบันทึกเป็น PDF" : "Print or save as PDF"}</button>` : ""}<a class="btn secondary" href="${calendarLink(b)}" target="_blank" rel="noopener">${th ? "เพิ่มใน Google Calendar" : "Add to Google Calendar"}</a><a class="btn secondary" href="${link("visit/")}">${th ? "การเดินทาง" : "Directions"}</a><a class="btn secondary" href="${holeLink(b)}" data-hole-link>${holeLabel(b)}</a></p>
      <div class="split-2 no-print">
        <div class="panel"><h2 class="label">${th ? "การชำระเงิน" : "Payment"}</h2><div class="money">
          ${b.exemption ? `<div><span>${th ? "ไม่ต้องมัดจำ" : "No deposit"}</span><span>${b.exemption === "member_account" ? (th ? "บัญชีสมาชิก" : "Member account") : (th ? "ชำระที่สนาม" : "Pay at the club")}</span></div>` : `
          <div><span>${th ? "ราคารวม" : "Total"}</span><span>${money(b.quote.totalMinor)}</span></div>
          <div class="due"><span>${th ? "มัดจำที่ชำระแล้ว" : "Deposit paid"}</span><span>${money(p?.capturedMinor)}</span></div>
          <div><span>${th ? "ชำระที่สนาม" : "To pay at the club"}</span><span>${money(b.quote.balanceMinor)}</span></div>`}
        </div>${b.quote?.deposit ? `<p class="small muted"><span>${depositText(b.quote)}</span>.</p>` : ""}<p class="small muted">${th ? `ยกเลิกและรับมัดจำคืนได้ถึง ${formatDateTime(b.cancelDeadline, lang)} หลังจากนั้นและกรณีไม่มาตามนัด สมาคมเก็บมัดจำไว้ ไม่เรียกเก็บเพิ่ม` : `Cancel with a refund until ${formatDateTime(b.cancelDeadline, lang)}. After that, or if nobody arrives, the club keeps the deposit and charges nothing more.`}</p></div>
        <div class="panel"><h2 class="label">${th ? "รหัสส่วนตัวสำหรับจัดการการจอง" : "Private code to manage this booking"}</h2><p class="small muted">${th ? "รหัสนี้ใช้คู่กับหมายเลขการจองเพื่อดู เปลี่ยนเวลา หรือยกเลิก ไม่ได้อยู่ในบัตรหรือ QR ห้ามแชร์รหัสนี้" : "Use it with the reference to view, move or cancel. It is not on the card or in the QR. Do not share it."}</p>
          <p class="row"><button class="btn small secondary" type="button" data-reveal aria-expanded="false" aria-controls="private-code">${th ? "แสดงรหัสส่วนตัว" : "Show the private code"}</button><a class="btn small secondary" href="${link("booking/manage/")}">${th ? "จัดการการจอง" : "Manage booking"}</a></p>
          <div id="private-code" hidden><p class="code-box" data-code>${esc(f.token)}</p><p class="row"><button class="btn small secondary" type="button" data-copy>${th ? "คัดลอกรหัส" : "Copy code"}</button></p><p class="small muted">${th ? "ในระบบจริงจะส่งทางอีเมลหรือ SMS" : "The live system sends it by email or SMS."}</p></div></div>
      </div>
      <div class="panel no-print"><h2 class="label">${th ? "วันเล่น" : "On the day"}</h2><p>${th ? "แสดงบัตรนี้หรือแจ้งหมายเลขการจองที่เคาน์เตอร์ ชำระยอดคงเหลือที่สนาม และเผื่อเวลาเช็กอินก่อนเวลาออกรอบ" : "Show this card or give the reference at the counter, pay the balance at the club and allow time to check in before your tee time."}</p><p class="small muted">${storageNote()}</p></div>`;
    document.documentElement.classList.toggle("has-pass", !!body.querySelector("[data-pass]"));
    if (!document.documentElement.classList.contains("is-paused") && !matchMedia("(prefers-reduced-motion: reduce)").matches) body.querySelector(".tick")?.classList.add("draw");
    await drawQR(body);
  };
  body.addEventListener("click", (e) => {
    if (e.target.closest("[data-print]")) return window.print();
    const rv = e.target.closest("[data-reveal]");
    if (rv) { const box = body.querySelector("#private-code"); const open = box.hidden; box.hidden = !open; rv.setAttribute("aria-expanded", String(open)); rv.textContent = open ? (th ? "ซ่อนรหัสส่วนตัว" : "Hide the private code") : (th ? "แสดงรหัสส่วนตัว" : "Show the private code"); return; }
    const c = e.target.closest("[data-copy]"); if (c) return copyWithFeedback(c, f.token, body.querySelector("[data-code]"));
    const r = e.target.closest("[data-copy-ref]"); if (r) return copyWithFeedback(r, body.querySelector("[data-pass-ref]").textContent, body.querySelector("[data-pass-ref]"));
  });
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
  let current = null, booking = null, movePicker = null, moveDate = null, moveSlots = [], showAll = false, preview = null;
  const view = async (st) => {
    const b = st.booking; booking = b; current = { ref: b.ref, token: form.token.value.trim() };
    const c = st.cancellation;
    moveDate = moveDate && moveDate !== b.date ? moveDate : b.date;
    out.innerHTML = `${passHTML(b)}<div class="panel"><div class="row" style="justify-content:space-between"><span class="ref">${b.ref}</span><span class="tag ${b.status === "CONFIRMED" ? "ok" : b.status === "CANCELLED" ? "bad" : "warn"}">${STATUS[b.status]}</span></div>
      <p><b>${day(b.date)}, ${time(b.time)}</b><br><span>${teeName(b.tee)}</span><br><span>${th ? `${b.partySize} ท่าน` : `${b.partySize} golfers`}</span></p>
      ${b.payment ? `<p class="small">${th ? "การชำระเงิน" : "Payment"}: ${PAY[b.payment.status] || b.payment.status}, ${money(b.payment.capturedMinor)}${b.payment.retainedMinor ? `, ${th ? "สมาคมเก็บไว้" : "kept by the club"} ${money(b.payment.retainedMinor)}` : ""}</p>` : ""}
      ${b.refunds?.length ? `<p class="small">${th ? "การคืนเงิน" : "Refunds"}: ${b.refunds.map((r) => `${money(r.amountMinor)} (${r.status === "COMPLETED" ? (th ? "เสร็จแล้ว" : "completed") : (th ? "ส่งคำขอแล้ว รอผู้ให้บริการยืนยัน" : "submitted, waiting for the provider")})`).join(", ")}</p>` : ""}
      ${b.status === "CONFIRMED" ? `<p class="row no-print"><a class="btn small secondary" href="${holeLink(b)}">${holeLabel(b)}</a></p>
      <div class="stack no-print" data-move-box><h2 class="label">${th ? `เปลี่ยนเวลา (ได้ ${b.policy?.reschedule?.limit ?? 1} ครั้ง ก่อน ${b.policy?.reschedule?.untilHoursBefore ?? 48} ชั่วโมง)` : `Move to another time (${b.policy?.reschedule?.limit ?? 1} move, up to ${b.policy?.reschedule?.untilHoursBefore ?? 48} hours ahead)`}</h2>
        <div class="row"><button type="button" class="date-btn" data-move-date aria-haspopup="dialog" aria-expanded="false"><span class="dv">${day(moveDate)}</span></button><span class="small muted">${th ? "เลือกวัน แล้วเลือกเวลาใหม่" : "Choose a date, then a new time"}</span></div>
        <div data-move-list></div><div data-move-preview aria-live="polite"></div></div>
      <div class="stack no-print" data-cancel-box><h2 class="label">${th ? "ยกเลิก" : "Cancel"}</h2><p class="small">${c.kind === "refund" ? (th ? `ยกเลิกตอนนี้ได้รับมัดจำคืน ${money(c.refundMinor)} ภายในเงื่อนไข (ก่อน ${formatDateTime(c.deadline, lang)})` : `Cancel now and ${money(c.refundMinor)} is refunded (before ${formatDateTime(c.deadline, lang)}).`) : (th ? `เลยกำหนดยกเลิกฟรีแล้ว (${formatDateTime(c.deadline, lang)}) หากยกเลิก สมาคมเก็บมัดจำ ${money(c.retainedMinor)} ไว้ ไม่เรียกเก็บเพิ่ม` : `The free-cancellation deadline (${formatDateTime(c.deadline, lang)}) has passed. If you cancel, the club keeps the ${money(c.retainedMinor)} deposit and charges nothing more.`)}</p><p class="row"><button class="btn secondary" type="button" data-cancel-confirm>${th ? "ยืนยันการยกเลิก" : "Confirm cancellation"}</button></p></div>` : ""}</div>`;
    document.documentElement.classList.toggle("has-pass", !!out.querySelector("[data-pass]"));
    await drawQR(out);
    if (b.status === "CONFIRMED") {
      const { createPicker } = await import("./datepicker.js");
      const cfg = await api.getPublicConfig();
      movePicker?.destroy();
      const trig = out.querySelector("[data-move-date]");
      movePicker = createPicker({ trigger: trig, api, getCfg: () => cfg, sheetTitle: th ? "เลือกวันใหม่" : "Choose a new date",
        getCriteria: () => ({ partySize: b.partySize, category: b.category, clientId: cid }), getValue: () => moveDate,
        onCommit: (d) => { moveDate = d; trig.querySelector(".dv").textContent = day(d); loadMoves(); },
        onPickTime: (slotId, d) => { moveDate = d; trig.querySelector(".dv").textContent = day(d); loadMoves().then(() => askPreview(slotId)); } });
      loadMoves();
    }
  };
  // The move list reuses the tee sheet's labels: local time, starting tee and places left, so two 08:30
  // starts stay distinct, and every eligible time is reachable (the first twelve, then "show all").
  async function loadMoves() {
    const list = out.querySelector("[data-move-list]"); if (!list) return;
    preview = null; out.querySelector("[data-move-preview]").innerHTML = "";
    list.innerHTML = `<p class="small muted">${th ? "กำลังอัปเดตเวลา" : "Updating times"}</p>`;
    try {
      const a = await api.listAvailability({ date: moveDate, partySize: booking.partySize, category: booking.category, clientId: cid });
      moveSlots = (a.sessions || []).flatMap((s) => s.slots).filter((s) => ["available", "partial"].includes(s.state) && s.id !== booking.slotId);
      showAll = false; drawMoves();
    } catch (x) { list.innerHTML = `<p class="small">${errorText(x)}</p>`; }
  }
  function drawMoves() {
    const list = out.querySelector("[data-move-list]");
    if (!moveSlots.length) { list.innerHTML = `<p class="small muted">${th ? "ไม่มีเวลาว่างสำหรับกลุ่มนี้ในวันนั้น" : "No free times for this group that day"}</p>`; return; }
    const shown = showAll ? moveSlots : moveSlots.slice(0, 12);
    list.innerHTML = `<div class="slots" role="list">${shown.map((s) => `<div role="listitem"><button type="button" class="slot" data-move="${s.id}" aria-pressed="${preview?.slotId === s.id}"><span class="time num">${time(s.time)}</span><span class="tee-tag">${th ? `ที ${s.tee}` : `Tee ${s.tee}`}</span><span class="free">${th ? `ว่าง ${s.remaining}` : `${s.remaining} free`}</span></button></div>`).join("")}</div>${moveSlots.length > 12 && !showAll ? `<p><button type="button" class="btn small secondary" data-move-more>${th ? `แสดงทุกเวลา (${moveSlots.length})` : `Show all ${moveSlots.length} times`}</button></p>` : ""}`;
  }
  async function askPreview(slotId) {
    const box = out.querySelector("[data-move-preview]");
    try {
      const r = await api.rescheduleBooking({ ...current, newSlotId: slotId, preview: true });
      preview = r.preview; drawMoves();
      const pv = r.preview;
      const diff = pv.priceDifferenceMinor;
      box.innerHTML = `<div class="panel move-preview"><p><b>${day(pv.date)}, ${time(pv.time)}</b>, <span>${teeName(pv.tee)}</span></p><div class="money">${pv.totalMinor != null ? `<div><span>${th ? "ราคารวมใหม่" : "New total"}</span><span>${money(pv.totalMinor)}</span></div><div class="due"><span>${th ? "มัดจำที่ชำระแล้ว (ยกไปด้วย)" : "Deposit already paid (moves with you)"}</span><span>${money(pv.depositPaidMinor)}</span></div><div><span>${th ? "ยอดคงเหลือใหม่ ชำระที่สนาม" : "Revised balance, paid at the club"}</span><span>${money(pv.balanceMinor)}</span></div>` : `<div><span>${th ? "บัญชีสมาชิก" : "Member account"}</span><span></span></div>`}</div>${diff ? `<p class="small">${diff > 0 ? (th ? `ราคาเพิ่มขึ้น ${money(diff)}` : `The price goes up by ${money(diff)}.`) : (th ? `ราคาลดลง ${money(-diff)}` : `The price goes down by ${money(-diff)}.`)}</p>` : ""}<p class="small muted">${th ? "ระบบจะกันเวลาใหม่ให้ก่อน แล้วจึงปล่อยเวลาเดิม หากไม่สำเร็จ เวลาเดิมยังอยู่" : "The new time is secured first, then the old one is released. If the move fails, your current time stays."}</p><p class="row"><button class="btn" type="button" data-move-confirm="${pv.slotId}">${th ? "ยืนยันการเปลี่ยนเวลา" : "Confirm the move"}</button><button class="btn secondary" type="button" data-move-cancel>${th ? "ไม่เปลี่ยน" : "Keep my time"}</button></p></div>`;
      box.querySelector("[data-move-confirm]")?.focus();
    } catch (x) { box.innerHTML = `<div class="notice warn"><span>${x.code === "NO_RATE" ? (th ? "เวลาใหม่ไม่มีราคาที่ประกาศสำหรับการจองนี้ จึงยังไม่ได้เปลี่ยน" : "The new time has no published rate for this booking, so nothing has changed.") : errorText(x)}</span></div>`; }
  }
  form.addEventListener("submit", async (e) => {
    e.preventDefault(); err.hidden = true;
    try { await view(await api.lookupBooking({ ref: form.ref.value.trim(), token: form.token.value.trim() })); }
    catch (x) { err.hidden = false; err.textContent = x.code === "NOT_FOUND" ? (th ? "ไม่พบการจองตามข้อมูลนี้ ตรวจสอบหมายเลขและรหัสอีกครั้ง" : "No booking matches those details. Check the reference and code.") : errorText(x); out.innerHTML = ""; }
  });
  out.addEventListener("click", async (e) => {
    if (e.target.closest("[data-cancel-confirm]")) {
      try { const r = await api.cancelBooking({ ...current, confirm: true }); window.kk.toast?.(th ? "ยกเลิกแล้ว บัตรเช็กอินใช้ไม่ได้อีก" : "Cancelled. The check-in card is no longer valid."); await view({ booking: r.booking, cancellation: r.outcome || { kind: "refund", refundMinor: 0, retainedMinor: 0, deadline: 0 } }); } catch (x) { window.kk.toast?.(errorText(x)); }
      return;
    }
    if (e.target.closest("[data-move-more]")) { showAll = true; drawMoves(); out.querySelectorAll("[data-move]")[12]?.focus(); return; }
    if (e.target.closest("[data-move-cancel]")) { preview = null; out.querySelector("[data-move-preview]").innerHTML = ""; drawMoves(); return; }
    const mv = e.target.closest("[data-move]"); if (mv) return askPreview(mv.dataset.move);
    const ok = e.target.closest("[data-move-confirm]");
    if (ok) {
      ok.disabled = true;
      try { const r = await api.rescheduleBooking({ ...current, newSlotId: ok.dataset.moveConfirm }); window.kk.toast?.(th ? `ย้ายไป ${time(r.booking.time)} แท่นที ${r.booking.tee} แล้ว` : `Moved to ${r.booking.time}, Tee ${r.booking.tee}`); moveDate = null; await view(await api.lookupBooking(current)); }
      catch (x) { ok.disabled = false; out.querySelector("[data-move-preview]").insertAdjacentHTML("afterbegin", `<div class="notice warn"><span>${x.code === "NO_RATE" ? (th ? "เวลาใหม่ไม่มีราคาที่ประกาศ จึงยังไม่ได้เปลี่ยน" : "The new time has no published rate, so nothing has changed.") : errorText(x)} ${th ? "เวลาเดิมยังอยู่" : "Your current time stays."}</span></div>`); }
      return;
    }
    const r = e.target.closest("[data-copy-ref]"); if (r) copyWithFeedback(r, out.querySelector("[data-pass-ref]").textContent, out.querySelector("[data-pass-ref]"));
  });
  if (f?.ref && f?.token) form.requestSubmit();
}

(async () => {
  try { api = await getApi(); } catch (e) { window.kk.toast?.(errorText(e)); return; }
  ({ details, payment, confirmation, manage })[step]?.();
})();
