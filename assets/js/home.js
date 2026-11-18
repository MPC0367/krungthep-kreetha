// Homepage: the booking dock, the hole rail and stage, and the facilities index.
import { getApi } from "./api.js";
import { addDays, bkkDate, dayKey, formatDate } from "./core/util.js";

const lang = document.documentElement.lang === "th" ? "th" : "en";
const th = lang === "th";
const pad2 = (n) => String(n).padStart(2, "0");
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

// ---- Booking dock: seven date chips, golfers stepper, hand-off to the tee-time page.
const dock = document.querySelector("[data-dock]");
if (dock) {
  const today = bkkDate(Date.now());
  const input = dock.querySelector("#dock-date");
  const golfers = dock.querySelector('input[name="golfers"]');
  const out = dock.querySelector("[data-golfers]");
  let date = addDays(today, 1);
  if (dayKey(date) === "mon") date = addDays(date, 1);
  input.value = date; input.min = today; input.max = addDays(today, 13);
  const wrap = dock.querySelector("[data-dock-dates]");
  const strip = document.createElement("div");
  strip.className = "date-strip"; strip.setAttribute("role", "radiogroup"); strip.setAttribute("aria-label", th ? "วันที่เล่น" : "Playing date");
  for (let i = 0; i < 7; i++) {
    const d = addDays(today, i);
    const closed = dayKey(d) === "mon";
    const b = document.createElement("button");
    b.type = "button"; b.className = "date-chip" + (closed ? " is-closed" : ""); b.setAttribute("role", "radio"); b.dataset.date = d;
    b.setAttribute("aria-checked", String(d === date));
    b.setAttribute("aria-label", formatDate(d, lang) + (closed ? (th ? " ปิดรับจองออนไลน์" : ", no online tee times") : ""));
    b.innerHTML = `<span class="dow">${i === 0 ? (th ? "วันนี้" : "Today") : formatDate(d, lang, { weekday: "short" })}</span><span class="d num">${Number(d.slice(8))}</span><span class="m">${formatDate(d, lang, { month: "short" })}</span>`;
    b.addEventListener("click", () => { date = d; input.value = d; strip.querySelectorAll(".date-chip").forEach((c) => c.setAttribute("aria-checked", String(c.dataset.date === d))); });
    strip.append(b);
  }
  strip.addEventListener("keydown", (e) => {
    if (!["ArrowLeft", "ArrowRight"].includes(e.key)) return;
    const chips = [...strip.children]; const i = chips.indexOf(document.activeElement);
    const n = chips[(i + (e.key === "ArrowRight" ? 1 : -1) + chips.length) % chips.length]; n.focus(); n.click(); e.preventDefault();
  });
  wrap.querySelector("label").id = "dock-date-label";
  input.type = "hidden";
  wrap.append(strip);
  const more = document.createElement("a");
  more.className = "small"; more.href = dock.action; more.textContent = th ? "เลือกวันอื่นภายใน 14 วัน" : "Other dates in the next 14 days";
  wrap.append(more);
  dock.querySelectorAll("[data-step]").forEach((b) => b.addEventListener("click", () => {
    const n = Math.min(4, Math.max(1, Number(golfers.value) + Number(b.dataset.step)));
    golfers.value = n; out.textContent = th ? `${n} ท่าน` : `${n} golfer${n > 1 ? "s" : ""}`;
    dock.querySelector('[data-step="-1"]').disabled = n <= 1; dock.querySelector('[data-step="1"]').disabled = n >= 4;
  }));
  out.textContent = th ? "2 ท่าน" : "2 golfers";
  dock.addEventListener("submit", (e) => {
    e.preventDefault();
    try { sessionStorage.setItem("kk.search", JSON.stringify({ date, golfers: Number(golfers.value), category: "visitor" })); } catch {}
    location.href = dock.action + (dock.action.endsWith(".html") ? "" : "") + `?date=${date}&golfers=${golfers.value}`;
  });
}

// ---- Hole viewer: the club's diagram in 2D, or the 3D model opening straight down so it matches the diagram.
// three.js loads only when the section comes near the screen; holes without a model stay in 2D.
function holeViewer(box) {
  const flat = box.querySelector("[data-hv-flat]");
  const sceneEl = box.querySelector("[data-hv-scene]");
  const status = box.querySelector("[data-hv-status]");
  const topBtn = box.querySelector("[data-hv-top]");
  const engageBtn = box.querySelector("[data-hv-engage]");
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const touch = matchMedia("(pointer: coarse)").matches;
  const cache = new Map();
  let scene = null, failed = false, token = 0, mode = "3d", cur = null, near = false;
  const label = (kind, extra) => {
    const el = document.createElement("span");
    el.className = `xp-label xp-${kind}`;
    el.textContent = kind === "green" ? (th ? "กรีน" : "Green") : kind === "tee" ? `${th ? "แท่นที" : "Tee"} ${extra}` : kind === "target" ? (th ? "จุดเล็ง" : "Target") : "";
    return kind === "carry" ? null : el;
  };
  const setTop = (on) => { topBtn.setAttribute("aria-pressed", String(on)); box.classList.toggle("is-moved", !on); };
  const engage = (on) => { if (!scene) return; scene.setEngaged(on); engageBtn.setAttribute("aria-pressed", String(on)); const s = engageBtn.querySelector("span"); s.textContent = on ? s.dataset.on : s.dataset.off; box.classList.toggle("is-engaged", on); };
  async function ensure() {
    if (scene || failed) return scene;
    try {
      const mod = await import("./explorer/scene3d.js");
      if (!mod.webglAvailable()) throw new Error("webgl");
      scene = new mod.HoleScene(sceneEl, { onLabel: label, reducedMotion: reduce, isTouch: touch, transparent: true });
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
      const [d, tx] = await Promise.all([getData(h), s.texture(h.cut).catch(() => null)]);
      if (my !== token) return;
      s.load(d, { tee: "1", enabled: { labels: true, line: true, carry: false }, texture: tx || h.cut });
      s.preset("top", { instant: true });
      setTop(true);
      status.textContent = th ? `แบบจำลองหลุม ${h.n} มองจากด้านบน` : `Hole ${h.n} model, seen from above`;
      prefetch(h.n);
    } catch { if (my === token) { box.classList.remove("is-drawn"); setMode("2d"); } }
    finally { if (my === token) box.classList.remove("is-loading"); }
  }
  // Once one hole is showing, the others are fetched quietly, nearest first, so switching is immediate.
  let prefetching = false;
  async function prefetch(from) {
    if (prefetching || !scene) return; prefetching = true;
    const idle = () => new Promise((r) => (window.requestIdleCallback ? requestIdleCallback(r, { timeout: 1500 }) : setTimeout(r, 200)));
    const list = data.filter((x) => x.model && x.n !== from).sort((a, b) => Math.abs(a.n - from) - Math.abs(b.n - from));
    for (const x of list) { await idle(); try { await Promise.all([getData(x), scene.texture(x.cut)]); } catch {} }
  }
  function setMode(m) {
    mode = m === "3d" && !failed && cur?.model ? "3d" : "2d";
    box.dataset.mode = mode;
    box.querySelectorAll("[data-hv-mode]").forEach((b) => { b.setAttribute("aria-pressed", String(b.dataset.hvMode === mode)); b.disabled = b.dataset.hvMode === "3d" && (failed || !cur?.model); });
    sceneEl.hidden = mode !== "3d";
    if (mode === "3d") load3d(); else { token++; engage(false); }
  }
  box.querySelectorAll("[data-hv-mode]").forEach((b) => b.addEventListener("click", () => { box.dataset.pref = b.dataset.hvMode; setMode(b.dataset.hvMode); }));
  topBtn.addEventListener("click", () => { scene?.preset("top"); setTop(true); });
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
  const yards = (h) => h.tees.length ? `<div class="yardages">${h.tees.map((t) => `<div><span>${th ? "แท่นที" : "Tee"} ${t.id}</span><b>${t.yards != null ? `${t.yards} ${th ? "หลา" : "yd"}` : `<span class="tag warn">${th ? "รอยืนยัน" : "To confirm"}</span>`}</b></div>`).join("")}</div>` : `<p class="muted small">${th ? "ระยะยังไม่ได้รับการยืนยัน" : "Yardages not yet confirmed"}</p>`;
  function select(n, focus) {
    const h = data.find((x) => x.n === n); if (!h) return;
    rail.querySelectorAll("[data-hole]").forEach((b) => { const on = Number(b.dataset.hole) === n; b.setAttribute("aria-selected", String(on)); b.tabIndex = on ? 0 : -1; if (on && focus) b.focus(); });
    stage.setAttribute("aria-labelledby", `hole-tab-${n}`);
    const anim = !matchMedia("(prefers-reduced-motion: reduce)").matches && stage.animate;
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

// ---- Facilities dropdowns: nothing open on arrival, one open at a time, and everything closes again
// once the section has scrolled out of view.
const facSection = document.querySelector("[data-fac]");
if (facSection) {
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const items = [...facSection.querySelectorAll("[data-fac-item]")];
  const parts = (it) => ({ btn: it.querySelector(".fac-head"), panel: it.querySelector(".fac-panel") });
  const setOpen = (it, open, { instant = false } = {}) => {
    const { btn, panel } = parts(it);
    if ((btn.getAttribute("aria-expanded") === "true") === open) return;
    btn.setAttribute("aria-expanded", String(open));
    panel.getAnimations?.().forEach((a) => a.cancel());
    if (instant || reduce || !panel.animate) { panel.hidden = !open; return; }
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
  items.forEach((it) => parts(it).btn.addEventListener("click", () => {
    const open = parts(it).btn.getAttribute("aria-expanded") !== "true";
    items.forEach((o) => { if (o !== it) setOpen(o, false); });
    setOpen(it, open);
    if (open && !reduce) {
      // Keep the opened heading in view when a long panel above it closes.
      requestAnimationFrame(() => { const top = it.getBoundingClientRect().top; const hh = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--header-h")) || 72; if (top < hh) window.scrollBy({ top: top - hh - 12, behavior: "smooth" }); });
    }
  }));
  new IntersectionObserver(([e]) => { if (!e.isIntersecting) { items.forEach((it) => setOpen(it, false, { instant: true })); facSection.querySelectorAll("details.school[open]").forEach((d) => d.removeAttribute("open")); } }, { threshold: 0 }).observe(facSection);
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
