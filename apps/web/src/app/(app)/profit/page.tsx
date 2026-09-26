"use client";

import { useMemo, useState } from "react";
import { Info, Lock } from "lucide-react";
import { Card, cx, Loading, Money, Note, PageHeader, Segmented, TableWrap, td, th } from "@/components/ui";
import { useI18n, type MessageKey } from "@/i18n/i18n";
import { useMe, useRpc } from "@/lib/db";

interface Row {
  key: string;
  label: string;
  units: number;
  revenue_usd: number; revenue_eur: number;
  cost_usd: number; cost_eur: number;
  gross_usd: number; gross_eur: number;
  expenses_usd: number; expenses_eur: number;
  net_before_usd: number; net_before_eur: number;
  fx_usd: number; fx_eur: number;
  net_after_usd: number; net_after_eur: number;
}
type By = "month" | "shipment" | "product" | "customer" | "adviser" | "order" | "route";
type Period = "month" | "last_month" | "quarter" | "all";

function range(today: string, p: Period) {
  const d = new Date(`${today}T12:00:00Z`);
  const iso = (x: Date) => x.toISOString().slice(0, 10);
  const first = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
  if (p === "month") return { from: iso(first), to: today };
  if (p === "last_month") return { from: iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1))), to: iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 0))) };
  if (p === "quarter") return { from: iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 2, 1))), to: today };
  return { from: "2000-01-01", to: today };
}

export default function Profit() {
  const me = useMe()!;
  const { t, money, percent, date, number } = useI18n();
  const [by, setBy] = useState<By>("month");
  const [period, setPeriod] = useState<Period>("quarter");
  const [cur, setCur] = useState<"usd" | "eur">("usd");
  const [asMargin, setAsMargin] = useState(false);
  const r = range(me.today, period);
  const { data, loading } = useRpc<Row[]>("profit_report", { p_from: r.from, p_to: r.to, p_by: by });
  const C = cur === "usd" ? "USD" : "EUR";
  const v = (row: Row, k: "revenue" | "gross" | "expenses" | "net_before" | "fx" | "net_after") => row[`${k}_${cur}` as keyof Row] as number;

  const total = useMemo(() => {
    const z = { key: "total", label: t("profit.total"), units: 0 } as Row;
    for (const row of data ?? []) for (const k of Object.keys(row) as (keyof Row)[]) if (typeof row[k] === "number") (z[k] as number) = ((z[k] as number) ?? 0) + (row[k] as number);
    return z;
  }, [data, t]);

  const cell = (row: Row, k: "gross" | "expenses" | "net_before" | "fx" | "net_after", signed = false) => {
    const amount = v(row, k);
    const rev = v(row, "revenue");
    if (asMargin && k !== "expenses") return <span className="num">{rev ? percent(amount / rev) : "—"}</span>;
    return <Money minor={k === "expenses" ? -amount : amount} currency={C} sign={signed} className={cx(signed && amount < 0 && "text-red-ink", signed && amount > 0 && "text-ok-ink")} />;
  };

  const cols = by === "route"
    ? [{ k: "fx", label: t("profit.fx") }]
    : [
        { k: "revenue", label: t("profit.revenue") },
        { k: "gross", label: t("profit.gross") },
        { k: "expenses", label: t("profit.expenses") },
        { k: "net_before", label: t("profit.net_before") },
        { k: "fx", label: t("profit.fx") },
        { k: "net_after", label: t("profit.net_after") },
      ];

  const row = (x: Row, strong = false) => (
    <tr key={x.key} className={cx(strong && "border-t-2 border-line bg-[#f9fbfa] font-bold", x.key.startsWith("~") && "text-ink-3")}>
      <td className={td}>
        <div className={strong ? "font-bold" : "font-medium"}>{x.key.startsWith("~") ? t(`profit.key.${x.key.slice(1)}` as MessageKey) : by === "month" && !strong ? date(`${x.key}-01`, "month") : x.label}</div>
        {!strong && by !== "route" && by !== "month" && x.units > 0 && <div className="text-xs text-ink-3">{t("profit.units", { n: number(x.units) })}</div>}
      </td>
      {cols.map((c) => (
        <td key={c.k} className={`${td} text-end`}>
          {c.k === "revenue" ? <Money minor={v(x, "revenue")} currency={C} /> : cell(x, c.k as "gross", c.k === "fx")}
        </td>
      ))}
    </tr>
  );

  return (
    <div className="fade-in">
      <PageHeader title={t("nav.profit")} subtitle={period === "all" ? t("profit.subtitle_all", { to: date(r.to) }) : t("profit.subtitle", { from: date(r.from), to: date(r.to) })} />
      <div className="mb-3 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <Segmented label={t("profit.group")} value={by} onChange={setBy} options={(["month", "shipment", "product", "customer", "adviser", "order", "route"] as By[]).map((b) => ({ value: b, label: t(`profit.by.${b}` as MessageKey) }))} />
        <div className="flex flex-wrap gap-2">
          <Segmented label={t("profit.period")} value={period} onChange={setPeriod} options={(["month", "last_month", "quarter", "all"] as Period[]).map((p) => ({ value: p, label: t(`profit.p.${p}` as MessageKey) }))} />
          <Segmented label={t("profit.currency")} value={cur} onChange={setCur} options={[{ value: "usd", label: "USD" }, { value: "eur", label: "EUR" }]} />
          <Segmented label={t("profit.show")} value={asMargin ? "margin" : "amount"} onChange={(x) => setAsMargin(x === "margin")} options={[{ value: "amount", label: t("profit.amount") }, { value: "margin", label: t("profit.margin") }]} />
        </div>
      </div>
      <Card pad={false}>
        {loading && !data ? (
          <Loading />
        ) : (
          <TableWrap label={t("nav.profit")}>
            <table className="w-full min-w-[820px]">
              <thead className="border-b border-line bg-[#f9fbfa]">
                <tr>
                  <th className={th}>{t(`profit.by.${by}` as MessageKey)}</th>
                  {cols.map((c) => (
                    <th key={c.k} className={`${th} text-end`}>{c.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {(data ?? []).slice(0, 200).map((x) => row(x))}
                {data && data.length > 1 && row(total, true)}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Note tone="info" icon={<Lock className="mt-0.5 size-4 shrink-0" aria-hidden />}>
          <p className="font-semibold">{t("profit.stable.title")}</p>
          <p className="mt-1">{t("profit.stable.body")}</p>
        </Note>
        <Note tone="info" icon={<Info className="mt-0.5 size-4 shrink-0" aria-hidden />}>
          <p className="font-semibold">{t("profit.how.title")}</p>
          <p className="mt-1">{t("profit.how.body")}</p>
        </Note>
      </div>
      {by === "route" && (
        <p className="mt-3 text-sm text-ink-3">{t("profit.route_note", { amount: money(v(total, "fx"), C, { sign: true }) })}</p>
      )}
    </div>
  );
}
