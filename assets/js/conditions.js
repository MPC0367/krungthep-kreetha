// Public conditions page: latest valid published reading, its measurement time, scope and
// freshness; notices; recent history including corrections. Updates when staff publish.
import { getApi } from "./api.js";
import { bkkDate } from "./core/util.js";
import { lang, th, esc, formatDateTime, formatClock } from "./ui.js";

const box = document.querySelector("[data-conditions]");
const FRESH = {
  CURRENT: { t: th ? "ล่าสุดวันนี้" : "Current", c: "ok", d: th ? "วัดภายใน 6 ชั่วโมงที่ผ่านมา" : "Measured within the last 6 hours" },
  AGING: { t: th ? "วัดไว้หลายชั่วโมงแล้ว" : "Measured some hours ago", c: "warn", d: th ? "วัดวันนี้ แต่นานกว่า 6 ชั่วโมงแล้ว สภาพกรีนอาจเปลี่ยนไป" : "Measured today but more than 6 hours ago; greens may have changed" },
  STALE: { t: th ? "ยังไม่มีค่าของวันนี้" : "No reading today yet", c: "bad", d: th ? "ค่าล่าสุดเป็นของวันก่อน จึงไม่แสดงเป็นค่าของวันนี้" : "The latest reading is from an earlier day, so it is not shown as today's" },
  NOT_MEASURED: { t: th ? "ยังไม่ได้วัด" : "Not measured", c: "info", d: th ? "ยังไม่มีค่าที่เผยแพร่" : "No published reading" },
};
const STATUS = { open: { t: th ? "เปิดให้บริการ" : "Open", c: "ok" }, partial: { t: th ? "เปิดบางส่วน" : "Partly open", c: "warn" }, closed: { t: th ? "ปิด" : "Closed", c: "bad" } };
const val = (r) => (r.range ? `${r.range[0]} ${th ? "ถึง" : "to"} ${r.range[1]}` : r.value);

async function render() {
  let c;
  try { c = await (await getApi()).getConditions(); } catch { box.innerHTML = `<div class="notice bad"><span>${th ? "โหลดสภาพสนามไม่สำเร็จ ลองใหม่อีกครั้ง หรือโทร 0-2736-0378-9" : "Conditions did not load. Try again or call 0-2736-0378-9."}</span></div>`; return; }
  const r = c.reading, f = FRESH[c.freshness], s = STATUS[c.course?.status] || STATUS.open;
  const showValue = r && c.freshness !== "STALE";
  box.innerHTML = `
  <div class="split-2" style="align-items:stretch">
    <div class="panel" style="gap:10px">
      <p class="label">${th ? "ความเร็วกรีนที่วัดล่าสุด" : "Latest measured green speed"}</p>
      <p style="font:400 clamp(4rem,3rem+4vw,7rem)/.9 var(--font-display)${showValue ? "" : ";color:var(--ink-3)"}" class="num">${r ? `${esc(val(r))}<span style="font:500 1.1rem var(--font-body);margin-left:10px">${th ? "ฟุต" : "ft"}</span>` : "&ndash;"}</p>
      ${r && !showValue ? `<p class="small" style="margin-top:-4px">${th ? `ค่าของ ${formatDateTime(r.measuredAt, lang)} ไม่ใช่ค่าของวันนี้` : `From ${formatDateTime(r.measuredAt, lang)}, not today`}</p>` : ""}
      <p><span class="tag ${f.c}"><span class="dot"></span>${f.t}</span> <span class="small muted">${f.d}</span></p>
      ${r ? `<dl class="kv small" style="margin-top:8px"><dt>${th ? "วัดเมื่อ" : "Measured"}</dt><dd>${formatDateTime(r.measuredAt, lang)}</dd><dt>${th ? "เผยแพร่เมื่อ" : "Published"}</dt><dd>${formatDateTime(r.publishedAt, lang)}</dd><dt>${th ? "ขอบเขต" : "Scope"}</dt><dd>${r.scope === "course" ? (th ? "ค่าสรุปจากกรีนที่วัด" : "Summary of the greens measured") : (th ? `หลุม ${r.holeIds.join(", ")}` : `Holes ${r.holeIds.join(", ")}`)}</dd><dt>${th ? "วิธีวัด" : "Method"}</dt><dd>${th ? "สติมป์มิเตอร์ หน่วยฟุตแบบทศนิยม" : "Stimpmeter, decimal feet"}</dd><dt>${th ? "ผู้วัด" : "Measured by"}</dt><dd>${esc(r.operator)}</dd>${r.version > 1 ? `<dt>${th ? "ฉบับแก้ไข" : "Correction"}</dt><dd>${th ? `ฉบับที่ ${r.version}` : `Version ${r.version}`}${r.correctionReason ? `: ${esc(r.correctionReason)}` : ""}</dd>` : ""}</dl>${r.notes?.[lang] ? `<p class="small muted">${esc(r.notes[lang])}</p>` : ""}` : ""}
      ${r?.demo ? `<p><span class="tag demo">${th ? "ค่าตัวอย่าง ไม่ใช่การวัดจริง" : "Demo value, not a real measurement"}</span></p>` : ""}
    </div>
    <div class="stack">
      <div class="panel" style="gap:8px"><p class="label">${th ? "สถานะสนาม" : "Course status"}</p><p><span class="tag ${s.c}"><span class="dot"></span>${s.t}</span></p>${c.course?.note ? `<p>${esc(c.course.note[lang])}</p>` : ""}${c.course?.updatedAt ? `<p class="small muted">${th ? "อัปเดต" : "Updated"} ${formatDateTime(c.course.updatedAt, lang)}</p>` : ""}</div>
      <div class="panel" style="gap:8px"><p class="label">${th ? "ประกาศ" : "Notices"}</p>${c.notices.length ? c.notices.map((n) => `<p class="notice ${n.demo ? "demo" : ""}"><span>${esc(n[lang])}</span></p>`).join("") : `<p class="muted">${th ? "ไม่มีประกาศ" : "No notices"}</p>`}</div>
      ${c.perHole.length ? `<div class="panel" style="gap:8px"><p class="label">${th ? "รายกรีน" : "By green"}</p>${c.perHole.map((p) => `<p class="small">${th ? "หลุม" : "Hole"} ${p.holeIds.join(", ")}: <b>${esc(val(p))} ${th ? "ฟุต" : "ft"}</b> (${FRESH[p.freshness].t}, ${formatClock(p.measuredAt, lang)})</p>`).join("")}</div>` : ""}
    </div>
  </div>
  ${c.history.length > 1 ? `<details style="margin-top:20px"><summary class="small">${th ? "ประวัติค่าที่เผยแพร่" : "Recent published readings"}</summary><div class="table-wrap" style="margin-top:12px"><table class="data"><thead><tr><th>${th ? "วัดเมื่อ" : "Measured"}</th><th class="r">${th ? "ค่า (ฟุต)" : "Value (ft)"}</th><th>${th ? "สถานะ" : "Status"}</th><th>${th ? "ฉบับ" : "Version"}</th></tr></thead><tbody>${c.history.map((h) => `<tr><td>${formatDateTime(h.measuredAt, lang)}</td><td class="r">${esc(val(h))}</td><td>${h.status === "PUBLISHED" ? (th ? "เผยแพร่" : "Published") : h.status === "SUPERSEDED" ? (th ? "ถูกแก้ไข" : "Corrected") : (th ? "ถอนแล้ว" : "Withdrawn")}</td><td>${h.version}</td></tr>`).join("")}</tbody></table></div></details>` : ""}
  <p class="small muted" style="margin-top:14px">${th ? `หน้านี้อัปเดตเองเมื่อทีมดูแลสนามเผยแพร่ค่าใหม่ ตรวจสอบล่าสุด ${formatClock(c.serverTime, lang)}` : `This page updates when the greenkeeping team publishes. Last checked ${formatClock(c.serverTime, lang)}.`} <a href="${document.documentElement.dataset.root}${lang}/staff/${document.documentElement.dataset.target === "artifact" ? "index.html" : ""}#conditions">${th ? "ลองเผยแพร่ค่าในหน้าเจ้าหน้าที่ (เดโม)" : "Try publishing a reading in the staff console (demo)"}</a></p>`;
}
render();
getApi().then((api) => api.subscribe("conditions", render));
setInterval(() => { if (document.visibilityState === "visible") render(); }, 60e3);
