import { NextResponse } from "next/server";
import { z } from "zod";
import { authorizeRequest, dbErrorResponse, jsonError, readJsonBody } from "@/lib/api/http";
import { updateDraftSchema } from "@/lib/prices/price-board";

type Context = { params: Promise<{ id: string }> };

/** Changes the rate of an unpublished price. A published price is refused by the database. */
export async function PATCH(request: Request, context: Context) {
  const auth = await authorizeRequest("prices:write");
  if (!auth.ok) return auth.response;
  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) return jsonError(404, "Not found");

  const body = await readJsonBody(request);
  if (!body.ok) return body.response;
  const parsed = updateDraftSchema.safeParse(body.data);
  if (!parsed.success) {
    return jsonError(422, "Some of the details are not valid", { rate: parsed.error.issues[0]?.message ?? "Invalid rate" });
  }

  const { error } = await auth.supabase.rpc("update_price_draft", { p_id: id, p_rate: parsed.data.rate });
  if (error) return dbErrorResponse(error);
  return NextResponse.json({ id });
}

/** Discards an unpublished price. */
export async function DELETE(_request: Request, context: Context) {
  const auth = await authorizeRequest("prices:write");
  if (!auth.ok) return auth.response;
  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) return jsonError(404, "Not found");

  const { error } = await auth.supabase.rpc("delete_price_draft", { p_id: id });
  if (error) return dbErrorResponse(error);
  return NextResponse.json({ id });
}
