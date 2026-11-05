import { NextResponse } from "next/server";
import { z } from "zod";
import { authorizeRequest, jsonError, readJsonBody } from "@/lib/api/http";
import { paymentErrorResponse } from "@/lib/api/payment-errors";
import { cancelRunSchema } from "@/lib/payments/schemas";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await authorizeRequest("payment_runs:create");
  if (!auth.ok) return auth.response;
  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) return jsonError(404, "Not found");

  const body = await readJsonBody(request);
  if (!body.ok) return body.response;
  const parsed = cancelRunSchema.safeParse(body.data);
  if (!parsed.success) return jsonError(422, "Please give a reason of at least 5 characters", { reason: "Write a reason" });

  const { error } = await auth.supabase.rpc("cancel_payment_run", { p_run_id: id, p_reason: parsed.data.reason });
  if (error) return paymentErrorResponse(error);
  return NextResponse.json({ id, status: "cancelled" });
}
