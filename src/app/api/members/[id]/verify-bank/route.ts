import { NextResponse } from "next/server";
import { z } from "zod";
import { authorizeRequest, dbErrorResponse, jsonError } from "@/lib/api/http";

/** Marks a farmer's bank account as verified. Office managers only. */
export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await authorizeRequest("members:bank:verify");
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) return jsonError(404, "Not found");

  const { error } = await auth.supabase.rpc("verify_farmer_bank", { p_id: id });
  if (error) return dbErrorResponse(error);

  return NextResponse.json({ id, verified: true });
}
