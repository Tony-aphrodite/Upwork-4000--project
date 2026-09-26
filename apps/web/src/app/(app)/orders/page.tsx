"use client";

import Link from "next/link";
import { useState } from "react";
import { Plus, Search } from "lucide-react";
import { Badge, Card, Empty, Loading, Money, PageHeader, PaymentChip, Progress, Segmented } from "@/components/ui";
import { useI18n } from "@/i18n/i18n";
import { useMe, useRpc } from "@/lib/db";

interface Row {
  id: string;
  number: string;
  kind: "quote" | "order";
  status: string;
  created_at: string;
  customer: string;
  city: string;
  adviser: string;
  rate_sdg: number;
  total_usd_minor: number;
  total_sdg_minor: number;
  paid_sdg_minor: number;
  payment_status: "unpaid" | "partial" | "paid";
  released_at: string | null;
  valid_until: string | null;
  lines: number;
}
type Filter = "all" | "quotes" | "open" | "to_release" | "released";

export default function Orders() {
  const me = useMe()!;
  const { t, dateTime, number } = useI18n();
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const { data, loading } = useRpc<Row[]>("orders_list", { p_filter: filter, p_search: q.trim() || null });

  return (
    <div className="fade-in">
      <PageHeader
        title={t("nav.orders")}
        subtitle={me.role === "adviser" ? t("orders.subtitle_adviser") : t("orders.subtitle")}
        actions={
          me.role !== "marketing" && (
            <Link href="/orders/new" className="btn btn-primary">
              <Plus className="size-4" aria-hidden />
              {t("nav.new_order")}
            </Link>
          )
        }
      />
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Segmented
          label={t("orders.filter")}
          value={filter}
          onChange={setFilter}
          options={[
            { value: "all", label: t("orders.f.all") },
            { value: "quotes", label: t("orders.f.quotes") },
            { value: "open", label: t("orders.f.open") },
            { value: "to_release", label: t("orders.f.to_release") },
            { value: "released", label: t("orders.f.released") },
          ]}
        />
        <div className="relative sm:w-64">
          <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-ink-3" aria-hidden />
          <input className="input ps-9" placeholder={t("orders.search")} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t("orders.search")} />
        </div>
      </div>
      <Card pad={false}>
        {loading && !data ? (
          <Loading />
        ) : !data?.length ? (
          <Empty>{t("orders.none")}</Empty>
        ) : (
          <ul className="divide-y divide-line">
            {data.map((o) => {
              const expired = o.kind === "quote" && o.status === "quote" && o.valid_until !== null && o.valid_until < me.today;
              return (
                <li key={o.id}>
                  <Link href={`/orders/${o.id}`} className="grid gap-2 px-4 py-3 hover:bg-[#f7faf8] sm:grid-cols-[1fr_auto] sm:items-center">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold">{o.number}</span>
                        {o.kind === "quote" ? (
                          <Badge tone={expired ? "warn" : o.status === "converted" ? "ok" : "info"}>{t(expired ? "status.expired" : o.status === "converted" ? "status.converted" : "status.quote")}</Badge>
                        ) : o.status === "cancelled" ? (
                          <Badge tone="bad">{t("status.cancelled")}</Badge>
                        ) : (
                          <PaymentChip status={o.payment_status} />
                        )}
                        {o.released_at && <Badge tone="ok">{t("orders.released")}</Badge>}
                        {o.kind === "order" && o.status === "confirmed" && o.payment_status === "paid" && !o.released_at && <Badge tone="brand">{t("orderpage.ready")}</Badge>}
                      </div>
                      <div className="mt-0.5 truncate text-sm text-ink-2">
                        {o.customer} <span className="text-ink-3">· {o.city} · {dateTime(o.created_at)}{me.role !== "adviser" ? ` · ${o.adviser}` : ""}</span>
                      </div>
                    </div>
                    <div className="sm:w-56 sm:text-end">
                      <div className="font-semibold">
                        <Money minor={o.total_usd_minor} currency="USD" />
                        <span className="ms-2 text-sm font-normal text-ink-3">
                          <Money minor={o.total_sdg_minor} currency="SDG" />
                        </span>
                      </div>
                      {o.kind === "order" && o.status === "confirmed" && (
                        <div className="mt-1.5 flex items-center gap-2">
                          <Progress value={o.paid_sdg_minor} max={o.total_sdg_minor} tone={o.payment_status === "paid" ? "ok" : "brand"} label={t("orders.paid_progress")} />
                          <span className="num w-10 shrink-0 text-xs text-ink-3">{number(Math.floor((o.paid_sdg_minor * 100) / o.total_sdg_minor))}%</span>
                        </div>
                      )}
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
