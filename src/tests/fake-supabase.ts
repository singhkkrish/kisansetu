import type { SupabaseClient } from "@supabase/supabase-js";

export interface FakeSupabaseOptions {
  /** Signed-in user, or null for a signed-out request. */
  user?: { id: string; email?: string } | null;
  /** Rows returned by `.from(table)...maybeSingle()`, keyed by table. */
  tables?: Record<string, unknown>;
  /** Rows returned when a list query on `table` is awaited. */
  lists?: Record<string, unknown[]>;
  rpc?: (name: string, args: unknown) => { data?: unknown; error?: { code?: string; message?: string } | null };
}

/**
 * A minimal stand-in for the Supabase client. It records which tables were
 * queried and which database functions were called, so tests can prove that a
 * forbidden request never reached the data.
 */
export function fakeSupabase(options: FakeSupabaseOptions = {}) {
  const queriedTables: string[] = [];
  const rpcCalls: { name: string; args: unknown }[] = [];

  const client = {
    auth: {
      getUser: async () => ({
        data: { user: options.user ?? null },
        error: options.user ? null : { message: "no session" },
      }),
    },
    from(table: string) {
      queriedTables.push(table);
      const chain: Record<string, unknown> = {};
      for (const method of ["select", "eq", "or", "order", "range", "limit"]) {
        chain[method] = () => chain;
      }
      chain.maybeSingle = async () => ({ data: options.tables?.[table] ?? null, error: null });
      // Awaiting the chain itself resolves a list query.
      chain.then = (resolve: (value: unknown) => void) => {
        const data = options.lists?.[table] ?? [];
        resolve({ data, count: data.length, error: null });
      };
      return chain;
    },
    async rpc(name: string, args: unknown) {
      rpcCalls.push({ name, args });
      const result = options.rpc?.(name, args) ?? {};
      return { data: result.data ?? null, error: result.error ?? null };
    },
  };

  return { client: client as unknown as SupabaseClient, queriedTables, rpcCalls };
}

export const MANAGER_PROFILE = { role: "office_manager", centre_id: null, active: true };
export const OPERATOR_PROFILE = { role: "centre_operator", centre_id: "22222222-2222-4222-8222-222222222222", active: true };
export const USER = { id: "33333333-3333-4333-8333-333333333333", email: "staff@example.test" };
