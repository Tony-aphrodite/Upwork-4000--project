"use client";

/**
 * The demo's backend: Postgres running in this browser tab (PGlite), with the project's Supabase
 * migrations and three months of replayed business, kept in IndexedDB so entries survive a
 * reload. Screens call `rpc()` only, exactly as they would call supabase.rpc() in production.
 */
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { Database, DbError } from "@qirsh/db";
import { HOSTED, HostedDatabase, hostedClient } from "./hosted";

export type Role = "owner" | "marketing" | "adviser" | "warehouse";
export interface Me {
  user_id: string;
  full_name: string;
  email: string;
  role: Role;
  today: string;
  tenant: { id: string; name: string; slug: string; kind: "distributor" | "dealer" };
  settings: {
    brand_name: string;
    brand_color: string;
    brand_accent: string;
    logo_initials: string;
    sand_max_bps: number;
    red_max_bps: number;
    min_rate_sdg: number;
    max_transfer_sdg_minor: number;
    quote_validity_days: number;
    payment_terms: string;
    currencies: string[];
    default_locale: string;
  };
}

type Phase = "loading" | "installing" | "seeding" | "ready" | "locked" | "error";
interface DbState {
  phase: Phase;
  error?: string;
  db: Database | null;
  userId: string | null;
  me: Me | null;
  version: number;
  signIn: (id: string) => Promise<void>;
  /** Hosted only: a real email and password against Supabase Auth. */
  signInWithPassword?: (email: string, password: string) => Promise<void>;
  hosted: boolean;
  signOut: () => void;
  reset: () => Promise<void>;
  refreshMe: () => Promise<void>;
}

const Ctx = createContext<DbState | null>(null);
const USER_KEY = "qirsh.user";

export function DbProvider({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [error, setError] = useState<string>();
  const [db, setDb] = useState<Database | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [version, setVersion] = useState(0);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    // Hosted: the database is a Supabase project and the session says who you are. Nothing is
    // installed, nothing is seeded, and no Postgres is downloaded into the tab.
    if (HOSTED) {
      const supabase = hostedClient();
      const hostedDb = new HostedDatabase(supabase);
      hostedDb.subscribe(() => setVersion(hostedDb.version));
      setDb(hostedDb as unknown as Database);
      supabase.auth.getSession().then(({ data }) => {
        setUserId(data.session?.user.id ?? null);
        setPhase("ready");
      });
      supabase.auth.onAuthStateChange((_event, session) => {
        setUserId(session?.user.id ?? null);
        if (!session) setMe(null);
      });
      return;
    }

    (async () => {
      // One tab at a time owns the IndexedDB database; a second tab would corrupt it.
      const locks = (navigator as Navigator & { locks?: LockManager }).locks;
      if (locks) {
        const got = await new Promise<boolean>((resolve) => {
          void locks.request("qirsh-demo-db", { ifAvailable: true }, (lock) => {
            if (!lock) return resolve(false), undefined;
            resolve(true);
            return new Promise(() => {}); // hold for the life of the tab
          });
        });
        if (!got) return setPhase("locked");
      }
      const mod = await import("@qirsh/db");
      setPhase("installing");
      const opened = await mod.Database.open({
        dataDir: "idb://qirsh-demo",
        seed: async (d) => {
          setPhase("seeding");
          await mod.seed(d);
        },
      });
      opened.subscribe(() => setVersion(opened.version));
      setDb(opened);
      let saved: string | null = null;
      try {
        saved = localStorage.getItem(USER_KEY);
      } catch {
        /* ignore */
      }
      if (saved) setUserId(saved);
      setPhase("ready");
    })().catch((e) => {
      console.error(e);
      setError(String((e as Error).message ?? e));
      setPhase("error");
    });
  }, []);

  const refreshMe = useCallback(async () => {
    if (!db || !userId) return setMe(null);
    const m = await db.as(userId).rpc<Me | null>("me");
    setMe(m);
  }, [db, userId]);

  useEffect(() => {
    void refreshMe();
  }, [refreshMe, version]);

  // White-label: the environment's colours become the app's colours.
  useEffect(() => {
    const root = document.documentElement;
    const brand = me?.settings.brand_color ?? "#1e4d3b";
    root.style.setProperty("--brand", brand);
    root.style.setProperty("--accent", me?.settings.brand_accent ?? "#d9a441");
    root.style.setProperty("--brand-ink", contrastInk(brand));
  }, [me]);

  const signInWithPassword = useCallback(async (email: string, password: string) => {
    const { error } = await hostedClient().auth.signInWithPassword({ email, password });
    if (error) throw new Error(error.message);
  }, []);

  const signIn = useCallback(async (id: string) => {
    try {
      localStorage.setItem(USER_KEY, id);
    } catch {
      /* ignore */
    }
    setUserId(id);
  }, []);
  const signOut = useCallback(() => {
    if (HOSTED) void hostedClient().auth.signOut();
    try {
      localStorage.removeItem(USER_KEY);
    } catch {
      /* ignore */
    }
    setUserId(null);
    setMe(null);
  }, []);
  const reset = useCallback(async () => {
    if (!db) return;
    const mod = await import("@qirsh/db");
    setPhase("seeding");
    await db.reset((d) => mod.seed(d).then(() => undefined));
    setPhase("ready");
  }, [db]);

  return (
    <Ctx.Provider
      value={{ phase, error, db, userId, me, version, signIn, signInWithPassword, signOut, reset, refreshMe, hosted: HOSTED }}
    >
      {children}
    </Ctx.Provider>
  );
}

function contrastInk(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const x = c / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  });
  const lum = 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
  return lum > 0.4 ? "#15201b" : "#ffffff";
}

export function useDb() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useDb outside DbProvider");
  return v;
}

export function useMe() {
  return useDb().me;
}

/** Calls a read function and re-runs it whenever the database changes. */
export function useRpc<T>(fn: string | null, args: Record<string, unknown> = {}, deps: unknown[] = []) {
  const { db, userId, version } = useDb();
  const [state, setState] = useState<{ data: T | null; error: DbError | null; loading: boolean }>({ data: null, error: null, loading: true });
  const key = JSON.stringify(args);
  useEffect(() => {
    if (!db || !userId || !fn) return;
    let live = true;
    setState((s) => ({ ...s, loading: true }));
    db.as(userId)
      .rpc<T>(fn, args)
      .then((data) => live && setState({ data, error: null, loading: false }))
      .catch((error: DbError) => live && setState({ data: null, error, loading: false }));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, userId, fn, key, version, ...deps]);
  return state;
}

/** Calls a function that writes, then tells every screen to refresh. */
export function useAction() {
  const { db, userId } = useDb();
  return useCallback(
    async <T,>(fn: string, args: Record<string, unknown> = {}): Promise<T> => {
      if (!db || !userId) throw new Error("Not signed in");
      const result = await db.as(userId).rpc<T>(fn, args);
      db.changed();
      return result;
    },
    [db, userId],
  );
}
