"use client";

/**
 * Prove it against this server.
 *
 * The demo's 28 checks build a fresh database from the migrations and attack it. On a hosted
 * project that is not possible: there is one database and it is the one you are signed in to. So
 * these checks do what a curious person with the anon key and a login would do, over the same REST
 * interface the screens use, and report what the database said back.
 *
 * Every one of them is an attempt to get at something the rules say you cannot have.
 */
import { useCallback, useEffect, useState } from "react";
import { ShieldCheck, ShieldAlert, Loader2 } from "lucide-react";
import { useDb } from "@/lib/db";
import { hostedClient } from "@/lib/hosted";

interface Result {
  title: string;
  asks: string;
  ok: boolean;
  detail: string;
}

export default function ServerChecks() {
  const { me, hosted } = useDb();
  const [results, setResults] = useState<Result[] | null>(null);
  const [running, setRunning] = useState(false);

  const run = useCallback(async () => {
    setRunning(true);
    const supabase = hostedClient();
    const out: Result[] = [];
    const add = (title: string, asks: string, ok: boolean, detail: string) => out.push({ title, asks, ok, detail });

    // 1. Everything you can read belongs to your own tenant.
    {
      const { data, error } = await supabase.from("orders").select("id, tenant_id, adviser_id").limit(500);
      const tenants = new Set((data ?? []).map((r) => r.tenant_id as string));
      add(
        "Orders you can read",
        "select * from orders",
        !error && tenants.size <= 1,
        error ? error.message : `${data?.length ?? 0} rows, ${tenants.size} tenant${tenants.size === 1 ? "" : "s"}`,
      );

      // 2. An adviser sees only their own orders; an owner sees the whole tenant.
      if (me?.role === "adviser") {
        const mine = (data ?? []).every((r) => r.adviser_id === me.user_id);
        add("Another adviser's orders", "select adviser_id from orders", mine, mine ? "every row is yours" : "someone else's rows came back");
      }
    }

    // 3. Cost prices and margins are in a schema the API roles have no privilege on.
    for (const table of ["shipment_costs", "sale_facts"]) {
      const { data, error } = await supabase.from(table).select("*").limit(1);
      add(
        `Cost data: ${table}`,
        `select * from ${table}`,
        Boolean(error) || (data?.length ?? 0) === 0,
        error ? error.message : "returned rows, which it should not",
      );
    }

    // 4. Writing an order straight into the table, without the function that checks the rules.
    {
      const { error } = await supabase.from("orders").insert({
        id: crypto.randomUUID(),
        tenant_id: me?.tenant.id,
        number: "HACK-1",
        kind: "order",
        status: "confirmed",
        customer_id: crypto.randomUUID(),
        adviser_id: me?.user_id,
        rate_sdg: 1,
        eur_per_usd_ppm: 1,
        value_usd_minor: 0,
        discount_usd_minor: 0,
        total_usd_minor: 0,
        total_sdg_minor: 0,
      });
      add("Inserting an order directly", "insert into orders ...", Boolean(error), error ? error.message : "the insert was accepted");
    }

    // 5. Changing the rate on an order that is already saved.
    {
      const { data: first } = await supabase.from("orders").select("id").limit(1);
      const id = first?.[0]?.id as string | undefined;
      if (id) {
        const { error } = await supabase.from("orders").update({ rate_sdg: 99999 }).eq("id", id);
        add("Changing a saved order", "update orders set rate_sdg = 99999", Boolean(error), error ? error.message : "the update was accepted");
      }
    }

    // 6. Approving your own discount by writing the row rather than asking the owner.
    {
      const { data: pendingRows } = await supabase.from("discount_approvals").select("id, status").eq("status", "pending").limit(1);
      const id = pendingRows?.[0]?.id as string | undefined;
      if (id) {
        await supabase.from("discount_approvals").update({ status: "approved" }).eq("id", id);
        const { data: after } = await supabase.from("discount_approvals").select("status").eq("id", id).maybeSingle();
        const stillPending = after?.status === "pending";
        add("Approving your own discount", "update discount_approvals set status = 'approved'", stillPending, stillPending ? "still pending" : "the status changed");
      } else {
        add("Approving your own discount", "update discount_approvals set status = 'approved'", true, "nothing is waiting for approval right now");
      }
    }

    // 7. The private helpers the policies use are not callable from outside.
    {
      const { error } = await supabase.rpc("tenant_id");
      add("Calling a private helper", "select tenant_id()", Boolean(error), error ? error.message : "it answered");
    }

    setResults(out);
    setRunning(false);
  }, [me]);

  useEffect(() => {
    if (hosted && me) void run();
  }, [hosted, me, run]);

  if (!hosted) {
    return (
      <div className="card p-5">
        <p className="text-sm text-ink-2">
          These checks are for a hosted project. In the in-browser demo the full set of 28 checks runs on the
          checks page instead.
        </p>
      </div>
    );
  }

  const passed = results?.filter((r) => r.ok).length ?? 0;

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Prove it against this server</h1>
          <p className="mt-1 max-w-2xl text-sm text-ink-2">
            Each row is an attempt to reach something the rules say you cannot have, made over the same interface
            the screens use, as the person signed in right now. A pass means the database refused it.
          </p>
        </div>
        <button onClick={run} className="btn btn-secondary" disabled={running}>
          {running ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
          Run again
        </button>
      </header>

      {results && (
        <p className="text-sm font-semibold">
          {passed} of {results.length} refused as they should be
        </p>
      )}

      <ul className="space-y-2">
        {(results ?? []).map((r) => (
          <li key={r.title} className="card flex items-start gap-3 p-4">
            {r.ok ? (
              <ShieldCheck className="mt-0.5 size-5 shrink-0 text-emerald-600" aria-hidden />
            ) : (
              <ShieldAlert className="mt-0.5 size-5 shrink-0 text-red-600" aria-hidden />
            )}
            <div className="min-w-0">
              <p className="font-semibold">{r.title}</p>
              <p className="mt-0.5 font-mono text-xs text-ink-3">{r.asks}</p>
              <p className="mt-1 text-sm text-ink-2">{r.detail}</p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
