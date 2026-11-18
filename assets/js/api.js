// One API for every page. On the Node server it calls /api/rpc/*; in a static preview (or when the
// server is unreachable) it runs the same service code in this browser over local demo storage.
// Pages never import fixtures directly; they only call these methods.
const root = document.documentElement.dataset.root || "./";
const target = document.documentElement.dataset.target;
let chosen;

export class ApiError extends Error {
  constructor(e = {}) { super(e.message || "Request failed"); this.code = e.code || "ERROR"; this.detail = e.detail || {}; }
}

function httpAdapter() {
  let es; const handlers = {};
  const rpc = async (method, args = {}, opts = {}) => {
    const headers = { "content-type": "application/json" };
    if (opts.staff) headers["x-kk-csrf"] = "1";
    if (args && args.idemKey) headers["idempotency-key"] = args.idemKey;
    let r;
    try { r = await fetch(`${root}api/rpc/${method}`, { method: "POST", headers, body: JSON.stringify(args || {}), credentials: "same-origin" }); }
    catch { throw new ApiError({ code: "NETWORK", message: "Connection lost. Check your connection and try again." }); }
    const body = await r.json().catch(() => ({}));
    if (!r.ok) throw new ApiError(body.error || { code: "ERROR", message: `HTTP ${r.status}` });
    return body;
  };
  const staff = new Set(["staffTeeSheet", "staffCreateBooking", "staffCheckIn", "staffNoShow", "staffCorrectAttendance", "staffCancel", "staffMove", "staffRefund", "staffSettleRefunds", "staffCloseSlots", "staffReopen", "listExceptions", "resolveException", "auditLog", "draftReading", "publishReading", "correctReading", "withdrawReading", "setCourseStatus", "addNotice", "removeNotice", "listReadings", "syncHealth", "syncImport", "syncExport", "resolveConflict", "setSimulation", "setClockOffset", "deliverQueuedEvents"]);
  const api = {
    kind: "server",
    subscribe(channel, cb) {
      if (!es && "EventSource" in window) { es = new EventSource(`${root}api/events`); }
      (handlers[channel] ||= []).push(cb);
      es?.addEventListener(channel, (e) => cb(JSON.parse(e.data || "{}")));
      return () => {};
    },
    async staffLogin(userId) { const r = await fetch(`${root}api/staff/session`, { method: "POST", headers: { "x-kk-csrf": "1", "content-type": "application/json" }, body: JSON.stringify({ userId }), credentials: "same-origin" }); const b = await r.json(); if (!r.ok) throw new ApiError(b.error); return b.user; },
    async staffSession() { const r = await fetch(`${root}api/staff/session`, { credentials: "same-origin" }); return (await r.json()).user; },
    async staffLogout() { await fetch(`${root}api/staff/session`, { method: "DELETE", credentials: "same-origin" }); },
    async resetDemo() { throw new ApiError({ code: "FORBIDDEN", message: "Reset the server demo from the command line (delete data/kk-demo.sqlite)." }); },
  };
  // "then" must stay undefined, or awaiting the adapter would treat it as a promise.
  return new Proxy(api, { get: (o, m) => (m in o ? o[m] : typeof m !== "string" || m === "then" || m.startsWith("_") ? undefined : (args) => rpc(m, args, { staff: staff.has(m) })) });
}

export function getApi() {
  if (!chosen) chosen = (async () => {
    if (target !== "artifact" && location.protocol.startsWith("http")) {
      try {
        const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 2500);
        const r = await fetch(`${root}api/rpc/health`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}", signal: ctl.signal });
        clearTimeout(t);
        if (r.ok && (r.headers.get("content-type") || "").includes("json")) return httpAdapter();
      } catch {}
    }
    const { createLocalAdapter } = await import("./local-adapter.js");
    return createLocalAdapter(root);
  })();
  return chosen;
}

/** A per-browser identity for holds; not personal data. */
export function clientId() {
  try {
    let id = sessionStorage.getItem("kk.client");
    if (!id) { id = "cl_" + crypto.getRandomValues(new Uint32Array(3)).join(""); sessionStorage.setItem("kk.client", id); }
    return id;
  } catch { return (window.__kkClient ||= "cl_" + Math.random().toString(36).slice(2)); }
}
