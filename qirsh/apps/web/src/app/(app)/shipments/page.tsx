"use client";

import Link from "next/link";
import { Badge, Card, Empty, Loading, PageHeader } from "@/components/ui";
import { useI18n, type MessageKey } from "@/i18n/i18n";
import { useRpc } from "@/lib/db";

interface Ship {
  id: string;
  ref: string;
  supplier: string;
  origin: string;
  status: string;
  ordered_on: string;
  eta: string | null;
  arrived_on: string | null;
  received_on: string | null;
  costs_final: boolean;
  units: number;
  lines: { product: string; qty: number }[];
}

export default function Shipments() {
  const { t, date, number } = useI18n();
  const { data } = useRpc<Ship[]>("shipments_list");
  return (
    <div className="fade-in">
      <PageHeader title={t("nav.shipments")} subtitle={t("ship.subtitle")} />
      {!data ? (
        <Loading />
      ) : !data.length ? (
        <Card><Empty>{t("ship.none")}</Empty></Card>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {data.map((s) => (
            <li key={s.id}>
              <Link href={`/shipments/${s.id}`} className="card block p-4 hover:border-brand">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-semibold">{s.ref}</div>
                    <div className="text-sm text-ink-3">{s.supplier}</div>
                  </div>
                  <Badge tone={s.status === "received" ? "ok" : s.status === "in_transit" ? "info" : "warn"}>{t(`ship.status.${s.status}` as MessageKey)}</Badge>
                </div>
                <div className="mt-2 text-xs text-ink-3">
                  {s.origin} · {s.received_on ? t("ship.received_on", { date: date(s.received_on) }) : t("ship.eta", { date: date(s.eta) })}
                </div>
                <div className="mt-2 text-sm text-ink-2">
                  {t("ship.units", { n: number(s.units) })}: {s.lines.slice(0, 3).map((l) => `${number(l.qty)}× ${l.product}`).join(", ")}
                  {s.lines.length > 3 ? "…" : ""}
                </div>
                {s.status !== "received" && <div className="mt-2 text-xs">{s.costs_final ? <Badge tone="ok">{t("ship.costs_final")}</Badge> : <Badge>{t("ship.costs_open")}</Badge>}</div>}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
