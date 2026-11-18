// Sandbox payment provider. It mimics the shape of a hosted provider (payment intents, signed
// webhook events, refunds) without moving money. A live adapter (for example Stripe with
// PromptPay) implements the same three calls; see docs/adapters.md.
import { hmacHex, randomId, safeEqual } from "./util.js";

export const SANDBOX_SECRET = "whsec_demo_only_not_a_real_secret";

export function createSandboxProvider({ secret = SANDBOX_SECRET } = {}) {
  return {
    id: "sandbox",
    live: false,
    methods: ["promptpay", "card"],
    createIntent({ amountMinor, method, reference, expiresAt }) {
      const id = randomId("pi");
      return {
        providerRef: id, status: "PENDING", method, amountMinor, expiresAt,
        // A dynamic QR is tied to this one payment request. The sandbox payload is not scannable.
        qrPayload: method === "promptpay" ? `SANDBOX-PROMPTPAY|${reference}|${amountMinor}|${id}` : null,
      };
    },
    async signEvent(event) {
      const body = JSON.stringify(event);
      return { body, signature: await hmacHex(secret, body) };
    },
    /** Verify against the unmodified request body, as a real webhook must be. */
    async verify(body, signature) { return safeEqual(await hmacHex(secret, body), signature || ""); },
    makeEvent(type, data, created) { return { id: randomId("evt"), type, created, data }; },
  };
}
