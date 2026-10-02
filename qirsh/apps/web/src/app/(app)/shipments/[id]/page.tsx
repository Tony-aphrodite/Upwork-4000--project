"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { ArrowLeft, Calculator, PackageCheck, Plus, Truck } from "lucide-react";
import { parseMoney, type Currency } from "@qirsh/money";
import { Badge, Card, Dialog, ErrorNote, Field, Loading, Money, Note, PageHeader, Stat, TableWrap, td, th, useToast } from "@/components/ui";
import { useI18n, type MessageKey } from "@/i18n/i18n";
import { useAction, useMe, useRpc } from "@/lib/db";

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
interface Dossier extends Ship {
  finance: { invoice_currency: "USD" | "EUR"; usd_per_eur_ppm: number | null; commission_bps: number; uplift_bps: number; purchase_usd_minor: number; indirect_usd_minor: number; uplifted_indirect_usd_minor: number; finalised_at: string | null };
  costs: { id: string; kind: string; amount_minor: number; currency: Currency; usd_minor: number; rate_note: string | null; incurred_on: string; note: string | null }[];
  lines: (Ship["lines"][number] & { id: string; sku: string; unit_price_minor: number; purchase_usd_minor: number | null; indirect_share_usd_minor: number | null; landed_usd_minor: number | null; landed_unit_usd_minor: number | null })[];
}

export default function ShipmentPage() {
  const { id } = useParams<{ id: string }>();
  const me = useMe()!;
  const { t, date, number, money } = useI18n();
  const toast = useToast();
  const action = useAction();
  const list = useRpc<Ship[]>("shipments_list");
  const dossier = useRpc<Dossier>(me.role === "owner" ? "shipment_dossier" : null, { p_shipment: id });
  const [cost, setCost] = useState(false);
  const ship = list.data?.find((s) => s.id === id);

  const run = async (fn: string, args: Record<string, unknown>, ok: string) => {
    try {
      await action(fn, args);
      toast("ok", ok);
    } catch (e) {
      toast("bad", (e as Error).message);
    }
  };

  if (!ship) return <Loading />;
  const d = dossier.data;
  const f = d?.finance;
  return (
    <div className="fade-in">
      <PageHeader
        back={
          <Link href="/shipments" className="mb-2 inline-flex items-center gap-1 text-sm text-ink-3 hover:text-brand">
            <ArrowLeft className="size-4 rtl:rotate-180" aria-hidden />
            {t("nav.shipments")}
          </Link>
        }
        title={ship.ref}
        subtitle={`${ship.supplier} · ${ship.origin}`}
        actions={
          <>
            {(me.role === "warehouse" || me.role === "owner") && ship.status !== "received" && ship.status !== "arrived" && (
              <button className="btn btn-secondary btn-sm" onClick={() => run("set_shipment_status", { p_shipment: id, p_status: "arrived", p_day: me.today }, t("ship.marked_arrived"))}>
                <Truck className="size-4" aria-hidden />
                {t("ship.mark_arrived")}
              </button>
            )}
            {(me.role === "warehouse" || me.role === "owner") && ship.status !== "received" && (
              <button className="btn btn-primary btn-sm" disabled={!ship.costs_final} onClick={() => run("receive_shipment", { p_shipment: id, p_day: me.today }, t("ship.received"))}>
                <PackageCheck className="size-4" aria-hidden />
                {t("ship.receive")}
              </button>
            )}
          </>
        }
      />
      <div className="mb-4 flex flex-wrap gap-2">
        <Badge tone={ship.status === "received" ? "ok" : "info"}>{t(`ship.status.${ship.status}` as MessageKey)}</Badge>
        <Badge>{t("ship.ordered_on", { date: date(ship.ordered_on) })}</Badge>
        {ship.received_on ? <Badge tone="ok">{t("ship.received_on", { date: date(ship.received_on) })}</Badge> : <Badge>{t("ship.eta", { date: date(ship.eta) })}</Badge>}
        {ship.costs_final ? <Badge tone="ok">{t("ship.costs_final")}</Badge> : <Badge tone="warn">{t("ship.costs_open")}</Badge>}
      </div>
      {!ship.costs_final && ship.status !== "received" && me.role === "warehouse" && (
        <div className="mb-4">
          <Note tone="info">{t("ship.wait_costs")}</Note>
        </div>
      )}

      {me.role !== "owner" ? (
        <Card title={t("ship.contents")} pad={false}>
          <ul className="divide-y divide-line">
            {ship.lines.map((l) => (
              <li key={l.product} className="flex justify-between gap-3 px-4 py-2.5 text-sm">
                <span>{l.product}</span>
                <span className="num font-semibold">{number(l.qty)}</span>
              </li>
            ))}
          </ul>
        </Card>
      ) : !d || !f ? (
        <Loading />
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label={t("ship.purchase")} value={<Money minor={f.purchase_usd_minor || d.lines.reduce((s, l) => s + (l.purchase_usd_minor ?? 0), 0)} currency="USD" />} hint={f.invoice_currency === "EUR" ? t("ship.eur_invoice", { rate: number((f.usd_per_eur_ppm ?? 0) / 1e6, 4), commission: number(f.commission_bps / 100, 2) }) : t("ship.usd_invoice")} />
            <Stat label={t("ship.indirect")} value={<Money minor={d.costs.reduce((s, c) => s + c.usd_minor, 0)} currency="USD" />} hint={t("ship.indirect_hint", { n: d.costs.length })} />
            <Stat label={t("ship.uplift", { pct: number(f.uplift_bps / 100) })} value={<Money minor={f.uplifted_indirect_usd_minor || Math.round((d.costs.reduce((s, c) => s + c.usd_minor, 0) * (10000 + f.uplift_bps)) / 10000)} currency="USD" />} hint={t("ship.uplift_hint")} />
            <Stat label={t("ship.landed_total")} value={<Money minor={f.finalised_at ? f.purchase_usd_minor + f.uplifted_indirect_usd_minor : null} currency="USD" />} hint={f.finalised_at ? t("ship.final_on", { date: date(f.finalised_at) }) : t("ship.not_final")} />
          </div>

          <Card
            title={t("ship.landed")}
            action={
              !ship.costs_final && (
                <button className="btn btn-primary btn-sm" onClick={() => run("finalise_landed_cost", { p_shipment: id }, t("ship.finalised"))}>
                  <Calculator className="size-4" aria-hidden />
                  {t("ship.finalise")}
                </button>
              )
            }
            pad={false}
          >
            <TableWrap label={t("ship.landed")}>
              <table className="w-full min-w-[760px]">
                <thead className="border-b border-line bg-[#f9fbfa]">
                  <tr>
                    <th className={th}>{t("ship.col.product")}</th>
                    <th className={`${th} text-end`}>{t("ship.col.qty")}</th>
                    <th className={`${th} text-end`}>{t("ship.col.invoice")}</th>
                    <th className={`${th} text-end`}>{t("ship.col.purchase")}</th>
                    <th className={`${th} text-end`}>{t("ship.col.share")}</th>
                    <th className={`${th} text-end`}>{t("ship.col.landed_unit")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {d.lines.map((l) => (
                    <tr key={l.id}>
                      <td className={td}>
                        <div className="font-medium">{l.product}</div>
                        <div className="text-xs text-ink-3">{l.sku}</div>
                      </td>
                      <td className={`${td} num text-end`}>{number(l.qty)}</td>
                      <td className={`${td} text-end`}>
                        <Money minor={l.unit_price_minor} currency={f.invoice_currency} decimals="always" />
                      </td>
                      <td className={`${td} text-end`}>
                        <Money minor={l.purchase_usd_minor} currency="USD" />
                      </td>
                      <td className={`${td} text-end text-ink-3`}>
                        <Money minor={l.indirect_share_usd_minor} currency="USD" />
                      </td>
                      <td className={`${td} text-end font-bold`}>
                        <Money minor={l.landed_unit_usd_minor} currency="USD" decimals="always" />
                        {l.purchase_usd_minor && l.landed_unit_usd_minor ? (
                          <div className="text-xs font-normal text-ink-3">
                            {t("ship.from_unit", { unit: money(Math.round(l.purchase_usd_minor / l.qty), "USD", { decimals: "always" }) })}
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
            <p className="border-t border-line px-4 py-3 text-xs text-ink-3">{t("ship.method", { pct: number(f.uplift_bps / 100) })}</p>
          </Card>

          <Card
            title={t("ship.costs")}
            action={
              !ship.costs_final && (
                <button className="btn btn-secondary btn-sm" onClick={() => setCost(true)}>
                  <Plus className="size-4" aria-hidden />
                  {t("ship.add_cost")}
                </button>
              )
            }
            pad={false}
          >
            <ul className="divide-y divide-line">
              {d.costs.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 text-sm">
                  <div>
                    <div className="font-medium">{t(`cost.${c.kind}` as MessageKey)}</div>
                    <div className="text-xs text-ink-3">
                      {date(c.incurred_on)}
                      {c.rate_note && ` · ${c.rate_note}`}
                    </div>
                  </div>
                  <div className="text-end">
                    <Money minor={c.amount_minor} currency={c.currency} className="font-medium" />
                    {c.currency !== "USD" && (
                      <div className="text-xs text-ink-3">
                        = <Money minor={c.usd_minor} currency="USD" />
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </Card>
          <CostForm open={cost} onClose={() => setCost(false)} shipment={id} />
        </div>
      )}
    </div>
  );
}

function CostForm({ open, onClose, shipment }: { open: boolean; onClose: () => void; shipment: string }) {
  const me = useMe()!;
  const { t } = useI18n();
  const action = useAction();
  const [kind, setKind] = useState("transport");
  const [currency, setCurrency] = useState<Currency>("SDG");
  const [amount, setAmount] = useState("");
  const [rate, setRate] = useState("");
  const [day, setDay] = useState(me.today);
  const [err, setErr] = useState<Error | null>(null);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t("ship.add_cost")}
      footer={
        <button
          className="btn btn-primary"
          onClick={async () => {
            setErr(null);
            try {
              const r = Number(rate.replace(/,/g, ""));
              await action("add_shipment_cost", {
                p_shipment: shipment, p_kind: kind, p_amount_minor: parseMoney(amount), p_currency: currency, p_incurred_on: day,
                ...(rate && currency !== "USD" ? { p_rate_ppm: Math.round(r * 1e6) } : {}),
              });
              onClose();
            } catch (e) {
              setErr(e as Error);
            }
          }}
        >
          {t("common.save")}
        </button>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("ship.cost_kind")} htmlFor="ck">
          <select id="ck" className="input" value={kind} onChange={(e) => setKind(e.target.value)}>
            {["freight", "insurance", "customs", "clearance", "port", "transport", "other"].map((k) => (
              <option key={k} value={k}>{t(`cost.${k}` as MessageKey)}</option>
            ))}
          </select>
        </Field>
        <Field label={t("ship.cost_currency")} htmlFor="cc">
          <select id="cc" className="input" value={currency} onChange={(e) => setCurrency(e.target.value as Currency)}>
            {me.settings.currencies.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </Field>
        <Field label={t("ship.cost_amount")} htmlFor="ca">
          <input id="ca" className="input num" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        {currency !== "USD" && (
          <Field label={t("ship.cost_rate", { currency })} htmlFor="cr" hint={t("ship.cost_rate_hint")}>
            <input id="cr" className="input num" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} />
          </Field>
        )}
        <Field label={t("ship.cost_date")} htmlFor="cd">
          <input id="cd" type="date" className="input" value={day} onChange={(e) => setDay(e.target.value)} />
        </Field>
      </div>
      <div className="mt-3">
        <ErrorNote error={err} />
      </div>
    </Dialog>
  );
}
