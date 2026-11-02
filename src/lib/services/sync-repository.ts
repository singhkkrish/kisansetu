import type { SupabaseClient } from "@supabase/supabase-js";
import type { SyncRepository } from "@/lib/services/sync-service";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Supabase-backed storage for the sync service. It runs as the signed-in
 * operator, so row level security still decides what can be read or written.
 */
export function createSupabaseSyncRepository(supabase: SupabaseClient): SyncRepository {
  return {
    async findEntryByClientId(clientId) {
      const { data, error } = await supabase
        .from("procurement_entries")
        .select("payload_hash")
        .eq("client_id", clientId)
        .maybeSingle();
      if (error) throw error;
      return data ? { payloadHash: data.payload_hash as string } : null;
    },

    async isKnownHash(deviceId, hash) {
      const stored = await supabase
        .from("procurement_entries")
        .select("id", { count: "exact", head: true })
        .eq("device_id", deviceId)
        .eq("payload_hash", hash);
      if (stored.error) throw stored.error;
      if ((stored.count ?? 0) > 0) return true;

      // Rejected entries are not stored, but their hashes are logged, so a
      // chain that runs through a rejected entry is not mistaken for a gap.
      const logged = await supabase
        .from("sync_events")
        .select("id", { count: "exact", head: true })
        .eq("device_id", deviceId)
        .eq("detail->>payloadHash", hash);
      if (logged.error) throw logged.error;
      return (logged.count ?? 0) > 0;
    },

    async farmerExists(farmerId) {
      const { count, error } = await supabase
        .from("farmer_members")
        .select("id", { count: "exact", head: true })
        .eq("id", farmerId)
        .eq("active", true);
      if (error) throw error;
      return (count ?? 0) > 0;
    },

    async getRate(date, crop, grade) {
      const { data, error } = await supabase
        .from("daily_prices")
        .select("rate_per_quintal")
        .eq("price_date", date)
        .eq("crop", crop)
        .eq("grade", grade)
        .maybeSingle();
      if (error) throw error;
      return data ? String(data.rate_per_quintal) : null;
    },

    async insertEntry(row) {
      const { error } = await supabase.from("procurement_entries").insert(row);
      if (!error) return "inserted";
      if (error.code === "23505") {
        return error.message.includes("slip_no") ? "duplicate_slip" : "duplicate_client";
      }
      throw error;
    },

    async logEvent(event) {
      const { error } = await supabase.from("sync_events").insert({
        device_id: event.deviceId,
        operator_id: event.operatorId,
        client_id: event.clientId && UUID.test(event.clientId) ? event.clientId : null,
        outcome: event.outcome,
        detail: event.detail,
      });
      if (error) throw error;
    },
  };
}
