// Runs on every page: header state, menu sheet, motion controls, language-switch state carry,
// the action bar, toasts, the gallery lightbox and the shared conditions strip.
import { getApi } from "./api.js";
import { formatClock, formatDateTime, bkkDate } from "./core/util.js";

const html = document.documentElement;
const lang = html.lang === "th" ? "th" : "en";
const th = lang === "th";
window.kk = window.kk || {};
const reduce = matchMedia("(prefers-reduced-motion: reduce)");

// Header: solid after the hero, and a thin reading-progress line.
const header = document.querySelector(".site-header");
const hasHero = document.body.classList.contains("has-hero");
let ticking = false;
function onScroll() {
  ticking = false;
  const y = scrollY;
  if (hasHero) header.classList.toggle("is-solid", y > Math.max(40, (document.querySelector(".hero")?.offsetHeight || 400) - 120));
  const max = document.documentElement.scrollHeight - innerHeight;
  header.style.setProperty("--p", max > 0 ? (y / max).toFixed(4) : 0);
  const bar = document.querySelector("[data-action-bar]");
  if (bar) {
    const footer = document.querySelector(".site-footer").getBoundingClientRect().top < innerHeight - 40;
    const dock = document.querySelector("[data-dock]");
    const dockVisible = dock && (() => { const r = dock.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight; })();
    bar.classList.toggle("is-hidden", footer || !!dockVisible || document.activeElement?.matches?.("input, select, textarea"));
  }
}
addEventListener("scroll", () => { if (!ticking) { ticking = true; requestAnimationFrame(onScroll); } }, { passive: true });
addEventListener("resize", onScroll);
document.addEventListener("focusin", onScroll);
document.addEventListener("focusout", () => setTimeout(onScroll, 50));
onScroll();

// Menu sheet with focus trap.
const sheet = document.getElementById("menu-sheet");
const openBtn = document.querySelector("[data-menu-open]");
function trap(e) {
  if (e.key === "Escape") return closeMenu();
  if (e.key !== "Tab") return;
  const f = [...sheet.querySelectorAll("a, button")].filter((x) => x.offsetParent);
  if (!f.length) return;
  if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
  else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
}
function openMenu() { sheet.hidden = false; openBtn.setAttribute("aria-expanded", "true"); document.body.style.overflow = "hidden"; sheet.querySelector("[data-menu-close]").focus(); sheet.addEventListener("keydown", trap); }
function closeMenu() { sheet.hidden = true; openBtn.setAttribute("aria-expanded", "false"); document.body.style.overflow = ""; sheet.removeEventListener("keydown", trap); openBtn.focus(); }
openBtn?.addEventListener("click", openMenu);
sheet?.querySelector("[data-menu-close]")?.addEventListener("click", closeMenu);

// Motion: pause continuous motion on request, when hidden, and under reduced motion.
const pauseBtn = document.querySelector("[data-pause-motion]");
const setPaused = (p) => { html.classList.toggle("is-paused", p); pauseBtn?.setAttribute("aria-pressed", String(p)); if (pauseBtn) pauseBtn.textContent = p ? (th ? "เล่นการเคลื่อนไหว" : "Play motion") : (th ? "หยุดการเคลื่อนไหว" : "Pause motion"); };
pauseBtn?.addEventListener("click", () => { const p = !html.classList.contains("is-paused"); setPaused(p); try { localStorage.setItem("kk.motion", p ? "off" : "on"); } catch {} });
try { if (localStorage.getItem("kk.motion") === "off") setPaused(true); } catch {}
if (reduce.matches && pauseBtn) pauseBtn.hidden = true;
document.addEventListener("visibilitychange", () => html.classList.toggle("is-hidden-tab", document.hidden));

// Atmosphere follows a fine pointer within bounds, eased; touch devices keep the autonomous drift.
if (matchMedia("(pointer: fine)").matches && !reduce.matches) {
  let tx = 0, ty = 0, x = 0, y = 0, raf = 0;
  const fields = [...document.querySelectorAll("[data-atmos]")];
  const step = () => { x += (tx - x) * 0.06; y += (ty - y) * 0.06; fields.forEach((f) => { f.style.setProperty("--ax", x.toFixed(3)); f.style.setProperty("--ay", y.toFixed(3)); }); raf = Math.abs(tx - x) + Math.abs(ty - y) > 0.002 ? requestAnimationFrame(step) : 0; };
  if (fields.length) addEventListener("pointermove", (e) => { tx = (e.clientX / innerWidth - 0.5) * 2; ty = (e.clientY / innerHeight - 0.5) * 2; if (!raf) raf = requestAnimationFrame(step); }, { passive: true });
}

// Language switch keeps the page and its safe state (no personal data travels in the URL).
document.querySelectorAll("[data-lang-link]").forEach((a) => a.addEventListener("click", () => {
  try { const s = window.kk.carry?.(); if (s) sessionStorage.setItem("kk.carry", JSON.stringify({ ...s, page: html.dataset.page, at: Date.now() })); } catch {}
  if (location.hash) a.href = a.href.split("#")[0] + location.hash;
}));
window.kk.takeCarry = () => {
  try { const s = JSON.parse(sessionStorage.getItem("kk.carry") || "null"); sessionStorage.removeItem("kk.carry"); return s && s.page === html.dataset.page && Date.now() - s.at < 60e3 ? s : null; } catch { return null; }
};

// Toasts
window.kk.toast = (msg) => {
  const region = document.querySelector("[data-toasts]"); if (!region) return;
  const t = document.createElement("div"); t.className = "toast"; t.textContent = msg; region.append(t);
  setTimeout(() => t.remove(), 4200);
};

// Gallery lightbox: keyboard, Escape, focus return, swipe.
function lightbox() {
  const groups = document.querySelectorAll("[data-gallery]");
  if (!groups.length) return;
  const lb = document.createElement("div");
  lb.className = "lightbox"; lb.hidden = true; lb.setAttribute("role", "dialog"); lb.setAttribute("aria-modal", "true"); lb.setAttribute("aria-label", th ? "ภาพขยาย" : "Photo viewer");
  lb.innerHTML = `<div class="lb-top"><span class="num" data-count></span><button class="icon-btn" type="button" data-x aria-label="${th ? "ปิด" : "Close"}">&times;</button></div><figure><img alt=""><figcaption></figcaption></figure><div class="lb-nav"><button class="icon-btn" type="button" data-prev aria-label="${th ? "ภาพก่อนหน้า" : "Previous photo"}">&larr;</button><button class="icon-btn" type="button" data-next aria-label="${th ? "ภาพถัดไป" : "Next photo"}">&rarr;</button></div>`;
  document.body.append(lb);
  let items = [], i = 0, opener = null;
  const show = () => { const b = items[i]; const im = b.querySelector("img"); lb.querySelector("img").src = b.dataset.full || im.currentSrc || im.src; lb.querySelector("img").alt = im.alt; lb.querySelector("figcaption").textContent = im.alt; lb.querySelector("[data-count]").textContent = `${i + 1} / ${items.length}`; };
  const close = () => { lb.hidden = true; document.body.style.overflow = ""; opener?.focus(); };
  // Auto-scrolling strips draw each image twice; the copies ([data-dup]) open their original.
  groups.forEach((g) => g.addEventListener("click", (e) => { let b = e.target.closest("button"); if (!b) return; items = [...g.querySelectorAll("button:not([data-dup])")]; if (b.hasAttribute("data-dup")) b = items[Number(b.dataset.dup)] || b; i = Math.max(0, items.indexOf(b)); opener = b; show(); lb.hidden = false; document.body.style.overflow = "hidden"; lb.querySelector("[data-x]").focus(); }));
  lb.querySelector("[data-x]").onclick = close;
  lb.querySelector("[data-prev]").onclick = () => { i = (i - 1 + items.length) % items.length; show(); };
  lb.querySelector("[data-next]").onclick = () => { i = (i + 1) % items.length; show(); };
  lb.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); if (e.key === "ArrowLeft") lb.querySelector("[data-prev]").click(); if (e.key === "ArrowRight") lb.querySelector("[data-next]").click(); if (e.key === "Tab") { const f = [...lb.querySelectorAll("button")]; if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); } else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); } } });
  let sx = null; lb.addEventListener("touchstart", (e) => { sx = e.touches[0].clientX; }, { passive: true });
  lb.addEventListener("touchend", (e) => { if (sx == null) return; const dx = e.changedTouches[0].clientX - sx; if (Math.abs(dx) > 50) (dx > 0 ? lb.querySelector("[data-prev]") : lb.querySelector("[data-next]")).click(); sx = null; });
}
lightbox();

// Today's conditions strip (homepage and anywhere it is placed).
const strip = document.querySelector("[data-conditions-strip]");
if (strip) {
  const FRESH = { CURRENT: th ? "ล่าสุดวันนี้" : "Current", AGING: th ? "วัดไว้หลายชั่วโมงแล้ว" : "Measured some hours ago", STALE: th ? "ยังไม่มีค่าของวันนี้" : "No reading today yet", NOT_MEASURED: th ? "ยังไม่ได้วัด" : "Not measured" };
  const STATUS = { open: th ? "เปิดให้บริการ" : "Open", partial: th ? "เปิดบางส่วน" : "Partly open", closed: th ? "ปิด" : "Closed" };
  const render = async () => {
    try {
      const api = await getApi();
      const c = await api.getConditions();
      const q = (k) => strip.querySelector(`[data-c="${k}"]`);
      q("status").textContent = STATUS[c.course?.status] || (th ? "ไม่ทราบ" : "Unknown");
      if (c.reading && c.freshness !== "STALE") {
        const r = c.reading; const v = r.range ? `${r.range[0]} to ${r.range[1]}` : r.value;
        q("speed").innerHTML = `${v} <small>${th ? "ฟุต" : "ft"}</small>`;
        const when = bkkDate(r.measuredAt) === bkkDate(c.serverTime) ? formatClock(r.measuredAt, lang) : formatDateTime(r.measuredAt, lang);
        q("measured").textContent = th ? `วัดเมื่อ ${when} (${FRESH[c.freshness]})` : `Measured ${when} (${FRESH[c.freshness].toLowerCase()})`;
      } else { q("speed").textContent = FRESH[c.freshness]; q("measured").textContent = c.reading ? `${th ? "ค่าล่าสุดวัดเมื่อ" : "Last reading"} ${formatDateTime(c.reading.measuredAt, lang)}` : ""; }
      q("notice").textContent = c.notices[0] ? c.notices[0][lang] : th ? "ไม่มีประกาศ" : "No notices";
    } catch { /* the strip keeps its link to the conditions page */ }
  };
  render();
  getApi().then((api) => api.subscribe("conditions", render));
}
