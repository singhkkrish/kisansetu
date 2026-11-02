import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { authorize, type AuthorizedUser } from "@/lib/auth/guard";
import type { Permission } from "@/lib/auth/permissions";
import { readSupabaseEnv } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";

const MAX_BODY_BYTES = 20_000;

export function jsonError(status: number, error: string, fieldErrors?: Record<string, string>) {
  return NextResponse.json(fieldErrors ? { error, fieldErrors } : { error }, { status });
}

export type RequestAuth =
  | { ok: true; supabase: SupabaseClient; user: AuthorizedUser }
  | { ok: false; response: NextResponse };

/**
 * First line of every protected route: checks configuration, the signed-in
 * user and the required permission. Nothing else should run before it.
 */
export async function authorizeRequest(permission: Permission): Promise<RequestAuth> {
  if (!readSupabaseEnv()) {
    return { ok: false, response: jsonError(503, "Server is not configured") };
  }
  const supabase = await createClient();
  const result = await authorize(supabase, permission);
  if (!result.ok) return { ok: false, response: jsonError(result.status, result.error) };
  return { ok: true, supabase, user: result.user };
}

export type JsonBody = { ok: true; data: unknown } | { ok: false; response: NextResponse };

/** Reads a small JSON body, refusing oversized or malformed input. */
export async function readJsonBody(request: Request): Promise<JsonBody> {
  let text: string;
  try {
    text = await request.text();
  } catch {
    return { ok: false, response: jsonError(400, "Could not read the request body") };
  }
  if (text.length > MAX_BODY_BYTES) {
    return { ok: false, response: jsonError(413, "Request is too large") };
  }
  try {
    return { ok: true, data: JSON.parse(text) };
  } catch {
    return { ok: false, response: jsonError(400, "Request body must be valid JSON") };
  }
}

/** Maps a Postgres error to a safe response. Database messages are never sent to the browser. */
export function dbErrorResponse(error: { code?: string; message?: string }) {
  switch (error.code) {
    case "42501":
      return jsonError(403, "You do not have permission to do this");
    case "P0002":
      return jsonError(404, "Not found");
    case "23505":
      return jsonError(409, "This record already exists");
    case "23503":
      return jsonError(422, "A referenced record does not exist");
    case "23502":
    case "23514":
    case "22023":
    case "22P02":
      return jsonError(422, "Some of the details are not valid");
    default:
      console.error("database error", error.code, error.message);
      return jsonError(500, "Something went wrong. Please try again");
  }
}
