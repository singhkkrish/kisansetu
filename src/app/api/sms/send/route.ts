import { NextResponse } from "next/server";
import { z } from "zod";
import { authorizeRequest, jsonError, readJsonBody } from "@/lib/api/http";
import { createSupabaseSmsRepository } from "@/lib/services/sms-repository";
import { sendSlipSms, toPublicSms } from "@/lib/services/sms-service";
import { getSmsProvider, simulationAllowed } from "@/lib/sms/server";

const sendSchema = z.strictObject({
  entryClientId: z.uuid(),
  language: z.enum(["mr", "en"]).default("mr"),
  simulateFailure: z.boolean().optional(),
});

/**
 * Sends the slip SMS for a procurement entry that the server already holds.
 * The message text is built here from the stored entry, never from anything the
 * browser sends, and the farmer's number never leaves the server.
 */
export async function POST(request: Request) {
  const auth = await authorizeRequest("sms:send");
  if (!auth.ok) return auth.response;

  const body = await readJsonBody(request);
  if (!body.ok) return body.response;
  const parsed = sendSchema.safeParse(body.data);
  if (!parsed.success) return jsonError(422, "Some of the details are not valid");

  try {
    const result = await sendSlipSms(
      { repo: createSupabaseSmsRepository(auth.supabase), provider: getSmsProvider() },
      {
        entryClientId: parsed.data.entryClientId,
        language: parsed.data.language,
        operatorId: auth.user.userId,
        simulateFailure: simulationAllowed() && parsed.data.simulateFailure === true,
      },
    );

    if (!result.ok) {
      if (result.reason === "entry_not_found") return jsonError(404, "This entry has not reached the server yet");
      return NextResponse.json(
        { error: result.reason === "no_phone" ? "This farmer has no phone number on file" : "The farmer's phone number is not valid", reason: result.reason },
        { status: 422 },
      );
    }
    return NextResponse.json({ sms: toPublicSms(result.record), reused: result.reused });
  } catch (error) {
    console.error("sms send failed", error);
    return jsonError(500, "Could not send the SMS. Please try again");
  }
}
