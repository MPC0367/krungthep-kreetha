// Illustrative 3D hole model built from a traced land-cover raster (scripts/trace-holes.mjs).
// It renders on demand, pauses when hidden, and disposes every GPU resource when switched.
// Flat terrain is assumed: the club has not supplied elevation data, so no slopes are invented.
import * as THREE from "../vendor/three/three.module.min.js";
import { OrbitControls } from "../vendor/three/OrbitControls.js";

const CLS = ["out", "rough", "fairway", "green", "tee", "bunker", "water", "trees", "path", "redline", "ink"];
const HEIGHT = { out: -2.6, rough: 0, fairway: 0.08, green: 0.22, tee: 0.45, bunker: -0.55, water: -0.95, trees: 0.04, path: 0.03, redline: 0, ink: 0 };
const COLOR = { out: "#E6E2D2", rough: "#6E8B50", fairway: "#93B567", green: "#B9D47C", tee: "#A7C978", bunker: "#E3D5B4", water: "#2F5566", trees: "#4F6B3A", path: "#C9C5B6", redline: "#6E8B50", ink: "#6E8B50" };
const YD = 0.9144;

export function decodeRaster(rle, n) {
  const out = new Uint8Array(n); let i = 0;
  for (const tok of rle.split(".")) { const c = parseInt(tok[0], 16); const k = parseInt(tok.slice(1), 36); out.fill(c, i, i + k); i += k; }
  return out;
}
export function webglAvailable() {
  try { const c = document.createElement("canvas"); return !!(window.WebGL2RenderingContext && c.getContext("webgl2")) || !!c.getContext("webgl"); } catch { return false; }
}

function gradientTexture(stops, h = 256) {
  const c = document.createElement("canvas"); c.width = 4; c.height = h;
  const g = c.getContext("2d"); const gr = g.createLinearGradient(0, 0, 0, h);
  for (const [o, col] of stops) gr.addColorStop(o, col);
  g.fillStyle = gr; g.fillRect(0, 0, 4, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function mergeGeometries(list) {
  const parts = list.map((g) => (g.index ? g.toNonIndexed() : g));
  const n = parts.reduce((sum, g) => sum + g.attributes.position.count, 0);
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3); let o = 0;
  for (const g of parts) { pos.set(g.attributes.position.array, o * 3); nor.set(g.attributes.normal.array, o * 3); o += g.attributes.position.count; }
  const out = new THREE.BufferGeometry(); out.setAttribute("position", new THREE.BufferAttribute(pos, 3)); out.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
  return out;
}
/** A broadleaf canopy: four overlapping rounded lobes, like the rain trees along Bangkok fairways. */
function canopyGeometry() {
  const lobe = (r, x, y, z) => new THREE.IcosahedronGeometry(r, 1).translate(x, y, z);
  return mergeGeometries([lobe(1, 0, 0, 0), lobe(0.72, 0.62, -0.18, 0.22), lobe(0.74, -0.5, -0.12, -0.38), lobe(0.62, 0.08, 0.48, -0.1), lobe(0.6, -0.2, -0.2, 0.62)]);
}

export class HoleScene {
  constructor(container, { onLabel, reducedMotion = false, isTouch = false, transparent = false } = {}) {
    this.container = container;
    this.transparent = transparent;
    this.reduced = reducedMotion;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: transparent, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.canvas = this.renderer.domElement;
    this.canvas.setAttribute("aria-hidden", "true");
    this.canvas.tabIndex = -1;
    container.prepend(this.canvas);
    this.scene = new THREE.Scene();
    // Transparent mode lets the page background show around the model (home page); otherwise a soft table colour.
    if (transparent) this.renderer.setClearColor(0x000000, 0);
    else { this.scene.background = gradientTexture([[0, "#D6E3E8"], [0.55, "#E9ECE4"], [1, "#EEEBDD"]]); this.scene.fog = new THREE.Fog("#EEEBDD", 700, 1600); }
    // Soft daylight from a sky-to-grass gradient, so greens, sand and water pick up natural tones and sheen.
    try {
      const pm = new THREE.PMREMGenerator(this.renderer); const env = gradientTexture([[0, "#CFE0EA"], [0.48, "#F4F2E9"], [0.52, "#B9C49A"], [1, "#6E7F52"]]);
      env.mapping = THREE.EquirectangularReflectionMapping; this.scene.environment = pm.fromEquirectangular(env).texture; this.scene.environmentIntensity = 0.55; env.dispose(); pm.dispose();
    } catch {}
    this.camera = new THREE.PerspectiveCamera(38, 1, 1, 5000);
    this.controls = new OrbitControls(this.camera, this.canvas);
    Object.assign(this.controls, { enableDamping: !reducedMotion, dampingFactor: 0.09, screenSpacePanning: false, maxPolarAngle: 1.42, minDistance: 12, rotateSpeed: 0.6, zoomSpeed: 0.9, enableZoom: false });
    this.controls.touches = { ONE: null, TWO: THREE.TOUCH.DOLLY_PAN };
    this.controls.addEventListener("change", () => this.request());
    // Once the visitor moves the model it is no longer "the top view"; the Top view button brings it back.
    this.controls.addEventListener("start", () => { this.current = null; this.tween = null; this.container.dispatchEvent(new CustomEvent("scene:moved", { bubbles: true })); });
    const hemi = new THREE.HemisphereLight("#FBFAF5", "#55663F", 1.1);
    const sun = new THREE.DirectionalLight("#FFF2DC", 2.8); sun.position.set(-300, 500, 260);
    sun.castShadow = true; sun.shadow.mapSize.set(isTouch ? 1024 : 2048, isTouch ? 1024 : 2048); sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.5; sun.shadow.radius = 3;
    this.sun = sun;
    this.scene.add(hemi, sun, sun.target);
    this.layers = {};
    this.labels = [];
    this.onLabel = onLabel;
    this.raf = 0; this.tween = null; this.visible = true;
    this.resize = this.resize.bind(this);
    this.ro = new ResizeObserver(this.resize); this.ro.observe(container);
    this.io = new IntersectionObserver(([e]) => { this.visible = e.isIntersecting; if (this.visible) this.request(); }, { threshold: 0.01 });
    this.io.observe(container);
    this.onVis = () => { if (!document.hidden) this.request(); };
    document.addEventListener("visibilitychange", this.onVis);
    this.canvas.addEventListener("webglcontextlost", (e) => { e.preventDefault(); this.lost = true; this.container.dispatchEvent(new CustomEvent("scene:lost", { bubbles: true })); });
    this.resize();
  }

  setEngaged(on) {
    this.controls.enableZoom = on;
    this.controls.touches.ONE = on ? THREE.TOUCH.ROTATE : null;
    this.canvas.style.touchAction = on ? "none" : "pan-y";
  }

  resize() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    // Keep the top view framed like the 2D sheet when the box changes size.
    if (this.data && this.current === "top" && !this.tween) this.preset("top", { instant: true });
    this.request();
  }

  request() { if (!this.raf && !this.disposed) this.raf = requestAnimationFrame(() => this.frame()); }
  frame() {
    this.raf = 0;
    if (!this.visible || document.hidden || this.lost) return;
    let moving = this.controls.update();
    if (this.tween) moving = this.stepTween() || moving;
    if (this.shots) moving = this.stepShots() || moving;
    this.renderer.render(this.scene, this.camera);
    this.updateLabels();
    if (moving) this.request();
  }

  /** The diagram picture for a hole, loaded once and uploaded to the graphics card ahead of use. */
  texture(url) {
    if (!this.texCache) this.texCache = new Map();
    if (!this.texCache.has(url)) {
      const pr = new Promise((res, rej) => new THREE.TextureLoader().load(url, (tx) => {
        tx.colorSpace = THREE.SRGBColorSpace; tx.anisotropy = this.renderer.capabilities.getMaxAnisotropy(); tx.generateMipmaps = true; tx.minFilter = THREE.LinearMipmapLinearFilter;
        try { this.renderer.initTexture(tx); } catch {}
        res(tx);
      }, undefined, rej));
      pr.catch(() => this.texCache.delete(url));
      this.texCache.set(url, pr);
    }
    return this.texCache.get(url);
  }

  clearHole() {
    for (const obj of [...this.scene.children]) if (obj.userData.hole) { this.scene.remove(obj); obj.traverse((o) => { o.geometry?.dispose(); (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m?.dispose?.()); }); }
    this.labels.forEach((l) => l.el.remove()); this.labels = [];
    this.layers = {};
  }

  /** Build the hole. `data` is public/data/holes/hole-NN.json. */
  load(data, { tee = "1", carryYards = 220, enabled = {}, texture = null, distances = null } = {}) {
    this.textured = !!texture;
    this.distances = distances; // { tees: [{id, yards}], approach: [yards...], approx }
    this.clearHole();
    this.data = data;
    const { w: GW, h: GH, cellPx } = data.grid;
    const grid = decodeRaster(data.raster, GW * GH);
    this.grid = grid;
    const m = data.scale.mPerPx; this.m = m;
    const [bx0, by0, bx1, by1] = data.bbox;
    const cx = (bx0 + bx1) / 2, cy = (by0 + by1) / 2;
    this.toWorld = (x, y, h = 0) => new THREE.Vector3((x - cx) * m, h, (y - cy) * m);
    const i0 = Math.max(0, Math.floor(bx0 / cellPx) - 2), j0 = Math.max(0, Math.floor(by0 / cellPx) - 2);
    const i1 = Math.min(GW, Math.ceil(bx1 / cellPx) + 2), j1 = Math.min(GH, Math.ceil(by1 / cellPx) + 2);
    const cw = i1 - i0, ch = j1 - j0;
    const cls = (i, j) => (i < 0 || j < 0 || i >= GW || j >= GH ? 0 : grid[j * GW + i]);
    this.enabled = { fairway: true, green: true, bunker: true, water: true, trees: true, path: true, tees: true, redline: true, line: true, carry: false, labels: true, ...enabled };

    // Vertex heights from the four neighbouring cells, then a light blur for soft edges.
    const VW = cw + 1, VH = ch + 1;
    let hgt = new Float32Array(VW * VH);
    for (let vj = 0; vj < VH; vj++) for (let vi = 0; vi < VW; vi++) {
      let s = 0, sand = 0;
      for (const [di, dj] of [[-1, -1], [0, -1], [-1, 0], [0, 0]]) { const c = CLS[cls(i0 + vi + di, j0 + vj + dj)]; s += HEIGHT[c] ?? 0; if (c === "bunker") sand++; }
      hgt[vj * VW + vi] = s / 4 + (sand && sand < 4 ? 0.38 : 0);
    }
    for (let pass = 0; pass < 2; pass++) {
      const nx = hgt.slice();
      for (let vj = 1; vj < VH - 1; vj++) for (let vi = 1; vi < VW - 1; vi++) { const k = vj * VW + vi; nx[k] = (hgt[k] * 4 + hgt[k - 1] + hgt[k + 1] + hgt[k - VW] + hgt[k + VW]) / 8; }
      hgt = nx;
    }
    // Gentle dome on the putting surface (shape only; contours are not surveyed).
    const g = data.green; const gr = Math.max(g.dims[0], g.dims[1]) / 2 / data.scale.ydPerPx;
    for (let vj = 0; vj < VH; vj++) for (let vi = 0; vi < VW; vi++) {
      const px = (i0 + vi) * cellPx, py = (j0 + vj) * cellPx; const d = Math.hypot(px - g.x, py - g.y) / gr;
      if (d < 1) hgt[vj * VW + vi] += 0.35 * (1 - d * d);
    }
    this.heightAt = (x, y) => { const vi = Math.round(x / cellPx) - i0, vj = Math.round(y / cellPx) - j0; return vi >= 0 && vj >= 0 && vi < VW && vj < VH ? hgt[vj * VW + vi] : 0; };

    const pos = new Float32Array(VW * VH * 3);
    for (let vj = 0; vj < VH; vj++) for (let vi = 0; vi < VW; vi++) {
      const k = vj * VW + vi; const w = this.toWorld((i0 + vi) * cellPx, (j0 + vj) * cellPx, hgt[k]);
      pos.set([w.x, w.y, w.z], k * 3);
    }
    const idx = [];
    const near = (i, j) => { for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) if (cls(i + di, j + dj) !== 0) return true; return false; };
    for (let j = 0; j < ch; j++) for (let i = 0; i < cw; i++) {
      if (texture ? !near(i0 + i, j0 + j) : cls(i0 + i, j0 + j) === 0) continue;
      const a = j * VW + i, b = a + 1, c = a + VW, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setIndex(idx);
    this.terrainInfo = { VW, VH, i0, j0, cls, cellPx };
    if (!texture) geo.setAttribute("color", new THREE.BufferAttribute(this.colors(), 3));
    // UVs map the club diagram (832 x 1248) onto the terrain so the model reads at full image resolution.
    const uv = new Float32Array(VW * VH * 2);
    for (let vj = 0; vj < VH; vj++) for (let vi = 0; vi < VW; vi++) { const k = vj * VW + vi; uv[k * 2] = ((i0 + vi) * cellPx) / (GW * cellPx); uv[k * 2 + 1] = 1 - ((j0 + vj) * cellPx) / (GH * cellPx); }
    geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ vertexColors: !texture, roughness: 0.92, metalness: 0, alphaTest: texture ? 0.5 : 0 });
    // When the model is on screen, the shot lines draw themselves from the tee.
    const ready = () => { if (this.data !== data) return; this.startShots(); this.container.dispatchEvent(new CustomEvent("scene:ready", { bubbles: true })); };
    const useTex = (tx) => { if (this.data !== data) return; mat.map = tx; mat.emissive = new THREE.Color("#FFFFFF"); mat.emissiveMap = tx; mat.emissiveIntensity = 0.12; mat.needsUpdate = true; this.request(); ready(); };
    const noTex = () => { if (this.data !== data) return; this.textured = false; geo.setAttribute("color", new THREE.BufferAttribute(this.colors(), 3)); mat.vertexColors = true; mat.alphaTest = 0; mat.needsUpdate = true; this.request(); ready(); };
    if (texture && typeof texture === "object") queueMicrotask(() => useTex(texture));
    else if (texture) this.texture(texture).then(useTex, noTex);
    else queueMicrotask(ready);
    const terrain = new THREE.Mesh(geo, mat);
    terrain.userData.hole = true; terrain.receiveShadow = true; this.terrain = terrain;
    this.scene.add(terrain);

    // Table under the model
    const span = Math.max((bx1 - bx0), (by1 - by0)) * m;
    this.span = span;
    { const sc = this.sun.shadow.camera; const half = span * 0.62; Object.assign(sc, { left: -half, right: half, top: half, bottom: -half, near: 10, far: span * 4 }); sc.updateProjectionMatrix();
      this.sun.position.set(-span * 0.45, span * 1.1, span * 0.38); this.sun.target.position.set(0, 0, 0); }
    if (!this.transparent) {
      const base = new THREE.Mesh(new THREE.CircleGeometry(span * 0.95, 64), new THREE.MeshStandardMaterial({ color: "#E2DECB", roughness: 1 }));
      base.rotation.x = -Math.PI / 2; base.position.y = -2.7; base.receiveShadow = true; base.userData.hole = true; this.scene.add(base);
    }

    // Water surface
    const wpos = [];
    for (let j = 0; j < ch; j++) for (let i = 0; i < cw; i++) {
      if (CLS[cls(i0 + i, j0 + j)] !== "water") continue;
      const x0 = (i0 + i) * cellPx, y0 = (j0 + j) * cellPx, x1 = x0 + cellPx, y1 = y0 + cellPx;
      const p = [this.toWorld(x0, y0, -0.32), this.toWorld(x1, y0, -0.32), this.toWorld(x0, y1, -0.32), this.toWorld(x1, y1, -0.32)];
      wpos.push(...p[0].toArray(), ...p[2].toArray(), ...p[1].toArray(), ...p[1].toArray(), ...p[2].toArray(), ...p[3].toArray());
    }
    if (wpos.length) {
      const wg = new THREE.BufferGeometry(); wg.setAttribute("position", new THREE.Float32BufferAttribute(wpos, 3)); wg.computeVertexNormals();
      const water = new THREE.Mesh(wg, new THREE.MeshPhysicalMaterial({ color: "#3F6E80", roughness: 0.06, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.08, envMapIntensity: 1.4, transparent: true, opacity: texture ? 0.42 : 0.9 }));
      water.userData.hole = true; this.layers.water = water; this.scene.add(water);
    }

    // Trees: instanced canopies on traced tree cells (sampled, deterministic jitter).
    const treeCells = [];
    for (let j = 0; j < GH; j += 3) for (let i = 0; i < GW; i += 3) if (CLS[cls(i, j)] === "trees") treeCells.push([i, j]);
    const cap = Math.min(treeCells.length, matchMedia("(max-width: 760px)").matches ? 700 : 1400);
    // Points along every shot arc (each tee to the landing zone, then the approach), so trees in a shot's
    // path can be left out: the shots fly clear from the tee boxes, as the club's drawing shows them.
    const W0 = (p) => this.toWorld(p.x, p.y, this.heightAt(p.x, p.y) + 0.4);
    const route = [...data.line.map(([x, y]) => ({ x, y })), { x: g.x, y: g.y }].map(W0);
    const pairs = [...data.tees.map((tt) => [W0(tt), route[0]]), ...route.slice(1).map((b, i) => [route[i], b])];
    const arcPts = pairs.flatMap(([a, b]) => { const apex = THREE.MathUtils.clamp(a.distanceTo(b) * 0.1, 3, 28); return Array.from({ length: 81 }, (_, k) => { const u = k / 80; return new THREE.Vector3().lerpVectors(a, b, u).setY(a.y + (b.y - a.y) * u + apex * 4 * u * (1 - u)); }); });
    const touches = (base, r, crown, lift) => arcPts.some((p) => {
      const dh = Math.hypot(p.x - base.x, p.z - base.z);
      if (dh > r * 1.4 + 1) return false;
      const dy = p.y - lift;
      return (dh / (r * 1.4)) ** 2 + (dy / (crown * 1.25)) ** 2 < 1 || (p.y < lift && dh < r * 0.2 + 0.8); // canopy or trunk
    });
    const keep = [];
    const stepAll = treeCells.length / Math.max(cap, 1);
    for (let k = 0; k < cap; k++) {
      const [i, j] = treeCells[Math.floor(k * stepAll)];
      const h1 = Math.sin(i * 12.9898 + j * 78.233) * 43758.5453 % 1, h2 = Math.sin(i * 39.34 + j * 11.13) * 9631.17 % 1, h3 = Math.abs(Math.sin(i * 7.13 + j * 3.71) * 1371.3 % 1);
      const r = 2.4 + Math.abs(h1) * 3.4; const crown = r * (0.72 + h3 * 0.2); const lift = r * 0.75 + 1.6;
      const base = this.toWorld(i * cellPx + cellPx * 1.5 + h2 * 4, j * cellPx + cellPx * 1.5 + h1 * 4, 0);
      if (!touches(base, r, crown, lift)) keep.push({ base, r, crown, lift, h2, h3 });
    }
    this.treesRemoved = cap - keep.length;
    const maxTrees = keep.length;
    if (maxTrees) {
      const canopies = new THREE.InstancedMesh(canopyGeometry(), new THREE.MeshStandardMaterial({ roughness: 0.85 }), maxTrees);
      const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.09, 0.15, 1, 7).translate(0, 0.5, 0), new THREE.MeshStandardMaterial({ color: "#5B4A3A", roughness: 0.95 }), maxTrees);
      canopies.castShadow = true; trunks.castShadow = true;
      const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), col = new THREE.Color(), up = new THREE.Vector3(0, 1, 0);
      const greens = ["#3B5A2C", "#4E6E36", "#5A7B3C", "#43622F", "#667F45"];
      keep.forEach(({ base, r, crown, lift, h2, h3 }, k) => {
        q.setFromAxisAngle(up, h3 * Math.PI * 2);
        mtx.compose(base.clone().setY(lift), q, new THREE.Vector3(r, crown, r)); canopies.setMatrixAt(k, mtx);
        mtx.compose(base, q, new THREE.Vector3(r * 0.9, lift, r * 0.9)); trunks.setMatrixAt(k, mtx);
        col.set(greens[Math.floor(h3 * greens.length) % greens.length]).offsetHSL(0, 0, (Math.abs(h2) - 0.5) * 0.05); canopies.setColorAt(k, col);
      });
      const trees = new THREE.Group(); trees.add(trunks, canopies);
      trees.userData.hole = true; this.layers.trees = trees; this.scene.add(trees);
    }

    // Penalty-area lines as drawn on the club diagram (not an approved boundary).
    const red = [];
    for (let j = 0; j < GH; j++) for (let i = 0; i < GW; i++) if (CLS[cls(i, j)] === "redline") { const p = this.toWorld(i * cellPx + cellPx / 2, j * cellPx + cellPx / 2, 0.5); red.push(p.x, p.y, p.z); }
    if (red.length) {
      const rg = new THREE.BufferGeometry(); rg.setAttribute("position", new THREE.Float32BufferAttribute(red, 3));
      const pts = new THREE.Points(rg, new THREE.PointsMaterial({ color: "#B3332E", size: Math.max(1.2, cellPx * m * 1.1), sizeAttenuation: true }));
      pts.userData.hole = true; this.layers.redline = pts; this.scene.add(pts);
    }

    // Flag at the diagram's green centre (not today's pin position).
    const flag = new THREE.Group(); flag.userData.hole = true;
    const gp = this.toWorld(g.x, g.y, this.heightAt(g.x, g.y));
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.6, 10), new THREE.MeshStandardMaterial({ color: "#F4F2E9", roughness: 0.4 }));
    pole.position.copy(gp).add(new THREE.Vector3(0, 1.3, 0)); pole.castShadow = true;
    const clothGeo = new THREE.PlaneGeometry(1.2, 0.75, 8, 1); const cp = clothGeo.attributes.position;
    for (let v = 0; v < cp.count; v++) cp.setZ(v, Math.sin((cp.getX(v) + 0.6) * 3.2) * 0.08 * (cp.getX(v) + 0.6));
    clothGeo.computeVertexNormals();
    const cloth = new THREE.Mesh(clothGeo, new THREE.MeshStandardMaterial({ color: "#1C3F94", roughness: 0.7, side: THREE.DoubleSide }));
    cloth.position.copy(gp).add(new THREE.Vector3(0.62, 2.22, 0)); cloth.castShadow = true;
    const cup = new THREE.Mesh(new THREE.CircleGeometry(0.16, 20), new THREE.MeshBasicMaterial({ color: "#10201B" }));
    cup.rotation.x = -Math.PI / 2; cup.position.copy(gp).add(new THREE.Vector3(0, 0.03, 0));
    flag.add(pole, cloth, cup); this.scene.add(flag); this.layers.flag = flag;

    // Tee markers
    const teeGroup = new THREE.Group(); teeGroup.userData.hole = true;
    const aim = data.line.length ? { x: data.line[0][0], y: data.line[0][1] } : { x: g.x, y: g.y };
    const padMat = new THREE.MeshStandardMaterial({ color: "#8DB565", roughness: 0.9 });
    const markMat = new THREE.MeshStandardMaterial({ color: "#152A24", roughness: 0.5 });
    for (const t of data.tees) {
      const ground = this.heightAt(t.x, t.y);
      const ang = Math.atan2(aim.x - t.x, aim.y - t.y);
      const pad = new THREE.Mesh(new THREE.BoxGeometry(5.5, 0.4, 7.5), padMat);
      pad.position.copy(this.toWorld(t.x, t.y, ground + 0.2)); pad.rotation.y = ang; pad.castShadow = true; pad.receiveShadow = true; teeGroup.add(pad);
      const side = new THREE.Vector3(Math.cos(ang), 0, -Math.sin(ang)).multiplyScalar(1.6), front = new THREE.Vector3(Math.sin(ang), 0, Math.cos(ang)).multiplyScalar(2.6);
      for (const sgn of [-1, 1]) { const mk = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 8), markMat); mk.position.copy(pad.position).add(side.clone().multiplyScalar(sgn)).add(front).setY(ground + 0.62); mk.castShadow = true; teeGroup.add(mk); }
      t._world = this.toWorld(t.x, t.y, ground + 0.45);
    }
    this.scene.add(teeGroup); this.layers.tees = teeGroup;
    this.greenWorld = gp;
    this.setTee(tee, { carryYards, silent: true });

    // Labels (DOM, on solid chips)
    this.addLabel("green", gp.clone().add(new THREE.Vector3(0, 4.2, 0)), "green");
    data.tees.forEach((t) => this.addLabel(`tee-${t.id}`, t._world.clone().add(new THREE.Vector3(0, 2.4, 0)), "tee", t.id));
    if (data.line.length) this.addLabel("target", this.toWorld(data.line[0][0], data.line[0][1], 3), "target");

    this.applyLayers(this.enabled);
    this.updateLabels();
    const vf = THREE.MathUtils.degToRad(this.camera.fov);
    this.topDist = (GH * cellPx * m / 2) / Math.tan(vf / 2);
    this.controls.maxDistance = Math.max(span * 1.8, this.topDist * 1.6);
    if (this.scene.fog) { this.scene.fog.near = this.topDist * 1.4; this.scene.fog.far = this.topDist * 3.2; }
    this.preset("top", { instant: true });
  }

  colors() {
    const { VW, VH, i0, j0, cls } = this.terrainInfo; const e = this.enabled;
    const off = (n) => (n === "fairway" || n === "green" || n === "bunker" || n === "path") && e[n] === false;
    const cols = new Float32Array(VW * VH * 3); const c = new THREE.Color(), tmp = new THREE.Color();
    const d = this.data; const route = [d.tees[0], ...d.line.map(([x, y]) => ({ x, y })), { x: d.green.x, y: d.green.y }];
    const ax = route[route.length - 1].x - route[0].x, ay = route[route.length - 1].y - route[0].y; const al = Math.hypot(ax, ay) || 1;
    for (let vj = 0; vj < VH; vj++) for (let vi = 0; vi < VW; vi++) {
      c.setRGB(0, 0, 0); let n = 0, nearTrees = 0;
      for (const [di, dj] of [[-1, -1], [0, -1], [-1, 0], [0, 0]]) {
        let name = CLS[cls(i0 + vi + di, j0 + vj + dj)];
        if (name === "trees") nearTrees++;
        if (off(name) || name === "trees" || name === "redline" || name === "ink") name = "rough";
        tmp.set(COLOR[name]); c.add(tmp); n++;
      }
      c.multiplyScalar(1 / n);
      const px = (i0 + vi) * this.terrainInfo.cellPx, py = (j0 + vj) * this.terrainInfo.cellPx;
      const along = ((px - route[0].x) * ax + (py - route[0].y) * ay) / al * this.m;
      const own = CLS[cls(i0 + vi, j0 + vj)];
      if (own === "fairway" && e.fairway !== false) c.multiplyScalar(1 + 0.055 * Math.sign(Math.sin(along / 7)));
      if (own === "green" && e.green !== false) c.multiplyScalar(1 + 0.03 * Math.sign(Math.sin(along / 2.2)));
      if (own === "rough") c.multiplyScalar(0.96 + 0.06 * Math.abs(Math.sin(px * 0.37) * Math.cos(py * 0.29)));
      if (nearTrees) c.multiplyScalar(1 - 0.08 * nearTrees);
      cols.set([c.r, c.g, c.b], (vj * VW + vi) * 3);
    }
    return cols;
  }

  applyLayers(enabled) {
    this.enabled = { ...this.enabled, ...enabled };
    const e = this.enabled;
    if (this.layers.water) this.layers.water.visible = e.water;
    if (this.layers.trees) this.layers.trees.visible = e.trees;
    if (this.layers.redline) this.layers.redline.visible = e.redline;
    if (this.layers.tees) this.layers.tees.visible = e.tees;
    if (this.layers.line) this.layers.line.visible = e.line;
    if (this.layers.carry) this.layers.carry.visible = e.carry;
    if (!this.textured) { this.terrain.geometry.attributes.color.array.set(this.colors()); this.terrain.geometry.attributes.color.needsUpdate = true; }
    // Only the selected tee carries a floating label; the others stay as markers and are listed in the panel.
    this.labels.forEach((l) => { l.hidden = !e.labels || (l.kind === "tee" && (!e.tees || l.id !== `tee-${this.tee?.id}`)) || (l.kind === "target" && !e.line) || (l.kind === "carry" && !e.carry) || (l.kind === "arc" && (!e.line || l.pending)); });
    this.request();
  }

  setTee(teeId, { carryYards = this.carryYards || 220, silent = false } = {}) {
    const d = this.data; const t = d.tees.find((x) => x.id === teeId) || d.tees[0];
    this.tee = t; this.carryYards = carryYards;
    for (const k of ["line", "carry"]) if (this.layers[k]) { this.scene.remove(this.layers[k]); this.layers[k].traverse((o) => { o.geometry?.dispose(); o.material?.dispose?.(); }); }
    const W = (p) => this.toWorld(p.x, p.y, this.heightAt(p.x, p.y) + 0.4);
    const pts = [t, ...d.line.map(([x, y]) => ({ x, y })), { x: d.green.x, y: d.green.y }].map(W);
    // The diagram's lines are shots: from every tee box an arc flies to the landing zone (the green on a par 3),
    // then the approach flies on to the green. Arcs peak at about a tenth of their length. An illustration of
    // the club's drawn lines, not a measured trajectory.
    const group = new THREE.Group(); group.userData.hole = true;
    const radius = Math.max(0.22, (this.span || 400) * 0.0007);
    const mat = (o) => new THREE.MeshBasicMaterial({ color: "#FFFFFF", transparent: true, opacity: o, depthWrite: false });
    const arc = (a, b, r, material) => {
      const dist = a.distanceTo(b); const apex = THREE.MathUtils.clamp(dist * 0.1, 3, 28);
      const samples = []; for (let k = 0; k <= 40; k++) { const u = k / 40; samples.push(new THREE.Vector3().lerpVectors(a, b, u).setY(a.y + (b.y - a.y) * u + apex * 4 * u * (1 - u))); }
      const curve = new THREE.CatmullRomCurve3(samples);
      const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 96, r, 6, false), material); tube.renderOrder = 3;
      return { tube, curve, total: tube.geometry.index.count, dist };
    };
    const ringAt = (at) => { const m = new THREE.Mesh(new THREE.RingGeometry(radius * 3, radius * 5.2, 32), mat(0.9)); m.material.side = THREE.DoubleSide; m.rotation.x = -Math.PI / 2; m.position.copy(at).setY(at.y + 0.12); return m; };
    const landing = pts[1];
    const legs = [];
    let teeDur = 0;
    for (const tt of d.tees) {
      const main = tt.id === t.id;
      const lg = arc(W(tt), landing, main ? radius : radius * 0.7, mat(main ? 0.97 : 0.5));
      const dur = 700 + lg.dist * 2.2; teeDur = Math.max(teeDur, dur);
      group.add(lg.tube); legs.push({ ...lg, start: 0, dur, main });
    }
    const landRing = ringAt(landing); group.add(landRing); legs[0].land = null;
    // Each arc carries its distance, as the club's diagram prints it on the drawn line.
    this.labels = this.labels.filter((l) => { if (l.kind === "arc") { l.el.remove(); return false; } return true; });
    const D = this.distances; const sumApp = D?.approach?.reduce((s, v) => s + v, 0) || 0;
    const arcLabel = (leg, id, yards, main) => { if (yards == null || !(yards > 0)) return; const at = leg.curve.getPointAt(0.5).add(new THREE.Vector3(0, 1.2, 0)); this.addLabel(id, at, "arc", { yards, main, approx: !!D?.approx }); const l = this.labels[this.labels.length - 1]; if (l?.id === id) { l.leg = leg; l.pending = true; } };
    if (D) d.tees.forEach((tt, i) => { const y = D.tees?.find((x) => x.id === tt.id)?.yards; arcLabel(legs[i], `arc-tee-${tt.id}`, y != null ? y - sumApp : null, tt.id === t.id); });
    let at = teeDur + 180;
    for (let i = 2; i < pts.length; i++) {
      const lg = arc(pts[i - 1], pts[i], radius, mat(0.97)); const dur = 650 + lg.dist * 2.2;
      group.add(lg.tube); legs.push({ ...lg, start: at, dur, main: true }); at += dur + 120;
    }
    const greenRing = pts.length > 2 ? ringAt(pts[pts.length - 1]) : null; if (greenRing) group.add(greenRing);
    if (D?.approach?.length) legs.slice(d.tees.length).forEach((leg, i) => arcLabel(leg, `arc-app-${i}`, D.approach[i], true));
    const ball = new THREE.Mesh(new THREE.SphereGeometry(radius * 2.6, 16, 12), new THREE.MeshBasicMaterial({ color: "#FFFFFF" })); ball.visible = false; group.add(ball);
    this.layers.line = group; this.scene.add(group);
    this.shotLegs = legs; this.shotBall = ball; this.shotRings = { landing: landRing, landAt: teeDur, green: greenRing, greenAt: at - 120 };
    this.shotTotal = Math.max(teeDur, at - 120);
    this.showShots(1);
    // Illustrative carry arc around the first leg of the line of play.
    const first = pts[1]; const dir = Math.atan2(first.z - pts[0].z, first.x - pts[0].x);
    const r = carryYards * YD; const spread = 0.42;
    const ring = new THREE.RingGeometry(r - 2.2, r + 2.2, 48, 1, -dir - spread, spread * 2);
    const carry = new THREE.Mesh(ring, new THREE.MeshBasicMaterial({ color: "#254E3D", transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false }));
    carry.rotation.x = -Math.PI / 2; carry.position.set(pts[0].x, 1.2, pts[0].z); carry.userData.hole = true;
    this.layers.carry = carry; this.scene.add(carry);
    const lbl = this.labels.find((l) => l.id === "carry");
    const cpos = new THREE.Vector3(pts[0].x + Math.cos(dir) * r, 3, pts[0].z + Math.sin(dir) * r);
    if (lbl) lbl.pos.copy(cpos); else this.addLabel("carry", cpos, "carry");
    if (this.enabled && this.terrain) this.applyLayers({});
    if (!silent) { this.startShots(); this.request(); }
  }

  /** Draw the shot lines to a given progress (0 to 1 of the whole sequence). */
  showShots(progress) {
    const legs = this.shotLegs || []; const T = progress * (this.shotTotal || 1);
    let head = null;
    for (const l of legs) {
      const f = THREE.MathUtils.clamp((T - l.start) / l.dur, 0, 1);
      l.tube.geometry.setDrawRange(0, Math.floor((l.total / 6) * f) * 6);
      l.f = f;
      if (l.main && f > 0 && f < 1) head = l.curve.getPointAt(f);
    }
    const e = this.enabled || {};
    for (const lb of this.labels) if (lb.kind === "arc") { lb.pending = !(lb.leg?.f >= 0.5); lb.hidden = !e.labels || !e.line || lb.pending; }
    const r = this.shotRings;
    if (r) { r.landing.visible = T >= r.landAt; if (r.green) r.green.visible = T >= r.greenAt; }
    if (this.shotBall) { this.shotBall.visible = !!head; if (head) this.shotBall.position.copy(head); }
  }
  /** Replay the shot lines from the tee (shown complete at once with reduced motion). */
  startShots() {
    if (!this.shotLegs?.length) return;
    if (this.reduced) { this.shots = null; this.showShots(1); this.request(); return; }
    this.showShots(0);
    this.shots = { t0: performance.now() + 250, total: this.shotTotal };
    this.request();
  }
  stepShots() {
    const k = (performance.now() - this.shots.t0) / this.shots.total;
    if (k < 0) return true;
    this.showShots(Math.min(1, k));
    if (k >= 1) { this.shots = null; return false; }
    return true;
  }

  addLabel(id, pos, kind, extra) {
    const el = this.onLabel?.(kind, extra);
    if (!el) return;
    this.container.querySelector("[data-labels]")?.append(el);
    this.labels.push({ id, pos, el, kind });
  }
  updateLabels() {
    const w = this.container.clientWidth, h = this.container.clientHeight; const v = new THREE.Vector3();
    for (const l of this.labels) {
      v.copy(l.pos).project(this.camera);
      const off = l.hidden || v.z > 1 || v.x < -1.1 || v.x > 1.1 || v.y < -1.1 || v.y > 1.1;
      l.el.hidden = off;
      if (!off) l.el.style.transform = `translate(${((v.x + 1) / 2 * w).toFixed(1)}px, ${((1 - v.y) / 2 * h).toFixed(1)}px) translate(-50%, -100%)`;
    }
  }

  /** Camera presets derived from the hole's own geometry. */
  preset(name, { instant = false } = {}) {
    const d = this.data, T = this.tee._world, G = this.greenWorld;
    const firstTarget = d.line.length ? this.toWorld(d.line[0][0], d.line[0][1], 0) : G.clone();
    const lastFrom = d.line.length ? this.toWorld(d.line[d.line.length - 1][0], d.line[d.line.length - 1][1], 0) : T.clone();
    const dirTo = (a, b) => new THREE.Vector3().subVectors(b, a).setY(0).normalize();
    let pos, target;
    // Cameras sit above the tree canopies (about 12 m) so the line of play stays visible.
    if (name === "top") {
      // Straight down with the diagram's top at the top of the screen, framed like the whole 2D sheet
      // (object-fit: contain), so switching between 2D and 3D keeps every feature in the same place.
      const { w: GW, h: GH, cellPx } = d.grid; const c = this.toWorld(GW * cellPx / 2, GH * cellPx / 2, 0);
      const w = GW * cellPx * this.m, h = GH * cellPx * this.m; const vf = THREE.MathUtils.degToRad(this.camera.fov);
      const dist = Math.max((h / 2) / Math.tan(vf / 2), (w / 2) / (Math.tan(vf / 2) * this.camera.aspect));
      pos = c.clone().setY(dist).add(new THREE.Vector3(0, 0, 0.01)); target = c;
    } else if (name === "tee") { const dir = dirTo(T, firstTarget); pos = T.clone().addScaledVector(dir, -22).setY(T.y + 24); target = T.clone().addScaledVector(dir, 170).setY(0); }
    else if (name === "landing") { const dir = dirTo(T, firstTarget); pos = firstTarget.clone().addScaledVector(dir, -70).setY(52); target = firstTarget.clone().addScaledVector(dir, 30); }
    else if (name === "approach") { const dir = dirTo(lastFrom, G); const back = Math.min(130, G.distanceTo(lastFrom)); pos = G.clone().addScaledVector(dir, -back).setY(36); target = G.clone(); }
    else if (name === "green") { const dir = dirTo(lastFrom, G); pos = G.clone().addScaledVector(dir, -44).setY(34); target = G.clone(); }
    else {
      // Fit the whole hole: landscape screens see it side-on (tee left, green right), portrait screens look along it.
      const tee1 = this.data.tees[0]._world;
      const c = new THREE.Vector3().addVectors(tee1, G).multiplyScalar(0.5).setY(0);
      const L = Math.max(tee1.distanceTo(G), 60) * 1.12;
      const dir = dirTo(tee1, G); const side = new THREE.Vector3(-dir.z, 0, dir.x);
      const vfov = THREE.MathUtils.degToRad(this.camera.fov); const hfov = 2 * Math.atan(Math.tan(vfov / 2) * this.camera.aspect);
      if (this.camera.aspect >= 1) { const d = (L / 2) / Math.tan(hfov / 2) * 1.16; pos = c.clone().addScaledVector(side, d * 0.78).setY(d * 0.6); target = c.clone(); }
      else { const d = (L / 2) / Math.tan(vfov / 2) * 1.02; pos = c.clone().addScaledVector(dir, -d * 0.5).setY(d * 0.87); target = c; }
    }
    this.current = name;
    if (instant || this.reduced) { this.camera.position.copy(pos); this.controls.target.copy(target); this.tween = null; this.controls.update(); this.request(); return; }
    this.tween = { from: this.camera.position.clone(), fromT: this.controls.target.clone(), to: pos, toT: target, t0: performance.now(), dur: 560 };
    this.request();
  }
  stepTween() {
    const tw = this.tween; const k = Math.min(1, (performance.now() - tw.t0) / tw.dur); const e = 1 - Math.pow(1 - k, 3);
    this.camera.position.lerpVectors(tw.from, tw.to, e); this.controls.target.lerpVectors(tw.fromT, tw.toT, e);
    if (k >= 1) this.tween = null;
    return !!this.tween;
  }
  zoom(f) { const off = new THREE.Vector3().subVectors(this.camera.position, this.controls.target).multiplyScalar(f); const len = off.length(); if (len < this.controls.minDistance || len > this.controls.maxDistance) return; this.camera.position.copy(this.controls.target).add(off); this.request(); }
  orbit(dx) { const off = new THREE.Vector3().subVectors(this.camera.position, this.controls.target); off.applyAxisAngle(new THREE.Vector3(0, 1, 0), dx); this.camera.position.copy(this.controls.target).add(off); this.request(); }
  /** Heading of the camera in degrees, for the compass. Diagram "up" is shown as north-up of the drawing, not true north. */
  heading() { const v = new THREE.Vector3(); this.camera.getWorldDirection(v); return Math.atan2(v.x, -v.z) * 180 / Math.PI; }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.clearHole();
    this.scene.traverse((o) => { o.geometry?.dispose(); o.material?.dispose?.(); });
    this.texCache?.forEach((pr) => pr.then((tx) => tx.dispose(), () => {}));
    this.controls.dispose(); this.renderer.dispose(); this.renderer.forceContextLoss?.();
    this.ro.disconnect(); this.io.disconnect(); document.removeEventListener("visibilitychange", this.onVis);
    this.canvas.remove();
  }
}
