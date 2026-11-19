// Tee-time discovery: date strip, group size, golfer type, time band, results by session,
// a server-created hold with a countdown, and live updates when another booking takes a place.
import { getApi, clientId } from "./api.js";
import { addDays, dayKey, bkkDate } from "./core/util.js";
import { lang, th, esc, money, time, day, CAT, SESSION, teeName, flow, errorText, countdown, summaryHTML, link } from "./ui.js";

const box = document.querySelector("[data-teetimes]");
const results = box.querySelector("[data-results]");
const title = box.querySelector("[data-results-title]");
const summary = box.querySelector("[data-summary-body]");
const mobileSum = document.querySelector("[data-mobile-summary]");
const datesEl = box.querySelector("[data-dates]");
const q = new URLSearchParams(location.search);
let saved = {}; try { saved = JSON.parse(sessionStorage.getItem("kk.search") || "{}"); } catch {}
const carried = window.kk.takeCarry?.() || {};
const state = {
  date: carried.date || q.get("date") || saved.date, golfers: Number(carried.golfers || q.get("golfers") || saved.golfers || 2), category: carried.category || saved.category || "visitor",
  band: "all", memberNumber: carried.memberNumber || "", hold: null, quote: null, slot: null, data: null,
};
window.kk.carry = () => ({ date: state.date, golfers: state.golfers, category: state.category, band: state.band, memberNumber: state.memberNumber });
let api, cfg, stopCountdown = () => {}, loadSeq = 0;
const cid = clientId();

function persist() { try { sessionStorage.setItem("kk.search", JSON.stringify({ date: state.date, golfers: state.golfers, category: state.category })); } catch {} }

function renderDates() {
  datesEl.innerHTML = "";
  for (let i = 0; i < 14; i++) {
    const d = addDays(cfg.today, i);
    if (d > cfg.horizon.last) break;
    const closed = dayKey(d) === "mon";
    const b = document.createElement("button");
    b.type = "button"; b.className = "date-chip" + (closed ? " is-closed" : ""); b.dataset.date = d; b.setAttribute("role", "radio");
    b.setAttribute("aria-checked", String(d === state.date)); b.tabIndex = d === state.date ? 0 : -1;
    b.setAttribute("aria-label", day(d) + (closed ? (th ? " ไม่มีเวลาออกรอบออนไลน์" : ", no online tee times") : ""));
    b.innerHTML = `<span class="dow">${i === 0 ? (th ? "วันนี้" : "Today") : day(d, { weekday: "short" })}</span><span class="d num">${Number(d.slice(8))}</span><span class="m">${day(d, { month: "short" })}</span>`;
    b.addEventListener("click", () => { state.date = d; persist(); datesEl.querySelectorAll(".date-chip").forEach((c) => { c.setAttribute("aria-checked", String(c.dataset.date === d)); c.tabIndex = c.dataset.date === d ? 0 : -1; }); if (state.hold) renderSummary(); load(); });
    datesEl.append(b);
  }
  datesEl.onkeydown = (e) => {
    if (!["ArrowLeft", "ArrowRight"].includes(e.key)) return;
    const chips = [...datesEl.children]; const i = chips.indexOf(document.activeElement); if (i < 0) return;
    const n = chips[Math.min(chips.length - 1, Math.max(0, i + (e.key === "ArrowRight" ? 1 : -1)))]; n.focus(); n.click(); e.preventDefault();
  };
}

function capDots(s) {
  if (s.capacity == null) return "";
  const left = s.remaining;
  return `<span class="cap" aria-hidden="true">${Array.from({ length: s.capacity }, (_, i) => `<i class="${i >= left ? "taken" : ""}"></i>`).join("")}</span>`;
}
function slotHTML(s, sessionPrice) {
  const tee = s.tee === "10" ? (th ? "เริ่มแท่นที 10" : "Starts on the 10th tee") : (th ? "เริ่มแท่นที 1" : "Starts on the 1st tee");
  const tag = th ? `ที ${s.tee}` : `Tee ${s.tee}`;
  const placesText = (data) => data.capacityModel === "flight" ? (th ? "จองได้ทั้งก๊วน" : "Whole tee time") : (th ? `ว่าง ${s.remaining} จาก ${s.capacity} ที่` : `${s.remaining} of ${s.capacity} places left`);
  const reason = {
    full: th ? "เต็มแล้ว" : "Full", too_small: th ? `ว่างไม่พอสำหรับ ${state.golfers} ท่าน` : `Not enough places for ${state.golfers}`,
    member_only: th ? "เฉพาะสมาชิก" : "Members only", closed: th ? `ปิด${s.reason ? `: ${s.reason}` : ""}` : `Closed${s.reason ? `: ${s.reason}` : ""}`,
    past: th ? "ผ่านไปแล้ว" : "Passed", no_rate: th ? "ยังไม่มีราคาที่ประกาศ จองทางโทรศัพท์" : "No published price; book by phone", not_eligible: th ? "ต้องยืนยันสิทธิ์สมาชิกก่อน" : "Verify membership first",
  }[s.state];
  const selectable = ["available", "partial", "yours"].includes(s.state);
  // The session header carries the price; a chip shows one only when it differs from its session.
  const price = s.quote?.perGolferMinor && s.quote.perGolferMinor !== sessionPrice ? `<span class="slot-price">${money(s.quote.perGolferMinor)}</span>` : "";
  const label = `${time(s.time)}, ${tee}. ${selectable ? placesText(state.data) : reason}${s.quote?.perGolferMinor ? `, ${money(s.quote.perGolferMinor)} ${th ? "ต่อท่าน" : "per golfer"}` : ""}`;
  if (!selectable) return `<div class="slot is-off${s.memberOnly ? " member-only" : ""}" role="listitem" aria-label="${esc(label)}"><span class="time num">${time(s.time)}</span><span class="why">${reason}</span></div>`;
  // Two times can share a clock time (one from each tee), so the starting tee and the places left are written out.
  const free = s.capacity != null && state.data.capacityModel !== "flight" ? `<span class="free">${th ? `ว่าง ${s.remaining}` : `${s.remaining} free`}</span>` : "";
  return `<div role="listitem"><button type="button" class="slot${s.memberOnly ? " member-only" : ""}" data-slot="${s.id}" aria-pressed="${s.state === "yours" || state.slot?.id === s.id}" data-selected-label="${th ? "เลือกแล้ว" : "Selected"}" aria-label="${esc(label)}"><span class="time num">${time(s.time)}</span><span class="tee-tag">${tag}</span>${capDots(s)}${free}${price}</button></div>`;
}

function renderResults() {
  const data = state.data;
  results.setAttribute("aria-busy", "false");
  if (data.dayState === "closed") {
    title.textContent = th ? `${day(state.date)} ไม่มีเวลาออกรอบออนไลน์` : `No online tee times on ${day(state.date)}`;
    const next = addDays(state.date, 1);
    results.innerHTML = `<div class="empty-state"><b>${th ? "วันจันทร์สงวนไว้สำหรับการปิดสนามจัดการแข่งขันในระบบตัวอย่างนี้" : "In this demo, Mondays are kept for course hire."}</b><p class="muted">${th ? "สนามแจ้งว่าวันจันทร์เปิด 08.00 ถึง 19.00 น. โทรสอบถามเวลาว่างได้ที่ 0-2736-0378-9" : "The club lists Monday hours of 08:00 to 19:00. Call 0-2736-0378-9 to ask about Monday play."}</p><button class="btn secondary" type="button" data-go="${next}">${th ? `ดู${day(next, { weekday: "long" })}` : `See ${day(next, { weekday: "long" })}`}</button></div>`;
    return;
  }
  if (data.dayState === "stale") {
    title.textContent = th ? "ยังยืนยันเวลาที่ว่างไม่ได้ในขณะนี้" : "Availability temporarily unavailable";
    results.innerHTML = `<div class="empty-state"><b>${th ? "ระบบยังยืนยันตารางกับสมาคมไม่ได้" : "We cannot confirm the schedule with the club right now."}</b><p class="muted">${th ? "เพื่อไม่ให้จองซ้อน เราหยุดรับการจองใหม่ชั่วคราว วันที่ที่คุณเลือกยังอยู่" : "To avoid double bookings we have paused new holds. Your chosen date is kept."}</p><div class="row"><button class="btn" type="button" data-retry>${th ? "ลองใหม่" : "Try again"}</button><span class="small">${th ? "หรือโทร 0-2736-0378-9" : "or call 0-2736-0378-9"}</span></div></div>`;
    return;
  }
  if (!data.eligibility.ok) {
    title.textContent = th ? "ยืนยันสิทธิ์สมาชิกเพื่อดูเวลาของสมาชิก" : "Verify your membership to see member times";
  }
  const sessions = data.sessions.filter((s) => state.band === "all" || s.id === state.band);
  const all = sessions.flatMap((s) => s.slots);
  const open = all.filter((s) => ["available", "partial", "yours"].includes(s.state));
  if (data.eligibility.ok) title.textContent = th ? `${day(state.date)} มี ${open.length} เวลาที่ว่างสำหรับ ${state.golfers} ท่าน` : `${open.length} time${open.length === 1 ? "" : "s"} for ${state.golfers} on ${day(state.date)}`;
  if (!open.length && data.eligibility.ok) {
    results.innerHTML = `<div class="empty-state"><b>${th ? "ไม่มีเวลาว่างตามที่เลือก" : "Nothing free for this choice"}</b><p class="muted">${th ? "ลองลดจำนวนผู้เล่น เปลี่ยนช่วงเวลา หรือเลือกวันอื่น" : "Try fewer golfers, another time of day, or another date."}</p><div class="row"><button class="btn secondary" type="button" data-go="${addDays(state.date, 1)}">${th ? "วันถัดไป" : "Next day"}</button><a class="btn secondary" href="tel:027360378">${th ? "โทรหาแผนกจอง" : "Call the booking desk"}</a></div></div>`;
    return;
  }
  const bookable = (x) => ["available", "partial", "yours"].includes(x.state);
  const hidden = all.length - open.length;
  const toggle = hidden ? `<label class="check show-all"><input type="checkbox" data-show-all${state.showAll ? " checked" : ""}><span class="small">${th ? `แสดงเวลาที่เต็มหรือจองไม่ได้ด้วย (${hidden} เวลา)` : `Also show full or unavailable times (${hidden})`}</span></label>` : "";
  // The same morning sessions (two tees, then one) read as one block.
  const merged = []; for (const s of sessions) { const m = merged.find((x) => x.id === s.id); if (m) m.slots = [...m.slots, ...s.slots]; else merged.push({ ...s, slots: [...s.slots] }); }
  results.innerHTML = merged.map((s) => {
    const shown = state.showAll ? s.slots : s.slots.filter(bookable);
    const prices = s.slots.filter(bookable).map((x) => x.quote?.perGolferMinor).filter(Boolean);
    const common = prices.length && prices.every((p) => p === prices[0]) ? prices[0] : null;
    const memberAcct = s.slots.some((x) => bookable(x) && x.quote?.priceMode === "member_account");
    const head = memberAcct ? (th ? "บัญชีสมาชิก ไม่ต้องมัดจำ" : "Member account, no deposit") : common ? (th ? `${money(common)} ต่อท่าน` : `${money(common)} per golfer`) : "";
    return `<section class="session" aria-labelledby="ss-${s.id}"><div class="session-head"><h3 id="ss-${s.id}">${SESSION[s.id][lang]}</h3>${head ? `<span class="sess-price">${head}</span>` : ""}</div>${shown.length ? `<div class="slots" role="list">${shown.map((x) => slotHTML(x, common)).join("")}</div>` : `<p class="small muted">${th ? "ช่วงนี้ไม่มีเวลาที่จองได้" : "Nothing bookable in this session"}</p>`}</section>`;
  }).join("") + toggle;
  results.querySelector("[data-show-all]")?.addEventListener("change", (e) => { state.showAll = e.target.checked; renderResults(); });
}

async function load({ quiet = false } = {}) {
  const my = ++loadSeq;
  if (!quiet) { results.setAttribute("aria-busy", "true"); results.style.opacity = ".55"; }
  try {
    const data = await api.listAvailability({ date: state.date, partySize: state.golfers, category: state.category, memberNumber: state.memberNumber, clientId: cid });
    if (my !== loadSeq) return; // a newer request superseded this one
    state.data = data; renderResults();
  } catch (e) {
    if (my !== loadSeq) return;
    title.textContent = errorText(e);
    results.innerHTML = `<div class="empty-state"><b>${errorText(e)}</b><button class="btn" type="button" data-retry>${th ? "ลองใหม่" : "Try again"}</button></div>`;
  } finally { if (my === loadSeq) results.style.opacity = ""; }
}

function renderSummary() {
  stopCountdown();
  if (!state.hold) {
    summary.innerHTML = `<p class="muted small">${th ? "เลือกเวลาจากรายการ ระบบจะกันเวลานั้นไว้ให้คุณ 10 นาทีระหว่างกรอกข้อมูล" : "Pick a time from the list. We hold it for you for 10 minutes while you add your details."}</p>`;
    mobileSum.hidden = true; return;
  }
  const h = state.hold;
  // The hold keeps its own date, group and golfer type while the visitor browses other filters.
  const browsing = h.date !== state.date || h.partySize !== state.golfers || h.category !== state.category;
  const keep = browsing ? `<div class="notice"><span>${th ? "คุณกำลังดูตัวเลือกอื่น เวลาที่กันไว้ด้านบนยังอยู่ จนกว่าจะเลือกเวลาใหม่ได้สำเร็จหรือกดยกเลิก" : "You are looking at other options. The time held above stays yours until a new choice succeeds or you release it."}</span></div>` : "";
  summary.innerHTML = `<p class="eyebrow small">${th ? "เวลาที่กันไว้ให้คุณ" : "Your held time"}</p>${summaryHTML({ ...h, quote: state.quote, policy: cfg.policy })}<div data-cd></div>${keep}<p class="row"><a class="btn block" href="${link("booking/details/")}">${th ? "ดำเนินการต่อ กรอกข้อมูล" : "Continue to your details"} <span class="arrow" aria-hidden="true">&rarr;</span></a><button class="btn secondary block" type="button" data-release>${th ? "ยกเลิกการเลือก" : "Release this time"}</button></p>`;
  stopCountdown = countdown(summary.querySelector("[data-cd]"), { expiresAt: h.expiresAt, serverTime: h.serverTime, onLow: () => window.kk.toast?.(th ? "เหลือเวลากันที่อีก 2 นาที" : "Two minutes left on your hold"), onEnd: () => { state.hold = null; flow.clear(); window.kk.toast?.(th ? "การกันเวลาหมดอายุ เลือกเวลาใหม่ได้" : "Your hold ended. Choose a time again."); load({ quiet: true }); renderSummary(); } });
  mobileSum.hidden = false;
  mobileSum.querySelector("[data-ms-text]").textContent = `${time(h.time)}, ${th ? `${h.partySize} ท่าน` : `${h.partySize} golfers`}`;
}

async function select(slotId, btn) {
  btn?.classList.add("is-loading");
  try {
    const idemKey = `${slotId}|${state.golfers}|${state.category}`;
    const r = await api.createHold({ slotId, partySize: state.golfers, category: state.category, memberNumber: state.memberNumber, clientId: cid, idemKey });
    state.hold = r.hold; state.quote = r.quote;
    flow.set({ holdId: r.hold.id, bookingId: null, token: null, ref: null });
    renderSummary();
    await load({ quiet: true });
    document.querySelector(`[data-slot="${slotId}"]`)?.focus();
    window.kk.toast?.(th ? `กันเวลา ${time(r.hold.time)} ไว้ให้คุณแล้ว` : `${r.hold.time} is held for you`);
  } catch (e) {
    window.kk.toast?.(errorText(e));
    await load({ quiet: true });
    if (e.code === "NO_CAPACITY" && e.detail?.alternatives?.length) {
      const near = e.detail.alternatives.map((a) => `<button class="btn small secondary" type="button" data-slot="${a.id}">${time(a.time)}</button>`).join("");
      results.insertAdjacentHTML("afterbegin", `<div class="notice warn" style="margin-bottom:16px"><span>${errorText(e)} <span class="row" style="margin-top:8px">${near}</span></span></div>`);
    }
  } finally { btn?.classList.remove("is-loading"); }
}

box.addEventListener("click", async (e) => {
  const s = e.target.closest("[data-slot]"); if (s) return select(s.dataset.slot, s);
  const g = e.target.closest("[data-go]"); if (g) { state.date = g.dataset.go; persist(); renderDates(); if (state.hold) renderSummary(); return load(); }
  if (e.target.closest("[data-retry]")) return load();
  if (e.target.closest("[data-release]")) { try { await api.releaseHold({ holdId: state.hold.id, clientId: cid }); } catch (err) { window.kk.toast?.(errorText(err)); return; } state.hold = null; flow.clear(); renderSummary(); load({ quiet: true }); }
});
box.querySelectorAll("[data-step]").forEach((b) => b.addEventListener("click", () => {
  state.golfers = Math.min(cfg.maxGroup, Math.max(1, state.golfers + Number(b.dataset.step))); persist(); syncControls(); if (state.hold) renderSummary(); load();
}));
box.querySelector("[data-category]").addEventListener("change", (e) => { state.category = e.target.value; persist(); syncControls(); if (state.hold) renderSummary(); load(); });
box.querySelector("[data-band]")?.addEventListener("change", (e) => { state.band = e.target.value; renderResults(); });
box.querySelector("[data-verify]").addEventListener("click", () => { state.memberNumber = box.querySelector("#member-no").value.trim(); load(); });
box.querySelector("#member-no").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); box.querySelector("[data-verify]").click(); } });

function syncControls() {
  box.querySelector("[data-golfers]").textContent = th ? `${state.golfers} ท่าน` : `${state.golfers} golfer${state.golfers > 1 ? "s" : ""}`;
  box.querySelector('[data-step="-1"]').disabled = state.golfers <= 1;
  box.querySelector('[data-step="1"]').disabled = state.golfers >= cfg.maxGroup;
  box.querySelectorAll('[name="category"]').forEach((r) => (r.checked = r.value === state.category));
  box.querySelectorAll('[name="band"]').forEach((r) => (r.checked = r.value === state.band));
  box.querySelector("[data-member]").hidden = state.category !== "member";
  box.querySelector("#member-no").value = state.memberNumber;
  // Only the guest and member choices need a word of explanation; the visitor price says what it includes.
  const note = box.querySelector("[data-category-note]");
  note.hidden = state.category === "visitor";
  note.textContent = {
    visitor: "",
    member_guest: th ? "สมาคมประกาศราคาแขกของสมาชิกเฉพาะช่วงทไวไลท์ เวลาอื่นโปรดโทรจอง แขกต้องมากับสมาชิกตามข้อบังคับ" : "The club publishes a member's-guest price for twilight only; book other times by phone. Guests play with their member, as the rules require.",
    member: th ? "สมาชิกยืนยันสิทธิ์ด้วยหมายเลขสมาชิก ค่าบริการเรียกเก็บผ่านบัญชีสมาชิก" : "Members verify with their member number; fees go to the member account.",
  }[state.category];
}

(async function init() {
  try {
    api = await getApi();
    cfg = await api.getPublicConfig();
  } catch (e) { results.innerHTML = `<div class="notice bad"><span>${errorText(e)}</span></div>`; return; }
  if (!state.date || state.date < cfg.horizon.first || state.date > cfg.horizon.last) { let d = addDays(cfg.today, 1); if (dayKey(d) === "mon") d = addDays(d, 1); state.date = d; }
  state.golfers = Math.min(cfg.maxGroup, Math.max(1, state.golfers || 2));
  renderDates(); syncControls();
  // Resume an existing hold (refresh, back button, language switch)
  const f = flow.get();
  if (f?.holdId) { try { const r = await api.getHold({ holdId: f.holdId, clientId: cid }); if (r.hold.status === "ACTIVE") { state.hold = r.hold; state.quote = r.quote; state.date = r.hold.date; renderDates(); } } catch { flow.clear(); } }
  renderSummary();
  await load();
  api.subscribe("availability", () => load({ quiet: true }));
})();
