"use client";

import Link from "next/link";
import { useState } from "react";
import { Search } from "lucide-react";
import { Badge, Card, Empty, Loading, Money, PageHeader, Segmented } from "@/components/ui";
import { useI18n, type MessageKey } from "@/i18n/i18n";
import { useMe, useRpc } from "@/lib/db";
import { LABEL_TONE } from "@/components/labels";

interface Row {
  id: string;
  code: string;
  name: string;
  city: string;
  kind: string;
  segment: string;
  pipeline: string;
  source: string;
  adviser: string | null;
  labels: { id: string; name: string; color: string }[];
  revenue_90d_usd_minor: number;
  last_order_at: string | null;
}
const PAGE = 40;


export default function Customers() {
  const me = useMe()!;
  const { t, date, number } = useI18n();
  const [q, setQ] = useState("");
  const [segment, setSegment] = useState<string>("all");
  const [label, setLabel] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const labels = useRpc<{ id: string; name: string; color: string; count: number }[]>("labels_list");
  const { data, loading } = useRpc<{ total: number; rows: Row[] }>("customers_list", { p_search: q.trim() || null, p_segment: segment === "all" ? null : segment, p_label: label, p_limit: PAGE, p_offset: page * PAGE });

  return (
    <div className="fade-in">
      <PageHeader title={t("nav.customers")} subtitle={me.role === "adviser" ? t("cust.subtitle_adviser", { n: number(data?.total ?? 0) }) : t("cust.subtitle", { n: number(data?.total ?? 0) })} />
      <div className="mb-3 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <Segmented label={t("cust.segment")} value={segment} onChange={(v) => { setSegment(v); setPage(0); }} options={[{ value: "all", label: t("cust.all") }, ...["A+", "A", "B", "C", "D"].map((s) => ({ value: s, label: s }))]} />
        <div className="relative lg:w-72">
          <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-ink-3" aria-hidden />
          <input className="input ps-9" placeholder={t("cust.search")} value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} aria-label={t("cust.search")} />
        </div>
      </div>
      <div className="mb-4 flex flex-wrap gap-1.5">
        {(labels.data ?? []).map((l) => (
          <button key={l.id} onClick={() => { setLabel(label === l.id ? null : l.id); setPage(0); }} aria-pressed={label === l.id} className={`rounded-full px-2.5 py-1 text-xs font-semibold ${LABEL_TONE[l.color] ?? ""} ${label === l.id ? "ring-2 ring-brand" : ""}`}>
            {l.name} · {number(l.count)}
          </button>
        ))}
      </div>
      <Card pad={false}>
        {loading && !data ? (
          <Loading />
        ) : !data?.rows.length ? (
          <Empty>{t("cust.none")}</Empty>
        ) : (
          <ul className="divide-y divide-line">
            {data.rows.map((c) => (
              <li key={c.id}>
                <Link href={`/customers/${c.id}`} className="grid gap-1 px-4 py-3 hover:bg-[#f7faf8] sm:grid-cols-[1fr_auto] sm:items-center">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone="brand">{c.segment}</Badge>
                      <span className="font-semibold">{c.name}</span>
                      {c.labels.map((l) => (
                        <span key={l.id} className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${LABEL_TONE[l.color] ?? ""}`}>{l.name}</span>
                      ))}
                    </div>
                    <div className="mt-0.5 text-xs text-ink-3">
                      {c.code} · {c.city} · {t(`kind.${c.kind}` as MessageKey)} · {t(`pipeline.${c.pipeline}` as MessageKey)} · {t(`source.${c.source}` as MessageKey)}
                      {me.role !== "adviser" && c.adviser ? ` · ${c.adviser}` : ""}
                    </div>
                  </div>
                  <div className="text-sm sm:text-end">
                    <Money minor={c.revenue_90d_usd_minor} currency="USD" className="font-semibold" />
                    <div className="text-xs text-ink-3">{c.last_order_at ? t("cust.last_order", { date: date(c.last_order_at) }) : t("cust.no_orders")}</div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {data && data.total > PAGE && (
        <div className="mt-4 flex items-center justify-center gap-3 text-sm">
          <button className="btn btn-secondary btn-sm" disabled={page === 0} onClick={() => setPage(page - 1)}>{t("common.previous")}</button>
          <span className="text-ink-3">{t("common.page", { a: page + 1, b: Math.ceil(data.total / PAGE) })}</span>
          <button className="btn btn-secondary btn-sm" disabled={(page + 1) * PAGE >= data.total} onClick={() => setPage(page + 1)}>{t("common.next")}</button>
        </div>
      )}
    </div>
  );
}
