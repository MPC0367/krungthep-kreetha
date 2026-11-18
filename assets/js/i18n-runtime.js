// Chinese and Japanese pages: the scripts write their messages in English (the same strings the
// build translates), and this module swaps them for the native translation as they appear. It uses the
// dictionary in assets/i18n/<lang>.json: exact strings first, then patterns such as "Hole {0}", whose
// filled-in parts are translated too when the dictionary knows them (day names, for example).
const html = document.documentElement;
const lang = html.lang;
const ATTRS = ["aria-label", "title", "placeholder", "alt", "data-selected-label"];
const SKIP = new Set(["SCRIPT", "STYLE", "TEXTAREA", "CODE", "PRE", "CANVAS", "SVG"]);
let dict = null, patterns = [];
const queue = new Set();

const norm = (s) => s.replace(/\s+/g, " ").trim();
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function compile(d) {
  patterns = Object.keys(d).filter((k) => /\{\d\}/.test(k)).map((k) => {
    const order = [];
    const re = new RegExp("^" + escRe(k).replace(/\\\{(\d)\\\}/g, (_, n) => { order.push(Number(n)); return "([^|]+?)"; }) + "$");
    return { re, order, out: d[k] };
  }).sort((a, b) => b.re.source.length - a.re.source.length);
}
export function translate(s) {
  if (!dict || !s) return null;
  const k = norm(s);
  if (!/[A-Za-z]{2}/.test(k)) return null;
  if (k in dict) return dict[k];
  // Titles such as "Hole 7 | Krungthep Kreetha": translate each side on its own.
  if (k.includes(" | ")) { const parts = k.split(" | "); const tr = parts.map((x) => translate(x) ?? x); return tr.some((x, i) => x !== parts[i]) ? tr.join(" | ") : null; }
  for (const p of patterns) {
    const m = k.match(p.re); if (!m) continue;
    // Each filled-in part is translated too (it is always shorter, so this ends).
    const vals = []; p.order.forEach((n, i) => { const v = m[i + 1]; vals[n] = translate(v) ?? v; });
    return p.out.replace(/\{(\d)\}/g, (_, n) => vals[n] ?? "");
  }
  return null;
}
function skip(el) { for (let e = el; e && e !== html; e = e.parentElement) { if (SKIP.has(e.tagName?.toUpperCase()) || e.hasAttribute?.("data-no-i18n")) return true; } return false; }
function doText(node) {
  const v = node.nodeValue; if (!v || !/[A-Za-z]{2}/.test(v) || skip(node.parentElement)) return;
  const t = translate(v); if (t == null || t === norm(v)) return;
  node.nodeValue = v.match(/^\s*/)[0] + t + v.match(/\s*$/)[0];
}
function doAttrs(el) {
  if (skip(el)) return;
  for (const a of ATTRS) { const v = el.getAttribute(a); if (v && /[A-Za-z]{2}/.test(v)) { const t = translate(v); if (t != null && t !== v) el.setAttribute(a, t); } }
}
function walk(root) {
  if (root.nodeType === 3) return doText(root);
  if (root.nodeType !== 1 && root.nodeType !== 9) return;
  if (root.nodeType === 1) doAttrs(root);
  const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  for (let n = tw.nextNode(); n; n = tw.nextNode()) n.nodeType === 3 ? doText(n) : doAttrs(n);
}
let scheduled = false;
const flush = () => { scheduled = false; if (!dict) return; const items = [...queue]; queue.clear(); items.forEach(walk); };
new MutationObserver((list) => {
  for (const m of list) {
    if (m.type === "childList") m.addedNodes.forEach((n) => queue.add(n));
    else if (m.type === "characterData") queue.add(m.target);
    else if (m.type === "attributes") queue.add(m.target);
  }
  if (!scheduled) { scheduled = true; queueMicrotask(flush); }
}).observe(html, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });

if (lang === "zh" || lang === "ja") {
  fetch(`${html.dataset.root}assets/i18n/${lang}.json`).then((r) => r.json()).then((d) => { dict = d; compile(d); walk(document.documentElement); flush(); }).catch(() => {});
}
