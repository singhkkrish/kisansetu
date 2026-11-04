import type { LocalDatabase, LocalNotification, LocalSmsStatus } from "@/lib/db/local";
import type { SmsLanguage } from "@/lib/sms/message";

/**
 * The offline side of farmer notifications.
 *
 * Asking for an SMS only writes a row here. It is sent once the server has
 * confirmed the entry (the server builds the message from its own copy), and
 * its status is copied back from the server's replies. Nothing here decides
 * that a message was delivered: that word only arrives from the server.
 */

export interface QueueSmsInput {
  entryClientId: string;
  operatorId: string;
  farmerId: string;
  language?: SmsLanguage;
  simulateFailure?: boolean;
  now?: Date;
}

/** Queues one slip SMS per entry. Asking again returns the existing request instead of a second one. */
export async function queueSlipSms(db: LocalDatabase, input: QueueSmsInput): Promise<LocalNotification> {
  const existing = await db.notifications.get(input.entryClientId);
  if (existing) return existing;

  const stamp = (input.now ?? new Date()).toISOString();
  const row: LocalNotification = {
    entryClientId: input.entryClientId,
    operatorId: input.operatorId,
    farmerId: input.farmerId,
    language: input.language ?? "mr",
    simulateFailure: input.simulateFailure ?? false,
    status: "queued",
    attempts: 0,
    queuedAt: stamp,
    updatedAt: stamp,
  };
  try {
    await db.notifications.add(row);
  } catch {
    // Lost a race with another tab: the other request is the one that counts.
    const winner = await db.notifications.get(input.entryClientId);
    if (winner) return winner;
    throw new Error("Could not queue the SMS");
  }
  return row;
}

/** A failed message goes back in the queue for another attempt. Delivered ones never do. */
export async function retrySlipSms(db: LocalDatabase, entryClientId: string, simulateFailure = false): Promise<boolean> {
  const row = await db.notifications.get(entryClientId);
  if (!row || row.status !== "failed") return false;
  await db.notifications.update(entryClientId, {
    status: "queued",
    simulateFailure,
    lastError: undefined,
    updatedAt: new Date().toISOString(),
  });
  return true;
}

export interface SmsQueueSummary {
  sent: number;
  delivered: number;
  failed: number;
  /** Still queued: waiting for the entry to sync, or for the network. */
  waiting: number;
  stoppedBecause?: "offline" | "signed_out" | "server_error";
}

interface ServerSms {
  id: string;
  status: "sending" | "sent" | "delivered" | "failed";
  recipientMasked: string;
  failureReason: string | null;
  statusAt: string;
}

export interface SmsQueueOptions {
  operatorId: string;
  endpoint?: string;
  fetchImpl?: typeof fetch;
}

const LOCAL_FROM_SERVER: Record<ServerSms["status"], LocalSmsStatus> = {
  sending: "sending",
  sent: "sent",
  delivered: "delivered",
  failed: "failed",
};

function fromServer(sms: ServerSms): Partial<LocalNotification> {
  return {
    status: LOCAL_FROM_SERVER[sms.status],
    smsId: sms.id,
    recipientMasked: sms.recipientMasked,
    failureReason: sms.failureReason ?? undefined,
    serverStatusAt: sms.statusAt,
    lastError: undefined,
    updatedAt: new Date().toISOString(),
  };
}

function tally(summary: SmsQueueSummary, status: LocalSmsStatus) {
  if (status === "sent") summary.sent++;
  else if (status === "delivered") summary.delivered++;
  else if (status === "failed") summary.failed++;
}

/**
 * Sends every queued SMS whose entry the server has confirmed, then asks for the
 * delivery receipt of messages that were sent but not yet confirmed. Safe to
 * call as often as you like: the server keeps one message per entry.
 */
export async function processSmsQueue(db: LocalDatabase, options: SmsQueueOptions): Promise<SmsQueueSummary> {
  const doFetch = options.fetchImpl ?? fetch;
  const endpoint = options.endpoint ?? "/api/sms";
  const summary: SmsQueueSummary = { sent: 0, delivered: 0, failed: 0, waiting: 0 };

  const mine = (await db.notifications.where("operatorId").equals(options.operatorId).toArray()).sort((a, b) =>
    a.queuedAt.localeCompare(b.queuedAt),
  );

  for (const row of mine.filter((n) => n.status === "queued" || n.status === "sending")) {
    const entry = await db.entries.where("clientId").equals(row.entryClientId).first();
    // Only a server-confirmed entry can have an SMS: the message is built from the server's copy.
    if (!entry || entry.syncStatus !== "synced") {
      summary.waiting++;
      continue;
    }

    let response: Response;
    try {
      response = await doFetch(`${endpoint}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entryClientId: row.entryClientId,
          language: row.language,
          ...(row.simulateFailure ? { simulateFailure: true } : {}),
        }),
      });
    } catch {
      await db.notifications.update(row.entryClientId, {
        attempts: row.attempts + 1,
        lastError: "no_connection",
        updatedAt: new Date().toISOString(),
      });
      summary.waiting++;
      summary.stoppedBecause = "offline";
      return summary;
    }

    if (response.status === 401) {
      summary.stoppedBecause = "signed_out";
      return summary;
    }
    if (response.status === 422) {
      const body = (await response.json().catch(() => ({}))) as { reason?: string };
      await db.notifications.update(row.entryClientId, {
        status: "unavailable",
        failureReason: body.reason ?? "invalid_request",
        attempts: row.attempts + 1,
        updatedAt: new Date().toISOString(),
      });
      continue;
    }
    if (!response.ok) {
      await db.notifications.update(row.entryClientId, {
        attempts: row.attempts + 1,
        lastError: `server_error_${response.status}`,
        updatedAt: new Date().toISOString(),
      });
      summary.waiting++;
      summary.stoppedBecause = "server_error";
      continue;
    }

    const { sms } = (await response.json()) as { sms: ServerSms };
    await db.notifications.update(row.entryClientId, { ...fromServer(sms), attempts: row.attempts + 1 });
    tally(summary, LOCAL_FROM_SERVER[sms.status]);
  }

  const refreshed = await refreshSentSms(db, options);
  summary.delivered += refreshed.delivered;
  summary.failed += refreshed.failed;
  if (refreshed.stoppedBecause && !summary.stoppedBecause) summary.stoppedBecause = refreshed.stoppedBecause;
  return summary;
}

/** Asks the server for the delivery receipt of every message that was sent but not yet confirmed. */
export async function refreshSentSms(
  db: LocalDatabase,
  options: SmsQueueOptions,
): Promise<Pick<SmsQueueSummary, "delivered" | "failed" | "stoppedBecause">> {
  const doFetch = options.fetchImpl ?? fetch;
  const endpoint = options.endpoint ?? "/api/sms";
  const result: Pick<SmsQueueSummary, "delivered" | "failed" | "stoppedBecause"> = { delivered: 0, failed: 0 };

  const sent = (await db.notifications.where("operatorId").equals(options.operatorId).toArray()).filter(
    (n) => n.status === "sent" && n.smsId,
  );
  for (const row of sent) {
    let response: Response;
    try {
      response = await doFetch(`${endpoint}/${row.smsId}/refresh`, { method: "POST" });
    } catch {
      result.stoppedBecause = "offline";
      return result;
    }
    if (response.status === 401) {
      result.stoppedBecause = "signed_out";
      return result;
    }
    if (!response.ok) continue;

    const { sms } = (await response.json()) as { sms: ServerSms };
    const patch = fromServer(sms);
    await db.notifications.update(row.entryClientId, patch);
    if (patch.status === "delivered") result.delivered++;
    if (patch.status === "failed") result.failed++;
  }
  return result;
}
