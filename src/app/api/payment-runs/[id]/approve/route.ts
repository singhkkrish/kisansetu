import { NextResponse } from "next/server";
import { z } from "zod";
import { authorizeRequest, jsonError } from "@/lib/api/http";
import { paymentErrorResponse } from "@/lib/api/payment-errors";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await authorizeRequest("payment_runs:approve");
  if (!auth.ok) return auth.response;
  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) return jsonError(404, "Not found");

  const { error } = await auth.supabase.rpc("approve_payment_run", { p_run_id: id });
  if (error) return paymentErrorResponse(error);
  return NextResponse.json({ id, status: "approved" });
}
