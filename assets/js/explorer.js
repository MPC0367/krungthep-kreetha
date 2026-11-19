// The 18-hole explorer: 3D model, the club's 2D diagram and photographs, with direct hole
// selection, tee choice, camera presets, layers and an always-available text guide.
// A hole change updates everything on the page from the same record: number, guide, breadcrumb,
// previous/next links, poster, photographs, status message, title and URL. Stale loads are discarded.
const html = document.documentElement;
const lang = html.lang === "th" ? "th" : "en"; // content language (zh/ja pages are translated from English)
const route = ["th", "en", "zh", "ja"].includes(html.lang) ? html.lang : "en"; // the page's own language route
const th = lang === "th";
const root = html.dataset.root;
const explicit = html.dataset.target === "artifact";
const link = (p) => `${root}${route}/${p}${explicit && p.endsWith("/") ? "index.html" : ""}`;
const pad2 = (n) => String(n).padStart(2, "0");
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const reduceQ = matchMedia("(prefers-reduced-motion: reduce)");
const still = () => reduceQ.matches || html.classList.contains("is-paused"); // reduced motion or the site's Pause motion
const touch = matchMedia("(pointer: coarse)").matches;

const app = document.querySelector("[data-explorer]");
const HOLES = JSON.parse(document.getElementById("holes-data").textContent);
const FEATURES = JSON.parse(document.getElementById("feature-labels").textContent);
const sceneBox = app.querySelector("[data-scene]");
const panel = app.querySelector("[data-panel]");
const status = app.querySelector("[data-scene-status]");
const params = new URLSearchParams(location.search);
let savedUnits = null; try { savedUnits = sessionStorage.getItem("kk.units"); } catch {}
const state = {
  hole: Number(app.dataset.hole), tee: params.get("tee") || "1", mode: params.get("mode") || "3d", view: params.get("view") || "top",
  units: params.get("units") === "m" || savedUnits === "m" ? "m" : "yd", carry: 220, layers: { water: true, trees: true, redline: true, tees: true, line: true, carry: false, labels: true },
};
const carried = window.kk?.takeCarry?.();
if (carried) Object.assign(state, { tee: carried.tee || state.tee, mode: carried.mode || state.mode, view: carried.view || state.view, units: carried.units || state.units });
state.prefer = state.mode;
window.kk.carry = () => ({ hole: state.hole, tee: state.tee, mode: state.prefer || state.mode, view: state.view, units: state.units });

let scene = null, sceneMod = null, token = 0, threeFailed = false, lastSaid = "";
const cache = new Map();
const holeData = (n) => HOLES.find((h) => h.n === n);
const has3d = (h) => (h.display === "ILLUSTRATIVE_3D" || h.display === "VERIFIED_3D") && !threeFailed;
/** One formatter for every distance on the page: guide, tee titles, arc chips and the carry readout. */
const fmt = (yards) => (yards == null ? null : state.units === "m" ? `${Math.round(yards * 0.9144)} ${th ? "ม." : "m"}` : `${yards} ${th ? "หลา" : "yd"}`);
const arcText = (x) => `${x.approx ? "≈ " : ""}${fmt(x.yards)}`;
const teeName = (h, id) => h?.tees.find((x) => x.id === id)?.name?.[lang] || id;

// Speak a status once; repeating the same sentence is not announced again.
function say(msg) { if (msg === lastSaid) return; lastSaid = msg; status.textContent = msg; }

// ---------- panel (text guide) ----------
function renderPanel(h) {
  const tees = h.tees;
  const sel = tees.find((t) => t.id === state.tee) || tees[0];
  const T = (o) => o?.[lang] ?? "";
  const src = (thText, enText) => (th ? thText : enText);
  panel.innerHTML = `
    <div class="xp-head"><span class="xp-n" aria-hidden="true">${pad2(h.n)}</span><div><h1 class="h3" id="hole-title">${th ? `หลุมที่ ${h.n}` : `Hole ${h.n}`}</h1><p class="muted small">${h.par ? `${th ? "พาร์" : "Par"} ${h.par}` : th ? "รอยืนยันพาร์" : "Par to be confirmed"}${sel?.yards ? (th ? ` ระยะ ${fmt(sel.yards)} จากแท่นทีสี${sel.name.th}` : `, ${fmt(sel.yards)} from the ${sel.name.en.toLowerCase()} tees`) : ""}</p></div></div>
    ${h.display === "ILLUSTRATIVE_3D" ? `<p class="tag demo wrap">${th ? "แบบจำลองประกอบ ลอกจากแผนผังของสมาคม ไม่ใช่ข้อมูลสำรวจ" : "Illustrative model traced from the club's diagram, not surveyed"}</p>` : ""}
    ${h.issues.length ? `<div class="notice warn"><span>${h.issues.map((i) => esc(i[lang] || i.en || i)).join(" ")}</span></div>` : ""}
    <p>${esc(T(h.d))}</p>
    ${h.heritage ? `<p class="heritage-note">${esc(T(h.heritage))}</p>` : ""}
    ${tees.length ? `<div class="stack" style="gap:8px"><h2 class="label">${th ? "ระยะจากแท่นที (ตามสกอร์การ์ดของสมาคม)" : "Yardage by tee (club scorecard)"}</h2><div class="yardages">${tees.map((t) => `<div${t.id === sel.id ? ' class="is-sel"' : ""}><span><i class="tee-dot" style="--tee:${t.color}" aria-hidden="true"></i>${t.name?.[lang] || t.id}</span><b>${t.yards != null ? fmt(t.yards) : `<span class="tag warn">${th ? "รอยืนยัน" : "To confirm"}</span>`}</b></div>`).join("")}</div>${state.units === "m" ? `<p class="photo-note">${th ? "แปลงจากหลาของสมาคม ปัดเศษเป็นเมตร" : "Converted from the club's yards, rounded to the metre"}</p>` : ""}</div>` : ""}
    ${h.features?.length ? `<div class="stack" style="gap:8px"><h2 class="label">${th ? "สิ่งที่เห็นในแผนผัง" : "What the diagram shows"}</h2><ul class="feature-list">${h.features.map((f) => `<li>${esc(FEATURES[f]?.[lang] || f)}</li>`).join("")}</ul></div>` : ""}
    <p class="row"><a class="btn" href="${link("tee-times/")}">${th ? "จองเวลาออกรอบ" : "Book a tee time"} <span class="arrow" aria-hidden="true">&rarr;</span></a><a class="btn secondary" href="${link("scorecard/")}#h${h.n}">${th ? "สกอร์การ์ด" : "Scorecard"}</a></p>
    <details class="source"><summary>${th ? "ที่มาและสถานะของข้อมูล" : "Sources and status"}</summary><dl class="kv small">
      <dt>${th ? "พาร์ ระยะ และลำดับความยาก" : "Par, yardages and stroke index"}</dt><dd>${src("สกอร์การ์ดสีของสมาคม (แท่นทีน้ำเงิน ขาว เหลือง แดง)", "The club's printed colour-tee scorecard (Blue, White, Yellow, Red)")}</dd>
      ${h.pageTees?.length ? `<dt>${th ? "หน้าหลุมบนเว็บไซต์สมาคม" : "The club's hole page"}</dt><dd><span>${src("ฉบับแท่นทีหมายเลข 1 ถึง " + h.pageTees.length + " (หลา)", "Numbered-tee edition, in yards")}</span><br><span class="num">${h.pageTees.map((t) => `${t.id}: ${t.yards}`).join(", ")}</span><br><span>${src("ใช้ตั้งมาตราส่วนของแบบจำลองเท่านั้น ไม่ใช่ระยะที่แสดงบนหน้านี้", "Used only to scale the model, not for the distances on this page.")}</span></dd>` : ""}
      <dt>${th ? "แผนผังและภาพถ่าย" : "Diagram and photographs"}</dt><dd>${h.source ? `<a href="${h.source}" rel="noopener" target="_blank">${src("หน้าหลุมของสมาคม", "The club's hole page")}</a>` : src("ยังไม่มี", "None yet")}</dd>
      <dt>${th ? "แบบจำลอง" : "Model"}</dt><dd>${h.display === "ILLUSTRATIVE_3D" ? src("ภาพประกอบ ลอกจากแผนผัง ยังไม่ได้ตรวจกับสนามจริง", "Illustrative, traced from the diagram, not yet checked on the ground") : h.display === "VERIFIED_3D" ? src("ตรวจกับข้อมูลสำรวจแล้ว", "Checked against survey data") : src("รอข้อมูลจากสมาคม", "Waiting for club data")}</dd>
      <dt>${th ? "ความสูงต่ำ" : "Elevation"}</dt><dd>${src("ภาพประกอบตามแผนผังของสมาคม ความสูงเป็นค่าโดยประมาณ", "Illustrative terrain based on the club diagram. Elevations are approximate.")}</dd>
    </dl></details>`;
}

// ---------- page chrome that belongs to the selected hole ----------
function renderChrome(h) {
  const n = h.n, prev = n === 1 ? 18 : n - 1, next = n === 18 ? 1 : n + 1;
  document.title = th ? `หลุมที่ ${n}${h.par ? ` พาร์ ${h.par}` : ""} | สนามกอล์ฟกรุงเทพกรีฑา` : `Hole ${n}${h.par ? `, Par ${h.par}` : ""} | Krungthep Kreetha Golf Course`;
  const crumb = document.querySelector("[data-crumb-hole]"); if (crumb) crumb.textContent = th ? `หลุมที่ ${n}` : `Hole ${n}`;
  const p = app.querySelector("[data-prev]"), x = app.querySelector("[data-next]");
  p.href = holeData(prev).url; p.innerHTML = `&larr; ${pad2(prev)}`; p.setAttribute("aria-label", th ? `หลุมก่อนหน้า หลุม ${prev}` : `Previous hole, ${prev}`);
  x.href = holeData(next).url; x.innerHTML = `${pad2(next)} &rarr;`; x.setAttribute("aria-label", th ? `หลุมถัดไป หลุม ${next}` : `Next hole, ${next}`);
  document.querySelectorAll("[data-hole-rail] [data-hole], [data-hole-grid] [data-hole]").forEach((a) => { if (Number(a.dataset.hole) === n) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current"); });
  sceneBox.setAttribute("aria-label", th ? `แบบจำลองหลุมที่ ${n} ใช้ปุ่มด้านล่างหรือคำบรรยายด้านข้างแทนการลากได้` : `Model of hole ${n}. Use the buttons or the text guide instead of dragging.`);
  // The poster shows this hole's diagram until the model has drawn.
  const poster = sceneBox.querySelector(".poster");
  if (poster) { if (h.cut) { if (!poster.src.endsWith(h.cut)) poster.src = h.cut; poster.alt = h.diagramAlt?.[lang] || ""; poster.hidden = false; } else poster.hidden = true; }
  // Photographs below the explorer, from the same record (the lightbox reads whichever buttons are present).
  const sec = document.querySelector("[data-hole-photos]");
  if (sec) {
    sec.hidden = !h.photos.length;
    sec.querySelector("[data-ph-title]").textContent = th ? `ภาพถ่ายหลุมที่ ${n}` : `Hole ${n} photographs`;
    sec.querySelector("[data-gallery]").innerHTML = h.photos.map((ph) => `<button type="button" data-full="${ph.src}"><img src="${ph.small}" alt="${esc(ph.alt[lang])}" loading="lazy" decoding="async" width="560" height="373"></button>`).join("");
  }
  // Head links and the language switch point at the hole being shown.
  document.querySelectorAll('link[rel="canonical"], link[rel="alternate"]').forEach((l) => { l.href = l.href.replace(/\/holes\/\d\d\//, `/holes/${pad2(n)}/`); });
  document.querySelectorAll("[data-lang-link]").forEach((a) => { a.href = a.href.replace(/\/holes\/\d\d\//, `/holes/${pad2(n)}/`); });
}

// ---------- 3D ----------
function labelFactory(kind, extra) {
  const el = document.createElement("span");
  el.className = `xp-label xp-${kind}`;
  if (kind === "arc") { el.textContent = arcText(extra); if (!extra.main) el.classList.add("is-sub"); return el; }
  el.textContent = kind === "green" ? (th ? "กลางกรีนตามแผนผัง" : "Green centre (diagram)") : kind === "tee" ? teeName(holeData(state.hole), extra) : kind === "target" ? (th ? "จุดเล็งตามแผนผัง" : "Diagram target") : (th ? "ระยะตีลอย (ประกอบ)" : "Carry (illustrative)");
  if (kind === "carry") el.dataset.carry = "";
  return el;
}
function relabel() { scene?.labels?.forEach((l) => { if (l.kind === "arc" && l.extra) l.el.textContent = arcText(l.extra); }); }
async function ensureScene() {
  if (scene || threeFailed) return scene;
  try {
    sceneMod = await import("./explorer/scene3d.js");
    if (!sceneMod.webglAvailable()) throw new Error("webgl");
    scene = new sceneMod.HoleScene(sceneBox, { onLabel: labelFactory, reducedMotion: still(), isTouch: touch });
    window.kk.hole3d = () => scene; // read-only handle for the local QA scripts (stats, heightAt)
    sceneBox.addEventListener("scene:lost", () => { threeFailed = true; app.classList.add("no-3d"); say(th ? "การแสดงผลสามมิติหยุดทำงาน เปลี่ยนเป็นแผนผังสองมิติ" : "3D stopped working, showing the 2D diagram"); setMode(holeData(state.hole).diagram ? "2d" : "photos"); });
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
  scene?.setEngaged(on);
  app.querySelector("[data-engage]")?.setAttribute("aria-pressed", String(on));
  app.classList.toggle("is-engaged", on);
}

async function show3D(h, my) {
  if (!has3d(h)) { setMode(h.diagram ? "2d" : "photos", { silent: true }); return; }
  const s = await ensureScene();
  if (my !== token) return;
  if (!s) { setMode(h.diagram ? "2d" : "photos", { silent: true }); return; }
  app.classList.add("is-loading");
  say(th ? `กำลังโหลดแบบจำลองหลุม ${h.n}` : `Loading the hole ${h.n} model`);
  try {
    // Data and picture load together; the current model stays on screen until both are in.
    const [full, tx] = await Promise.all([holeJSON(h.n), h.clean ? s.texture(h.clean).catch(() => null) : null]);
    if (my !== token) return; // a newer selection won
    const data = { ...full, tees: full.tees.filter((t) => h.tees.some((x) => x.id === t.id)) }; // the scorecard's four tees
    s.reduced = still();
    sceneBox.classList.remove("is-drawn");
    s.load(data, { tee: state.tee, carryYards: state.carry, enabled: state.layers, texture: tx || h.clean || h.cut, distances: h.arcs ? { tees: h.tees, approach: h.arcs.approach, approx: h.arcs.approx } : null });
    s.retain?.([h.clean, ...near(h.n).map((k) => holeData(k)?.clean)]);
    prefetchNear(h.n);
    s.preset(state.view, { instant: true });
    say(th ? `แบบจำลองหลุม ${h.n} พร้อมแล้ว` : `Hole ${h.n} model ready`);
  } catch {
    if (my !== token) return;
    say(th ? "โหลดแบบจำลองไม่สำเร็จ แสดงแผนผังสองมิติแทน" : "The model did not load; showing the 2D diagram");
    setMode(h.diagram ? "2d" : "photos", { silent: true });
  } finally { if (my === token) app.classList.remove("is-loading"); }
}

function holeJSON(n) {
  if (!cache.has(n)) { const p = fetch(`${root}data/holes/hole-${pad2(n)}.json`).then((r) => { if (!r.ok) throw new Error("fetch"); return r.json(); }); p.catch(() => cache.delete(n)); cache.set(n, p); }
  return cache.get(n);
}
const near = (n) => [n === 18 ? 1 : n + 1, n === 1 ? 18 : n - 1];
// The next and previous holes are fetched quietly once idle, so the arrows switch at once.
// Nothing is warmed on a data-saving connection.
function prefetchNear(n) {
  if (navigator.connection?.saveData) return;
  const idle = window.requestIdleCallback || ((f) => setTimeout(f, 300));
  idle(() => { for (const k of near(n)) { const x = holeData(k); if (x && has3d(x)) { holeJSON(k).catch(() => {}); if (x.clean && scene) scene.texture(x.clean).catch(() => {}); } } });
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
// Only the controls that work in the active view are shown: cameras and layers in 3D, zoom in 3D and 2D.
function setMode(mode, { silent } = {}) {
  const h = holeData(state.hole);
  state.mode = mode;
  app.dataset.mode = mode;
  app.querySelectorAll("[data-mode]").forEach((b) => {
    b.setAttribute("aria-pressed", String(b.dataset.mode === mode));
    b.hidden = (b.dataset.mode === "3d" && !has3d(h)) || (b.dataset.mode === "2d" && !h.diagram);
  });
  sceneBox.hidden = mode !== "3d"; flat.hidden = mode !== "2d"; app.querySelector("[data-photos]").hidden = mode !== "photos";
  app.querySelector("[data-tools3d]").hidden = mode === "photos";
  app.querySelector(".xp-presets").hidden = mode !== "3d";
  app.querySelector(".xp-layers").hidden = mode !== "3d";
  if (mode !== "3d") say(mode === "2d" ? (th ? `แผนผังหลุมที่ ${h.n} ของสมาคม` : `The club's diagram of hole ${h.n}`) : h.photos.length ? (th ? `ภาพถ่ายหลุมที่ ${h.n} จำนวน ${h.photos.length} ภาพ` : `Hole ${h.n} photographs, ${h.photos.length}`) : (th ? `ยังไม่มีภาพถ่ายของหลุมที่ ${h.n}` : `No photographs of hole ${h.n} yet`));
  if (mode === "3d" && !silent) show3D(h, token);
  syncUrl();
}

function syncUrl() {
  const h = holeData(state.hole);
  const u = new URL(h.url, location.href);
  if (state.tee !== "1") u.searchParams.set("tee", state.tee);
  if (state.mode !== "3d") u.searchParams.set("mode", state.mode);
  if (state.view !== "top") u.searchParams.set("view", state.view);
  if (state.units === "m") u.searchParams.set("units", "m");
  try { history.replaceState({ hole: state.hole }, "", u.pathname + u.search); } catch {}
}

async function selectHole(n, { push = false } = {}) {
  const h = holeData(n); if (!h) return;
  const my = ++token;
  state.hole = n;
  if (!h.tees.find((t) => t.id === state.tee)) state.tee = "1";
  app.dataset.hole = n;
  if (push) try { history.pushState({ hole: n }, "", h.url); } catch {}
  renderChrome(h); renderTees(h); renderPanel(h); renderFlat(h); renderPhotos(h);
  // The visitor's chosen view is kept; a hole that cannot show it falls back without changing the choice.
  const pref = state.prefer;
  const want = pref === "3d" && has3d(h) ? "3d" : pref === "photos" && h.photos.length ? "photos" : (pref === "2d" || pref === "3d") && h.diagram ? "2d" : h.photos.length ? "photos" : h.diagram ? "2d" : has3d(h) ? "3d" : "photos";
  setMode(want, { silent: true });
  if (want === "3d") await show3D(h, my);
  if (my === token) syncUrl();
}

function renderTees(h) {
  const box = app.querySelector("[data-tees]");
  box.innerHTML = h.tees.map((t) => `<button type="button" data-tee="${t.id}" aria-pressed="${t.id === state.tee}"${t.yards != null ? ` title="${fmt(t.yards)}"` : ""}><i class="tee-dot" style="--tee:${t.color}" aria-hidden="true"></i>${t.name?.[lang] || t.id}</button>`).join("") || `<span class="small muted">${th ? "ไม่มีข้อมูลแท่นที" : "No tee data"}</span>`;
}
app.querySelector("[data-tees]").addEventListener("click", (e) => {
  const b = e.target.closest("[data-tee]"); if (!b) return;
  state.tee = b.dataset.tee;
  app.querySelectorAll("[data-tee]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
  renderPanel(holeData(state.hole));
  if (scene?.data) { scene.reduced = still(); scene.setTee(state.tee); relabel(); if (["tee", "landing"].includes(state.view)) scene.preset(state.view); }
  say(th ? `เลือกแท่นทีสี${teeName(holeData(state.hole), state.tee)}` : `${teeName(holeData(state.hole), state.tee)} tees selected`);
  syncUrl();
});

app.querySelectorAll("[data-mode]").forEach((b) => b.addEventListener("click", () => { state.prefer = b.dataset.mode; setMode(b.dataset.mode); }));
app.querySelectorAll("[data-view]").forEach((b) => b.addEventListener("click", () => {
  state.view = b.dataset.view;
  app.querySelectorAll("[data-view]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
  if (scene) scene.reduced = still();
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
const carryOut = () => { const o = app.querySelector("[data-carry-out]"); if (o) o.textContent = fmt(state.carry); };
app.querySelector("[data-carry]")?.addEventListener("input", (e) => { state.carry = Number(e.target.value); carryOut(); scene?.setTee(state.tee, { carryYards: state.carry, silent: true }); relabel(); });
function setUnits(u) {
  state.units = u; app.dataset.units = u;
  try { sessionStorage.setItem("kk.units", u); } catch {}
  app.querySelectorAll("[data-unit]").forEach((x) => x.setAttribute("aria-pressed", String(x.dataset.unit === u)));
  const h = holeData(state.hole); renderPanel(h); renderTees(h); relabel(); carryOut();
}
app.querySelector("[data-units]")?.addEventListener("click", (e) => { const b = e.target.closest("[data-unit]"); if (!b) return; setUnits(b.dataset.unit); say(state.units === "m" ? (th ? "แสดงระยะเป็นเมตร" : "Distances in metres") : (th ? "แสดงระยะเป็นหลา" : "Distances in yards")); syncUrl(); });

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
  app.querySelector("[data-scene-wrap]").scrollIntoView({ behavior: still() ? "auto" : "smooth", block: "nearest" });
});
app.querySelectorAll("[data-prev], [data-next]").forEach((a) => a.addEventListener("click", (e) => { if (e.metaKey || e.ctrlKey || e.shiftKey) return; e.preventDefault(); const n = state.hole; selectHole(a.hasAttribute("data-prev") ? (n === 1 ? 18 : n - 1) : (n === 18 ? 1 : n + 1), { push: true }); }));
addEventListener("popstate", (e) => { const n = e.state?.hole || Number(location.pathname.match(/holes\/(\d\d)/)?.[1]); if (n && n !== state.hole) selectHole(n); });

// All-holes grid (mobile)
const grid = document.querySelector("[data-hole-grid-dialog]");
const opener = document.querySelector("[data-open-grid]");
function closeGrid() { if (grid && !grid.hidden) { grid.hidden = true; opener?.setAttribute("aria-expanded", "false"); opener?.focus(); } }
opener?.addEventListener("click", () => { grid.hidden = false; opener.setAttribute("aria-expanded", "true"); (grid.querySelector("a[aria-current]") || grid.querySelector("a"))?.focus(); });
grid?.querySelector("[data-close-grid]")?.addEventListener("click", closeGrid);
grid?.addEventListener("keydown", (e) => {
  if (e.key === "Escape") return closeGrid();
  if (e.key !== "Tab") return;
  const f = [...grid.querySelectorAll("a, button")]; const first = f[0], last = f[f.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
});

// Start
app.classList.add("is-ready");
app.dataset.units = state.units;
app.querySelectorAll("[data-unit]").forEach((x) => x.setAttribute("aria-pressed", String(x.dataset.unit === state.units)));
carryOut();
selectHole(state.hole);
if (state.view !== "top") app.querySelectorAll("[data-view]").forEach((x) => x.setAttribute("aria-pressed", String(x.dataset.view === state.view)));
