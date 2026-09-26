"use client";

import Link from "next/link";
import { AlertTriangle, ArrowRight, BadgeCheck, CheckCircle2, CircleAlert, PackageOpen, Plus, Receipt, Send, Store, Truck } from "lucide-react";
import { Bars } from "@/components/Bars";
import { PickList } from "@/components/PickList";
import { Badge, Card, cx, Empty, Loading, Money, Note, PageHeader, Progress, Stat } from "@/components/ui";
import { useI18n, type MessageKey } from "@/i18n/i18n";
import { useMe, useRpc } from "@/lib/db";

interface Dash {
  role: string;
  today: string;
  low_stock: { product: string; on_hand: number; min: number }[];
  open_payments?: { orders: number; outstanding_sdg_minor: number };
  to_forward?: { receipts: number; sdg_minor: number };
  accounts?: { name: string; holder: string; limit: number; intake: number }[];
  approvals?: number;
  sales_14d?: { date: string; usd_minor: number; orders: number }[];
  month_sales_usd_minor?: number;
  cash?: { currency: "SDG" | "EUR" | "AED"; minor: number; accounts: number }[];
  exchangers?: { holder: string; sdg_minor: number }[];
  conflicts?: number;
  profit_month?: { revenue_usd: number; gross_usd: number; fx_usd: number; expenses_usd: number };
  checks?: { code: string; status: "ok" | "warn" | "fail"; count: number }[];
  ready_to_release?: number;
  waiting_payment?: number;
  incoming?: { ref: string; status: string; eta: string; units: number }[];
  crm?: Crm;
  top_products?: { product: string; units: number }[];
}
interface Crm {
  customers: number;
  active_dealers: number;
  revenue_90d_usd_minor: number;
  segments: { segment: string; customers: number; active: number; revenue_usd_minor: number }[];
  pipeline: Record<string, number>;
  sources: { source: string; customers: number; revenue_usd_minor: number }[];
  top: { id: string; name: string; city: string; segment: string; orders: number; revenue_usd_minor: number }[];
}

export default function Dashboard() {
  const me = useMe()!;
  const { t, date } = useI18n();
  const { data: d } = useRpc<Dash>("dashboard");
  const greeting = t("dash.hello", { name: me.full_name.split(" ")[0]! });

  return (
    <div className="fade-in">
      <PageHeader title={greeting} subtitle={`${t(`role.${me.role}` as MessageKey)} · ${me.tenant.name} · ${date(me.today, "long")}`} />
      {me.tenant.kind === "dealer" && (
        <div className="mb-4">
          <Note tone="info" icon={<Store className="mt-0.5 size-4 shrink-0" aria-hidden />}>
            {t("dash.dealer_env")}
          </Note>
        </div>
      )}
      {!d ? <Loading /> : me.role === "owner" ? <Owner d={d} /> : me.role === "adviser" ? <Adviser d={d} /> : me.role === "marketing" ? <Marketing d={d} /> : <Warehouse d={d} />}
    </div>
  );
}

function Sales({ d }: { d: Dash }) {
  const { t, money, date } = useI18n();
  if (!d.sales_14d) return null;
  return (
    <Card title={t("dash.sales_14d")} action={<span className="text-xs text-ink-3">{t("dash.month_sales", { amount: money(d.month_sales_usd_minor ?? 0, "USD") })}</span>}>
      <Bars label={t("dash.sales_14d")} data={d.sales_14d.map((s) => ({ key: s.date, label: date(s.date, "short"), value: s.usd_minor }))} format={(v) => money(v, "USD")} />
    </Card>
  );
}

function AccountsToday({ d }: { d: Dash }) {
  const { t, money } = useI18n();
  if (!d.accounts) return null;
  return (
    <Card title={t("dash.accounts_today")}>
      <ul className="space-y-3">
        {d.accounts.map((a) => {
          const pct = a.limit ? a.intake / a.limit : 0;
          return (
            <li key={a.name}>
              <div className="mb-1 flex flex-wrap items-center justify-between gap-x-2 text-sm">
                <span className="min-w-0 truncate">{a.name}</span>
                <span className={cx("num text-xs", pct >= 0.8 ? "font-semibold text-red-ink" : "text-ink-3")}>
                  {money(a.intake, "SDG")} / {money(a.limit, "SDG")}
                </span>
              </div>
              <Progress value={a.intake} max={a.limit} tone={pct >= 1 ? "bad" : pct >= 0.8 ? "warn" : "brand"} label={a.name} />
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function LowStock({ d }: { d: Dash }) {
  const { t, number } = useI18n();
  return (
    <Card title={t("dash.low_stock")} action={<Link href="/stock" className="text-xs font-medium text-brand">{t("common.all")}</Link>}>
      {d.low_stock.length === 0 ? (
        <p className="text-sm text-ink-3">{t("dash.low_stock_none")}</p>
      ) : (
        <ul className="space-y-2 text-sm">
          {d.low_stock.map((s) => (
            <li key={s.product} className="flex items-center justify-between gap-3">
              <span className="truncate">{s.product}</span>
              <span className="num shrink-0 text-xs">
                <span className={s.on_hand === 0 ? "font-bold text-red-ink" : "font-semibold text-warn-ink"}>{number(s.on_hand)}</span>
                <span className="text-ink-3"> / {t("dash.min", { n: number(s.min) })}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// ------------------------------------------------------------------ owner
function Owner({ d }: { d: Dash }) {
  const { t, money, percent } = useI18n();
  const p = d.profit_month!;
  const net = p.gross_usd - p.expenses_usd + p.fx_usd;
  const failing = (d.checks ?? []).filter((c) => c.status !== "ok");
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {(d.cash ?? []).map((c) => (
          <Stat key={c.currency} label={t("dash.cash", { currency: c.currency })} value={<Money minor={c.minor} currency={c.currency} />} hint={t("dash.cash_hint", { n: c.accounts })} />
        ))}
        <Stat label={t("dash.open_payments")} value={<Money minor={d.open_payments!.outstanding_sdg_minor} currency="SDG" />} hint={t("dash.open_payments_hint", { n: d.open_payments!.orders })} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title={t("dash.profit_month")} action={<Link href="/profit" className="text-xs font-medium text-brand">{t("dash.details")}</Link>} className="lg:col-span-2">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Mini label={t("profit.revenue")} value={money(p.revenue_usd, "USD")} />
            <Mini label={t("profit.gross")} value={money(p.gross_usd, "USD")} hint={p.revenue_usd ? percent(p.gross_usd / p.revenue_usd) : ""} />
            <Mini label={t("profit.fx")} value={money(p.fx_usd, "USD", { sign: true })} tone={p.fx_usd < 0 ? "bad" : "ok"} />
            <Mini label={t("profit.net_after")} value={money(net, "USD")} hint={p.revenue_usd ? percent(net / p.revenue_usd) : ""} strong />
          </div>
          <p className="mt-3 text-xs text-ink-3">{t("dash.profit_note")}</p>
        </Card>
        <Card title={t("dash.to_do")}>
          <ul className="space-y-2 text-sm">
            <Todo href="/approvals" icon={BadgeCheck} n={d.approvals ?? 0} text={t("dash.todo.approvals", { n: d.approvals ?? 0 })} />
            <Todo href="/receipts?f=to_forward" icon={Send} n={d.to_forward?.receipts ?? 0} text={t("dash.todo.forward", { n: d.to_forward?.receipts ?? 0 })} />
            <Todo href="/receipts?f=conflicts" icon={AlertTriangle} n={d.conflicts ?? 0} text={t("dash.todo.conflicts", { n: d.conflicts ?? 0 })} bad />
            <Todo href="/closing" icon={CircleAlert} n={failing.length} text={t("dash.todo.checks", { n: failing.length })} bad />
          </ul>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Sales d={d} />
        </div>
        <Card title={t("dash.exchangers")} action={<Link href="/accounts" className="text-xs font-medium text-brand">{t("common.all")}</Link>}>
          <ul className="space-y-2 text-sm">
            {(d.exchangers ?? []).map((x) => (
              <li key={x.holder} className="flex items-center justify-between gap-3">
                <span>{x.holder}</span>
                <Money minor={x.sdg_minor} currency="SDG" className="font-medium" />
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-ink-3">{t("dash.exchangers_note")}</p>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <AccountsToday d={d} />
        <Card title={t("dash.closing")} action={<Link href="/closing" className="text-xs font-medium text-brand">{t("dash.details")}</Link>}>
          <ul className="space-y-1.5 text-sm">
            {(d.checks ?? []).map((c) => (
              <li key={c.code} className="flex items-center gap-2">
                {c.status === "ok" ? <CheckCircle2 className="size-4 text-ok-ink" aria-hidden /> : <CircleAlert className={cx("size-4", c.status === "fail" ? "text-red-ink" : "text-warn-ink")} aria-hidden />}
                <span className={c.status === "ok" ? "text-ink-2" : "font-medium"}>{t(`closing.${c.code}` as MessageKey)}</span>
                {c.count > 0 && <Badge tone={c.status === "fail" ? "bad" : "warn"} className="ms-auto">{c.count}</Badge>}
              </li>
            ))}
          </ul>
        </Card>
        <LowStock d={d} />
      </div>
    </div>
  );
}

function Mini({ label, value, hint, tone, strong }: { label: string; value: string; hint?: string; tone?: "ok" | "bad"; strong?: boolean }) {
  return (
    <div>
      <div className="text-xs text-ink-3">{label}</div>
      <div className={cx("num mt-0.5 text-lg font-bold", tone === "bad" ? "text-red-ink" : tone === "ok" ? "text-ok-ink" : "", strong && "text-brand")}>{value}</div>
      {hint && <div className="text-xs text-ink-3">{hint}</div>}
    </div>
  );
}

function Todo({ href, icon: Icon, n, text, bad }: { href: string; icon: typeof Send; n: number; text: string; bad?: boolean }) {
  return (
    <li>
      <Link href={href} className={cx("flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-[#f1f5f2]", n === 0 && "text-ink-3")}>
        <Icon className={cx("size-4", n > 0 ? (bad ? "text-red-ink" : "text-warn-ink") : "text-ink-3")} aria-hidden />
        <span className="flex-1">{text}</span>
        <ArrowRight className="size-4 text-ink-3 rtl:rotate-180" aria-hidden />
      </Link>
    </li>
  );
}

// ------------------------------------------------------------------ adviser
function Adviser({ d }: { d: Dash }) {
  const { t } = useI18n();
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:flex">
        <Link href="/orders/new" className="btn btn-primary">
          <Plus className="size-4" aria-hidden />
          {t("nav.new_order")}
        </Link>
        <Link href="/receipts/new" className="btn btn-secondary">
          <Receipt className="size-4" aria-hidden />
          {t("receipts.record")}
        </Link>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label={t("dash.my_open")} value={<Money minor={d.open_payments!.outstanding_sdg_minor} currency="SDG" />} hint={t("dash.open_payments_hint", { n: d.open_payments!.orders })} />
        <Stat label={t("dash.my_forward")} value={d.to_forward!.receipts} hint={<Money minor={d.to_forward!.sdg_minor} currency="SDG" />} tone={d.to_forward!.receipts ? "warn" : undefined} />
        <Stat label={t("dash.my_approvals")} value={d.approvals ?? 0} hint={t("dash.my_approvals_hint")} />
        <Stat label={t("dash.my_month")} value={<Money minor={d.month_sales_usd_minor ?? 0} currency="USD" />} />
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Sales d={d} />
        </div>
        <AccountsToday d={d} />
      </div>
      <LowStock d={d} />
    </div>
  );
}

// ------------------------------------------------------------------ marketing
function Marketing({ d }: { d: Dash }) {
  const { t, money, number } = useI18n();
  const c = d.crm!;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label={t("crm.customers")} value={number(c.customers)} />
        <Stat label={t("crm.active")} value={number(c.active_dealers)} hint={t("crm.active_hint")} />
        <Stat label={t("crm.revenue_90d")} value={<Money minor={c.revenue_90d_usd_minor} currency="USD" />} />
        <Stat label={t("crm.per_active")} value={<Money minor={c.active_dealers ? Math.round(c.revenue_90d_usd_minor / c.active_dealers) : 0} currency="USD" />} hint={t("crm.per_active_hint")} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title={t("crm.segments")}>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-ink-3">
                <th className="py-1 text-start font-medium">{t("crm.segment")}</th>
                <th className="py-1 text-end font-medium">{t("crm.customers")}</th>
                <th className="py-1 text-end font-medium">{t("crm.active")}</th>
                <th className="py-1 text-end font-medium">{t("crm.per_active")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {c.segments.map((s) => (
                <tr key={s.segment}>
                  <td className="py-2"><Badge tone="brand">{s.segment}</Badge></td>
                  <td className="num py-2 text-end">{number(s.customers)}</td>
                  <td className="num py-2 text-end">{number(s.active)}</td>
                  <td className="py-2 text-end"><Money minor={s.active ? Math.round(s.revenue_usd_minor / s.active) : 0} currency="USD" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        <Card title={t("crm.top")}>
          <ol className="space-y-2 text-sm">
            {c.top.map((x, i) => (
              <li key={x.id} className="flex items-center gap-3">
                <span className="num w-5 text-xs text-ink-3">{i + 1}</span>
                <Link href={`/customers/${x.id}`} className="min-w-0 flex-1 truncate hover:text-brand">
                  {x.name} <span className="text-ink-3">· {x.city}</span>
                </Link>
                <Money minor={x.revenue_usd_minor} currency="USD" className="font-medium" />
              </li>
            ))}
          </ol>
        </Card>
        <Card title={t("crm.pipeline")}>
          <div className="flex flex-wrap gap-2">
            {["lead", "contacted", "quoted", "active", "dormant", "lost"].map((p) => (
              <div key={p} className="rounded-lg border border-line px-3 py-2 text-center">
                <div className="num text-lg font-bold">{number(c.pipeline[p] ?? 0)}</div>
                <div className="text-xs text-ink-3">{t(`pipeline.${p}` as MessageKey)}</div>
              </div>
            ))}
          </div>
        </Card>
        <Card title={t("crm.sources")}>
          <ul className="space-y-2 text-sm">
            {c.sources.map((s) => (
              <li key={s.source} className="flex items-center justify-between gap-3">
                <span>{t(`source.${s.source}` as MessageKey)}</span>
                <span className="text-xs text-ink-3">
                  {t("crm.n_customers", { n: number(s.customers) })} · <span className="font-medium text-ink">{money(s.revenue_usd_minor, "USD")}</span>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title={t("dash.top_products")}>
          <ul className="space-y-2 text-sm">
            {(d.top_products ?? []).map((p) => (
              <li key={p.product} className="flex justify-between gap-3">
                <span className="truncate">{p.product}</span>
                <span className="num text-ink-3">{t("dash.units", { n: number(p.units) })}</span>
              </li>
            ))}
          </ul>
        </Card>
        <LowStock d={d} />
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ warehouse
function Warehouse({ d }: { d: Dash }) {
  const { t, date, number } = useI18n();
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label={t("dash.ready")} value={number(d.ready_to_release ?? 0)} icon={<PackageOpen className="size-4" aria-hidden />} tone={d.ready_to_release ? "ok" : undefined} />
        <Stat label={t("dash.waiting")} value={number(d.waiting_payment ?? 0)} hint={t("dash.waiting_hint")} />
        <Stat label={t("dash.incoming")} value={number((d.incoming ?? []).length)} icon={<Truck className="size-4" aria-hidden />} />
        <Stat label={t("dash.low_stock")} value={number(d.low_stock.length)} tone={d.low_stock.length ? "warn" : undefined} />
      </div>
      <PickList />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title={t("dash.incoming")}>
          {(d.incoming ?? []).length === 0 ? (
            <Empty>{t("dash.incoming_none")}</Empty>
          ) : (
            <ul className="space-y-2 text-sm">
              {d.incoming!.map((s) => (
                <li key={s.ref} className="flex items-center justify-between gap-3">
                  <span>
                    <span className="font-medium">{s.ref}</span> <Badge tone="info">{t(`ship.status.${s.status}` as MessageKey)}</Badge>
                  </span>
                  <span className="text-xs text-ink-3">{t("dash.eta", { date: date(s.eta), n: number(s.units) })}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <LowStock d={d} />
      </div>
    </div>
  );
}
