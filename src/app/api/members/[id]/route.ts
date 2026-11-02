import { NextResponse } from "next/server";
import { z } from "zod";
import { authorizeRequest, dbErrorResponse, jsonError, readJsonBody } from "@/lib/api/http";
import { can } from "@/lib/auth/permissions";
import { getMaskedBank, getMember } from "@/lib/services/members";
import { issuesToFieldErrors, memberUpdateSchema, toFarmerPayload } from "@/lib/validation/member";

type Context = { params: Promise<{ id: string }> };

async function readId(context: Context): Promise<string | null> {
  const { id } = await context.params;
  return z.uuid().safeParse(id).success ? id : null;
}

/** One farmer. The masked bank account is included for office managers only. */
export async function GET(_request: Request, context: Context) {
  const auth = await authorizeRequest("members:read");
  if (!auth.ok) return auth.response;

  const id = await readId(context);
  if (!id) return jsonError(404, "Not found");

  try {
    const member = await getMember(auth.supabase, id);
    if (!member) return jsonError(404, "Not found");

    const bank = can(auth.user.role, "members:bank:read")
      ? await getMaskedBank(auth.supabase, id)
      : undefined;
    return NextResponse.json({ member, ...(bank !== undefined ? { bank } : {}) });
  } catch (error) {
    console.error("member lookup failed", error);
    return jsonError(500, "Could not load the farmer");
  }
}

/** Edit a farmer. Office managers only. */
export async function PUT(request: Request, context: Context) {
  const auth = await authorizeRequest("members:write");
  if (!auth.ok) return auth.response;

  const id = await readId(context);
  if (!id) return jsonError(404, "Not found");

  const body = await readJsonBody(request);
  if (!body.ok) return body.response;

  const parsed = memberUpdateSchema.safeParse(body.data);
  if (!parsed.success) {
    return jsonError(422, "Please correct the highlighted fields", issuesToFieldErrors(parsed.error));
  }

  const { error } = await auth.supabase.rpc("update_farmer", {
    p_id: id,
    p: toFarmerPayload(parsed.data),
  });
  if (error) return dbErrorResponse(error);

  return NextResponse.json({ id });
}
