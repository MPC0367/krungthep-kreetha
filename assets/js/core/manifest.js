// All-hole completion register (brief section 23). The validator rejects anything that would let
// a partial course pass for a finished one.
export const PRODUCTION_STATUSES = ["NOT_STARTED", "SOURCE_NEEDED", "GEOMETRY_DRAFT", "DATA_REVIEW", "MODEL_QA", "CLUB_APPROVAL", "APPROVED"];
export const DISPLAY_STATES = ["PENDING_SOURCE", "PHOTO_ONLY", "VERIFIED_2D", "ILLUSTRATIVE_3D", "VERIFIED_3D"];

export function validateManifest(manifest) {
  const errors = [];
  const ids = manifest.holes.map((h) => h.number);
  const want = Array.from({ length: 18 }, (_, i) => i + 1);
  for (const n of want) if (!ids.includes(n)) errors.push(`Hole ${n} is missing`);
  const dup = ids.filter((n, i) => ids.indexOf(n) !== i);
  if (dup.length) errors.push(`Duplicate hole IDs: ${[...new Set(dup)].join(", ")}`);
  if (ids.length !== 18) errors.push(`Expected exactly 18 holes, found ${ids.length}`);
  const geometry = new Map();
  for (const h of manifest.holes) {
    const p = h.production || {};
    if (!PRODUCTION_STATUSES.includes(p.status)) errors.push(`Hole ${h.number}: unknown production status ${p.status}`);
    if (!DISPLAY_STATES.includes(p.display)) errors.push(`Hole ${h.number}: unknown public display state ${p.display}`);
    if ((p.display === "VERIFIED_3D" || p.display === "VERIFIED_2D") && (p.status !== "APPROVED" || !p.approvedBy || !p.approvedOn)) errors.push(`Hole ${h.number}: marked verified without club approval`);
    if (p.display === "ILLUSTRATIVE_3D" && !h.geometry) errors.push(`Hole ${h.number}: 3D display without a geometry file`);
    if (p.display === "PHOTO_ONLY" && !(h.photos || []).length) errors.push(`Hole ${h.number}: photo display without photographs`);
    if (p.display !== "PENDING_SOURCE" && !h.diagram && !(h.photos || []).length) errors.push(`Hole ${h.number}: no public fallback (diagram or photograph)`);
    if (h.geometry) {
      if (geometry.has(h.geometry.hash)) errors.push(`Hole ${h.number} reuses the geometry of hole ${geometry.get(h.geometry.hash)}`);
      geometry.set(h.geometry.hash, h.number);
    }
  }
  return { ok: errors.length === 0, errors };
}

export function completionSummary(manifest) {
  const by = (k) => manifest.holes.reduce((m, h) => ((m[h.production[k]] = (m[h.production[k]] || 0) + 1), m), {});
  const verified3d = manifest.holes.filter((h) => h.production.display === "VERIFIED_3D").length;
  return { production: by("status"), display: by("display"), verified3d, allDetailedModelsComplete: verified3d === 18 };
}
