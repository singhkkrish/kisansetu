import { NextResponse } from "next/server";
import { z } from "zod";
import { authorizeRequest, jsonError } from "@/lib/api/http";
import { paymentErrorResponse } from "@/lib/api/payment-errors";

/** Returns a failed payment's entries to unpaid so they can go into a new run. */
export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await authorizeRequest("payment_runs:create");
  if (!auth.ok) return auth.response;
  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) return jsonError(404, "Not found");

  const { error } = await auth.supabase.rpc("release_failed_item", { p_item_id: id });
  if (error) return paymentErrorResponse(error);
  return NextResponse.json({ id, released: true });
}
