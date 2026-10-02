"use client";

import { useState } from "react";
import { Clock, PackageCheck, PackageOpen } from "lucide-react";
import { useI18n } from "@/i18n/i18n";
import { useAction, useRpc } from "@/lib/db";
import { Badge, Card, cx, Dialog, Empty, Loading, useToast } from "./ui";

interface Pick {
  id: string;
  number: string;
  customer: string;
  city: string;
  created_at: string;
  state: "ready" | "waiting" | "released";
  released_at: string | null;
  lines: { product: string; sku: string; qty: number; on_hand: number }[];
}

/** Step 5, for the warehouse: what may leave (fully paid), what waits, what left. No amounts. */
export function PickList() {
  const { t, dateTime, number } = useI18n();
  const toast = useToast();
  const action = useAction();
  const { data, loading } = useRpc<Pick[]>("pick_list");
  const [confirm, setConfirm] = useState<Pick | null>(null);

  const release = async (p: Pick) => {
    try {
      await action("release_order", { p_order: p.id });
      toast("ok", t("pick.released", { number: p.number }));
    } catch (e) {
      toast("bad", (e as Error).message);
    }
    setConfirm(null);
  };

  if (loading && !data) return <Loading />;
  const groups: { state: Pick["state"]; title: string }[] = [
    { state: "ready", title: t("pick.ready") },
    { state: "waiting", title: t("pick.waiting") },
    { state: "released", title: t("pick.released_recent") },
  ];
  return (
    <div className="space-y-4">
      {groups.map((g) => {
        const rows = (data ?? []).filter((p) => p.state === g.state);
        return (
          <Card key={g.state} title={`${g.title} · ${rows.length}`} pad={false}>
            {rows.length === 0 ? (
              <Empty>{t(g.state === "ready" ? "pick.none_ready" : "pick.none")}</Empty>
            ) : (
              <ul className="divide-y divide-line">
                {rows.slice(0, g.state === "waiting" ? 8 : 20).map((p) => (
                  <li key={p.id} className={cx("px-4 py-3", g.state === "waiting" && "opacity-80")}>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold">{p.number}</span>
                          {g.state === "ready" ? <Badge tone="ok">{t("pick.paid")}</Badge> : g.state === "waiting" ? <Badge tone="warn"><Clock className="size-3" aria-hidden />{t("pick.not_paid")}</Badge> : <Badge>{dateTime(p.released_at)}</Badge>}
                        </div>
                        <div className="text-sm text-ink-3">
                          {p.customer} · {p.city}
                        </div>
                      </div>
                      {g.state === "ready" && (
                        <button className="btn btn-primary btn-sm" onClick={() => setConfirm(p)}>
                          <PackageOpen className="size-4" aria-hidden />
                          {t("pick.release")}
                        </button>
                      )}
                    </div>
                    <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink-2">
                      {p.lines.map((l) => (
                        <li key={l.sku}>
                          <span className="num font-semibold">{number(l.qty)}×</span> {l.product}
                          {g.state !== "released" && l.qty > l.on_hand && <span className="ms-1 text-xs font-medium text-red-ink">({t("pick.short", { n: number(l.on_hand) })})</span>}
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        );
      })}
      <Dialog
        open={!!confirm}
        onClose={() => setConfirm(null)}
        title={t("pick.confirm_title", { number: confirm?.number ?? "" })}
        footer={
          <button className="btn btn-primary" onClick={() => confirm && release(confirm)}>
            <PackageCheck className="size-4" aria-hidden />
            {t("pick.confirm")}
          </button>
        }
      >
        <p className="text-sm text-ink-2">{t("pick.confirm_body", { customer: confirm?.customer ?? "" })}</p>
        <ul className="mt-3 space-y-1 text-sm">
          {confirm?.lines.map((l) => (
            <li key={l.sku}>
              <span className="num font-semibold">{number(l.qty)}×</span> {l.product} <span className="text-xs text-ink-3">({l.sku})</span>
            </li>
          ))}
        </ul>
      </Dialog>
    </div>
  );
}
