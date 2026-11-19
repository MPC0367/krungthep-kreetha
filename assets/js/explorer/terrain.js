// Ground surface for the illustrative hole model, built from the traced land-cover raster.
// No three.js here, so the same code runs in the browser and in the Node checks (tests/terrain.test.mjs).
//
// The base ground follows the traced classes (water low, tees and greens a little raised) and is softened.
// Bunkers are then carved as hollows: each connected sand area gets a signed distance field (positive
// inside, measured from the traced edge), and the surface is lowered through a turf lip, a sloping sand
// face and a recessed floor, scaled to that bunker's own width. The mesh is refined only where a bunker
// changes the surface, on one shared lattice, so refined and plain cells meet without cracks.
// Depth, lip and face widths are artistic choices: the club has published no elevation data.

export const CLS = ["out", "rough", "fairway", "green", "tee", "bunker", "water", "trees", "path", "redline", "ink"];
const HEIGHT = { out: -2.6, rough: 0, fairway: 0.08, green: 0.22, tee: 0.45, bunker: 0.04, water: -0.95, trees: 0.04, path: 0.03, redline: 0, ink: 0 };
/** Artistic bunker parameters, in metres (internal; not shown to visitors). */
export const SAND = { lipW: 1.4, lipH: 0.24, depthK: 0.42, depthMin: 0.55, depthMax: 1.7, faceK: 0.5, faceMin: 0.9, faceMax: 3.2, floorVar: 0.04, subdiv: 3 };

export function decodeRaster(rle, n) {
  const out = new Uint8Array(n); let i = 0;
  for (const tok of rle.split(".")) { const c = parseInt(tok[0], 16); const k = parseInt(tok.slice(1), 36); out.fill(c, i, i + k); i += k; }
  return out;
}

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

// Squared Euclidean distance transform (Felzenszwalb and Huttenlocher), distances in cells, centre to centre.
function edt1d(f, n, d, v, z) {
  let k = 0; v[0] = 0; z[0] = -Infinity; z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) { k--; s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
    k++; v[k] = q; z[k] = s; z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) { while (z[k + 1] < q) k++; d[q] = (q - v[k]) * (q - v[k]) + f[v[k]]; }
}
function edt(mask, w, h) {
  const INF = 1e10, g = new Float64Array(w * h), n = Math.max(w, h);
  const f = new Float64Array(n), d = new Float64Array(n), v = new Int32Array(n), z = new Float64Array(n + 1);
  for (let x = 0; x < w; x++) { for (let y = 0; y < h; y++) f[y] = mask[y * w + x] ? 0 : INF; edt1d(f, h, d, v, z); for (let y = 0; y < h; y++) g[y * w + x] = d[y]; }
  for (let y = 0; y < h; y++) { for (let x = 0; x < w; x++) f[x] = g[y * w + x]; edt1d(f, w, d, v, z); for (let x = 0; x < w; x++) g[y * w + x] = d[x]; }
  return g;
}

/**
 * Build the ground for one hole. `data` is public/data/holes/hole-NN.json.
 * Returns typed arrays for a three.js BufferGeometry plus heightAt(x, y) in diagram pixels,
 * which interpolates exactly as the rendered triangles do.
 */
export function buildTerrain(data, { textured = true, sand = true, subdiv = SAND.subdiv } = {}) {
  const { w: GW, h: GH, cellPx } = data.grid;
  const grid = decodeRaster(data.raster, GW * GH);
  const m = data.scale.mPerPx, cellM = cellPx * m;
  const [bx0, by0, bx1, by1] = data.bbox;
  const cx = (bx0 + bx1) / 2, cy = (by0 + by1) / 2;
  const i0 = Math.max(0, Math.floor(bx0 / cellPx) - 2), j0 = Math.max(0, Math.floor(by0 / cellPx) - 2);
  const i1 = Math.min(GW, Math.ceil(bx1 / cellPx) + 2), j1 = Math.min(GH, Math.ceil(by1 / cellPx) + 2);
  const cw = i1 - i0, ch = j1 - j0;
  const cls = (i, j) => (i < 0 || j < 0 || i >= GW || j >= GH ? 0 : grid[j * GW + i]);
  const BUNKER = CLS.indexOf("bunker"), WATER = CLS.indexOf("water");

  // 1. Base ground: vertex heights from the four cells around each vertex (sand counts as turf here),
  //    two soft passes, then a gentle dome on the putting surface (shape only; contours are not surveyed).
  const VW = cw + 1, VH = ch + 1;
  let hgt = new Float32Array(VW * VH);
  for (let vj = 0; vj < VH; vj++) for (let vi = 0; vi < VW; vi++) {
    let s = 0;
    for (const [di, dj] of [[-1, -1], [0, -1], [-1, 0], [0, 0]]) s += HEIGHT[CLS[cls(i0 + vi + di, j0 + vj + dj)]] ?? 0;
    hgt[vj * VW + vi] = s / 4;
  }
  for (let pass = 0; pass < 2; pass++) {
    const nx = hgt.slice();
    for (let vj = 1; vj < VH - 1; vj++) for (let vi = 1; vi < VW - 1; vi++) { const k = vj * VW + vi; nx[k] = (hgt[k] * 4 + hgt[k - 1] + hgt[k + 1] + hgt[k - VW] + hgt[k + VW]) / 8; }
    hgt = nx;
  }
  const g = data.green; const gr = Math.max(g.dims[0], g.dims[1]) / 2 / data.scale.ydPerPx;
  for (let vj = 0; vj < VH; vj++) for (let vi = 0; vi < VW; vi++) {
    const d = Math.hypot((i0 + vi) * cellPx - g.x, (j0 + vj) * cellPx - g.y) / gr;
    if (d < 1) hgt[vj * VW + vi] += 0.35 * (1 - d * d);
  }
  const baseAt = (x, y) => {
    const u = clamp(x / cellPx - i0, 0, VW - 1), v = clamp(y / cellPx - j0, 0, VH - 1);
    const a = Math.min(VW - 2, Math.floor(u)), b = Math.min(VH - 2, Math.floor(v)), fu = u - a, fv = v - b, k = b * VW + a;
    return (hgt[k] * (1 - fu) + hgt[k + 1] * fu) * (1 - fv) + (hgt[k + VW] * (1 - fu) + hgt[k + VW + 1] * fu) * fv;
  };

  // 2. Bunkers: signed distance (cells, positive inside), each sand area's own radius, and water nearby.
  const isSand = new Uint8Array(GW * GH), notSand = new Uint8Array(GW * GH);
  let sandCells = 0;
  for (let k = 0; k < GW * GH; k++) { if (sand && grid[k] === BUNKER) { isSand[k] = 1; sandCells++; } else notSand[k] = 1; }
  const sd = new Float32Array(GW * GH).fill(-99), rad = new Float32Array(GW * GH), wet = new Float32Array(GW * GH);
  const comps = [];
  if (sandCells) {
    const dIn = edt(notSand, GW, GH), dOut = edt(isSand, GW, GH);
    for (let k = 0; k < GW * GH; k++) sd[k] = isSand[k] ? Math.sqrt(dIn[k]) - 0.5 : -Math.min(99, Math.sqrt(dOut[k]) - 0.5);
    // Separate bunkers (4-connected, so pockets a cell apart stay apart) and each one's inscribed radius.
    const lab = new Int32Array(GW * GH).fill(-1);
    for (let k = 0; k < GW * GH; k++) {
      if (!isSand[k] || lab[k] >= 0) continue;
      const id = comps.length, stack = [k]; lab[k] = id; let r = 0, n = 0;
      while (stack.length) {
        const q = stack.pop(); n++; r = Math.max(r, sd[q]);
        const x = q % GW, y = (q / GW) | 0;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= GW || ny >= GH) continue; const p = ny * GW + nx; if (isSand[p] && lab[p] < 0) { lab[p] = id; stack.push(p); } }
      }
      comps.push({ cells: n, radius: r });
    }
    for (let k = 0; k < GW * GH; k++) if (lab[k] >= 0) rad[k] = comps[lab[k]].radius;
    for (let pass = 0; pass < 3; pass++) { // carry each bunker's radius out to its lip
      const nx = rad.slice();
      for (let y = 1; y < GH - 1; y++) for (let x = 1; x < GW - 1; x++) { const k = y * GW + x; if (rad[k]) continue; let best = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) best = Math.max(best, rad[k + dy * GW + dx]); nx[k] = best; }
      rad.set(nx);
    }
    for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) { let w = 0; for (let dy = -1; dy <= 1 && !w; dy++) for (let dx = -1; dx <= 1; dx++) if (cls(x + dx, y + dy) === WATER) { w = 1; break; } wet[y * GW + x] = w; }
  }
  const cellField = (F) => (x, y) => {
    const u = clamp(x / cellPx - 0.5, 0, GW - 1), v = clamp(y / cellPx - 0.5, 0, GH - 1);
    const a = Math.min(GW - 2, Math.floor(u)), b = Math.min(GH - 2, Math.floor(v)), fu = u - a, fv = v - b, k = b * GW + a;
    return (F[k] * (1 - fu) + F[k + 1] * fu) * (1 - fv) + (F[k + GW] * (1 - fu) + F[k + GW + 1] * fu) * fv;
  };
  const sdCells = cellField(sd), radAt = cellField(rad), wetAt = cellField(wet);
  /** Signed distance to the nearest traced sand edge, in metres (positive inside a bunker). */
  const sdAt = (x, y) => sdCells(x, y) * cellM;
  const carve = (x, y) => {
    if (!sandCells) return 0;
    const d = sdAt(x, y);
    if (d <= -SAND.lipW) return 0;
    const R = Math.max(0.5, radAt(x, y)) * cellM;
    const depth = clamp(R * SAND.depthK, SAND.depthMin, SAND.depthMax), face = clamp(R * SAND.faceK, SAND.faceMin, SAND.faceMax);
    const lip = (d < 0 ? smooth(-SAND.lipW, 0, d) : 1 - smooth(0, face * 0.45, d)) * Math.min(1, R / 1.2) * (1 - clamp(wetAt(x, y), 0, 1));
    const t = clamp(d / face, 0, 1), dip = 1 - (1 - t) * (1 - t);
    const floor = t * SAND.floorVar * Math.sin(x * 0.21 + y * 0.07) * Math.cos(y * 0.17 - x * 0.05);
    return SAND.lipH * lip - depth * dip + floor;
  };
  const H = (x, y) => baseAt(x, y) + carve(x, y);

  // 3. Mesh on one lattice: plain cells use their corners; cells a bunker touches are split S x S.
  const S = Math.max(1, subdiv | 0);
  const near = (i, j) => { for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) if (cls(i + di, j + dj) !== 0) return true; return false; };
  const drawn = new Uint8Array(cw * ch), fine = new Uint8Array(cw * ch);
  const reach = -(SAND.lipW / cellM + 1.6);
  let refined = 0;
  for (let j = 0; j < ch; j++) for (let i = 0; i < cw; i++) {
    const gi = i0 + i, gj = j0 + j, k = j * cw + i;
    drawn[k] = textured ? (near(gi, gj) ? 1 : 0) : (cls(gi, gj) !== 0 ? 1 : 0);
    if (drawn[k] && S > 1 && sandCells && sd[gj * GW + gi] > reach) { fine[k] = 1; refined++; }
  }
  const FW = cw * S + 1, FH = ch * S + 1;
  const slot = new Int32Array(FW * FH).fill(-1);
  const P = [], UV = [], UV1 = [], PX = [], HV = [];
  const vtx = (fi, fj) => {
    const key = fj * FW + fi; let s = slot[key];
    if (s >= 0) return s;
    const x = (i0 + fi / S) * cellPx, y = (j0 + fj / S) * cellPx, h = H(x, y);
    s = slot[key] = HV.length;
    HV.push(h); PX.push(x, y); P.push((x - cx) * m, h, (y - cy) * m);
    UV.push(x / (GW * cellPx), 1 - y / (GH * cellPx)); UV1.push((x * m) / 3.2, (y * m) / 3.2);
    return s;
  };
  const idx = [];
  const quad = (fa, fb, step) => { const a = vtx(fa, fb), b = vtx(fa + step, fb), c = vtx(fa, fb + step), d = vtx(fa + step, fb + step); idx.push(a, c, b, b, c, d); };
  for (let j = 0; j < ch; j++) for (let i = 0; i < cw; i++) {
    const k = j * cw + i; if (!drawn[k]) continue;
    if (fine[k]) { for (let b = 0; b < S; b++) for (let a = 0; a < S; a++) quad(i * S + a, j * S + b, 1); }
    else quad(i * S, j * S, S);
  }
  const latticeH = (fi, fj) => { const s = slot[fj * FW + fi]; return s >= 0 ? HV[s] : H((i0 + fi / S) * cellPx, (j0 + fj / S) * cellPx); };
  /** Ground height (metres) under a diagram pixel, interpolated over the same triangles the GPU draws. */
  const heightAt = (x, y) => {
    const fx = clamp((x / cellPx - i0) * S, 0, cw * S - 1e-6), fy = clamp((y / cellPx - j0) * S, 0, ch * S - 1e-6);
    const i = Math.floor(fx / S), j = Math.floor(fy / S);
    let qa, qb, step;
    if (fine[j * cw + i]) { qa = Math.floor(fx); qb = Math.floor(fy); step = 1; } else { qa = i * S; qb = j * S; step = S; }
    const s = (fx - qa) / step, t = (fy - qb) / step;
    const ha = latticeH(qa, qb), hb = latticeH(qa + step, qb), hc = latticeH(qa, qb + step), hd = latticeH(qa + step, qb + step);
    return s + t <= 1 ? ha + s * (hb - ha) + t * (hc - ha) : hd + (1 - s) * (hc - hd) + (1 - t) * (hb - hd);
  };

  // 4. A light tint over the diagram texture: a slightly brighter collar on the turf lip, quiet grain in the sand.
  const n = HV.length;
  const tint = new Float32Array(n * 3).fill(1);
  if (sandCells) for (let v = 0; v < n; v++) {
    const x = PX[v * 2], y = PX[v * 2 + 1], d = sdAt(x, y);
    if (d > -SAND.lipW && d < 0) { const c = smooth(-SAND.lipW, -SAND.lipW * 0.3, d) * (1 - smooth(-0.35, 0, d)); tint[v * 3] = 1 + 0.03 * c; tint[v * 3 + 1] = 1 + 0.06 * c; tint[v * 3 + 2] = 1 + 0.01 * c; }
    else if (d >= 0) { const gnoise = 1 + 0.025 * Math.sin(x * 1.7 + y * 0.9) * Math.sin(y * 1.3 - x * 0.4); tint[v * 3] = gnoise; tint[v * 3 + 1] = gnoise; tint[v * 3 + 2] = gnoise * 0.99; }
  }
  /** Per-vertex class colours, used when the diagram picture is unavailable. */
  const classColors = (enabled, palette, shade) => {
    const cols = new Float32Array(n * 3);
    for (let v = 0; v < n; v++) {
      const x = PX[v * 2], y = PX[v * 2 + 1], ci = Math.round(x / cellPx), cj = Math.round(y / cellPx);
      const rgb = shade(x, y, [[ci - 1, cj - 1], [ci, cj - 1], [ci - 1, cj], [ci, cj]].map(([a, b]) => CLS[cls(a, b)]), CLS[cls(Math.floor(x / cellPx), Math.floor(y / cellPx))], enabled, palette);
      cols[v * 3] = rgb[0]; cols[v * 3 + 1] = rgb[1]; cols[v * 3 + 2] = rgb[2];
    }
    return cols;
  };

  return {
    grid, cls, GW, GH, cellPx, m, cx, cy, i0, j0, cw, ch,
    positions: new Float32Array(P), uvs: new Float32Array(UV), uv1: new Float32Array(UV1), px: new Float32Array(PX), index: idx, tint,
    heightAt, sdAt, baseAt, carveAt: carve, classColors,
    stats: { bunkers: comps.length, sandCells, refinedCells: refined, vertices: n, triangles: idx.length / 3, subdiv: S },
  };
}
