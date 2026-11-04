import { NextResponse } from "next/server";
import { authorizeRequest, dbErrorResponse, jsonError, readJsonBody } from "@/lib/api/http";
import { publishSchema } from "@/lib/prices/price-board";

/**
 * Publishes the chosen drafts, all or none. The request must carry
 * `confirm: true`, so a stray call can never publish by accident, and the
 * database records who published and when.
 */
export async function POST(request: Request) {
  const auth = await authorizeRequest("prices:write");
  if (!auth.ok) return auth.response;

  const body = await readJsonBody(request);
  if (!body.ok) return body.response;
  const parsed = publishSchema.safeParse(body.data);
  if (!parsed.success) return jsonError(422, "Confirm the prices you want to publish");

  const { data, error } = await auth.supabase.rpc("publish_prices", { p_ids: parsed.data.ids });
  if (error) return dbErrorResponse(error);
  return NextResponse.json({ published: Number(data) });
}
