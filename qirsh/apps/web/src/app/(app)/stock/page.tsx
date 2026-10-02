"use client";

import { useState } from "react";
import { Minus } from "lucide-react";
import { Badge, Card, cx, Dialog, ErrorNote, Field, Loading, Money, PageHeader, Segmented, TableWrap, td, th, useToast } from "@/components/ui";
import { useI18n, type MessageKey } from "@/i18n/i18n";
import { useAction, useMe, useRpc } from "@/lib/db";

interface Product {
  id: string;
  sku: string;
  name: string;
  category: string;
  price_usd_minor: number | null;
  min_stock: number;
  on_hand: number;
  in_transit: number;
  committed: number;
}
interface Move {
  id: string;
  kind: "receive" | "release" | "adjust";
  qty: number;
  product: string;
  created_at: string;
  note: string | null;
  shipment: string | null;
  order_number: string | null;
  by: string | null;
}

export default function Stock() {
  const me = useMe()!;
  const { t, number, dateTime } = useI18n();
  const toast = useToast();
  const action = useAction();
  const [tab, setTab] = useState<"levels" | "movements">("levels");
  const products = useRpc<Product[]>("catalogue");
  const moves = useRpc<Move[]>(tab === "movements" ? "movements_list" : null, { p_limit: 150 });
  const [adjust, setAdjust] = useState<Product | null>(null);
  const [qty, setQty] = useState("1");
  const [note, setNote] = useState("");
  const [err, setErr] = useState<Error | null>(null);
  const priced = me.role !== "warehouse";

  return (
    <div className="fade-in">
      <PageHeader title={t("nav.stock")} subtitle={t("stock.subtitle")} />
      <div className="mb-4">
        <Segmented label={t("stock.tabs")} value={tab} onChange={setTab} options={[{ value: "levels", label: t("stock.levels") }, { value: "movements", label: t("stock.movements") }]} />
      </div>
      {tab === "levels" ? (
        <Card pad={false}>
          {!products.data ? (
            <Loading />
          ) : (
            <TableWrap label={t("stock.levels")}>
              <table className="w-full min-w-[700px]">
                <thead className="border-b border-line bg-[#f9fbfa]">
                  <tr>
                    <th className={th}>{t("stock.col.product")}</th>
                    {priced && <th className={`${th} text-end`}>{t("stock.col.price")}</th>}
                    <th className={`${th} text-end`}>{t("stock.col.on_hand")}</th>
                    <th className={`${th} text-end`}>{t("stock.col.committed")}</th>
                    <th className={`${th} text-end`}>{t("stock.col.available")}</th>
                    <th className={`${th} text-end`}>{t("stock.col.in_transit")}</th>
                    <th className={`${th} text-end`}>{t("stock.col.min")}</th>
                    {(me.role === "warehouse" || me.role === "owner") && <th className={th} />}
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {products.data.map((p) => {
                    const low = p.on_hand < p.min_stock;
                    return (
                      <tr key={p.id} className={cx(low && "bg-warn-bg/40")}>
                        <td className={td}>
                          <div className="font-medium">{p.name}</div>
                          <div className="text-xs text-ink-3">
                            {p.sku} · {t(`cat.${p.category}` as MessageKey)}
                          </div>
                        </td>
                        {priced && (
                          <td className={`${td} text-end`}>
                            <Money minor={p.price_usd_minor} currency="USD" />
                          </td>
                        )}
                        <td className={`${td} num text-end font-semibold`}>{number(p.on_hand)}</td>
                        <td className={`${td} num text-end text-ink-3`}>{number(p.committed)}</td>
                        <td className={`${td} num text-end`}>{number(p.on_hand - p.committed)}</td>
                        <td className={`${td} num text-end text-info-ink`}>{p.in_transit ? number(p.in_transit) : "—"}</td>
                        <td className={`${td} text-end`}>
                          {low ? <Badge tone={p.on_hand === 0 ? "bad" : "warn"}>{number(p.min_stock)}</Badge> : <span className="num text-ink-3">{number(p.min_stock)}</span>}
                        </td>
                        {(me.role === "warehouse" || me.role === "owner") && (
                          <td className={td}>
                            <button className="btn btn-ghost btn-sm" onClick={() => setAdjust(p)} aria-label={t("stock.adjust_for", { name: p.name })}>
                              <Minus className="size-4" aria-hidden />
                            </button>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TableWrap>
          )}
        </Card>
      ) : (
        <Card pad={false}>
          {!moves.data ? (
            <Loading />
          ) : (
            <ul className="divide-y divide-line">
              {moves.data.map((m) => (
                <li key={m.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                  <div className="min-w-0">
                    <div className="truncate font-medium">{m.product}</div>
                    <div className="text-xs text-ink-3">
                      {t(`move.${m.kind}` as MessageKey)} · {m.shipment ?? m.order_number ?? m.note} · {m.by} · {dateTime(m.created_at)}
                    </div>
                  </div>
                  <span className={cx("num font-bold", m.qty > 0 ? "text-ok-ink" : "text-ink")}>{m.qty > 0 ? `+${number(m.qty)}` : number(m.qty)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
      <Dialog
        open={!!adjust}
        onClose={() => setAdjust(null)}
        title={t("stock.adjust")}
        footer={
          <button
            className="btn btn-primary"
            onClick={async () => {
              setErr(null);
              try {
                await action("adjust_stock", { p_product: adjust!.id, p_qty: -Math.abs(Number(qty) || 0), p_note: note });
                toast("ok", t("stock.adjusted"));
                setAdjust(null);
                setNote("");
              } catch (e) {
                setErr(e as Error);
              }
            }}
          >
            {t("common.save")}
          </button>
        }
      >
        <p className="mb-3 text-sm text-ink-2">{t("stock.adjust_explain", { name: adjust?.name ?? "" })}</p>
        <div className="grid gap-3 sm:grid-cols-[120px_1fr]">
          <Field label={t("stock.adjust_qty")} htmlFor="aq">
            <input id="aq" className="input num" inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} />
          </Field>
          <Field label={t("stock.adjust_reason")} htmlFor="ar">
            <input id="ar" className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("stock.adjust_ph")} />
          </Field>
        </div>
        <div className="mt-3">
          <ErrorNote error={err} />
        </div>
      </Dialog>
    </div>
  );
}
