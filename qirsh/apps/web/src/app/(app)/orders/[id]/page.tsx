"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowLeft, FileDown, Lock, MessageCircle, Repeat2 } from "lucide-react";
import { Badge, Card, Dialog, ErrorNote, Field, Loading, Money, Note, PageHeader, PaymentChip, TableWrap, TierChip, td, th, useToast } from "@/components/ui";
import { PaymentInstructions } from "@/components/PaymentInstructions";
import { useI18n, type MessageKey } from "@/i18n/i18n";
import { useAction, useMe, useRpc } from "@/lib/db";
import { quotePdf, shareOrDownload } from "@/lib/pdf";
import { whatsappLink } from "@/lib/whatsapp";

interface OrderDetail {
  id: string;
  number: string;
  kind: "quote" | "order";
  status: string;
  rate_sdg: number;
  eur_per_usd_ppm: number;
  value_usd_minor: number;
  discount_usd_minor: number;
  total_usd_minor: number;
  total_sdg_minor: number;
  total_eur_minor: number;
  paid_sdg_minor: number;
  payment_status: "unpaid" | "partial" | "paid";
  valid_until: string | null;
  released_at: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  created_at: string;
  customer: { id: string; name: string; city: string; code: string; phone: string | null };
  adviser_name: string;
  converted_from_number: string | null;
  converted_to: string | null;
  converted_to_number: string | null;
  lines: { line_no: number; product_name: string; sku: string; qty: number; unit_price_usd_minor: number; price_overridden: boolean; value_usd_minor: number; discount_usd_minor: number; total_usd_minor: number; tier: "none" | "sand" | "red" | "approved"; approved_by: string | null }[];
  payments: { receipt_id: string; number: string; txn_code: string; received_on: string; status: string; sdg_minor: number; booked_usd_minor: number }[];
}

export default function OrderPage() {
  const { id } = useParams<{ id: string }>();
  const me = useMe()!;
  const { t, number, date, dateTime, money } = useI18n();
  const toast = useToast();
  const action = useAction();
  const router = useRouter();
  const { data: o, loading, error } = useRpc<OrderDetail | null>("order_detail", { p_id: id });
  const [convert, setConvert] = useState(false);
  const [rate, setRate] = useState("");
  const [convError, setConvError] = useState<{ message: string } | null>(null);
  const [cancel, setCancel] = useState(false);
  const [reason, setReason] = useState("");

  if (loading && !o) return <Loading />;
  if (error) return <ErrorNote error={error} />;
  if (!o) return <Note tone="warn">{t("orderpage.not_found")}</Note>;

  const expired = o.kind === "quote" && o.status === "quote" && o.valid_until !== null && o.valid_until < me.today;
  const outstanding = o.total_sdg_minor - o.paid_sdg_minor;
  const brand = { name: me.settings.brand_name, color: me.settings.brand_color, initials: me.settings.logo_initials, paymentTerms: me.settings.payment_terms };

  const pdf = async () => {
    const blob = await quotePdf(
      {
        number: o.number, kind: o.kind, date: date(o.created_at), validUntil: o.valid_until ? date(o.valid_until) : null,
        customer: o.customer, adviser: o.adviser_name, rate: o.rate_sdg, totalUsd: o.total_usd_minor, totalSdg: o.total_sdg_minor, discountUsd: o.discount_usd_minor,
        lines: o.lines.map((l) => ({ name: l.product_name, sku: l.sku, qty: l.qty, unit: l.unit_price_usd_minor, discount: l.discount_usd_minor, total: l.total_usd_minor })),
      },
      brand,
    );
    const how = await shareOrDownload(blob, `${o.number}.pdf`, t("orderpage.share_text", { number: o.number }));
    await action("log_message", { p_customer: o.customer.id, p_channel: "whatsapp_link", p_body: t("orderpage.pdf_logged", { number: o.number }), p_order: o.id }).catch(() => undefined);
    toast("ok", how === "shared" ? t("orderpage.pdf_shared") : t("orderpage.pdf_downloaded"));
  };

  const shareText = t("orderpage.wa_text", {
    customer: o.customer.name, number: o.number, usd: money(o.total_usd_minor, "USD"), sdg: money(o.total_sdg_minor, "SDG"), rate: number(o.rate_sdg),
    valid: o.valid_until ? date(o.valid_until) : "—",
  });

  const doConvert = async () => {
    setConvError(null);
    try {
      const newId = crypto.randomUUID();
      const r = await action<{ id: string; number: string }>("convert_quote", { p_quote: o.id, p_new_id: newId, ...(expired || rate ? { p_rate_sdg: Number(rate.replace(/\D/g, "")) || null } : {}) });
      toast("ok", t("orderpage.converted", { number: r.number }));
      router.push(`/orders/${r.id}`);
    } catch (e) {
      setConvError(e as Error);
    }
  };

  return (
    <div className="fade-in">
      <PageHeader
        back={
          <Link href="/orders" className="mb-2 inline-flex items-center gap-1 text-sm text-ink-3 hover:text-brand">
            <ArrowLeft className="size-4 rtl:rotate-180" aria-hidden />
            {t("nav.orders")}
          </Link>
        }
        title={`${t(o.kind === "quote" ? "orderpage.quote" : "orderpage.order")} ${o.number}`}
        subtitle={
          <>
            <Link className="font-medium text-ink-2 hover:text-brand" href={`/customers/${o.customer.id}`}>
              {o.customer.name}
            </Link>{" "}
            · {o.customer.city} · {t("orderpage.by", { name: o.adviser_name, when: dateTime(o.created_at) })}
          </>
        }
        actions={
          <>
            <button className="btn btn-secondary btn-sm" onClick={pdf}>
              <FileDown className="size-4" aria-hidden />
              {t(o.kind === "quote" ? "orderpage.quote_pdf" : "orderpage.order_pdf")}
            </button>
            <a className="btn btn-secondary btn-sm" href={whatsappLink(o.customer.phone, shareText)} target="_blank" rel="noreferrer">
              <MessageCircle className="size-4" aria-hidden />
              {t("orderpage.whatsapp")}
            </a>
            {o.kind === "quote" && o.status === "quote" && me.role !== "marketing" && (
              <button className="btn btn-primary btn-sm" onClick={() => (expired ? setConvert(true) : doConvert())}>
                <Repeat2 className="size-4" aria-hidden />
                {t("orderpage.convert")}
              </button>
            )}
          </>
        }
      />

      <div className="mb-4 flex flex-wrap gap-2">
        {o.status === "cancelled" ? <Badge tone="bad">{t("status.cancelled")}</Badge> : o.kind === "quote" ? <Badge tone={expired ? "warn" : "info"}>{t(expired ? "status.expired" : o.status === "converted" ? "status.converted" : "status.quote")}</Badge> : <PaymentChip status={o.payment_status} />}
        {o.released_at && <Badge tone="ok">{t("orderpage.released", { when: date(o.released_at) })}</Badge>}
        {o.kind === "order" && !o.released_at && o.payment_status === "paid" && <Badge tone="brand">{t("orderpage.ready")}</Badge>}
        {o.converted_from_number && <Badge>{t("orderpage.from_quote", { number: o.converted_from_number })}</Badge>}
        {o.converted_to_number && (
          <Link href={`/orders/${o.converted_to}`}>
            <Badge tone="ok">{t("orderpage.became", { number: o.converted_to_number })}</Badge>
          </Link>
        )}
        {o.valid_until && o.status === "quote" && <Badge tone={expired ? "warn" : "neutral"}>{t("orderpage.valid_until", { date: date(o.valid_until) })}</Badge>}
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="space-y-4">
          <Card title={t("orderpage.lines")} pad={false}>
            <TableWrap label={t("orderpage.lines")}>
              <table className="w-full min-w-[640px]">
                <thead className="border-b border-line bg-[#f9fbfa]">
                  <tr>
                    <th className={th}>{t("orderpage.col.product")}</th>
                    <th className={`${th} text-end`}>{t("orderpage.col.qty")}</th>
                    <th className={`${th} text-end`}>{t("orderpage.col.price")}</th>
                    <th className={`${th} text-end`}>{t("orderpage.col.value")}</th>
                    <th className={`${th} text-end`}>{t("orderpage.col.discount")}</th>
                    <th className={`${th} text-end`}>{t("orderpage.col.total")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {o.lines.map((l) => (
                    <tr key={l.line_no} className={l.tier === "sand" ? "bg-sand-bg/50" : l.tier === "red" ? "bg-red-bg/50" : l.tier === "approved" ? "bg-ok-bg/40" : ""}>
                      <td className={td}>
                        <div className="font-medium">{l.product_name}</div>
                        <div className="text-xs text-ink-3">
                          {l.sku}
                          {l.price_overridden && <> · {t("orderpage.price_overridden")}</>}
                          {l.approved_by && <> · {t("orderpage.approved_by", { name: l.approved_by })}</>}
                        </div>
                      </td>
                      <td className={`${td} num text-end`}>{number(l.qty)}</td>
                      <td className={`${td} text-end`}>
                        <Money minor={l.unit_price_usd_minor} currency="USD" />
                      </td>
                      <td className={`${td} text-end`}>
                        <Money minor={l.value_usd_minor} currency="USD" />
                      </td>
                      <td className={`${td} text-end`}>
                        {l.discount_usd_minor > 0 ? (
                          <div className="flex flex-col items-end gap-1">
                            <Money minor={l.discount_usd_minor} currency="USD" />
                            <span className="flex items-center gap-1 text-xs text-ink-3">
                              <span className="num">{number((l.discount_usd_minor * 100) / l.value_usd_minor, 2)}%</span>
                              <TierChip tier={l.tier} />
                            </span>
                          </div>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className={`${td} text-end font-semibold`}>
                        <Money minor={l.total_usd_minor} currency="USD" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          </Card>

          {o.kind === "order" && (
            <Card title={t("orderpage.payments")} action={<span className="text-xs text-ink-3">{t("orderpage.payments_count", { n: o.payments.length })}</span>} pad={false}>
              {o.payments.length === 0 ? (
                <p className="px-4 py-6 text-sm text-ink-3">{t("orderpage.no_payments")}</p>
              ) : (
                <ul className="divide-y divide-line">
                  {o.payments.map((p) => (
                    <li key={p.receipt_id + p.sdg_minor} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                      <span className="min-w-0">
                        <span className="font-medium">{p.number}</span> <span className="text-ink-3">· {p.txn_code} · {date(p.received_on, "short")}</span>
                      </span>
                      <span className="flex items-center gap-2">
                        <Badge tone={p.status === "confirmed" ? "ok" : p.status === "forwarded" ? "info" : "warn"}>{t(`receipt.status.${p.status}` as MessageKey)}</Badge>
                        <Money minor={p.sdg_minor} currency="SDG" className="font-medium" />
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}

          {o.kind === "order" && o.status === "confirmed" && outstanding > 0 && me.role !== "marketing" && (
            <PaymentInstructions orderNumber={o.number} outstanding={outstanding} customer={o.customer.name} phone={o.customer.phone} />
          )}
        </div>

        <aside className="space-y-4">
          <Card title={t("orderpage.totals")}>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-ink-3">{t("orderpage.value")}</dt>
                <dd><Money minor={o.value_usd_minor} currency="USD" /></dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-ink-3">{t("orderpage.discounts")}</dt>
                <dd><Money minor={-o.discount_usd_minor} currency="USD" /></dd>
              </div>
              <div className="flex justify-between gap-3 border-t border-line pt-2 text-base font-bold">
                <dt>{t("orderpage.total_usd")}</dt>
                <dd><Money minor={o.total_usd_minor} currency="USD" /></dd>
              </div>
              <div className="flex justify-between gap-3 text-base font-bold">
                <dt>{t("orderpage.total_sdg")}</dt>
                <dd><Money minor={o.total_sdg_minor} currency="SDG" /></dd>
              </div>
              {me.role === "owner" && (
                <div className="flex justify-between gap-3 text-ink-2">
                  <dt>{t("orderpage.total_eur")}</dt>
                  <dd><Money minor={o.total_eur_minor} currency="EUR" /></dd>
                </div>
              )}
              {o.kind === "order" && (
                <>
                  <div className="flex justify-between gap-3 border-t border-line pt-2">
                    <dt className="text-ink-3">{t("orderpage.paid")}</dt>
                    <dd><Money minor={o.paid_sdg_minor} currency="SDG" /></dd>
                  </div>
                  <div className="flex justify-between gap-3 font-semibold">
                    <dt>{t("orderpage.outstanding")}</dt>
                    <dd><Money minor={outstanding} currency="SDG" /></dd>
                  </div>
                </>
              )}
            </dl>
          </Card>
          <Card>
            <div className="flex items-start gap-2 text-sm">
              <Lock className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden />
              <div>
                <p className="font-semibold">{t("orderpage.fixed.title", { rate: number(o.rate_sdg) })}</p>
                <p className="mt-1 text-ink-3">{t("orderpage.fixed.body", { min: number(me.settings.min_rate_sdg) })}</p>
              </div>
            </div>
          </Card>
          {o.kind === "order" && o.status === "confirmed" && o.paid_sdg_minor === 0 && (me.role === "owner" || me.role === "adviser") && (
            <button className="btn btn-ghost btn-sm text-red-ink" onClick={() => setCancel(true)}>
              {t("orderpage.cancel")}
            </button>
          )}
          {o.cancel_reason && <Note tone="bad">{t("orderpage.cancelled_because", { reason: o.cancel_reason })}</Note>}
        </aside>
      </div>

      <Dialog
        open={convert}
        onClose={() => setConvert(false)}
        title={t("orderpage.convert")}
        footer={
          <button className="btn btn-primary" onClick={doConvert}>
            {t("orderpage.convert")}
          </button>
        }
      >
        <p className="mb-3 text-sm text-ink-2">{t("orderpage.expired_rate", { min: number(me.settings.min_rate_sdg) })}</p>
        <Field label={t("order.rate.label")} htmlFor="conv-rate">
          <input id="conv-rate" className="input num" inputMode="numeric" value={rate} onChange={(e) => setRate(e.target.value)} placeholder={number(me.settings.min_rate_sdg)} />
        </Field>
        <div className="mt-3">
          <ErrorNote error={convError} />
        </div>
      </Dialog>

      <Dialog
        open={cancel}
        onClose={() => setCancel(false)}
        title={t("orderpage.cancel")}
        footer={
          <button
            className="btn btn-danger"
            disabled={!reason.trim()}
            onClick={async () => {
              try {
                await action("cancel_order", { p_id: o.id, p_reason: reason });
                setCancel(false);
                toast("ok", t("orderpage.cancelled"));
              } catch (e) {
                toast("bad", (e as Error).message);
              }
            }}
          >
            {t("orderpage.cancel")}
          </button>
        }
      >
        <Field label={t("orderpage.cancel_reason")} htmlFor="reason">
          <input id="reason" className="input" value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      </Dialog>
    </div>
  );
}
