// Demo enquiry forms (events, contact). They validate in place, keep what was typed after an error,
// and store the enquiry in this browser only. Nothing is sent anywhere.
const th = document.documentElement.lang === "th";
document.querySelectorAll("[data-enquiry]").forEach((form) => {
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const err = form.querySelector("[data-enquiry-error]");
    const ok = form.querySelector("[data-enquiry-ok]");
    const missing = [...form.querySelectorAll("[required]")].filter((el) => !String(el.value).trim());
    form.querySelectorAll(".field").forEach((f) => f.classList.remove("has-error"));
    if (missing.length) {
      missing.forEach((el) => { el.closest(".field")?.classList.add("has-error"); el.setAttribute("aria-invalid", "true"); });
      err.hidden = false; err.textContent = th ? `กรุณากรอก ${missing.length} ช่องที่ยังว่าง` : `Please fill in the ${missing.length} empty field${missing.length > 1 ? "s" : ""}`;
      ok.hidden = true; missing[0].focus(); return;
    }
    form.querySelectorAll("[aria-invalid]").forEach((el) => el.removeAttribute("aria-invalid"));
    err.hidden = true;
    try { const list = JSON.parse(localStorage.getItem("kk.demo.enquiries") || "[]"); list.push({ at: Date.now(), page: document.documentElement.dataset.page, ...Object.fromEntries(new FormData(form)) }); localStorage.setItem("kk.demo.enquiries", JSON.stringify(list.slice(-20))); } catch {}
    ok.hidden = false; ok.focus?.();
    window.kk?.toast?.(th ? "บันทึกคำขอแล้ว (เดโม)" : "Enquiry saved (demo)");
  });
});
