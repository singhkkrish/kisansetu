import { NextResponse } from "next/server";
import { z } from "zod";
import { authorizeRequest, jsonError } from "@/lib/api/http";
import { createSupabaseSmsRepository } from "@/lib/services/sms-repository";
import { refreshSmsStatus, toPublicSms } from "@/lib/services/sms-service";
import { getSmsProvider } from "@/lib/sms/server";

/**
 * Asks the gateway for the delivery receipt of a sent message. Until a receipt
 * exists the message stays "sent": it is never reported as delivered by guess.
 */
export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await authorizeRequest("sms:send");
  if (!auth.ok) return auth.response;
  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) return jsonError(404, "Not found");

  try {
    const record = await refreshSmsStatus(
      { repo: createSupabaseSmsRepository(auth.supabase), provider: getSmsProvider() },
      id,
    );
    if (!record) return jsonError(404, "Not found");
    return NextResponse.json({ sms: toPublicSms(record) });
  } catch (error) {
    console.error("sms refresh failed", error);
    return jsonError(500, "Could not check the SMS status");
  }
}
