"use client";

/**
 * Nothing typed on a phone is lost when the connection drops. A save that can't reach the server
 * waits in this outbox (kept on the phone) and is sent again when the connection is back. Every
 * write carries an id made on the phone, and the database treats a repeat of the same save as the
 * same order or receipt, so sending twice is safe.
 *
 * In the demo the database is in the browser, so "offline" is simulated with a switch.
 */
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useDb } from "./db";
import { isNetworkFailure } from "./lastseen";
import { flushProofs } from "./proofs";

export interface Pending {
  key: string;
  fn: string;
  args: Record<string, unknown>;
  label: string;
  at: string;
}
interface Outbox {
  offline: boolean;
  simulated: boolean;
  setSimulated: (v: boolean) => void;
  pending: Pending[];
  /** Runs now, or queues when offline. Returns the result, or null when queued. */
  submit: <T>(fn: string, args: Record<string, unknown>, label: string) => Promise<T | null>;
  lastSynced: { label: string; result: unknown }[];
}

const Ctx = createContext<Outbox | null>(null);
const KEY = "qirsh.outbox";

export function OutboxProvider({ children }: { children: ReactNode }) {
  const { db, userId } = useDb();
  const [simulated, setSimulated] = useState(false);
  const [browserOffline, setBrowserOffline] = useState(false);
  const [pending, setPending] = useState<Pending[]>([]);
  const [lastSynced, setLastSynced] = useState<{ label: string; result: unknown }[]>([]);
  const flushing = useRef(false);
  const offline = simulated || browserOffline;

  useEffect(() => {
    try {
      setPending(JSON.parse(localStorage.getItem(KEY) ?? "[]"));
    } catch {
      /* ignore */
    }
    const on = () => setBrowserOffline(false);
    const off = () => setBrowserOffline(true);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    setBrowserOffline(!navigator.onLine);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  const save = (p: Pending[]) => {
    setPending(p);
    try {
      localStorage.setItem(KEY, JSON.stringify(p));
    } catch {
      /* ignore */
    }
  };

  const submit = useCallback(
    async <T,>(fn: string, args: Record<string, unknown>, label: string): Promise<T | null> => {
      if (!db || !userId) throw new Error("Not signed in");
      if (offline) {
        const key = String(args.p_id ?? `${fn}-${Date.now()}`);
        const next = [...pending.filter((p) => p.key !== key), { key, fn, args, label, at: new Date().toISOString() }];
        save(next);
        return null;
      }
      try {
        const result = await db.as(userId).rpc<T>(fn, args);
        db.changed();
        return result;
      } catch (e) {
        // The browser said it was online and the request still did not arrive: a dead spot, a
        // captive portal, a server that timed out. The save waits here rather than being lost, and
        // the id it carries makes the retry safe.
        if (!isNetworkFailure(e)) throw e;
        const key = String(args.p_id ?? `${fn}-${Date.now()}`);
        save([...pending.filter((p) => p.key !== key), { key, fn, args, label, at: new Date().toISOString() }]);
        return null;
      }
    },
    [db, userId, offline, pending],
  );

  // A photo can be waiting with nothing else in the queue: the receipt reached the server but the
  // image did not. Send those as soon as there is a connection again.
  useEffect(() => {
    if (!offline) void flushProofs();
  }, [offline]);

  // Back online: send what waited, oldest first. A repeat is harmless (idempotent ids).
  useEffect(() => {
    if (offline || !db || !userId || pending.length === 0 || flushing.current) return;
    flushing.current = true;
    (async () => {
      const left = [...pending];
      const done: { label: string; result: unknown }[] = [];
      while (left.length) {
        const p = left[0]!;
        try {
          const result = await db.as(userId).rpc(p.fn, p.args);
          done.push({ label: p.label, result });
        } catch (e) {
          // Still no connection: stop, keep what is left, and try again when the browser says so.
          if (isNetworkFailure(e)) break;
          // The server answered and refused it. That is an answer, so it does not stay in the queue.
          done.push({ label: p.label, result: { error: (e as Error).message } });
        }
        left.shift();
        save([...left]);
      }
      // Photos that could not leave the phone go now, too.
      await flushProofs();
      db.changed();
      setLastSynced(done);
      flushing.current = false;
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offline, db, userId, pending.length]);

  return <Ctx.Provider value={{ offline, simulated, setSimulated, pending, submit, lastSynced }}>{children}</Ctx.Provider>;
}

export function useOutbox() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useOutbox outside OutboxProvider");
  return v;
}
