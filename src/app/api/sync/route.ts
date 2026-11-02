import { NextResponse } from "next/server";
import { DEFAULT_MAX_FUTURE_SKEW_MINUTES } from "@/lib/offline/integrity";
import { requireOperator } from "@/lib/services/operator-context";
import { createSupabaseSyncRepository } from "@/lib/services/sync-repository";
import { processSyncBatch } from "@/lib/services/sync-service";
import { readSupabaseEnv } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";
import { syncRequestSchema } from "@/lib/validation/procurement";

function maxFutureSkew(): number {
  const parsed = Number(process.env.SYNC_MAX_FUTURE_SKEW_MINUTES);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_MAX_FUTURE_SKEW_MINUTES;
}

export async function POST(request: Request) {
  if (!readSupabaseEnv()) {
    return NextResponse.json({ error: "server is not configured" }, { status: 503 });
  }
  const supabase = await createClient();
  const lookup = await requireOperator(supabase);
  if (!lookup.ok) {
    return NextResponse.json({ error: lookup.error }, { status: lookup.status });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "body must be JSON" }, { status: 400 });
  }

  const parsed = syncRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "invalid request" },
      { status: 400 },
    );
  }

  try {
    const results = await processSyncBatch(
      parsed.data.entries,
      {
        ...lookup.operator,
        deviceId: parsed.data.deviceId,
        now: new Date(),
        maxFutureSkewMinutes: maxFutureSkew(),
      },
      createSupabaseSyncRepository(supabase),
    );
    return NextResponse.json({ results });
  } catch (error) {
    console.error("sync failed", error);
    return NextResponse.json({ error: "sync failed, try again" }, { status: 500 });
  }
}
