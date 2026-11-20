// A small QR Code encoder (ISO/IEC 18004, model 2): byte mode, error correction level M, versions 1 to 6
// (up to 106 bytes). It runs on this device; nothing is sent anywhere. Loaded only by the booking
// confirmation and manage pages for the demo check-in card (Phase 2 brief, B04).
// Structure follows the public-domain description of the format; tests/qr.test.mjs compares every module
// against an independent encoder and a decoder reads the rendered card back.

// Error correction level M: [total codewords, EC codewords per block, blocks] for versions 1 to 6.
const M = [null, [26, 10, 1], [44, 16, 1], [70, 26, 1], [100, 18, 2], [134, 24, 2], [172, 16, 4]];
const REMAINDER = [0, 0, 7, 7, 7, 7, 7];

function gfMul(x, y) { let z = 0; for (let i = 7; i >= 0; i--) { z = (z << 1) ^ ((z >>> 7) * 0x11d); z ^= ((y >>> i) & 1) * x; } return z & 0xff; }
function rsDivisor(degree) {
  const r = new Array(degree).fill(0); r[degree - 1] = 1; let root = 1;
  for (let i = 0; i < degree; i++) { for (let j = 0; j < degree; j++) { r[j] = gfMul(r[j], root); if (j + 1 < degree) r[j] ^= r[j + 1]; } root = gfMul(root, 2); }
  return r;
}
function rsRemainder(data, div) {
  const r = div.map(() => 0);
  for (const b of data) { const f = b ^ r.shift(); r.push(0); div.forEach((c, i) => { r[i] ^= gfMul(c, f); }); }
  return r;
}

function codewords(bytes, v) {
  const [total, ec, blocks] = M[v];
  const dataLen = total - ec * blocks;
  const bits = [];
  const put = (val, n) => { for (let i = n - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
  put(0b0100, 4); put(bytes.length, 8); bytes.forEach((b) => put(b, 8));
  const cap = dataLen * 8;
  put(0, Math.min(4, cap - bits.length));
  while (bits.length % 8) bits.push(0);
  const data = [];
  for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
  for (let pad = 0xec; data.length < dataLen; pad ^= 0xec ^ 0x11) data.push(pad);
  // Versions 1 to 6 at level M have equal blocks, so interleaving is column by column.
  const per = dataLen / blocks, div = rsDivisor(ec), split = [];
  for (let b = 0; b < blocks; b++) { const d = data.slice(b * per, (b + 1) * per); split.push([d, rsRemainder(d, div)]); }
  const out = [];
  for (let i = 0; i < per; i++) for (const [d] of split) out.push(d[i]);
  for (let i = 0; i < ec; i++) for (const [, e] of split) out.push(e[i]);
  return out;
}

const MASKS = [
  (x, y) => (x + y) % 2 === 0, (x, y) => y % 2 === 0, (x) => x % 3 === 0, (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0, (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

function build(cw, v, mask) {
  const n = 17 + 4 * v;
  const mod = Array.from({ length: n }, () => new Array(n).fill(false));
  const fn = Array.from({ length: n }, () => new Array(n).fill(false));
  const set = (x, y, dark) => { mod[y][x] = dark; fn[y][x] = true; };
  for (let i = 0; i < n; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
  const finder = (cx, cy) => { for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) { const x = cx + dx, y = cy + dy; if (x < 0 || y < 0 || x >= n || y >= n) continue; const d = Math.max(Math.abs(dx), Math.abs(dy)); set(x, y, d !== 2 && d !== 4); } };
  finder(3, 3); finder(n - 4, 3); finder(3, n - 4);
  if (v > 1) { const a = n - 7; for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(a + dx, a + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1); }
  const format = (m) => {
    const data = (0 << 3) | m; // level M is 00
    let rem = data; for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const bits = ((data << 10) | rem) ^ 0x5412;
    const bit = (i) => ((bits >>> i) & 1) === 1;
    for (let i = 0; i <= 5; i++) set(8, i, bit(i));
    set(8, 7, bit(6)); set(8, 8, bit(7)); set(7, 8, bit(8));
    for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) set(n - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) set(8, n - 15 + i, bit(i));
    set(8, n - 8, true); // the dark module
  };
  format(0); // reserve the format areas before placing data
  let i = 0;
  const total = cw.length * 8;
  for (let right = n - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < n; vert++) for (let j = 0; j < 2; j++) {
      const x = right - j, up = ((right + 1) & 2) === 0, y = up ? n - 1 - vert : vert;
      if (!fn[y][x] && i < total) { mod[y][x] = ((cw[i >>> 3] >>> (7 - (i & 7))) & 1) === 1; i++; }
    }
  }
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (!fn[y][x] && MASKS[mask](x, y)) mod[y][x] = !mod[y][x];
  format(mask);
  return mod;
}

/** Penalty score from the standard's four rules; the lowest wins. */
function penalty(m) {
  const n = m.length; let p = 0;
  const lines = [];
  for (let y = 0; y < n; y++) lines.push(m[y]);
  for (let x = 0; x < n; x++) lines.push(m.map((row) => row[x]));
  for (const line of lines) {
    let run = 1;
    for (let i = 1; i <= n; i++) {
      if (i < n && line[i] === line[i - 1]) run++;
      else { if (run >= 5) p += 3 + (run - 5); run = 1; }
    }
    const s = line.map((d) => (d ? "1" : "0")).join("");
    for (const pat of ["10111010000", "00001011101"]) { let k = s.indexOf(pat); while (k !== -1) { p += 40; k = s.indexOf(pat, k + 1); } }
  }
  for (let y = 0; y < n - 1; y++) for (let x = 0; x < n - 1; x++) { const c = m[y][x]; if (c === m[y][x + 1] && c === m[y + 1][x] && c === m[y + 1][x + 1]) p += 3; }
  const dark = m.flat().filter(Boolean).length;
  p += Math.floor(Math.abs((dark * 100) / (n * n) - 50) / 5) * 10;
  return p;
}

/** The module grid for a text: rows of booleans (true is dark). `mask` forces a mask for testing. */
export function qrMatrix(text, { mask = null } = {}) {
  const bytes = [...new TextEncoder().encode(String(text))];
  let v = 1;
  while (v <= 6 && bytes.length > M[v][0] - M[v][1] * M[v][2] - 2) v++;
  if (v > 6) throw new Error("QR payload too long for this encoder");
  const cw = codewords(bytes, v);
  if (mask != null) return { version: v, mask, modules: build(cw, v, mask) };
  let best = null;
  for (let k = 0; k < 8; k++) { const mod = build(cw, v, k); const score = penalty(mod); if (!best || score < best.score) best = { version: v, mask: k, modules: mod, score }; }
  return { version: best.version, mask: best.mask, modules: best.modules };
}

/** SVG of the code: dark square modules on white, with a four-module quiet zone on every edge. */
export function qrSVG(text, { quiet = 4, label = "" } = {}) {
  const { modules } = qrMatrix(text);
  const n = modules.length, size = n + quiet * 2;
  let d = "";
  modules.forEach((row, y) => row.forEach((dark, x) => { if (dark) d += `M${x + quiet} ${y + quiet}h1v1h-1z`; }));
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges" role="img"${label ? ` aria-label="${label.replace(/"/g, "&quot;")}"` : ' aria-hidden="true"'}><rect width="${size}" height="${size}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}
