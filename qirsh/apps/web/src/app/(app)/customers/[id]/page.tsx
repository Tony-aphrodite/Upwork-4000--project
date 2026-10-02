"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { ArrowLeft, MessageCircle, Pencil, StickyNote } from "lucide-react";
import { Badge, Card, Dialog, ErrorNote, Field, Loading, Money, Note, PageHeader, PaymentChip, Stat, useToast } from "@/components/ui";
import { useI18n, type MessageKey } from "@/i18n/i18n";
import { useAction, useMe, useRpc } from "@/lib/db";
import { whatsappLink } from "@/lib/whatsapp";
import { LABEL_TONE } from "@/components/labels";

interface Detail {
  id: string;
  code: string;
  name: string;
  city: string;
  kind: string;
  contact_name: string | null;
  segment: string;
  pipeline: string;
  source: string;
  notes: string | null;
  adviser: string | null;
  adviser_id: string | null;
  contacts: { id: string; channel: string; value: string; is_primary: boolean; whatsapp_opt_in: boolean }[];
  labels: { id: string; name: string; color: string }[];
  orders: { id: string; number: string; kind: string; status: string; created_at: string; total_usd_minor: number; total_sdg_minor: number; paid_sdg_minor: number; payment_status: "unpaid" | "partial" | "paid"; rate_sdg: number; released_at: string | null }[];
  receipts: { id: string; number: string; txn_code: string; amount_sdg_minor: number; received_on: string; status: string }[] | null;
  messages: { id: string; channel: string; direction: string; body: string; created_at: string; author: string | null }[];
  outstanding_sdg_minor: number;
  revenue_usd_minor: number;
}

export default function CustomerPage() {
  const { id } = useParams<{ id: string }>();
  const me = useMe()!;
  const { t, date, dateTime } = useI18n();
  const toast = useToast();
  const action = useAction();
  const { data: c, loading } = useRpc<Detail | null>("customer_detail", { p_id: id });
  const labels = useRpc<{ id: string; name: string; color: string }[]>("labels_list");
  const [edit, setEdit] = useState(false);
  const [note, setNote] = useState("");

  if (loading && !c) return <Loading />;
  if (!c) return <Note tone="warn">{t("cust.not_found")}</Note>;
  const phone = c.contacts.find((x) => x.is_primary)?.value ?? null;
  const canEdit = me.role !== "warehouse";

  const history = [
    ...c.orders.map((o) => ({ at: o.created_at, key: `o${o.id}`, node: (
      <Link href={`/orders/${o.id}`} className="flex items-center justify-between gap-3 hover:text-brand">
        <span>
          <span className="font-medium">{o.number}</span> <span className="text-ink-3">· {t(o.kind === "quote" ? "cust.h.quote" : "cust.h.order")}</span>
        </span>
        <span className="flex items-center gap-2">
          {o.kind === "order" && o.status === "confirmed" && <PaymentChip status={o.payment_status} />}
          <Money minor={o.total_usd_minor} currency="USD" className="font-medium" />
        </span>
      </Link>
    ) })),
    ...(c.receipts ?? []).map((r) => ({ at: `${r.received_on}T12:00:00Z`, key: `r${r.id}`, node: (
      <div className="flex items-center justify-between gap-3">
        <span>
          <span className="font-medium">{r.number}</span> <span className="text-ink-3">· {t("cust.h.receipt")} {r.txn_code}</span>
        </span>
        <Money minor={r.amount_sdg_minor} currency="SDG" />
      </div>
    ) })),
    ...c.messages.map((m) => ({ at: m.created_at, key: `m${m.id}`, node: (
      <div>
        <span className="text-ink-3">{t(`channel.${m.channel}` as MessageKey)} · {m.author}</span>
        <p className="text-ink-2">{m.body}</p>
      </div>
    ) })),
  ].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 60);

  return (
    <div className="fade-in">
      <PageHeader
        back={
          <Link href="/customers" className="mb-2 inline-flex items-center gap-1 text-sm text-ink-3 hover:text-brand">
            <ArrowLeft className="size-4 rtl:rotate-180" aria-hidden />
            {t("nav.customers")}
          </Link>
        }
        title={c.name}
        subtitle={`${c.code} · ${c.city} · ${t(`kind.${c.kind}` as MessageKey)}${c.adviser ? ` · ${t("cust.adviser", { name: c.adviser })}` : ""}`}
        actions={
          <>
            <a className="btn btn-secondary btn-sm" href={whatsappLink(phone, t("cust.wa_hello", { name: c.contact_name ?? c.name }))} target="_blank" rel="noreferrer">
              <MessageCircle className="size-4" aria-hidden />
              {t("cust.whatsapp")}
            </a>
            {canEdit && (
              <button className="btn btn-secondary btn-sm" onClick={() => setEdit(true)}>
                <Pencil className="size-4" aria-hidden />
                {t("cust.edit")}
              </button>
            )}
          </>
        }
      />
      <div className="mb-4 flex flex-wrap gap-2">
        <Badge tone="brand">{t("cust.segment_x", { s: c.segment })}</Badge>
        <Badge>{t(`pipeline.${c.pipeline}` as MessageKey)}</Badge>
        <Badge>{t("cust.source_x", { s: t(`source.${c.source}` as MessageKey) })}</Badge>
        {c.labels.map((l) => (
          <span key={l.id} className={`rounded-full px-2 py-0.5 text-xs font-semibold ${LABEL_TONE[l.color] ?? ""}`}>{l.name}</span>
        ))}
      </div>
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label={t("cust.revenue")} value={<Money minor={c.revenue_usd_minor} currency="USD" />} />
        <Stat label={t("cust.outstanding")} value={<Money minor={c.outstanding_sdg_minor} currency="SDG" />} tone={c.outstanding_sdg_minor > 0 ? "warn" : undefined} />
        <Stat label={t("cust.orders")} value={c.orders.filter((o) => o.kind === "order").length} />
        <Stat label={t("cust.contact")} value={<span className="text-base">{c.contact_name ?? "—"}</span>} hint={phone ?? ""} />
      </div>
      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <Card title={t("cust.history")} pad={false}>
          <ol className="divide-y divide-line">
            {history.map((h) => (
              <li key={h.key} className="grid grid-cols-[88px_1fr] gap-3 px-4 py-2.5 text-sm">
                <span className="text-xs text-ink-3">{date(h.at, "short")}</span>
                {h.node}
              </li>
            ))}
          </ol>
        </Card>
        <div className="space-y-4">
          {canEdit && (
            <Card title={t("cust.add_note")}>
              <textarea className="input min-h-20" value={note} onChange={(e) => setNote(e.target.value)} aria-label={t("cust.add_note")} placeholder={t("cust.note_ph")} />
              <button
                className="btn btn-secondary btn-sm mt-2"
                disabled={!note.trim()}
                onClick={async () => {
                  try {
                    await action("log_message", { p_customer: c.id, p_channel: "note", p_body: note });
                    setNote("");
                  } catch (e) {
                    toast("bad", (e as Error).message);
                  }
                }}
              >
                <StickyNote className="size-4" aria-hidden />
                {t("cust.save_note")}
              </button>
            </Card>
          )}
          <Card title={t("cust.whatsapp_ready")}>
            <p className="text-sm text-ink-2">{t("cust.whatsapp_ready_body")}</p>
            <ul className="mt-2 space-y-1 text-xs text-ink-3">
              {c.contacts.map((x) => (
                <li key={x.id}>
                  {t(`channel.${x.channel}` as MessageKey)} · {x.value} · {x.whatsapp_opt_in ? t("cust.opt_in") : t("cust.no_opt_in")}
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-ink-3">{t("cust.last_contact", { when: c.messages[0] ? dateTime(c.messages[0].created_at) : "—" })}</p>
          </Card>
        </div>
      </div>
      {edit && <EditCustomer c={c} labels={labels.data ?? []} onClose={() => setEdit(false)} />}
    </div>
  );
}

function EditCustomer({ c, labels, onClose }: { c: Detail; labels: { id: string; name: string; color: string }[]; onClose: () => void }) {
  const { t } = useI18n();
  const action = useAction();
  const [v, setV] = useState({ name: c.name, city: c.city, kind: c.kind, contact: c.contact_name ?? "", phone: c.contacts.find((x) => x.is_primary)?.value ?? "", segment: c.segment, pipeline: c.pipeline, source: c.source, notes: c.notes ?? "" });
  const [picked, setPicked] = useState(new Set(c.labels.map((l) => l.id)));
  const [err, setErr] = useState<Error | null>(null);
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV({ ...v, [k]: e.target.value });
  return (
    <Dialog
      open
      onClose={onClose}
      title={t("cust.edit")}
      wide
      footer={
        <button
          className="btn btn-primary"
          onClick={async () => {
            setErr(null);
            try {
              await action("save_customer", {
                p_id: c.id, p_name: v.name, p_city: v.city, p_kind: v.kind, p_contact_name: v.contact, p_phone: v.phone, p_segment: v.segment, p_pipeline: v.pipeline, p_source: v.source, p_notes: v.notes || null,
              });
              await action("set_customer_labels", { p_customer: c.id, p_labels: [...picked] });
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
        <Field label={t("cust.f.name")} htmlFor="n"><input id="n" className="input" value={v.name} onChange={set("name")} /></Field>
        <Field label={t("cust.f.city")} htmlFor="ci"><input id="ci" className="input" value={v.city} onChange={set("city")} /></Field>
        <Field label={t("cust.f.contact")} htmlFor="co"><input id="co" className="input" value={v.contact} onChange={set("contact")} /></Field>
        <Field label={t("cust.f.phone")} htmlFor="ph"><input id="ph" className="input" inputMode="tel" value={v.phone} onChange={set("phone")} /></Field>
        <Field label={t("cust.f.segment")} htmlFor="se">
          <select id="se" className="input" value={v.segment} onChange={set("segment")}>{["A+", "A", "B", "C", "D"].map((s) => <option key={s}>{s}</option>)}</select>
        </Field>
        <Field label={t("cust.f.pipeline")} htmlFor="pi">
          <select id="pi" className="input" value={v.pipeline} onChange={set("pipeline")}>{["lead", "contacted", "quoted", "active", "dormant", "lost"].map((s) => <option key={s} value={s}>{t(`pipeline.${s}` as MessageKey)}</option>)}</select>
        </Field>
        <Field label={t("cust.f.source")} htmlFor="so">
          <select id="so" className="input" value={v.source} onChange={set("source")}>{["referral", "walk_in", "whatsapp", "facebook", "exhibition", "field_visit", "existing_network"].map((s) => <option key={s} value={s}>{t(`source.${s}` as MessageKey)}</option>)}</select>
        </Field>
        <Field label={t("cust.f.kind")} htmlFor="ki">
          <select id="ki" className="input" value={v.kind} onChange={set("kind")}>{["dealer", "installer"].map((s) => <option key={s} value={s}>{t(`kind.${s}` as MessageKey)}</option>)}</select>
        </Field>
      </div>
      <fieldset className="mt-4">
        <legend className="mb-2 text-sm font-medium text-ink-2">{t("cust.f.labels")}</legend>
        <div className="flex flex-wrap gap-2">
          {labels.map((l) => (
            <label key={l.id} className={`flex cursor-pointer items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${LABEL_TONE[l.color] ?? ""}`}>
              <input type="checkbox" className="size-3.5" checked={picked.has(l.id)} onChange={(e) => { const n = new Set(picked); if (e.target.checked) n.add(l.id); else n.delete(l.id); setPicked(n); }} />
              {l.name}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="mt-4">
        <Field label={t("cust.f.notes")} htmlFor="no"><textarea id="no" className="input min-h-20" value={v.notes} onChange={set("notes")} /></Field>
      </div>
      <div className="mt-3"><ErrorNote error={err} /></div>
    </Dialog>
  );
}
