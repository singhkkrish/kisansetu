import { buildSmsBody, type SmsLanguage } from "@/lib/sms/message";
import { maskPhone, normalizeIndianMobile } from "@/lib/sms/phone";
import { SmsSendError, type SmsProvider } from "@/lib/sms/provider";
import type { SlipInput } from "@/lib/slip/slip";

/** What the server knows about a message. `delivered` is only ever set from a delivery receipt. */
export type SmsStatus = "sending" | "sent" | "delivered" | "failed";

export interface SmsRecord {
  id: string;
  entryId: string;
  status: SmsStatus;
  language: SmsLanguage;
  recipientMasked: string;
  body: string;
  failureReason: string | null;
  providerRef: string | null;
  attempts: number;
  createdAt: string;
  sentAt: string | null;
  statusAt: string;
}

export interface SmsSource {
  entryId: string;
  farmerId: string;
  centreId: string;
  /** The farmer's number from the registry. Used to send; never stored in the SMS log. */
  phone: string | null;
  slip: SlipInput;
}

export interface NewSms {
  entryId: string;
  farmerId: string;
  centreId: string;
  language: SmsLanguage;
  recipientMasked: string;
  body: string;
  createdBy: string;
  createdAt: string;
}

export interface SmsPatch {
  status: SmsStatus;
  failureReason?: string | null;
  providerRef?: string | null;
  attempts?: number;
  sentAt?: string | null;
  statusAt: string;
}

export interface SmsRepository {
  loadSource(entryClientId: string): Promise<SmsSource | null>;
  findByEntryId(entryId: string): Promise<SmsRecord | null>;
  getById(id: string): Promise<SmsRecord | null>;
  /** Returns null when a message for this entry already exists (a parallel request won). */
  create(row: NewSms): Promise<SmsRecord | null>;
  update(id: string, patch: SmsPatch): Promise<SmsRecord>;
}

export interface SmsDeps {
  repo: SmsRepository;
  provider: SmsProvider;
  now?: () => Date;
}

export type SendSmsResult =
  | { ok: true; record: SmsRecord; reused: boolean }
  | { ok: false; reason: "entry_not_found" | "no_phone" | "invalid_phone" };

/** A "sending" record older than this was interrupted and may be sent again. */
export const STALE_SENDING_MS = 60_000;

/**
 * Sends the slip SMS for an entry. The text is built here from the stored
 * entry, never taken from the browser, so the SMS can only say what the
 * database says. One message per entry: asking again returns the existing one,
 * except after a failure, which may be retried.
 */
export async function sendSlipSms(
  deps: SmsDeps,
  input: { entryClientId: string; language: SmsLanguage; operatorId: string; simulateFailure?: boolean },
): Promise<SendSmsResult> {
  const now = deps.now ?? (() => new Date());
  const source = await deps.repo.loadSource(input.entryClientId);
  if (!source) return { ok: false, reason: "entry_not_found" };
  if (!source.phone) return { ok: false, reason: "no_phone" };
  const mobile = normalizeIndianMobile(source.phone);
  if (!mobile) return { ok: false, reason: "invalid_phone" };

  let record = await deps.repo.findByEntryId(source.entryId);
  if (record) {
    const interrupted = record.status === "sending" && now().getTime() - Date.parse(record.statusAt) > STALE_SENDING_MS;
    if (record.status !== "failed" && !interrupted) return { ok: true, record, reused: true };
    record = await deps.repo.update(record.id, {
      status: "sending",
      failureReason: null,
      attempts: record.attempts + 1,
      statusAt: now().toISOString(),
    });
  } else {
    const created = await deps.repo.create({
      entryId: source.entryId,
      farmerId: source.farmerId,
      centreId: source.centreId,
      language: input.language,
      recipientMasked: maskPhone(mobile),
      body: buildSmsBody(source.slip, input.language),
      createdBy: input.operatorId,
      createdAt: now().toISOString(),
    });
    if (!created) {
      const existing = await deps.repo.findByEntryId(source.entryId);
      if (existing) return { ok: true, record: existing, reused: true };
      throw new Error("SMS record could not be created");
    }
    record = await deps.repo.update(created.id, { status: "sending", attempts: 1, statusAt: now().toISOString() });
  }

  try {
    const accepted = await deps.provider.send({ to: mobile, body: record.body, simulateFailure: input.simulateFailure });
    // The gateway has the message. That is "sent", not "delivered".
    record = await deps.repo.update(record.id, {
      status: "sent",
      providerRef: accepted.providerRef,
      sentAt: accepted.acceptedAt,
      statusAt: now().toISOString(),
    });
  } catch (error) {
    if (!(error instanceof SmsSendError)) throw error;
    record = await deps.repo.update(record.id, {
      status: "failed",
      failureReason: error.reason,
      statusAt: now().toISOString(),
    });
  }
  return { ok: true, record, reused: false };
}

/**
 * Asks the gateway whether a sent message arrived. Only a receipt moves a
 * message to "delivered" or "failed"; while there is no receipt it stays "sent".
 */
export async function refreshSmsStatus(deps: SmsDeps, id: string): Promise<SmsRecord | null> {
  const record = await deps.repo.getById(id);
  if (!record || record.status !== "sent" || !record.providerRef || !record.sentAt) return record;

  const receipt = deps.provider.getDeliveryReceipt(record.providerRef, record.sentAt, (deps.now ?? (() => new Date()))());
  if (receipt.status === "pending") return record;
  if (receipt.status === "delivered") {
    return deps.repo.update(record.id, { status: "delivered", statusAt: receipt.at });
  }
  return deps.repo.update(record.id, { status: "failed", failureReason: receipt.reason, statusAt: receipt.at });
}

/** What is sent to a browser: the gateway's internal reference stays on the server. */
export function toPublicSms(record: SmsRecord): Omit<SmsRecord, "providerRef"> {
  const { providerRef: _providerRef, ...rest } = record;
  return rest;
}
