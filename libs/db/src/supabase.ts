/**
 * The production transport. The screens only use `Api.rpc`, so moving from the in-browser demo
 * to a hosted Supabase project is this adapter plus Supabase Auth for the session:
 *
 *   const supabase = createClient(url, anonKey);
 *   const api = supabaseApi(supabase);
 *
 * Row level security and every rule stay exactly where they are: in the migrations.
 */
import type { Api } from "./client";
import { DbError } from "./client";

interface RpcClient {
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string; code?: string; hint?: string } | null }>;
}

export function supabaseApi(client: RpcClient): Api {
  return {
    async rpc<T>(fn: string, args: Record<string, unknown> = {}) {
      const { data, error } = await client.rpc(fn, args);
      if (error) throw new DbError(error.message, error.code, error.hint);
      return data as T;
    },
  };
}
