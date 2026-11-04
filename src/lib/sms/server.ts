import { createMockSmsProvider, MOCK_RECEIPT_DELAY_MS, type SmsProvider } from "@/lib/sms/provider";

/** The gateway used by the server. Today this is the mock; a real gateway would be returned here instead. */
export function getSmsProvider(): SmsProvider {
  const delay = Number(process.env.SMS_MOCK_RECEIPT_DELAY_MS);
  return createMockSmsProvider({ receiptDelayMs: Number.isFinite(delay) && delay >= 0 ? delay : MOCK_RECEIPT_DELAY_MS });
}

/** Simulated failures are a testing aid. Set SMS_ALLOW_SIMULATION=false to switch them off. */
export function simulationAllowed(): boolean {
  return process.env.SMS_ALLOW_SIMULATION !== "false";
}
