// The 18-hole explorer: 3D model, the club's 2D diagram and photographs, with direct hole
// selection, tee choice, camera presets, layers and an always-available text guide.
// Hole changes update the number, panel, labels and URL together; stale loads are discarded.
const html = document.documentElement;
const lang = html.lang === "th" ? "th" : "en";
const th = lang === "th";
const root = html.dataset.root;
const pad2 = (n) => String(n).padStart(2, "0");
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
const touch = matchMedia("(pointer: coarse)").matches;

const app = document.querySelector("[data-explorer]");
const HOLES = JSON.parse(document.getElementById("holes-data").textContent);
const FEATURES = JSON.parse(document.getElementById("feature-labels").textContent);
const sceneBox = app.querySelector("[data-scene]");
const panel = app.querySelector("[data-panel]");
const status = app.querySelector("[data-scene-status]");
const params = new URLSearchParams(location.search);
const state = {
  hole: Number(app.dataset.hole), tee: params.get("tee") || "1", mode: params.get("mode") || "3d", view: params.get("view") || "top",
  units: "yd", carry: 220, layers: { water: true, trees: true, redline: true, tees: true, line: true, carry: false, labels: true },
};
const carried = window.kk?.takeCarry?.();
if (carried) Object.assign(state, { tee: carried.tee || state.tee, mode: carried.mode || state.mode, view: carried.view || state.view, units: carried.units || state.units });
state.prefer = state.mode;
window.kk.carry = () => ({ hole: state.hole, tee: state.tee, mode: state.prefer || state.mode, view: state.view, units: state.units });

let scene = null, sceneMod = null, token = 0, threeFailed = false;
const cache = new Map();
const holeData = (n) => HOLES.find((h) => h.n === n);
const fmt = (yards) => (yards == null ? null : state.units === "m" ? `${Math.round(yards * 0.9144)} ${th ? "ม." : "m"}` : `${yards} ${th ? "หลา" : "yd"}`);

function say(msg) { status.textContent = msg; }

// ---------- panel (text guide) ----------
function renderPanel(h) {
  const tees = h.tees;
  const sel = tees.find((t) => t.id === state.tee) || tees[0];
  const T = (o) => o?.[lang] ?? "";
  panel.innerHTML = `
    <div class="xp-head"><span class="xp-n" aria-hidden="true">${pad2(h.n)}</span><div><h1 class="h3" id="hole-title">${th ? `หลุมที่ ${h.n}` : `Hole ${h.n}`}</h1><p class="muted small">${h.par ? `${th ? "พาร์" : "Par"} ${h.par}` : th ? "รอยืนยันพาร์" : "Par to be confirmed"}${sel?.yards ? `, ${fmt(sel.yards)} ${th ? `จากแท่นที ${sel.id}` : `from Tee ${sel.id}`}` : ""}</p></div></div>
    ${h.display === "ILLUSTRATIVE_3D" ? `<p class="tag demo">${th ? "แบบจำลองประกอบ ลอกจากแผนผังของสมาคม ไม่ใช่ข้อมูลสำรวจ" : "Illustrative model traced from the club's diagram, not surveyed"}</p>` : ""}
    ${h.issues.length ? `<div class="notice warn"><span>${h.issues.map((i) => esc(i[lang] || i.en || i)).join(" ")}</span></div>` : ""}
    <p>${esc(T(h.d))}</p>
    ${h.heritage ? `<p class="heritage-note">${esc(T(h.heritage))}</p>` : ""}
    ${tees.length ? `<div class="stack" style="gap:8px"><h2 class="label">${th ? "ระยะจากแท่นที (ตามหน้าเว็บของสมาคม)" : "Yardage by tee (club website)"}</h2><div class="yardages">${tees.map((t) => `<div${t.id === sel.id ? ' class="is-sel"' : ""}><span>${th ? "แท่นที" : "Tee"} ${t.id}</span><b>${t.yards != null ? fmt(t.yards) : `<span class="tag warn">${th ? "รอยืนยัน" : "To confirm"}</span>`}</b></div>`).join("")}</div>${state.units === "m" ? `<p class="photo-note">${th ? "แปลงจากหลาของสมาคม ปัดเศษเป็นเมตร" : "Converted from the club's yards, rounded to the metre"}</p>` : ""}</div>` : ""}
    ${h.features?.length ? `<div class="stack" style="gap:8px"><h2 class="label">${th ? "สิ่งที่เห็นในแผนผัง" : "What the diagram shows"}</h2><ul class="feature-list">${h.features.map((f) => `<li>${esc(FEATURES[f]?.[lang] || f)}</li>`).join("")}</ul></div>` : ""}
    <p class="row"><a class="btn" href="${root}${lang}/tee-times/${html.dataset.target === "artifact" ? "index.html" : ""}">${th ? "จองเวลาออกรอบ" : "Book a tee time"} <span class="arrow" aria-hidden="true">&rarr;</span></a><a class="btn secondary" href="${root}${lang}/scorecard/${html.dataset.target === "artifact" ? "index.html" : ""}#h${h.n}">${th ? "สกอร์การ์ด" : "Scorecard"}</a></p>
    <details class="source"><summary>${th ? "ที่มาและสถานะของข้อมูล" : "Sources and status"}</summary><dl class="kv small"><dt>${th ? "สถานะการผลิต" : "Production"}</dt><dd>${h.status}</dd><dt>${th ? "การแสดงผล" : "Public display"}</dt><dd>${h.display}</dd><dt>${th ? "พาร์" : "Par"}</dt><dd>${th ? "แผนผังของสมาคม" : "Club diagram"}</dd><dt>${th ? "ระยะ" : "Yardages"}</dt><dd>${th ? "ข้อความหน้าหลุมของสมาคม" : "Club hole page text"}</dd><dt>${th ? "ลำดับความยาก" : "Stroke index"}</dt><dd>${th ? "ยังไม่เผยแพร่" : "Not published"}</dd><dt>${th ? "ความสูงต่ำ" : "Elevation"}</dt><dd>${th ? "ไม่มีข้อมูล แสดงเป็นพื้นราบ" : "No data; shown flat"}</dd></dl></details>`;
}

// ---------- 3D ----------
function labelFactory(kind, extra) {
  const el = document.createElement("span");
  el.className = `xp-label xp-${kind}`;
  if (kind === "arc") { el.textContent = `${extra.approx ? "≈ " : ""}${extra.yards} ${th ? "หลา" : "yd"}`; if (!extra.main) el.classList.add("is-sub"); return el; }
  el.textContent = kind === "green" ? (th ? "กลางกรีนตามแผนผัง" : "Green centre (diagram)") : kind === "tee" ? `${th ? "แท่นที" : "Tee"} ${extra}` : kind === "target" ? (th ? "จุดเล็งตามแผนผัง" : "Diagram target") : (th ? "ระยะตีลอย (ประกอบ)" : "Carry (illustrative)");
  if (kind === "carry") el.dataset.carry = "";
  return el;
}
async function ensureScene() {
  if (scene || threeFailed) return scene;
  try {
    sceneMod = await import("./explorer/scene3d.js");
    if (!sceneMod.webglAvailable()) throw new Error("webgl");
    scene = new sceneMod.HoleScene(sceneBox, { onLabel: labelFactory, reducedMotion: reduce, isTouch: touch });
    sceneBox.addEventListener("scene:lost", () => { threeFailed = true; say(th ? "การแสดงผลสามมิติหยุดทำงาน เปลี่ยนเป็นแผนผังสองมิติ" : "3D stopped working, showing the 2D diagram"); setMode("2d"); });
    sceneBox.addEventListener("pointerdown", () => engage(true));
    sceneBox.addEventListener("scene:ready", () => sceneBox.classList.add("is-drawn"));
    const tick = () => { if (scene && !scene.disposed) { app.querySelector("[data-compass] svg")?.style.setProperty("transform", `rotate(${-scene.heading()}deg)`); } };
    scene.controls.addEventListener("change", tick);
    return scene;
  } catch (e) {
    threeFailed = true;
    app.classList.add("no-3d");
    say(th ? "อุปกรณ์นี้แสดงภาพสามมิติไม่ได้ จึงแสดงแผนผังสองมิติแทน" : "This device cannot show 3D, so the 2D diagram is shown instead");
    return null;
  }
}
function engage(on) {
  if (!scene) return;
  scene.setEngaged(on);
  app.querySelector("[data-engage]")?.setAttribute("aria-pressed", String(on));
  app.classList.toggle("is-engaged", on);
}

async function show3D(h, my) {
  if (h.display !== "ILLUSTRATIVE_3D" && h.display !== "VERIFIED_3D") { setMode(h.diagram ? "2d" : "photos", { silent: true }); return; }
  const s = await ensureScene();
  if (my !== token) return;
  if (!s) { setMode(h.diagram ? "2d" : "photos", { silent: true }); return; }
  app.classList.add("is-loading");
  say(th ? `กำลังโหลดแบบจำลองหลุม ${h.n}` : `Loading the hole ${h.n} model`);
  try {
    // Data and picture load together; the current model stays on screen until both are in.
    const [data, tx] = await Promise.all([holeJSON(h.n), h.clean ? s.texture(h.clean).catch(() => null) : null]);
    if (my !== token) return; // a newer selection won
    s.load(data, { tee: state.tee, carryYards: state.carry, enabled: state.layers, texture: tx || h.clean || h.cut, distances: h.arcs ? { tees: h.tees, approach: h.arcs.approach, approx: h.arcs.approx } : null });
    prefetchNear(h.n);
    s.preset(state.view, { instant: true });
    say(th ? `แบบจำลองหลุม ${h.n} พร้อมแล้ว` : `Hole ${h.n} model ready`);
  } catch {
    if (my !== token) return;
    say(th ? "โหลดแบบจำลองไม่สำเร็จ แสดงแผนผังสองมิติแทน" : "The model did not load; showing the 2D diagram");
    setMode("2d", { silent: true });
  } finally { if (my === token) app.classList.remove("is-loading"); }
}

function holeJSON(n) {
  if (!cache.has(n)) { const p = fetch(`${root}data/holes/hole-${pad2(n)}.json`).then((r) => { if (!r.ok) throw new Error("fetch"); return r.json(); }); p.catch(() => cache.delete(n)); cache.set(n, p); }
  return cache.get(n);
}
// The previous and next holes are fetched quietly so the arrows switch at once.
function prefetchNear(n) {
  const idle = window.requestIdleCallback || ((f) => setTimeout(f, 300));
  idle(() => { for (const k of [n === 18 ? 1 : n + 1, n === 1 ? 18 : n - 1]) { const x = holeData(k); if (x && (x.display === "ILLUSTRATIVE_3D" || x.display === "VERIFIED_3D")) { holeJSON(k).catch(() => {}); if (x.clean && scene) scene.texture(x.clean).catch(() => {}); } } });
}

// ---------- 2D diagram with pan and zoom ----------
const flat = app.querySelector("[data-flat]");
let z = { s: 1, x: 0, y: 0 };
function renderFlat(h) {
  flat.innerHTML = h.diagram ? `<img src="${h.cut || h.diagram}" alt="${esc(h.diagramAlt[lang])}" draggable="false" width="832" height="1248">` : `<p class="muted" style="padding:32px">${th ? "ยังไม่มีแผนผังของหลุมนี้" : "No diagram published for this hole yet"}</p>`;
  z = { s: 1, x: 0, y: 0 }; applyZ();
}
function applyZ() { const im = flat.querySelector("img"); if (im) im.style.transform = `translate(${z.x}px, ${z.y}px) scale(${z.s})`; }
let drag = null;
flat.addEventListener("pointerdown", (e) => { if (e.pointerType === "touch" && !app.classList.contains("is-engaged")) return; drag = { x: e.clientX - z.x, y: e.clientY - z.y }; flat.setPointerCapture(e.pointerId); });
flat.addEventListener("pointermove", (e) => { if (!drag) return; z.x = e.clientX - drag.x; z.y = e.clientY - drag.y; applyZ(); });
flat.addEventListener("pointerup", () => { drag = null; });
flat.addEventListener("wheel", (e) => { if (!app.classList.contains("is-engaged")) return; e.preventDefault(); z.s = Math.min(4, Math.max(0.6, z.s * (e.deltaY < 0 ? 1.12 : 0.89))); applyZ(); }, { passive: false });

function renderPhotos(h) {
  const box = app.querySelector("[data-photos]");
  box.innerHTML = h.photos.length ? `<div class="gallery" data-gallery>${h.photos.map((p) => `<button type="button" data-full="${p.src}"><img src="${p.small}" alt="${esc(p.alt[lang])}" loading="lazy" width="560" height="373"></button>`).join("")}</div>` : `<p class="muted" style="padding:32px">${th ? "ยังไม่มีภาพถ่ายที่ยืนยันว่าเป็นหลุมนี้" : "No photograph is confirmed for this hole yet"}</p>`;
}

// ---------- modes, holes, tees ----------
function setMode(mode, { silent } = {}) {
  state.mode = mode;
  app.dataset.mode = mode;
  app.querySelectorAll("[data-mode]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.mode === mode)));
  sceneBox.hidden = mode !== "3d"; flat.hidden = mode !== "2d"; app.querySelector("[data-photos]").hidden = mode !== "photos";
  app.querySelector("[data-tools3d]").hidden = mode !== "3d";
  if (mode === "3d" && !silent) show3D(holeData(state.hole), token);
  syncUrl();
}

function syncUrl() {
  const h = holeData(state.hole);
  const u = new URL(h.url, location.href);
  if (state.tee !== "1") u.searchParams.set("tee", state.tee);
  if (state.mode !== "3d") u.searchParams.set("mode", state.mode);
  if (state.view !== "top") u.searchParams.set("view", state.view);
  try { history.replaceState({ hole: state.hole }, "", u.pathname + u.search); } catch {}
  document.querySelectorAll("[data-lang-link]").forEach((a) => { a.href = a.href.replace(/\/holes\/\d\d\//, `/holes/${pad2(state.hole)}/`); });
}

async function selectHole(n, { push = false } = {}) {
  const h = holeData(n); if (!h) return;
  const my = ++token;
  state.hole = n;
  if (!h.tees.find((t) => t.id === state.tee)) state.tee = "1";
  document.title = `${th ? `หลุมที่ ${n}` : `Hole ${n}`} | ${th ? "กรุงเทพกรีฑา" : "Krungthep Kreetha"}`;
  app.dataset.hole = n;
  document.querySelectorAll("[data-hole-rail] [data-hole], [data-hole-grid] [data-hole]").forEach((a) => { if (Number(a.dataset.hole) === n) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current"); });
  app.querySelector("[data-prev]").href = holeData(n === 1 ? 18 : n - 1).url;
  app.querySelector("[data-next]").href = holeData(n === 18 ? 1 : n + 1).url;
  renderTees(h); renderPanel(h); renderFlat(h); renderPhotos(h);
  if (push) try { history.pushState({ hole: n }, "", h.url); } catch {}
  // The visitor's chosen view is kept; a hole that cannot show it falls back without changing the choice.
  const pref = state.prefer;
  const has3d = (h.display === "ILLUSTRATIVE_3D" || h.display === "VERIFIED_3D") && !threeFailed;
  const want = pref === "3d" && has3d ? "3d" : pref === "photos" && h.photos.length ? "photos" : (pref === "2d" || pref === "3d") && h.diagram ? "2d" : h.photos.length ? "photos" : h.diagram ? "2d" : has3d ? "3d" : "photos";
  setMode(want, { silent: true });
  if (want === "3d") await show3D(h, my);
  syncUrl();
}

function renderTees(h) {
  const box = app.querySelector("[data-tees]");
  box.innerHTML = h.tees.map((t) => `<button type="button" data-tee="${t.id}" aria-pressed="${t.id === state.tee}" title="${t.yards ?? ""}"><span class="shape s${t.id}" aria-hidden="true"></span>${th ? "ที" : "Tee"} ${t.id}</button>`).join("") || `<span class="small muted">${th ? "ไม่มีข้อมูลแท่นที" : "No tee data"}</span>`;
}
app.querySelector("[data-tees]").addEventListener("click", (e) => {
  const b = e.target.closest("[data-tee]"); if (!b) return;
  state.tee = b.dataset.tee;
  app.querySelectorAll("[data-tee]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
  renderPanel(holeData(state.hole));
  if (scene?.data) { scene.setTee(state.tee); if (["tee", "landing"].includes(state.view)) scene.preset(state.view); }
  say(th ? `เลือกแท่นที ${state.tee}` : `Tee ${state.tee} selected`);
  syncUrl();
});

app.querySelectorAll("[data-mode]").forEach((b) => b.addEventListener("click", () => { state.prefer = b.dataset.mode; setMode(b.dataset.mode); }));
app.querySelectorAll("[data-view]").forEach((b) => b.addEventListener("click", () => {
  state.view = b.dataset.view;
  app.querySelectorAll("[data-view]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
  scene?.preset(state.view); syncUrl();
}));
sceneBox.addEventListener("scene:moved", () => { if (state.view === "top") app.querySelectorAll("[data-view]").forEach((x) => x.setAttribute("aria-pressed", "false")); });
app.querySelector("[data-reset]")?.addEventListener("click", () => { state.view = "top"; app.querySelectorAll("[data-view]").forEach((x) => x.setAttribute("aria-pressed", String(x.dataset.view === "top"))); scene?.preset("top"); z = { s: 1, x: 0, y: 0 }; applyZ(); engage(false); syncUrl(); });
app.querySelector("[data-zoom-in]")?.addEventListener("click", () => (state.mode === "3d" ? scene?.zoom(0.8) : ((z.s = Math.min(4, z.s * 1.2)), applyZ())));
app.querySelector("[data-zoom-out]")?.addEventListener("click", () => (state.mode === "3d" ? scene?.zoom(1.25) : ((z.s = Math.max(0.6, z.s / 1.2)), applyZ())));
app.querySelector("[data-engage]")?.addEventListener("click", () => engage(!app.classList.contains("is-engaged")));
app.querySelector("[data-layers]").addEventListener("change", (e) => {
  const c = e.target.closest("input[type=checkbox]"); if (!c) return;
  state.layers[c.name] = c.checked; scene?.applyLayers({ [c.name]: c.checked });
  app.querySelector("[data-carry-row]").hidden = !state.layers.carry;
});
app.querySelector("[data-carry]")?.addEventListener("input", (e) => { state.carry = Number(e.target.value); app.querySelector("[data-carry-out]").textContent = `${state.carry} ${th ? "หลา" : "yd"}`; scene?.setTee(state.tee, { carryYards: state.carry }); });
app.querySelector("[data-units]")?.addEventListener("click", (e) => { const b = e.target.closest("[data-unit]"); if (!b) return; state.units = b.dataset.unit; app.querySelectorAll("[data-unit]").forEach((x) => x.setAttribute("aria-pressed", String(x === b))); renderPanel(holeData(state.hole)); });

// Keyboard inside the focused explorer only.
sceneBox.addEventListener("keydown", (e) => {
  if (!scene) return;
  const k = e.key.toLowerCase();
  if (k === "arrowleft") scene.orbit(0.12); else if (k === "arrowright") scene.orbit(-0.12);
  else if (k === "+" || k === "=") scene.zoom(0.8); else if (k === "-") scene.zoom(1.25);
  else if (k === "r") app.querySelector("[data-reset]").click(); else return;
  e.preventDefault();
});
document.addEventListener("pointerdown", (e) => { if (!app.contains(e.target)) engage(false); });

// Hole selection without a page load. Rail and grid are real links, so they work without script.
document.addEventListener("click", (e) => {
  const a = e.target.closest("a[data-hole]");
  if (!a || e.metaKey || e.ctrlKey || e.shiftKey || e.button) return;
  e.preventDefault();
  closeGrid();
  selectHole(Number(a.dataset.hole), { push: true });
  app.querySelector("[data-scene-wrap]").scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "nearest" });
});
app.querySelectorAll("[data-prev], [data-next]").forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); const n = state.hole; selectHole(a.hasAttribute("data-prev") ? (n === 1 ? 18 : n - 1) : (n === 18 ? 1 : n + 1), { push: true }); }));
addEventListener("popstate", (e) => { if (e.state?.hole) selectHole(e.state.hole); });

// All-holes grid (mobile)
const grid = document.querySelector("[data-hole-grid-dialog]");
function closeGrid() { if (grid && !grid.hidden) { grid.hidden = true; document.querySelector("[data-open-grid]")?.focus(); } }
document.querySelector("[data-open-grid]")?.addEventListener("click", () => { grid.hidden = false; grid.querySelector("a[aria-current]")?.focus() || grid.querySelector("a")?.focus(); });
grid?.querySelector("[data-close-grid]")?.addEventListener("click", closeGrid);
grid?.addEventListener("keydown", (e) => { if (e.key === "Escape") closeGrid(); });

// Start
app.classList.add("is-ready");
selectHole(state.hole);
if (state.view !== "top") app.querySelectorAll("[data-view]").forEach((x) => x.setAttribute("aria-pressed", String(x.dataset.view === state.view)));
