// Least-privilege roles for the operations console (brief section 20). Enforced in the service
// layer, so calling the API directly cannot skip it.
import { DomainError } from "./util.js";

export const ROLES = {
  admin: ["teesheet.view", "contact.view", "booking.create", "booking.checkin", "booking.noshow", "booking.cancel", "booking.move", "attendance.correct", "closure.manage", "refund.issue", "exception.resolve", "conditions.draft", "conditions.publish", "notice.manage", "sync.manage", "audit.view", "demo.control"],
  reception: ["teesheet.view", "contact.view", "booking.create", "booking.checkin", "booking.noshow", "booking.cancel", "booking.move", "attendance.correct", "exception.view"],
  greenkeeper: ["conditions.draft", "conditions.publish", "notice.manage", "teesheet.view"],
  editor: ["conditions.draft", "notice.manage"],
  finance: ["teesheet.view", "refund.issue", "exception.view", "exception.resolve", "audit.view"],
  committee: ["teesheet.view", "audit.view", "exception.view"],
};
ROLES.admin.push("exception.view");

export function can(actor, perm) { return !!actor && (ROLES[actor.role] || []).includes(perm); }
export function require(actor, perm) {
  if (!actor) throw new DomainError("UNAUTHENTICATED", "Sign in to the operations console first");
  if (!can(actor, perm)) throw new DomainError("FORBIDDEN", `The ${actor.role} role cannot ${perm}`, { role: actor.role, perm });
}
export function maskName(name) {
  if (!name) return "";
  const parts = String(name).trim().split(/\s+/);
  return parts.map((p, i) => (i === 0 ? p : p[0] + ".")).join(" ");
}
