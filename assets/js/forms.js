// Demo enquiry forms (events, contact). They check each field against its own rules (required, whole
// numbers within min and max, a real date not in the past, email shape, a phone number in any common
// international form), show the message next to the field, focus the first problem, clear a field's
// error as soon as it is corrected, and keep what was typed. The enquiry is stored in this browser
// only; nothing is sent anywhere. If the browser cannot store it, the visitor is told so plainly.
const lang = document.documentElement.lang;
const th = lang === "th";

function problem(el) {
  const v = String(el.value ?? "").trim();
  if (el.required && !v) return th ? "กรุณากรอกช่องนี้" : "Please fill in this field.";
  if (!v) return "";
  if (el.type === "number") {
    if (!/^\d+$/.test(v)) return th ? "กรอกเป็นจำนวนเต็ม" : "Enter a whole number.";
    const n = Number(v), min = el.min !== "" ? Number(el.min) : null, max = el.max !== "" ? Number(el.max) : null;
    if (min != null && n < min) return th ? `อย่างน้อย ${min}` : `At least ${min}.`;
    if (max != null && n > max) return th ? `ไม่เกิน ${max}` : `No more than ${max}.`;
  }
  if (el.type === "date") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(`${v}T00:00:00Z`))) return th ? "ตรวจสอบวันที่" : "Check the date.";
    const today = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10); // Bangkok
    if (v < today) return th ? "เลือกวันที่ตั้งแต่วันนี้เป็นต้นไป" : "Choose today or a later date.";
  }
  if (el.type === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) return th ? "รูปแบบอีเมลไม่ถูกต้อง" : "This email address does not look right.";
  if (el.type === "tel" || el.name === "phone") {
    const digits = v.replace(/[\s().-]/g, "");
    if (!/^\+?\d{8,15}$/.test(digits)) return th ? "ตรวจสอบเบอร์โทร ตัวเลข 8 ถึง 15 หลัก ใส่รหัสประเทศได้" : "Check the phone number: 8 to 15 digits, a country code is fine.";
  }
  return "";
}

function fieldError(el) {
  const field = el.closest(".field") || el.parentElement;
  let msg = field.querySelector(".field-error");
  if (!msg) {
    msg = document.createElement("p"); msg.className = "field-error"; msg.id = `${el.id || el.name}-err`; msg.hidden = true;
    el.insertAdjacentElement("afterend", msg);
    el.setAttribute("aria-describedby", [el.getAttribute("aria-describedby"), msg.id].filter(Boolean).join(" "));
  }
  return { field, msg };
}
function show(el, text) {
  const { field, msg } = fieldError(el);
  msg.textContent = text; msg.hidden = !text;
  field.classList.toggle("has-error", !!text);
  if (text) el.setAttribute("aria-invalid", "true"); else el.removeAttribute("aria-invalid");
}

document.querySelectorAll("[data-enquiry]").forEach((form) => {
  const inputs = [...form.querySelectorAll("input, select, textarea")].filter((el) => el.name);
  // A corrected field clears its own error straight away.
  form.addEventListener("input", (e) => { const el = e.target; if (el.getAttribute("aria-invalid") === "true" && !problem(el)) show(el, ""); });
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const err = form.querySelector("[data-enquiry-error]");
    const ok = form.querySelector("[data-enquiry-ok]");
    const bad = inputs.map((el) => [el, problem(el)]).filter(([, p]) => p);
    inputs.forEach((el) => show(el, ""));
    if (bad.length) {
      bad.forEach(([el, p]) => show(el, p));
      err.hidden = false; err.textContent = th ? `ตรวจสอบ ${bad.length} ช่องที่ทำเครื่องหมายไว้` : `Check the ${bad.length} marked field${bad.length > 1 ? "s" : ""}.`;
      ok.hidden = true; bad[0][0].focus(); return;
    }
    err.hidden = true;
    let saved = false;
    try {
      const list = JSON.parse(localStorage.getItem("kk.demo.enquiries") || "[]");
      list.push({ at: Date.now(), page: document.documentElement.dataset.page, ...Object.fromEntries(new FormData(form)) });
      localStorage.setItem("kk.demo.enquiries", JSON.stringify(list.slice(-20)));
      saved = JSON.parse(localStorage.getItem("kk.demo.enquiries") || "[]").length > 0;
    } catch { saved = false; }
    if (!saved) {
      // Nothing was stored, so nothing is claimed: the typed text stays in the form for another try or a call.
      ok.hidden = true; err.hidden = false;
      err.textContent = th ? "เบราว์เซอร์นี้บันทึกคำขอไม่ได้ (อาจปิดการเก็บข้อมูลไว้) ข้อความที่กรอกยังอยู่ ลองใหม่ หรือโทรหาสมาคมโดยตรง" : "This browser could not save the enquiry (site storage may be switched off). What you typed is still here: try again, or call the club.";
      err.focus?.(); return;
    }
    ok.hidden = false; ok.focus?.();
    window.kk?.toast?.(th ? "บันทึกคำขอแล้ว (เดโม)" : "Enquiry saved (demo)");
  });
});
