// Homepage: the booking dock, the hole rail and stage, and the facilities index.
import { getApi, clientId } from "./api.js";
import { addDays, bkkDate, dayKey, formatDate } from "./core/util.js";
import { createPicker, onBangkokMidnight } from "./datepicker.js";

const lang = document.documentElement.lang === "th" ? "th" : "en";
const th = lang === "th";
const pad2 = (n) => String(n).padStart(2, "0");
// Reduced motion (OS) or the site's Pause motion, read at the moment of each interaction (S03).
const motionOff = () => matchMedia("(prefers-reduced-motion: reduce)").matches || document.documentElement.classList.contains("is-paused");
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

// ---- Finder: playing date (the shared calendar), golfers and golfer type, handed to the tee sheet.
// Without JavaScript the native date field and the form's GET still reach the tee sheet.
const dock = document.querySelector("[data-dock]");
if (dock) finder(dock);
async function finder(dock) {
  const input = dock.querySelector("#dock-date");
  const btn = dock.querySelector("[data-date-btn]");
  const golfers = dock.querySelector('input[name="golfers"]');
  const out = dock.querySelector("[data-golfers]");
  const catSel = dock.querySelector("[data-dock-category]");
  const quick = dock.querySelector("[data-dock-quick]");
  let saved = {}; try { saved = JSON.parse(sessionStorage.getItem("kk.search") || "{}"); } catch {}
  const st = { date: null, golfers: Math.min(4, Math.max(1, Number(saved.golfers) || 2)), category: ["visitor", "member_guest", "member"].includes(saved.category) ? saved.category : "visitor" };
  let api, cfg;
  try { api = await getApi(); cfg = await api.getPublicConfig(); } catch { return; } // the plain form still works
  const closed = (d) => (cfg.closedDays || []).some((c) => c.day === dayKey(d));
  const inRange = (d) => d && d >= cfg.horizon.first && d <= cfg.horizon.last;
  st.date = inRange(saved.date) ? saved.date : (() => { let d = addDays(cfg.today, 1); if (closed(d)) d = addDays(d, 1); return d; })();
  input.type = "hidden"; btn.hidden = false; quick.hidden = false;
  const persist = () => { try { sessionStorage.setItem("kk.search", JSON.stringify({ date: st.date, golfers: st.golfers, category: st.category })); } catch {} };
  const strip = document.createElement("div");
  strip.className = "date-strip quick"; strip.setAttribute("role", "radiogroup"); strip.setAttribute("aria-labelledby", "dock-quick-label");
  dock.querySelector("[data-quick]").append(strip);
  function render() {
    input.value = st.date;
    btn.querySelector("[data-date-value]").textContent = formatDate(st.date, lang, { weekday: "short", day: "numeric", month: "short", year: "numeric" });
    strip.innerHTML = "";
    // The quick days are a projection of the same configured window: the next seven dates.
    for (let i = 0; i < 7; i++) {
      const d = addDays(cfg.today, i);
      if (d > cfg.horizon.last) break;
      const c = closed(d);
      const b = document.createElement("button");
      b.type = "button"; b.className = "date-chip" + (c ? " is-closed" : ""); b.setAttribute("role", "radio"); b.dataset.date = d;
      b.setAttribute("aria-checked", String(d === st.date)); b.tabIndex = d === st.date || (i === 0 && !strip.querySelector('[tabindex="0"]') && !inWeek()) ? 0 : -1;
      b.setAttribute("aria-label", formatDate(d, lang) + (c ? (th ? " ไม่มีเวลาออกรอบออนไลน์" : ", no online tee times") : ""));
      b.innerHTML = `<span class="dow">${i === 0 ? (th ? "วันนี้" : "Today") : formatDate(d, lang, { weekday: "short" })}</span><span class="d num">${Number(d.slice(8))}</span>`;
      b.addEventListener("click", () => { st.date = d; persist(); render(); strip.querySelector(`[data-date="${d}"]`)?.focus(); });
      strip.append(b);
    }
  }
  const inWeek = () => st.date >= cfg.today && st.date <= addDays(cfg.today, 6);
  // One stop in the tab order; arrows, Home and End move the choice (a single-selection radio group).
  strip.addEventListener("keydown", (e) => {
    const chips = [...strip.children]; const i = chips.indexOf(document.activeElement); if (i < 0) return;
    const k = { ArrowRight: i + 1, ArrowDown: i + 1, ArrowLeft: i - 1, ArrowUp: i - 1, Home: 0, End: chips.length - 1 }[e.key];
    if (k == null) return;
    chips[(k + chips.length) % chips.length].click(); e.preventDefault();
  });
  const setGolfers = (n) => {
    st.golfers = Math.min(cfg.maxGroup || 4, Math.max(1, n)); golfers.value = st.golfers;
    out.textContent = th ? `${st.golfers} ท่าน` : `${st.golfers} golfer${st.golfers > 1 ? "s" : ""}`;
    dock.querySelector('[data-step="-1"]').disabled = st.golfers <= 1; dock.querySelector('[data-step="1"]').disabled = st.golfers >= (cfg.maxGroup || 4);
  };
  dock.querySelectorAll("[data-step]").forEach((b) => b.addEventListener("click", () => { setGolfers(st.golfers + Number(b.dataset.step)); persist(); picker.refresh(); }));
  catSel.value = st.category;
  catSel.addEventListener("change", () => { st.category = catSel.value; persist(); picker.refresh(); });
  setGolfers(st.golfers);
  const go = (pickSlot) => {
    persist();
    if (pickSlot) { try { sessionStorage.setItem("kk.pick", JSON.stringify({ slotId: pickSlot, date: st.date, at: Date.now() })); } catch {} }
    location.href = `${dock.action}?date=${st.date}&golfers=${st.golfers}${st.category !== "visitor" ? `&category=${st.category}` : ""}`;
  };
  const picker = createPicker({ trigger: btn, anchor: dock.querySelector(".finder-bar"), api, getCfg: () => cfg,
    getCriteria: () => ({ partySize: st.golfers, category: st.category, clientId: clientId() }),
    getValue: () => st.date, onCommit: (d) => { st.date = d; persist(); render(); },
    onPickTime: (slotId) => go(slotId) });
  dock.querySelector("[data-view-cal]").addEventListener("click", () => picker.open());
  dock.addEventListener("submit", (e) => { e.preventDefault(); go(null); });
  onBangkokMidnight(cfg.serverTime, async () => { try { cfg = await api.getPublicConfig(); if (!inRange(st.date)) st.date = cfg.horizon.first; picker.refresh(); render(); } catch {} });
  render();
}

// ---- Hole viewer: the club's diagram in 2D, or the 3D model opening straight down so it matches the diagram.
// three.js loads only when the section comes near the screen; holes without a model stay in 2D.
function holeViewer(box) {
  const flat = box.querySelector("[data-hv-flat]");
  const sceneEl = box.querySelector("[data-hv-scene]");
  const status = box.querySelector("[data-hv-status]");
  const topBtn = box.querySelector("[data-hv-top]");
  const engageBtn = box.querySelector("[data-hv-engage]");
  // Reduced motion or the site's Pause motion, read each time so a change during the visit applies.
  const still = () => matchMedia("(prefers-reduced-motion: reduce)").matches || document.documentElement.classList.contains("is-paused");
  const touch = matchMedia("(pointer: coarse)").matches;
  const cache = new Map();
  let scene = null, failed = false, token = 0, mode = "3d", cur = null, near = false;
  const label = (kind, extra) => {
    const el = document.createElement("span");
    el.className = `xp-label xp-${kind}`;
    if (kind === "arc") { el.textContent = `${extra.approx ? "≈ " : ""}${extra.yards} ${th ? "หลา" : "yd"}`; if (!extra.main) el.classList.add("is-sub"); return el; }
    el.textContent = kind === "green" ? (th ? "กรีน" : "Green") : kind === "tee" ? (cur?.tees.find((x) => x.id === extra)?.name?.[lang] || extra) : kind === "target" ? (th ? "จุดเล็ง" : "Target") : "";
    return kind === "carry" ? null : el;
  };
  const setTop = (on) => { topBtn.setAttribute("aria-pressed", String(on)); box.classList.toggle("is-moved", !on); };
  const engage = (on) => { if (!scene) return; scene.setEngaged(on); engageBtn.setAttribute("aria-pressed", String(on)); const s = engageBtn.querySelector("span"); s.textContent = on ? s.dataset.on : s.dataset.off; box.classList.toggle("is-engaged", on); };
  async function ensure() {
    if (scene || failed) return scene;
    try {
      const mod = await import("./explorer/scene3d.js");
      if (!mod.webglAvailable()) throw new Error("webgl");
      scene = new mod.HoleScene(sceneEl, { onLabel: label, reducedMotion: still(), isTouch: touch, transparent: true });
      sceneEl.addEventListener("scene:ready", () => box.classList.add("is-drawn"));
      sceneEl.addEventListener("scene:moved", () => { setTop(false); box.classList.add("was-moved"); });
      sceneEl.addEventListener("scene:lost", () => { failed = true; box.classList.add("no-3d"); setMode("2d"); });
      return scene;
    } catch { failed = true; box.classList.add("no-3d"); setMode("2d"); return null; }
  }
  const getData = (h) => {
    if (!cache.has(h.n)) { const p = fetch(h.model).then((r) => { if (!r.ok) throw new Error("fetch"); return r.json(); }); p.catch(() => cache.delete(h.n)); cache.set(h.n, p); }
    return cache.get(h.n);
  };
  async function load3d() {
    const h = cur; const my = ++token;
    if (!h?.model || mode !== "3d" || !near) { box.classList.remove("is-drawn"); return; }
    const s = await ensure();
    if (!s || my !== token) return;
    box.classList.add("is-loading");
    try {
      // The hole's data and its picture load together; the current hole stays on screen until both are in.
      const [full, tx] = await Promise.all([getData(h), s.texture(h.clean || h.cut).catch(() => null)]);
      const d = { ...full, tees: full.tees.filter((t) => h.tees.some((x) => x.id === t.id)) }; // the scorecard's four tees
      if (my !== token) return;
      s.reduced = still();
      s.load(d, { tee: "1", enabled: { labels: true, line: true, carry: false }, texture: tx || h.clean || h.cut, distances: h.arcs ? { tees: h.tees, approach: h.arcs.approach, approx: h.arcs.approx } : null });
      s.preset("top", { instant: true });
      setTop(true);
      status.textContent = th ? `แบบจำลองหลุม ${h.n} มองจากด้านบน` : `Hole ${h.n} model, seen from above`;
      const next = neighbour(h.n);
      s.retain?.([h.clean || h.cut, next && (next.clean || next.cut)]); // a small cache: this hole and the likely next one
      prefetch(next);
    } catch { if (my === token) { box.classList.remove("is-drawn"); setMode("2d"); } }
    finally { if (my === token) box.classList.remove("is-loading"); }
  }
  // Only the selected hole loads straight away. Once idle, at most one likely neighbour (the next hole) is
  // warmed, and nothing at all on a data-saving connection.
  const neighbour = (n) => data.find((x) => x.n === (n === 18 ? 1 : n + 1) && x.model) || null;
  function prefetch(x) {
    if (!x || !scene || navigator.connection?.saveData) return;
    const idle = window.requestIdleCallback ? (f) => requestIdleCallback(f, { timeout: 2500 }) : (f) => setTimeout(f, 400);
    idle(() => { getData(x).catch(() => {}); scene.texture(x.clean || x.cut).catch(() => {}); });
  }
  function setMode(m) {
    mode = m === "3d" && !failed && cur?.model ? "3d" : "2d";
    box.dataset.mode = mode;
    box.querySelectorAll("[data-hv-mode]").forEach((b) => { b.setAttribute("aria-pressed", String(b.dataset.hvMode === mode)); b.disabled = b.dataset.hvMode === "3d" && (failed || !cur?.model); });
    sceneEl.hidden = mode !== "3d";
    if (mode === "3d") load3d(); else { token++; engage(false); }
  }
  box.querySelectorAll("[data-hv-mode]").forEach((b) => b.addEventListener("click", () => { box.dataset.pref = b.dataset.hvMode; setMode(b.dataset.hvMode); }));
  topBtn.addEventListener("click", () => { if (scene) scene.reduced = still(); scene?.preset("top"); setTop(true); });
  engageBtn.addEventListener("click", () => engage(!box.classList.contains("is-engaged")));
  document.addEventListener("pointerdown", (e) => { if (!box.contains(e.target)) engage(false); });
  box.querySelectorAll("[data-hv-zoom]").forEach((b) => b.addEventListener("click", () => { scene?.zoom(b.dataset.hvZoom === "in" ? 0.8 : 1.25); setTop(false); }));
  new IntersectionObserver(([e]) => { if (e.isIntersecting && !near) { near = true; if (mode === "3d") load3d(); } }, { rootMargin: "400px 0px" }).observe(box);
  return {
    show(h) {
      cur = h;
      box.classList.toggle("no-diagram", !h.cut);
      if (h.cut) { flat.src = h.cut; flat.alt = h.diagramAlt?.[lang] || ""; }
      flat.hidden = !h.cut;
      setMode(box.dataset.pref || "3d");
      if (!h.cut) status.textContent = th ? "ยังไม่มีแผนผังของหลุมนี้" : "No diagram published for this hole yet";
    },
  };
}

// ---- Hole rail and stage
const rail = document.querySelector("[data-hole-rail]");
const stage = document.querySelector("[data-hole-stage]");
const data = JSON.parse(document.getElementById("holes-data")?.textContent || "[]");
if (rail && stage && data.length) {
  const viewer = holeViewer(stage.querySelector("[data-hv]"));
  viewer.show(data.find((x) => x.n === Number(rail.querySelector('[aria-selected="true"]')?.dataset.hole || 7)));
  const q = (k) => stage.querySelector(`[data-f="${k}"]`);
  const yards = (h) => h.tees.length ? `<div class="yardages">${h.tees.map((t) => `<div><span><i class="tee-dot" style="--tee:${t.color}" aria-hidden="true"></i>${t.name?.[lang] || t.id}</span><b>${t.yards != null ? `${t.yards} ${th ? "หลา" : "yd"}` : `<span class="tag warn">${th ? "รอยืนยัน" : "To confirm"}</span>`}</b></div>`).join("")}</div>` : `<p class="muted small">${th ? "ระยะยังไม่ได้รับการยืนยัน" : "Yardages not yet confirmed"}</p>`;
  function select(n, focus) {
    const h = data.find((x) => x.n === n); if (!h) return;
    rail.querySelectorAll("[data-hole]").forEach((b) => { const on = Number(b.dataset.hole) === n; b.setAttribute("aria-selected", String(on)); b.tabIndex = on ? 0 : -1; if (on && focus) b.focus(); });
    stage.setAttribute("aria-labelledby", `hole-tab-${n}`);
    const anim = !motionOff() && stage.animate;
    const apply = () => {
      q("numeral").textContent = pad2(n);
      q("title").textContent = `${th ? `หลุมที่ ${n}` : `Hole ${n}`}${h.par ? `, ${th ? "พาร์" : "par"} ${h.par}` : ""}`;
      q("desc").textContent = h.d[lang];
      q("yards").innerHTML = yards(h);
      const link = q("link"); link.href = h.url; link.innerHTML = `${th ? (h.par ? `เปิดหลุม ${n} ในแบบจำลอง` : `ดูหน้าหลุม ${n}`) : (h.par ? `Open hole ${n} in the explorer` : `See the hole ${n} page`)} <span class="arrow" aria-hidden="true">&rarr;</span>`;
      viewer.show(h);
      q("photo").innerHTML = h.photos[0] ? `<img src="${h.photos[0].src}" alt="${esc(h.photos[0].alt[lang])}" width="960" height="640">` : `<p class="muted small" style="padding:24px">${th ? "ยังไม่มีภาพถ่ายที่ยืนยันว่าเป็นหลุมนี้" : "No photograph confirmed for this hole yet"}</p>`;
    };
    apply();
    // Only the text eases in; the viewer swaps as soon as the next hole is ready.
    if (anim) stage.querySelector(".facts")?.animate([{ opacity: 0.35, transform: "translateY(4px)" }, { opacity: 1, transform: "none" }], { duration: 240, easing: "cubic-bezier(.2,.7,.2,1)" });
  }
  rail.addEventListener("click", (e) => { const b = e.target.closest("[data-hole]"); if (b) select(Number(b.dataset.hole)); });
  rail.addEventListener("keydown", (e) => {
    const cur = Number(rail.querySelector('[aria-selected="true"]').dataset.hole);
    const map = { ArrowRight: 1, ArrowLeft: -1, Home: -99, End: 99 };
    if (!(e.key in map)) return;
    e.preventDefault();
    const n = Math.min(18, Math.max(1, map[e.key] === -99 ? 1 : map[e.key] === 99 ? 18 : cur + map[e.key]));
    select(n, true);
  });
  window.kk.carry = () => ({ hole: Number(rail.querySelector('[aria-selected="true"]').dataset.hole) });
  const carried = window.kk.takeCarry?.();
  if (carried?.hole) select(carried.hole);
}

// ---- Facilities index with image stage
const idx = document.querySelector("[data-index-stage]");
if (idx) {
  const frame = idx.querySelector(".stage-frame");
  const cap = idx.querySelector("[data-stage-caption]");
  const items = [...idx.querySelectorAll(".index-item")];
  const activate = (it) => {
    items.forEach((x) => x.toggleAttribute("aria-current", x === it));
    items.forEach((x) => x.setAttribute("aria-current", String(x === it)));
    const id = it.dataset.stageImg;
    frame.querySelectorAll("img").forEach((im) => im.classList.toggle("on", im.dataset.id === id));
    frame.style.background = id ? "" : "var(--sage)";
    cap.textContent = it.dataset.stageCap + (id ? "" : th ? " (รอภาพจากสมาคม)" : " (photograph to come from the club)");
  };
  items.forEach((it) => { it.addEventListener("mouseenter", () => activate(it)); it.addEventListener("focusin", () => activate(it)); });
}

// ---- Facilities dropdowns: nothing open on a first visit, one open at a time (audit H4, 20 Nov 2026:
// they no longer close when the section scrolls out of view).
const facSection = document.querySelector("[data-fac]");
if (facSection) {
  const items = [...facSection.querySelectorAll("[data-fac-item]")];
  const parts = (it) => ({ btn: it.querySelector(".fac-head"), panel: it.querySelector(".fac-panel") });
  const setOpen = (it, open, { instant = false } = {}) => {
    const { btn, panel } = parts(it);
    if ((btn.getAttribute("aria-expanded") === "true") === open) return;
    btn.setAttribute("aria-expanded", String(open));
    panel.getAnimations?.().forEach((a) => a.cancel());
    if (instant || motionOff() || !panel.animate) { panel.hidden = !open; return; }
    if (open) {
      panel.hidden = false;
      const h = panel.scrollHeight;
      panel.animate([{ height: "0px", opacity: 0 }, { height: `${h}px`, opacity: 1 }], { duration: 420, easing: "cubic-bezier(.2,.7,.2,1)" });
    } else {
      const h = panel.scrollHeight;
      const a = panel.animate([{ height: `${h}px`, opacity: 1 }, { height: "0px", opacity: 0 }], { duration: 320, easing: "cubic-bezier(.4,0,.2,1)" });
      a.onfinish = () => { if (btn.getAttribute("aria-expanded") === "false") panel.hidden = true; };
    }
  };
  // The visitor's place is kept: an open facility (and any open school inside it) stays open while they read
  // another section, and comes back open when they return from a detail page in the same tab.
  const KEY = "kk.fac";
  const remember = () => { try { sessionStorage.setItem(KEY, JSON.stringify({ open: items.findIndex((x) => parts(x).btn.getAttribute("aria-expanded") === "true"), schools: [...facSection.querySelectorAll("details.school")].map((d) => d.open) })); } catch {} };
  items.forEach((it) => parts(it).btn.addEventListener("click", () => {
    const open = parts(it).btn.getAttribute("aria-expanded") !== "true";
    items.forEach((o) => { if (o !== it) setOpen(o, false); });
    setOpen(it, open);
    remember();
    if (open) {
      // Keep the opened heading in view when a long panel above it closes; no smooth scroll while motion is off.
      requestAnimationFrame(() => { const top = it.getBoundingClientRect().top; const hh = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--header-h")) || 72; if (top < hh) window.scrollBy({ top: top - hh - 12, behavior: motionOff() ? "instant" : "smooth" }); });
    }
  }));
  facSection.querySelectorAll("details.school").forEach((d) => d.addEventListener("toggle", remember));
  try {
    const saved = JSON.parse(sessionStorage.getItem(KEY) || "null");
    if (saved?.open >= 0 && items[saved.open]) setOpen(items[saved.open], true, { instant: true });
    facSection.querySelectorAll("details.school").forEach((d, i) => { if (saved?.schools?.[i]) d.open = true; });
  } catch {}
}

// ---- Live open/closed status on hours cards, in Bangkok time from the listed hours.
const hcards = [...document.querySelectorAll("[data-hours]")];
if (hcards.length) {
  const DAY = th ? ["วันอาทิตย์", "วันจันทร์", "วันอังคาร", "วันพุธ", "วันพฤหัสบดี", "วันศุกร์", "วันเสาร์"] : ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const clock = (m) => { const h = String(Math.floor(m / 60)).padStart(2, "0"), mm = String(m % 60).padStart(2, "0"); return th ? `${h}.${mm} น.` : `${h}:${mm}`; };
  const update = () => {
    const now = new Date(Date.now() + 7 * 3600e3); // Bangkok is UTC+7 all year
    const day = now.getUTCDay(), mins = now.getUTCHours() * 60 + now.getUTCMinutes();
    for (const card of hcards) {
      const { w, last } = JSON.parse(card.dataset.hours);
      const el = card.querySelector("[data-status]"); if (!el) continue;
      const today = w[day];
      let state = "closed", text;
      if (today && mins >= today[0] && mins < today[1]) {
        const left = today[1] - mins;
        if (last != null && mins < last) { state = last - mins <= 60 ? "soon" : "open"; text = th ? `เปิดอยู่ ปิดการขาย ${clock(last)}` : `Open now, last order ${clock(last)}`; }
        else if (left <= 60) { state = "soon"; text = th ? `ใกล้ปิด ปิด ${clock(today[1])}` : `Closing soon, at ${clock(today[1])}`; }
        else { state = "open"; text = th ? `เปิดอยู่ ถึง ${clock(today[1])}` : `Open now, until ${clock(today[1])}`; }
      } else if (today && mins < today[0]) {
        text = th ? `ปิดอยู่ เปิด ${clock(today[0])}` : `Closed now, opens at ${clock(today[0])}`;
      } else {
        let k = 1; while (k < 8 && !w[(day + k) % 7]) k++;
        const next = w[(day + k) % 7];
        text = !next ? (th ? "ปิด" : "Closed") : k === 1 ? (th ? `ปิดอยู่ เปิดพรุ่งนี้ ${clock(next[0])}` : `Closed now, opens tomorrow at ${clock(next[0])}`) : (th ? `ปิดอยู่ เปิด${DAY[(day + k) % 7]} ${clock(next[0])}` : `Closed now, opens ${DAY[(day + k) % 7]} at ${clock(next[0])}`);
      }
      el.dataset.state = state;
      el.querySelector("span").textContent = text;
    }
  };
  update();
  setInterval(update, 60e3);
}

getApi(); // warm the adapter so the conditions strip and tee times answer quickly
