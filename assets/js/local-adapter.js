// The in-browser demo backend. It runs src/core/host.js over a store kept in this browser.
// A Web Lock serialises transactions across tabs, so two tabs cannot oversell a tee time either.
// Nothing leaves the browser: no reservation and no payment is made.
import { createHost } from "./core/host.js";
import { MemoryRepo, emptyState } from "./core/repo-memory.js";
import { createSandboxProvider } from "./core/payments.js";
import { ApiError } from "./api.js";

const KEY = "kk.demo.store.v1";
const STAFF_KEY = "kk.demo.staff";

export async function createLocalAdapter(root) {
  const [config, rates] = await Promise.all([
    fetch(`${root}assets/data/demo-config.json`).then((r) => r.json()),
    fetch(`${root}assets/data/rates.json`).then((r) => r.json()),
  ]);
  let storageOk = true;
  const load = () => { try { const s = localStorage.getItem(KEY); return s ? JSON.parse(s) : null; } catch { storageOk = false; return null; } };
  const save = (st) => { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch { storageOk = false; } };
  // Web Locks serialise transactions across tabs. Some sandboxed frames refuse them; then this tab
  // runs alone (single-tab demo) and says so in describe().
  let locksOk = false;
  try { if (navigator.locks?.request) { await navigator.locks.query(); locksOk = true; } } catch { locksOk = false; }
  const lock = (fn) => (locksOk ? navigator.locks.request("kk-demo-store", fn) : fn());

  class BrowserRepo extends MemoryRepo {
    async run(fn) {
      return lock(async () => {
        const fresh = load(); if (fresh) this.state = fresh;
        const r = this.runSync(fn);
        save(this.state);
        return r;
      });
    }
    describe() { return { kind: "browser-demo", durable: false, persisted: storageOk, crossTabLock: locksOk }; }
  }
  const repo = new BrowserRepo(load() || emptyState());
  const listeners = {};
  let bc; try { bc = new BroadcastChannel("kk-demo"); } catch {}
  const emit = (channel, payload) => (listeners[channel] || []).forEach((cb) => { try { cb(payload); } catch {} });
  bc?.addEventListener("message", (e) => emit(e.data.channel, e.data.payload));
  window.addEventListener("storage", (e) => { if (e.key === KEY) { emit("availability", {}); emit("conditions", {}); emit("booking", {}); } });
  const notify = (channel, payload) => { emit(channel, payload); try { bc?.postMessage({ channel, payload }); } catch {} };
  const host = createHost({ repo, config, rates, provider: createSandboxProvider(), notify, source: "demo-sheet" });

  const actor = () => { try { return JSON.parse(sessionStorage.getItem(STAFF_KEY) || "null"); } catch { return null; } };
  const wrap = (fn) => async (...a) => { try { return await fn(...a); } catch (e) { throw e instanceof ApiError ? e : new ApiError({ code: e.code || "ERROR", message: e.message, detail: e.detail }); } };
  const api = {
    kind: "browser",
    storageOk: () => storageOk,
    subscribe(channel, cb) { (listeners[channel] ||= []).push(cb); return () => { listeners[channel] = listeners[channel].filter((x) => x !== cb); }; },
    async staffLogin(userId) { const u = config.staffUsers.find((x) => x.id === userId); if (!u) throw new ApiError({ code: "UNAUTHENTICATED", message: "Unknown demo user" }); const a = { id: u.id, role: u.role, name: u.name }; sessionStorage.setItem(STAFF_KEY, JSON.stringify(a)); return a; },
    async staffSession() { return actor(); },
    async staffLogout() { sessionStorage.removeItem(STAFF_KEY); },
    async resetDemo() { await lock(async () => { try { localStorage.removeItem(KEY); } catch {} repo.state = emptyState(); }); notify("availability", {}); notify("conditions", {}); return { ok: true }; },
  };
  return new Proxy(api, {
    get(o, m) {
      if (m in o) return o[m];
      if (typeof host[m] !== "function") return undefined;
      return wrap((args) => (m.startsWith("staff") || ["listExceptions", "resolveException", "auditLog", "draftReading", "publishReading", "correctReading", "withdrawReading", "setCourseStatus", "addNotice", "removeNotice", "listReadings", "syncHealth", "syncImport", "syncExport", "resolveConflict", "setSimulation", "setClockOffset", "deliverQueuedEvents"].includes(m) ? host[m](args || {}, actor()) : host[m](args || {})));
    },
  });
}
