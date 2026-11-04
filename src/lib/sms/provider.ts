/**
 * The SMS gateway contract, and a mock that needs no real gateway.
 *
 * A real gateway accepts a message first and reports delivery later. The mock
 * behaves the same way: `send` only says the message was accepted, and delivery
 * is learned from `getDeliveryReceipt`, which stays "pending" for a short while.
 * So nothing upstream can call a message delivered without a receipt saying so.
 */

export class SmsSendError extends Error {
  constructor(readonly reason: string) {
    super(`SMS gateway refused the message: ${reason}`);
    this.name = "SmsSendError";
  }
}

export interface SendRequest {
  /** 10-digit mobile number. */
  to: string;
  body: string;
  /** Mock only: make delivery fail, to exercise the failure path. */
  simulateFailure?: boolean;
}

export interface SendAccepted {
  providerRef: string;
  acceptedAt: string;
}

export type DeliveryReceipt =
  | { status: "pending" }
  | { status: "delivered"; at: string }
  | { status: "failed"; at: string; reason: string };

export interface SmsProvider {
  readonly name: string;
  send(request: SendRequest): Promise<SendAccepted>;
  getDeliveryReceipt(providerRef: string, acceptedAt: string, now?: Date): DeliveryReceipt;
}

/** How long the mock keeps a message "pending" before a receipt is available. */
export const MOCK_RECEIPT_DELAY_MS = 2000;

/**
 * Deterministic mock. The outcome is written into the provider reference, so a
 * receipt can be worked out later by any server instance with no shared state.
 *
 * Fails delivery when the caller asks for a simulated failure, or when the
 * number ends in 0000 (a handy fixed "unreachable phone" for testing).
 * Refuses outright, as a gateway would, a number that is not a valid mobile.
 */
export function createMockSmsProvider(options: { receiptDelayMs?: number } = {}): SmsProvider {
  const delay = options.receiptDelayMs ?? MOCK_RECEIPT_DELAY_MS;

  return {
    name: "mock",

    async send({ to, body, simulateFailure }) {
      if (!/^[6-9]\d{9}$/.test(to)) throw new SmsSendError("invalid_number");
      if (body.trim() === "") throw new SmsSendError("empty_message");

      const outcome = simulateFailure ? "fail-simulated" : to.endsWith("0000") ? "fail-unreachable" : "ok";
      const nonce = globalThis.crypto.randomUUID().slice(0, 8);
      return { providerRef: `mock:${outcome}:${nonce}`, acceptedAt: new Date().toISOString() };
    },

    getDeliveryReceipt(providerRef, acceptedAt, now = new Date()) {
      const readyAt = Date.parse(acceptedAt) + delay;
      if (!Number.isFinite(readyAt) || now.getTime() < readyAt) return { status: "pending" };

      const at = new Date(readyAt).toISOString();
      const outcome = providerRef.split(":")[1] ?? "";
      if (outcome === "ok") return { status: "delivered", at };
      if (outcome === "fail-simulated") return { status: "failed", at, reason: "simulated_failure" };
      if (outcome === "fail-unreachable") return { status: "failed", at, reason: "number_unreachable" };
      // A reference we do not recognise is never reported as delivered.
      return { status: "failed", at, reason: "unknown_receipt" };
    },
  };
}
