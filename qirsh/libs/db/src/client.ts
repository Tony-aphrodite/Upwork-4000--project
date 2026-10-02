/**
 * The demo database: real Postgres (PGlite, WebAssembly) running the same migrations a Supabase
 * project runs. Every call runs as one person: the transaction switches to the `authenticated`
 * role and sets the JWT subject, which is how Supabase's API applies row level security.
 *
 * The web app only ever calls `rpc`, the same shape as supabase.rpc(), so swapping this for a
 * hosted Supabase project changes the transport, not the screens. `query` exists for the
 * security checks, which deliberately try to read tables directly the way an attacker would.
 */
import { PGlite, type PGliteOptions, type Transaction } from "@electric-sql/pglite";
import { LOCAL, MIGRATIONS } from "./sql.generated";

export const SCHEMA_VERSION = 11; // bump to rebuild the demo database for returning visitors

export class DbError extends Error {
  constructor(
    message: string,
    readonly code?: string,
    readonly hint?: string,
  ) {
    super(message);
  }
}

function friendly(err: unknown): DbError {
  if (err instanceof DbError) return err;
  const e = err as { message?: string; code?: string; hint?: string };
  const code = e.code;
  const msg = e.message ?? String(err);
  if (code === "42501" && msg.startsWith("permission denied")) return new DbError("You don't have permission to do that.", code, e.hint);
  if (code === "23505") return new DbError("That already exists.", code, e.hint);
  if (code === "23514") return new DbError("Some values are out of range.", code, e.hint);
  return new DbError(msg, code, e.hint);
}

export type Row = Record<string, unknown>;

export interface Api {
  /** Calls a Postgres function, like supabase.rpc(). Returns its single value, or its rows. */
  rpc<T = unknown>(fn: string, args?: Record<string, unknown>): Promise<T>;
}

export interface Session extends Api {
  /** Raw SQL as this person, under RLS. Used by the security checks, never by the screens. */
  query<T = Row>(sql: string, params?: unknown[]): Promise<T[]>;
}

export interface OpenOptions {
  dataDir?: string;
  /** Pre-compiled assets for the browser (see apps/web/scripts/copy-pglite.mjs). */
  assets?: Pick<PGliteOptions, "pgliteWasmModule" | "initdbWasmModule" | "fsBundle">;
  /** Runs once when the database is new or its schema version changed. */
  seed?: (db: Database) => Promise<void>;
}

export class Database {
  private listeners = new Set<() => void>();
  version = 0;

  private constructor(readonly pg: PGlite) {}

  static async open(opts: OpenOptions = {}): Promise<Database> {
    // relaxedDurability would let PGlite answer before IndexedDB has the write; a reload right
    // after saving an order could then lose it. The whole point here is not losing entries.
    const pg = await PGlite.create({ dataDir: opts.dataDir, relaxedDurability: false, ...opts.assets });
    const db = new Database(pg);
    const meta = await pg
      .query<{ v: string | null }>("select obj_description('public.tenants'::regclass) as v")
      .then((r) => Number(r.rows[0]?.v))
      .catch(() => undefined);
    if (meta !== SCHEMA_VERSION) {
      if (meta !== undefined) await db.wipe();
      await db.install();
      if (opts.seed) await opts.seed(db);
      await pg.exec(`comment on table public.tenants is '${SCHEMA_VERSION}'`);
    }
    return db;
  }

  private async wipe() {
    await this.pg.exec(`
      drop schema if exists public cascade; create schema public;
      drop schema if exists private cascade; drop schema if exists restricted cascade; drop schema if exists auth cascade;
      grant usage on schema public to public;`);
  }

  async install() {
    await this.pg.exec("set timezone = 'UTC'");
    const shim = LOCAL.find((f) => f.name.endsWith("auth_shim.sql"));
    if (!shim) throw new Error("auth shim missing");
    await this.pg.exec(shim.sql);
    for (const m of MIGRATIONS) {
      try {
        await this.pg.exec(m.sql);
      } catch (e) {
        throw new Error(`${m.name}: ${(e as Error).message}`);
      }
    }
    for (const f of LOCAL) if (f !== shim) await this.pg.exec(f.sql);
  }

  /** Wipes and rebuilds everything, including the seed. */
  async reset(seed?: (db: Database) => Promise<void>) {
    await this.wipe();
    await this.install();
    if (seed) await seed(this);
    await this.pg.exec(`comment on table public.tenants is '${SCHEMA_VERSION}'`);
    this.changed();
  }

  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  }

  changed() {
    this.version++;
    this.listeners.forEach((l) => l());
  }

  /** A session that runs as `userId` under row level security. */
  as(userId: string | null): Session {
    const run = async <T>(fn: (tx: Transaction) => Promise<T>): Promise<T> => {
      try {
        return await this.pg.transaction(async (tx) => {
          await tx.exec(`set local role ${userId ? "authenticated" : "anon"}`);
          await tx.query("select set_config('request.jwt.claim.sub', $1, true)", [userId ?? ""]);
          return fn(tx);
        });
      } catch (err) {
        throw friendly(err);
      }
    };
    return {
      query: <T>(sql: string, params: unknown[] = []) => run(async (tx) => (await tx.query<T>(sql, params)).rows),
      rpc: async <T>(fn: string, args: Record<string, unknown> = {}) => {
        if (!/^[a-z_][a-z0-9_]*$/.test(fn)) throw new DbError("Bad function name");
        const keys = Object.keys(args);
        const sql = `select * from public.${fn}(${keys.map((k, i) => `${k} => $${i + 1}`).join(", ")})`;
        const rows = await run(async (tx) => (await tx.query<Row>(sql, keys.map((k) => toParam(args[k])))).rows);
        const first = rows[0];
        const result = (first && Object.keys(first).length === 1 && fn in first ? first[fn] : rows) as T;
        return normalise(result) as T;
      },
    };
  }

  /** Owner-level access for the seed and the tests (bypasses RLS). */
  get service() {
    return this.pg;
  }
}

/** Arrays of plain values become Postgres arrays (uuid[], text[]); objects and arrays of objects become jsonb. */
function toParam(v: unknown) {
  if (v === undefined) return null;
  if (Array.isArray(v) && v.length > 0 && v.every((x) => x === null || typeof x !== "object")) return v;
  if (v !== null && typeof v === "object" && !(v instanceof Date) && !(v instanceof Uint8Array)) return JSON.stringify(v);
  return v;
}

/** bigint columns arrive as BigInt; every amount here fits in a double exactly, so convert. */
function normalise(v: unknown): unknown {
  if (typeof v === "bigint") return Number(v);
  if (Array.isArray(v)) return v.map(normalise);
  if (v && typeof v === "object" && !(v instanceof Date) && !(v instanceof Uint8Array)) {
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, normalise(x)]));
  }
  return v;
}
