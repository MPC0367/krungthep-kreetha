// The Visit map: OpenStreetMap features (public/data/map.json, built by scripts/map-data.mjs) drawn
// live on a canvas in the site's own colours. It drags the moment it opens (mouse or one finger),
// zooms in and out (buttons, pinch, double-click, ctrl or cmd + wheel, or the wheel once the map has
// been clicked), and can switch to satellite pictures where the host allows them (Esri World Imagery).
// Coordinates are Web Mercator metres relative to the course, x east and y south.
const lang = document.documentElement.lang === "th" ? "th" : "en";
const th = lang === "th";
const R = 6378137, WORLD = 2 * Math.PI * R;
const C = {
  ground: "#F1EEE3", green: "#DCE4D2", golf: "#CFDCC2", ours: "rgba(37, 78, 61, .22)", oursLine: "#254E3D", campus: "#E9E3D5", stadium: "#E3DCCB", airport: "#E5E0D2",
  water: "#C9DAE0", waterLine: "#A9C3CC", casingMinor: "rgba(21, 42, 36, .14)", minor: "#FFFFFF", casingMajor: "rgba(120, 96, 52, .38)", major: "#F3E7CC", motorway: "#E9D3A6",
  rail: "#7A8580", label: "#3D504A", labelMuted: "#66756F", halo: "rgba(244, 242, 233, .95)", haloSat: "rgba(10, 24, 19, .75)",
};
const RANK = { residential: 1, living_street: 1, unclassified: 1, tertiary: 2, secondary: 3, primary: 4, trunk: 5, motorway: 6 };
const WIDTH_M = { residential: 6, living_street: 5, unclassified: 6, tertiary: 9, secondary: 12, primary: 16, trunk: 20, motorway: 24 };
const MIN_PX = { residential: .7, living_street: .6, unclassified: .7, tertiary: 1.2, secondary: 1.6, primary: 2.2, trunk: 2.6, motorway: 3 };
const SHOW_AT = { residential: .16, living_street: .22, unclassified: .16, tertiary: .05, secondary: .03, primary: 0, trunk: 0, motorway: 0 }; // px per metre
const LABEL_AT = { motorway: .018, trunk: .02, primary: .035, secondary: .12, tertiary: .25 };

function decode(p) { const a = new Float32Array(p.length); let x = 0, y = 0; for (let i = 0; i < p.length; i += 2) { x = i ? x + p[i] : p[i]; y = i ? y + p[i + 1] : p[i + 1]; a[i] = x; a[i + 1] = y; } return a; }
function bbox(a) { let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for (let i = 0; i < a.length; i += 2) { if (a[i] < x0) x0 = a[i]; if (a[i] > x1) x1 = a[i]; if (a[i + 1] < y0) y0 = a[i + 1]; if (a[i + 1] > y1) y1 = a[i + 1]; } return [x0, y0, x1, y1]; }
function length(a) { let L = 0; for (let i = 2; i < a.length; i += 2) L += Math.hypot(a[i] - a[i - 2], a[i + 1] - a[i - 1]); return L; }
function midpoint(a) {
  const half = length(a) / 2; let acc = 0;
  for (let i = 2; i < a.length; i += 2) { const d = Math.hypot(a[i] - a[i - 2], a[i + 1] - a[i - 1]); if (acc + d >= half) { const t = (half - acc) / (d || 1); return [a[i - 2] + (a[i] - a[i - 2]) * t, a[i - 1] + (a[i + 1] - a[i - 1]) * t, Math.atan2(a[i + 1] - a[i - 1], a[i] - a[i - 2])]; } acc += d; }
  return [a[0], a[1], 0];
}

export async function mountMap(root, { url, labels }) {
  const canvas = root.querySelector("canvas");
  const ctx = canvas.getContext("2d");
  const pin = root.querySelector("[data-map-pin]");
  const card = root.querySelector("[data-map-card]");
  const attr = root.querySelector("[data-map-attr]");
  const satBtn = root.querySelector('[data-map-mode="sat"]');
  root.classList.add("is-loading");
  const res = await fetch(url);
  if (!res.ok) throw new Error("map data");
  const D = await res.json();
  root.classList.remove("is-loading");
  const N = D.names;
  const name = (i) => { const n = N[i]; if (!n) return ""; return th ? n[0] || n[1] : n[1] || n[0]; };

  // Decode once; keep a bounding box per feature for culling.
  const areas = D.areas.map((a) => { const r = a.r.map(decode); const b = r.map(bbox).reduce((m, q) => [Math.min(m[0], q[0]), Math.min(m[1], q[1]), Math.max(m[2], q[2]), Math.max(m[3], q[3])]); return { ...a, r, b }; });
  const order = { airport: 0, campus: 1, stadium: 2, green: 3, golf: 4, water: 5 };
  areas.sort((a, b) => (order[a.k] ?? 9) - (order[b.k] ?? 9) || (a.ours ? 1 : 0) - (b.ours ? 1 : 0));
  const water = D.water.map((w) => { const p = decode(w.p); return { ...w, p, b: bbox(p) }; });
  const roads = D.roads.map((r) => { const p = decode(r.p); return { ...r, p, b: bbox(p), rank: RANK[r.k] || 1 }; }).sort((a, b) => a.rank - b.rank);
  const rail = D.rail.map((r) => { const p = decode(r.p); return { ...r, p, b: bbox(p) }; });
  const stations = D.stations;
  // Label candidates: per road name, its longer pieces, longest first.
  const byName = new Map();
  for (const r of roads) if (r.n != null && LABEL_AT[r.k] != null) { const L = length(r.p); if (L < 120) continue; const list = byName.get(r.n) || []; list.push({ L, m: midpoint(r.p), k: r.k }); byName.set(r.n, list); }
  const roadLabels = [...byName.entries()].map(([n, list]) => ({ n, k: list[0].k, cands: list.sort((a, b) => b.L - a.L).slice(0, 8) })).sort((a, b) => (RANK[b.k] || 0) - (RANK[a.k] || 0));
  const areaLabels = areas.filter((a) => a.n != null && !a.ours && a.k !== "water").map((a) => ({ n: a.n, x: (a.b[0] + a.b[2]) / 2, y: (a.b[1] + a.b[3]) / 2, w: a.b[2] - a.b[0], k: a.k }));

  // View: centre (metres) and scale (CSS px per metre).
  const [cx0, cy0, cx1, cy1] = D.course;
  const home = { x: (cx0 + cx1) / 2, y: (cy0 + cy1) / 2 };
  let W = 0, H = 0, dpr = 1;
  const fitScale = () => Math.min(W / ((cx1 - cx0) * 3.2), H / ((cy1 - cy0) * 3.2));
  const minScale = () => Math.min(W / (D.bounds[2] - D.bounds[0]), H / (D.bounds[3] - D.bounds[1])) * 0.98;
  const MAX = 3.2;
  const view = { x: home.x, y: home.y, s: 0.3 };
  let mode = "map", sat = { ok: 0, fail: 0, disabled: false }, raf = 0;
  const tiles = new Map();

  const resize = () => {
    const r = root.getBoundingClientRect(); W = r.width; H = canvas.clientHeight; dpr = Math.min(devicePixelRatio || 1, 2.5);
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    if (!view.init) { view.s = fitScale(); view.init = true; }
    view.s = Math.max(minScale(), Math.min(MAX, view.s));
    draw();
  };
  const toScreen = (x, y) => [(x - view.x) * view.s + W / 2, (y - view.y) * view.s + H / 2];
  const toWorld = (sx, sy) => [(sx - W / 2) / view.s + view.x, (sy - H / 2) / view.s + view.y];
  const visible = (b, pad = 0) => { const [x0, y0] = toWorld(-pad, -pad), [x1, y1] = toWorld(W + pad, H + pad); return !(b[2] < x0 || b[0] > x1 || b[3] < y0 || b[1] > y1); };
  const clampView = () => { const [bx0, by0, bx1, by1] = D.bounds; view.x = Math.max(bx0, Math.min(bx1, view.x)); view.y = Math.max(by0, Math.min(by1, view.y)); };
  const request = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; draw(); }); };

  function path(a) { ctx.moveTo(a[0], a[1]); for (let i = 2; i < a.length; i += 2) ctx.lineTo(a[i], a[i + 1]); }
  function drawTiles() {
    // Web Mercator tile pyramid: pick the level whose pixels match the screen's.
    const z = Math.max(3, Math.min(19, Math.round(Math.log2(WORLD * view.s * dpr / 256))));
    const n = 2 ** z, size = WORLD / n;
    const [wx0, wy0] = toWorld(0, 0), [wx1, wy1] = toWorld(W, H);
    const ax0 = D.center.x + wx0, ax1 = D.center.x + wx1, ay0 = D.center.y - wy0, ay1 = D.center.y - wy1;
    const tx0 = Math.floor((ax0 + WORLD / 2) / size), tx1 = Math.floor((ax1 + WORLD / 2) / size);
    const ty0 = Math.floor((WORLD / 2 - ay0) / size), ty1 = Math.floor((WORLD / 2 - ay1) / size);
    for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
      const key = `${z}/${ty}/${tx}`; let t = tiles.get(key);
      if (!t) {
        t = new Image(); t.crossOrigin = "anonymous"; t.decoding = "async";
        t.onload = () => { sat.ok++; request(); };
        t.onerror = () => { sat.fail++; if (!sat.ok && sat.fail >= 3) disableSat(); };
        t.src = `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${key}`; tiles.set(key, t);
        if (tiles.size > 400) tiles.delete(tiles.keys().next().value);
      }
      if (t.complete && t.naturalWidth) {
        const x = tx * size - WORLD / 2 - D.center.x, y = WORLD / 2 - ty * size - D.center.y;
        ctx.drawImage(t, x, -y, size, size);
      }
    }
  }
  function draw() {
    if (!W) return;
    const s = view.s, k = dpr * s;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = mode === "sat" ? "#2A3A30" : C.ground; ctx.fillRect(0, 0, W, H);
    ctx.setTransform(k, 0, 0, k, (W / 2 - view.x * s) * dpr, (H / 2 - view.y * s) * dpr);
    const px = (v) => v / s; // CSS px to metres
    if (mode === "sat") drawTiles();
    else {
      for (const a of areas) {
        if (!visible(a.b)) continue;
        ctx.beginPath(); a.r.forEach(path);
        ctx.fillStyle = a.ours ? C.ours : C[a.k] || C.green; ctx.fill("evenodd");
      }
      ctx.lineCap = "round"; ctx.lineJoin = "round";
      for (const w of water) {
        if (!visible(w.b)) continue;
        const wm = w.k === "river" ? 60 : w.k === "canal" ? 9 : 4; if (w.k !== "river" && s < 0.06) continue;
        ctx.beginPath(); path(w.p); ctx.strokeStyle = C.waterLine; ctx.lineWidth = Math.max(px(w.k === "river" ? 2.5 : 1), wm); ctx.stroke();
      }
    }
    // Roads: casings first, then fills, minor to major.
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    const shown = roads.filter((r) => s >= (SHOW_AT[r.k] ?? 0.2) && visible(r.b, 20));
    if (mode === "map") {
      for (const r of shown) { ctx.beginPath(); path(r.p); ctx.strokeStyle = r.rank >= 3 ? C.casingMajor : C.casingMinor; ctx.lineWidth = Math.max(px(MIN_PX[r.k]), WIDTH_M[r.k]) + px(1.6); ctx.stroke(); }
      for (const r of shown) { ctx.beginPath(); path(r.p); ctx.strokeStyle = r.k === "motorway" || r.k === "trunk" ? C.motorway : r.rank >= 3 ? C.major : C.minor; ctx.lineWidth = Math.max(px(MIN_PX[r.k]), WIDTH_M[r.k]); ctx.stroke(); }
    } else {
      for (const r of shown) { if (r.rank < 2) continue; ctx.beginPath(); path(r.p); ctx.strokeStyle = "rgba(255, 255, 255, .55)"; ctx.lineWidth = px(r.rank >= 4 ? 1.6 : 1); ctx.stroke(); }
    }
    for (const r of rail) { if (!visible(r.b)) continue; ctx.beginPath(); path(r.p); ctx.strokeStyle = mode === "sat" ? "rgba(255,255,255,.7)" : C.rail; ctx.lineWidth = px(1.6); ctx.setLineDash([px(5), px(4)]); ctx.stroke(); ctx.setLineDash([]); }
    // The course: outlined in evergreen on both maps.
    for (const a of areas) if (a.ours) { ctx.beginPath(); a.r.forEach(path); ctx.strokeStyle = mode === "sat" ? "#E7F0DC" : C.oursLine; ctx.lineWidth = px(2); ctx.stroke(); }
    drawLabels();
    placePin();
  }
  function text(str, x, y, { size = 12, weight = 500, color = C.label, angle = 0, placed }) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(angle);
    ctx.font = `${weight} ${size}px "IBM Plex Sans", "IBM Plex Sans Thai", "Noto Sans Thai", system-ui, sans-serif`;
    const w = ctx.measureText(str).width;
    // collision test in screen space (axis-aligned box around the rotated label)
    const cos = Math.abs(Math.cos(angle)), sin = Math.abs(Math.sin(angle));
    const bw = w * cos + size * sin, bh = w * sin + size * cos; const box = [x - bw / 2 - 4, y - bh / 2 - 3, x + bw / 2 + 4, y + bh / 2 + 3];
    if (placed.some((q) => !(box[2] < q[0] || box[0] > q[2] || box[3] < q[1] || box[1] > q[3])) || box[0] < 4 || box[1] < 4 || box[2] > W - 4 || box[3] > H - 4) { ctx.restore(); return false; }
    placed.push(box);
    ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.lineJoin = "round";
    ctx.lineWidth = 3.5; ctx.strokeStyle = mode === "sat" ? C.haloSat : C.halo; ctx.strokeText(str, 0, 0);
    ctx.fillStyle = mode === "sat" ? "#F4F2E9" : color; ctx.fillText(str, 0, 0); ctx.restore();
    return true;
  }
  function drawLabels() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const placed = [];
    // keep the pin and its card clear
    const [px0, py0] = toScreen(home.x, home.y); placed.push([px0 - 24, py0 - 58, px0 + 260, py0 + 4]);
    let count = 0;
    for (const L of roadLabels) {
      if (view.s < LABEL_AT[L.k] || count > 36) continue;
      const str = name(L.n); if (!str) continue;
      for (const c of L.cands) {
        const [sx, sy] = toScreen(c.m[0], c.m[1]); if (sx < 30 || sy < 20 || sx > W - 30 || sy > H - 20) continue;
        let a = c.m[2]; if (a > Math.PI / 2) a -= Math.PI; if (a < -Math.PI / 2) a += Math.PI;
        if (text(str, sx, sy, { size: L.k === "motorway" || L.k === "trunk" || L.k === "primary" ? 12.5 : 11.5, angle: a, placed })) { count++; break; }
      }
    }
    for (const a of areaLabels) {
      if (a.w * view.s < 90) continue;
      const [sx, sy] = toScreen(a.x, a.y);
      text(name(a.n), sx, sy, { size: 11.5, weight: 500, color: a.k === "green" || a.k === "golf" ? "#4F6B3A" : C.labelMuted, placed });
    }
    if (view.s > 0.05) for (const st of stations) {
      const [sx, sy] = toScreen(st.p[0], st.p[1]); if (sx < 0 || sy < 0 || sx > W || sy > H) continue;
      if (view.s < 0.12 && !/airport|สุวรรณภูมิ|หัวหมาก|Hua Mak|Ramkhamhaeng|รามคำแหง/i.test(N[st.n].join(" "))) continue;
      if (text(name(st.n), sx, sy - 12, { size: 11, weight: 500, color: "#24506A", placed })) {
        ctx.beginPath(); ctx.arc(sx, sy, 3.5, 0, Math.PI * 2); ctx.fillStyle = mode === "sat" ? "#F4F2E9" : "#24506A"; ctx.fill(); ctx.lineWidth = 1.5; ctx.strokeStyle = mode === "sat" ? "#24506A" : "#F4F2E9"; ctx.stroke();
      }
    }
  }
  function placePin() {
    const [sx, sy] = toScreen(home.x, home.y);
    pin.style.transform = `translate(${sx.toFixed(1)}px, ${sy.toFixed(1)}px)`;
    if (!card.hidden) card.style.transform = `translate(${Math.max(12, Math.min(W - card.offsetWidth - 12, sx - card.offsetWidth / 2)).toFixed(1)}px, ${Math.max(12, sy - card.offsetHeight - 58).toFixed(1)}px)`;
  }

  // ---- Interaction
  const pointers = new Map(); let pinch = null, active = false, last = null;
  const zoomAt = (f, sx = W / 2, sy = H / 2) => {
    const [wx, wy] = toWorld(sx, sy);
    view.s = Math.max(minScale(), Math.min(MAX, view.s * f));
    view.x = wx - (sx - W / 2) / view.s; view.y = wy - (sy - H / 2) / view.s; clampView(); request();
  };
  const local = (e) => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  canvas.addEventListener("pointerdown", (e) => {
    canvas.setPointerCapture(e.pointerId); pointers.set(e.pointerId, local(e)); active = true; root.classList.add("is-active", "is-dragging");
    if (pointers.size === 2) { const [a, b] = [...pointers.values()]; pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), s: view.s }; }
    last = local(e);
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!pointers.has(e.pointerId)) return;
    const p = local(e); const prev = pointers.get(e.pointerId); pointers.set(e.pointerId, p);
    if (pointers.size === 2 && pinch) {
      const [a, b] = [...pointers.values()]; const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
      const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      view.x -= (p[0] - prev[0]) / 2 / view.s; view.y -= (p[1] - prev[1]) / 2 / view.s;
      zoomAt((pinch.s * d / pinch.d) / view.s, mid[0], mid[1]); return;
    }
    view.x -= (p[0] - prev[0]) / view.s; view.y -= (p[1] - prev[1]) / view.s; clampView(); request();
  });
  const up = (e) => { pointers.delete(e.pointerId); if (pointers.size < 2) pinch = null; if (!pointers.size) root.classList.remove("is-dragging"); };
  canvas.addEventListener("pointerup", up); canvas.addEventListener("pointercancel", up);
  canvas.addEventListener("dblclick", (e) => { const [x, y] = local(e); zoomAt(e.shiftKey ? 0.5 : 2, x, y); });
  let hintT = 0;
  canvas.addEventListener("wheel", (e) => {
    if (!active && !e.ctrlKey && !e.metaKey) { root.classList.add("show-hint"); clearTimeout(hintT); hintT = setTimeout(() => root.classList.remove("show-hint"), 1600); return; }
    e.preventDefault(); const [x, y] = local(e); zoomAt(Math.exp(-e.deltaY * (e.deltaMode ? 0.05 : 0.0018)), x, y);
  }, { passive: false });
  document.addEventListener("pointerdown", (e) => { if (!root.contains(e.target)) { active = false; root.classList.remove("is-active"); } });
  canvas.addEventListener("keydown", (e) => {
    const step = 80 / view.s; const k = e.key;
    if (k === "ArrowLeft") view.x -= step; else if (k === "ArrowRight") view.x += step; else if (k === "ArrowUp") view.y -= step; else if (k === "ArrowDown") view.y += step;
    else if (k === "+" || k === "=") return zoomAt(1.4); else if (k === "-") return zoomAt(1 / 1.4); else return;
    e.preventDefault(); clampView(); request();
  });
  root.querySelector("[data-map-zoom='in']").addEventListener("click", () => zoomAt(1.6));
  root.querySelector("[data-map-zoom='out']").addEventListener("click", () => zoomAt(1 / 1.6));
  root.querySelector("[data-map-home]").addEventListener("click", () => { view.x = home.x; view.y = home.y; view.s = fitScale(); request(); });
  pin.addEventListener("click", () => { card.hidden = !card.hidden; pin.setAttribute("aria-expanded", String(!card.hidden)); request(); });
  card.querySelector("[data-map-close]")?.addEventListener("click", () => { card.hidden = true; pin.setAttribute("aria-expanded", "false"); pin.focus(); });
  function disableSat() {
    sat.disabled = true; mode = "map"; root.dataset.mode = "map";
    root.querySelectorAll("[data-map-mode]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.mapMode === "map")));
    satBtn.disabled = true; satBtn.title = labels.satOff; attr.textContent = D.attribution; root.classList.add("no-sat"); request();
  }
  root.querySelectorAll("[data-map-mode]").forEach((b) => b.addEventListener("click", () => {
    if (b.disabled) return;
    mode = b.dataset.mapMode; root.dataset.mode = mode;
    root.querySelectorAll("[data-map-mode]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    attr.textContent = mode === "sat" ? `${D.attribution}. ${labels.satAttr}` : D.attribution;
    request();
  }));
  attr.textContent = D.attribution;
  new ResizeObserver(resize).observe(root);
  resize();
  root.classList.add("is-ready");
}

// Mount every map on the page once it comes near the screen.
for (const el of document.querySelectorAll("[data-map]")) {
  const io = new IntersectionObserver(([e]) => {
    if (!e.isIntersecting) return; io.disconnect();
    mountMap(el, { url: el.dataset.map, labels: JSON.parse(el.dataset.labels || "{}") }).catch(() => el.classList.add("is-failed"));
  }, { rootMargin: "300px 0px" });
  io.observe(el);
}
