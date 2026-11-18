// In-memory record store with all-or-nothing transactions. The browser demo persists it (with a
// cross-tab lock); unit tests use it directly. server/repo-sqlite.mjs implements the same surface.
import { clone, DomainError } from "./util.js";

export const TABLES = ["holds", "bookings", "payments", "events", "refunds", "exceptions", "external", "closures", "readings", "notices", "kv", "audit", "outbox", "idem", "pending"];

export function emptyState() { return { tables: Object.fromEntries(TABLES.map((t) => [t, {}])) }; }

export function txHandle(state) {
  const tbl = (name) => { if (!state.tables[name]) state.tables[name] = {}; return state.tables[name]; };
  return {
    get: (t, id) => clone(tbl(t)[id]) ?? null,
    put: (t, rec) => { if (!rec || !rec.id) throw new DomainError("INVALID", `put ${t}: record needs an id`); tbl(t)[rec.id] = clone(rec); return rec; },
    insert: (t, rec) => { if (tbl(t)[rec.id]) throw new DomainError("DUPLICATE", `${t}/${rec.id} already exists`); tbl(t)[rec.id] = clone(rec); return rec; },
    del: (t, id) => { delete tbl(t)[id]; },
    list: (t, filter) => {
      const all = Object.values(tbl(t)).map(clone);
      if (!filter) return all;
      if (typeof filter === "function") return all.filter(filter);
      return all.filter((r) => Object.entries(filter).every(([k, v]) => (Array.isArray(v) ? v.includes(r[k]) : r[k] === v)));
    },
  };
}

export class MemoryRepo {
  constructor(state) { this.state = state || emptyState(); }
  /** Runs fn atomically: on any error the state is restored exactly. Single-threaded, so serialised. */
  async run(fn) { return this.runSync(fn); }
  runSync(fn) {
    const before = JSON.stringify(this.state);
    try { return fn(txHandle(this.state)); } catch (e) { this.state = JSON.parse(before); throw e; }
  }
  describe() { return { kind: "memory", durable: false }; }
}
