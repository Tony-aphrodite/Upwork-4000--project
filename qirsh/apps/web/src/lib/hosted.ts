"use client";

/**
 * The hosted transport: the same screens, talking to a Supabase project instead of to Postgres in
 * the browser tab.
 *
 * The screens only ever call rpc(), so this file is the whole difference between the demo and a
 * deployment. Every rule, every policy and every amount still lives in the migrations; what
 * changes is where the database runs and who says who you are.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
export const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
export const HOSTED = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

export class ApiError extends Error {
  constructor(
    message: string,
    readonly code?: string,
    readonly hint?: string,
  ) {
    super(message);
  }
}

/** The same wording the in-browser demo gives, so a screen reads the same either way. */
function friendly(message: string, code?: string, hint?: string): ApiError {
  // Postgres' own "permission denied for table ..." is replaced; the database's role messages
  // ("Your role (adviser) cannot do this.") already say what happened and pass through as written.
  if (message.startsWith("permission denied")) {
    return new ApiError("You don't have permission to do that.", code, hint);
  }
  if (code === "23505") return new ApiError("That already exists.", code, hint);
  if (code === "23514") return new ApiError("Some values are out of range.", code, hint);
  if (code === "PGRST301" || message.includes("JWT")) {
    return new ApiError("You have been signed out. Sign in again and try once more.", code, hint);
  }
  return new ApiError(message, code, hint);
}

let client: SupabaseClient | null = null;
export function hostedClient(): SupabaseClient {
  client ??= createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true },
  });
  return client;
}

export interface HostedSession {
  rpc<T = unknown>(fn: string, args?: Record<string, unknown>): Promise<T>;
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
}

/**
 * Stands in for the demo's Database object. The screens use as(), subscribe(), changed() and
 * version; none of them care which of the two is underneath.
 */
export class HostedDatabase {
  private listeners = new Set<() => void>();
  version = 0;

  constructor(readonly supabase: SupabaseClient) {}

  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  }

  changed() {
    this.version++;
    this.listeners.forEach((l) => l());
  }

  /** The session is the signed-in user's, so the argument is ignored: the server decides who you are. */
  as(_userId: string | null): HostedSession {
    const supabase = this.supabase;
    return {
      async rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
        const { data, error } = await supabase.rpc(fn, args);
        if (error) throw friendly(error.message, error.code, error.hint ?? undefined);
        return data as T;
      },
      async query<T>(): Promise<T[]> {
        // There is no raw SQL over the API, which is the point: the checks that used it in the demo
        // are replaced on a hosted project by the same attempts made through the REST interface.
        throw new ApiError("Raw SQL is not available over the API. See the server checks page.");
      },
    };
  }
}
