// Booking, payment, synchronisation and attendance are separate state machines (brief section 15).
// docs/transitions.md is generated from these tables, so the documentation cannot drift from the code.
import { DomainError } from "./util.js";

export const MACHINES = {
  booking: {
    states: ["HELD", "PAYMENT_PENDING", "CONFIRMED", "CHECKED_IN", "COMPLETED", "CANCELLED", "EXPIRED", "NO_SHOW"],
    transitions: [
      ["HELD", "PAYMENT_PENDING", "customer", "Payment request created for a valid hold"],
      ["HELD", "CONFIRMED", "system/staff", "Approved payment exemption (member account, pay at club for staff bookings)"],
      ["HELD", "CANCELLED", "customer/staff", "Hold released before payment"],
      ["HELD", "EXPIRED", "system", "Hold passed its expiry"],
      ["PAYMENT_PENDING", "HELD", "system", "Payment failed or its QR expired while the hold is still valid"],
      ["PAYMENT_PENDING", "CONFIRMED", "system", "Verified settlement and the hold is still valid"],
      ["PAYMENT_PENDING", "EXPIRED", "system", "Hold and payment window passed without settlement"],
      ["PAYMENT_PENDING", "CANCELLED", "customer/staff", "Customer abandoned before settlement"],
      ["EXPIRED", "CONFIRMED", "system", "Late settlement and capacity is still free"],
      ["CONFIRMED", "CHECKED_IN", "staff", "Party arrived"],
      ["CONFIRMED", "CANCELLED", "customer/staff", "Cancellation under the accepted policy, or club closure"],
      ["CONFIRMED", "NO_SHOW", "staff", "Grace period passed and staff verified the party absent"],
      ["NO_SHOW", "CHECKED_IN", "supervisor", "Supervised correction of a wrong no-show mark"],
      ["CHECKED_IN", "COMPLETED", "staff/system", "Round finished"],
    ],
  },
  payment: {
    states: ["CREATED", "PENDING", "SUCCEEDED", "FAILED", "EXPIRED", "REFUND_PENDING", "PARTIALLY_REFUNDED", "REFUNDED"],
    transitions: [
      ["CREATED", "PENDING", "provider", "Request accepted by the provider"],
      ["PENDING", "SUCCEEDED", "provider event", "Signed settlement event"],
      ["PENDING", "FAILED", "provider event", "Declined or abandoned"],
      ["PENDING", "EXPIRED", "provider event", "QR or session expired"],
      ["EXPIRED", "SUCCEEDED", "provider event", "Settlement arrived after expiry (exception path)"],
      ["FAILED", "SUCCEEDED", "provider event", "Out-of-order delivery: settlement wins"],
      ["SUCCEEDED", "REFUND_PENDING", "system/finance", "Refund requested"],
      ["REFUND_PENDING", "REFUNDED", "provider event", "Full refund completed"],
      ["REFUND_PENDING", "PARTIALLY_REFUNDED", "provider event", "Part of the amount refunded"],
      ["PARTIALLY_REFUNDED", "REFUND_PENDING", "finance", "Further refund requested"],
    ],
  },
  sync: {
    states: ["CLEAN", "PENDING_EXPORT", "STALE", "CONFLICT", "FAILED"],
    transitions: [
      ["CLEAN", "PENDING_EXPORT", "system", "Booking changed; outbox entry written in the same transaction"],
      ["PENDING_EXPORT", "CLEAN", "worker", "Projection written with its operation ID"],
      ["PENDING_EXPORT", "FAILED", "worker", "Export failed; retried with backoff"],
      ["FAILED", "PENDING_EXPORT", "staff/worker", "Retry"],
      ["CLEAN", "STALE", "reconciler", "External copy no longer matches"],
      ["STALE", "PENDING_EXPORT", "reconciler", "Repair queued"],
      ["CLEAN", "CONFLICT", "importer", "External edit conflicts with a confirmed booking"],
      ["CONFLICT", "CLEAN", "staff", "Conflict resolved by an authorised person"],
    ],
  },
  attendance: {
    states: ["EXPECTED", "CHECKED_IN", "PARTIAL", "NO_SHOW"],
    transitions: [
      ["EXPECTED", "CHECKED_IN", "staff", "Whole party arrived"],
      ["EXPECTED", "PARTIAL", "staff", "Part of the party arrived"],
      ["EXPECTED", "NO_SHOW", "staff", "Nobody arrived within the grace period"],
      ["NO_SHOW", "CHECKED_IN", "supervisor", "Correction"],
    ],
  },
};

export function canTransition(machine, from, to) {
  return MACHINES[machine].transitions.some(([f, t]) => f === from && t === to);
}
export function assertTransition(machine, from, to) {
  if (from === to) return;
  if (!canTransition(machine, from, to)) throw new DomainError("INVALID_TRANSITION", `${machine}: ${from} -> ${to} is not allowed`, { machine, from, to });
}
