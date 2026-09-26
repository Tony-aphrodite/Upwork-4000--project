"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, Clock, Lock, Minus, PackagePlus, Plus, Search, Sparkles, Trash2, WifiOff, XCircle } from "lucide-react";
import { acceptRate, lineOf, parseMoney, totalsOf, type LineResult } from "@qirsh/money";
import type { DbError } from "@qirsh/db";
import { Card, cx, Dialog, ErrorNote, Field, Money, Note, PageHeader, TierChip, useToast } from "@/components/ui";
import { PaymentInstructions } from "@/components/PaymentInstructions";
import { CustomerPicker, type PickedCustomer as Customer } from "@/components/CustomerPicker";
import { useI18n, type MessageKey } from "@/i18n/i18n";
import { useAction, useDb, useMe, useRpc } from "@/lib/db";
import { useOutbox } from "@/lib/outbox";

interface Product {
  id: string;
  sku: string;
  name: string;
  category: string;
  price_usd_minor: number;
  on_hand: number;
  committed: number;
}
interface DraftLine {
  key: string;
  product_id: string;
  qty: number;
  discount: string; // as typed, in dollars
}
interface Draft {
  id: string;
  customer: Customer | null;
  lines: DraftLine[];
  rate: string;
  kind: "order" | "quote";
}
interface Approval {
  id: string;
  product_id: string;
  qty: number;
  discount_usd_minor: number;
  status: "pending" | "approved" | "rejected";
  decided_by: string | null;
}
interface Saved {
  id: string;
  number: string;
  kind: string;
  total_usd_minor: number;
  total_sdg_minor: number;
  rate_sdg: number;
  customer_name: string;
}

const newDraft = (): Draft => ({ id: crypto.randomUUID(), customer: null, lines: [], rate: "", kind: "order" });

export default function NewOrder() {
  const me = useMe()!;
  const { userId, db } = useDb();
  const { t, number, money } = useI18n();
  const toast = useToast();
  const action = useAction();
  const { submit, offline } = useOutbox();
  const storageKey = `qirsh.draft.${userId}`;
  const thresholds = { sandMaxBps: me.settings.sand_max_bps, redMaxBps: me.settings.red_max_bps };
  const minRate = me.settings.min_rate_sdg;

  // ---------------------------------------------------------------- draft, kept on the phone
  const [draft, setDraft] = useState<Draft | null>(null);
  useEffect(() => {
    let d: Draft | null = null;
    try {
      d = JSON.parse(localStorage.getItem(storageKey) ?? "null");
    } catch {
      /* ignore */
    }
    setDraft(d ?? newDraft());
  }, [storageKey]);
  useEffect(() => {
    if (!draft) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify(draft));
    } catch {
      /* ignore */
    }
  }, [draft, storageKey]);
  const update = (fn: (d: Draft) => Draft) => setDraft((d) => (d ? fn(d) : d));

  const catalogue = useRpc<Product[]>("catalogue");
  const approvals = useRpc<Approval[]>(draft ? "draft_approvals" : null, { p_draft: draft?.id });
  const products = useMemo(() => new Map((catalogue.data ?? []).map((p) => [p.id, p])), [catalogue.data]);

  const [rateNote, setRateNote] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<DbError | null>(null);
  const [saved, setSaved] = useState<Saved | null>(null);
  const [queued, setQueued] = useState(false);
  const [picker, setPicker] = useState(false);

  // ---------------------------------------------------------------- lines, as the database will compute them
  const lines = useMemo(() => {
    if (!draft) return [];
    return draft.lines.map((l) => {
      const p = products.get(l.product_id);
      const discount = parseMoney(l.discount);
      let result: LineResult | null = null;
      let problem: MessageKey | null = null;
      if (!p) problem = "order.line.unknown";
      else if (discount === null) problem = "order.line.bad_discount";
      else if (discount > l.qty * p.price_usd_minor) problem = "order.line.discount_too_big";
      else result = lineOf({ qty: l.qty, unitPriceMinor: p.price_usd_minor, discountMinor: discount }, thresholds);
      // An approval counts only for this exact line: same product, quantity and discount.
      const matches = result?.tier === "blocked" ? (approvals.data ?? []).filter((a) => a.product_id === l.product_id && a.qty === l.qty && a.discount_usd_minor === result!.discountMinor) : [];
      const approval = matches.find((a) => a.status === "approved") ?? matches.find((a) => a.status === "pending") ?? matches[0];
      return { draft: l, product: p, result, problem, approval };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, products, approvals.data]);

  const rate = draft?.rate ? acceptRate(draft.rate, minRate) : null;
  const valid = lines.filter((l) => l.result).map((l) => l.result!);
  const totals = rate && !rate.refused && valid.length ? totalsOf(valid, rate.rate) : null;
  // The owner's own order carries the owner's approval; the database records it on save.
  const blocked = me.role === "owner" ? [] : lines.filter((l) => l.result?.tier === "blocked" && l.approval?.status !== "approved");
  const problems = lines.filter((l) => l.problem);
  // What the order would be if the blocked lines were removed (the brief's $3,570 case).
  const withoutBlocked = blocked.length && rate && !rate.refused
    ? totalsOf(lines.filter((l) => l.result && !blocked.includes(l)).map((l) => l.result!), rate.rate)
    : null;

  const blockers: string[] = [];
  if (!draft?.customer) blockers.push(t("order.need.customer"));
  if (!draft?.lines.length) blockers.push(t("order.need.product"));
  if (!rate || rate.refused) blockers.push(t("order.need.rate"));
  if (problems.length) blockers.push(t("order.need.fix_lines"));
  if (blocked.length) blockers.push(t("order.need.approval", { n: blocked.length }));

  // ---------------------------------------------------------------- actions
  const commitRate = () => {
    if (!draft) return;
    if (draft.rate.trim() === "") return;
    const r = acceptRate(draft.rate, minRate);
    if (r.refused) {
      setRateNote(t("order.rate.refused", { typed: draft.rate, min: number(minRate) }));
      update((d) => ({ ...d, rate: String(minRate) }));
    } else {
      setRateNote(null);
      update((d) => ({ ...d, rate: String(r.rate) }));
    }
  };

  const addProduct = (p: Product) => {
    update((d) => {
      const existing = d.lines.find((l) => l.product_id === p.id);
      if (existing) return { ...d, lines: d.lines.map((l) => (l === existing ? { ...l, qty: l.qty + 1 } : l)) };
      return { ...d, lines: [...d.lines, { key: crypto.randomUUID(), product_id: p.id, qty: 1, discount: "" }] };
    });
    setPicker(false);
  };

  const askApproval = async (l: (typeof lines)[number]) => {
    if (!draft?.customer || !l.result) return;
    try {
      await action("request_discount_approval", {
        p_draft: draft.id, p_customer: draft.customer.id, p_product: l.draft.product_id, p_qty: l.draft.qty, p_discount_usd_minor: l.result.discountMinor,
      });
      toast("info", t("order.approval.sent"));
    } catch (e) {
      toast("bad", (e as Error).message);
    }
  };

  const fillWorkedExample = useCallback(async () => {
    const byName = (n: string) => (catalogue.data ?? []).find((p) => p.name.startsWith(n));
    const inv = byName("SPF 6000 ES Plus");
    const small = byName("Hope 5.0L-B1");
    const large = byName("Hope 16.0LM-A1");
    if (!inv || !small || !large || !db || !userId) return toast("bad", t("order.worked.missing"));
    // With no connection there is no one to ask for the dealer; the rest of the example still fills
    // in, and she picks the dealer herself from what the phone has.
    let found: Customer | null = null;
    try {
      found = (await db.as(userId).rpc<{ rows: Customer[] }>("customers_list", { p_search: "Ahmed Trading", p_limit: 1 })).rows[0] ?? null;
    } catch {
      toast("warn", t("order.worked.offline"));
    }
    setDraft((d) => ({
      ...(d ?? newDraft()),
      id: crypto.randomUUID(),
      customer: found ?? d?.customer ?? null,
      rate: "8200",
      kind: "order",
      lines: [
        { key: crypto.randomUUID(), product_id: inv.id, qty: 4, discount: "40" },
        { key: crypto.randomUUID(), product_id: small.id, qty: 2, discount: "70" },
        { key: crypto.randomUUID(), product_id: large.id, qty: 1, discount: "150" },
      ],
    }));
    setRateNote(null);
    setSaved(null);
    setError(null);
  }, [catalogue.data, t, toast, db, userId]);

  const save = async () => {
    if (!draft?.customer || !rate || rate.refused || blockers.length) return;
    setSaving(true);
    setError(null);
    const args = {
      p_id: draft.id,
      p_customer: draft.customer.id,
      p_rate_sdg: rate.rate,
      p_kind: draft.kind,
      p_lines: lines.map((l) => ({
        product_id: l.draft.product_id,
        qty: l.draft.qty,
        discount_usd_minor: l.result!.discountMinor,
        ...(l.result!.tier === "blocked" && l.approval ? { approval_id: l.approval.id } : {}),
      })),
    };
    try {
      const result = await submit<Saved>("save_order", args, `${draft.customer.name} · ${money(totals?.totalUsd ?? 0, "USD")}`);
      if (result === null) {
        setQueued(true);
      } else {
        setSaved(result);
        setDraft(newDraft());
      }
    } catch (e) {
      const err = e as DbError;
      setError(err);
      if (err.hint === "min_rate") update((d) => ({ ...d, rate: String(minRate) }));
    } finally {
      setSaving(false);
    }
  };

  // Queued while offline, then sent: show the result like any save.
  const { lastSynced, pending } = useOutbox();
  const draftId = draft?.id;
  const syncRef = useRef(lastSynced);
  useEffect(() => {
    if (!queued || lastSynced === syncRef.current) return;
    syncRef.current = lastSynced;
    const mine = lastSynced.map((s) => s.result as Saved & { error?: string }).find((r) => r && (r.id === draftId || r.error));
    if (mine?.error) {
      setError({ message: mine.error } as DbError);
      setQueued(false);
    } else if (mine) {
      setSaved(mine);
      setQueued(false);
      setDraft(newDraft());
    }
  }, [lastSynced, queued, draftId]);

  if (!draft) return null;

  // ---------------------------------------------------------------- saved
  if (saved) {
    return (
      <div className="fade-in mx-auto max-w-xl">
        <PageHeader title={t(saved.kind === "quote" ? "order.saved.quote_title" : "order.saved.title", { number: saved.number })} subtitle={saved.customer_name} />
        <Card>
          <div className="flex items-start gap-3">
            <CheckCircle2 className="mt-0.5 size-6 shrink-0 text-ok-ink" aria-hidden />
            <div className="min-w-0 flex-1">
              <div className="text-2xl font-bold">
                <Money minor={saved.total_usd_minor} currency="USD" />
              </div>
              <div className="text-lg font-semibold text-ink-2">
                <Money minor={saved.total_sdg_minor} currency="SDG" />
              </div>
              <p className="mt-2 text-sm text-ink-3">{t("order.saved.fixed", { rate: number(saved.rate_sdg) })}</p>
            </div>
          </div>
        </Card>
        {saved.kind === "order" && (
          <div className="mt-4">
            <PaymentInstructions orderNumber={saved.number} outstanding={saved.total_sdg_minor} customer={saved.customer_name} />
          </div>
        )}
        <div className="mt-4 flex flex-wrap gap-2">
          <Link href={`/orders/${saved.id}`} className="btn btn-primary">
            {t("order.saved.open")}
          </Link>
          <button className="btn btn-secondary" onClick={() => setSaved(null)}>
            <Plus className="size-4" aria-hidden />
            {t("order.saved.another")}
          </button>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------- the screen
  return (
    <div className="pb-40 lg:pb-0">
      <PageHeader
        title={t(draft.kind === "quote" ? "order.title_quote" : "order.title")}
        subtitle={t("order.subtitle")}
        actions={
          <button className="btn btn-ghost btn-sm" onClick={fillWorkedExample}>
            <Sparkles className="size-4" aria-hidden />
            {t("order.worked.fill")}
          </button>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <div className="space-y-4">
          {/* customer */}
          <Card title={t("order.customer")}>
            <CustomerPicker value={draft.customer} onChange={(c) => update((d) => ({ ...d, customer: c }))} />
          </Card>

          {/* lines */}
          <Card
            title={t("order.products")}
            action={
              <button className="btn btn-secondary btn-sm" onClick={() => setPicker(true)}>
                <PackagePlus className="size-4" aria-hidden />
                {t("order.add_product")}
              </button>
            }
            pad={false}
          >
            {draft.lines.length === 0 ? (
              <button onClick={() => setPicker(true)} className="flex w-full flex-col items-center gap-2 px-4 py-10 text-sm text-ink-3 hover:text-brand">
                <PackagePlus className="size-6" aria-hidden />
                {t("order.no_lines")}
              </button>
            ) : (
              <ul className="divide-y divide-line">
                {lines.map((l, i) => (
                  <LineRow
                    key={l.draft.key}
                    index={i}
                    line={l}
                    onQty={(q) => update((d) => ({ ...d, lines: d.lines.map((x) => (x.key === l.draft.key ? { ...x, qty: Math.max(1, q) } : x)) }))}
                    onDiscount={(v) => update((d) => ({ ...d, lines: d.lines.map((x) => (x.key === l.draft.key ? { ...x, discount: v } : x)) }))}
                    onRemove={() => update((d) => ({ ...d, lines: d.lines.filter((x) => x.key !== l.draft.key) }))}
                    onAsk={() => askApproval(l)}
                    canAsk={!!draft.customer}
                    isOwner={me.role === "owner"}
                  />
                ))}
              </ul>
            )}
          </Card>

          {/* rate */}
          <Card title={t("order.rate")}>
            <Field label={t("order.rate.label")} htmlFor="rate" hint={t("order.rate.hint", { min: number(minRate) })} error={rateNote}>
              <div className="flex items-center gap-2">
                <input
                  id="rate"
                  className="input max-w-[12rem] text-lg font-semibold num"
                  inputMode="numeric"
                  autoComplete="off"
                  placeholder={number(minRate)}
                  value={draft.rate ? number(Number(draft.rate.replace(/[^\d]/g, "")) || 0) : ""}
                  onChange={(e) => {
                    setRateNote(null);
                    const digits = e.target.value.replace(/[^\d]/g, "").slice(0, 7);
                    update((d) => ({ ...d, rate: digits }));
                  }}
                  onBlur={commitRate}
                  onKeyDown={(e) => e.key === "Enter" && commitRate()}
                  aria-invalid={!!rateNote}
                />
                <span className="text-sm text-ink-3">{t("order.rate.unit")}</span>
              </div>
            </Field>
            <p className="mt-3 text-xs text-ink-3">{t("order.rate.stored")}</p>
          </Card>
        </div>

        {/* summary: a sticky panel on desktop, a bar at the bottom of the phone */}
        <aside className="lg:sticky lg:top-6 lg:self-start">
          <div className="card fixed inset-x-0 bottom-14 z-20 rounded-none border-x-0 border-b-0 px-4 py-3 shadow-[0_-8px_24px_-12px_rgba(0,0,0,0.25)] lg:static lg:rounded-[14px] lg:border lg:p-4 lg:shadow-none">
            <div className="hidden lg:block">
              <h2 className="mb-3 text-sm font-semibold">{t("order.summary")}</h2>
              <dl className="space-y-1.5 text-sm">
                <Row label={t("order.sum.value")} value={<Money minor={valid.reduce((s, l) => s + l.valueMinor, 0)} currency="USD" />} />
                <Row label={t("order.sum.discount")} value={<Money minor={-valid.reduce((s, l) => s + l.discountMinor, 0)} currency="USD" />} />
                <Row label={t("order.sum.rate")} value={rate && !rate.refused ? <span className="num">{number(rate.rate)}</span> : "—"} />
              </dl>
              <div className="my-3 border-t border-line" />
            </div>
            <div className="flex items-end justify-between gap-3 lg:block">
              <div>
                <div className="text-xs text-ink-3">{t("order.sum.total")}</div>
                <div className="text-xl font-bold lg:text-2xl" data-testid="total-usd">
                  {totals ? <Money minor={totals.totalUsd} currency="USD" /> : "—"}
                </div>
                <div className="text-sm font-semibold text-ink-2 lg:text-base" data-testid="total-sdg">
                  {totals ? <Money minor={totals.totalSdg} currency="SDG" /> : t("order.sum.enter_rate")}
                </div>
                {totals && (
                  <div className="mt-0.5 hidden text-xs text-ink-3 lg:block">
                    {t("order.sum.transfers", { n: Math.ceil(totals.totalSdg / me.settings.max_transfer_sdg_minor) })}
                  </div>
                )}
                {totals && withoutBlocked && (
                  <div className="mt-2 rounded-lg bg-red-bg/60 px-2.5 py-1.5 text-xs text-red-ink" data-testid="without-blocked">
                    {t("order.sum.without_blocked", { usd: money(withoutBlocked.totalUsd, "USD"), sdg: money(withoutBlocked.totalSdg, "SDG") })}
                  </div>
                )}
              </div>
              <div className="flex flex-col items-end gap-1.5 lg:mt-4 lg:items-stretch">
                <button className="btn btn-primary w-full min-w-[9rem]" disabled={saving || blockers.length > 0} onClick={save} aria-describedby="blockers">
                  {offline && <WifiOff className="size-4" aria-hidden />}
                  {draft.kind === "quote" ? t("order.save_quote") : t("order.save")}
                </button>
                <label className="flex items-center gap-2 text-xs text-ink-3">
                  <input type="checkbox" className="size-4 accent-[var(--brand)]" checked={draft.kind === "quote"} onChange={(e) => update((d) => ({ ...d, kind: e.target.checked ? "quote" : "order" }))} />
                  {t("order.as_quote", { days: me.settings.quote_validity_days })}
                </label>
              </div>
            </div>
            {blockers.length > 0 && (
              <p id="blockers" className="mt-2 text-xs text-ink-3">
                {blockers.join(" · ")}
              </p>
            )}
            {queued && (
              <div className="mt-2">
                <Note tone="warn" icon={<WifiOff className="mt-0.5 size-4 shrink-0" aria-hidden />}>
                  {t("order.queued", { n: pending.length })}
                </Note>
              </div>
            )}
            {error && (
              <div className="mt-2">
                <ErrorNote error={error} />
              </div>
            )}
          </div>
          <p className="mt-3 hidden text-xs text-ink-3 lg:block">{t("order.draft_kept")}</p>
        </aside>
      </div>

      <ProductPicker open={picker} onClose={() => setPicker(false)} products={catalogue.data ?? []} onPick={addProduct} />
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-ink-3">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}

// ------------------------------------------------------------------ one line
function LineRow({
  index, line, onQty, onDiscount, onRemove, onAsk, canAsk, isOwner,
}: {
  index: number;
  line: { draft: DraftLine; product?: Product; result: LineResult | null; problem: MessageKey | null; approval?: Approval };
  onQty: (q: number) => void;
  onDiscount: (v: string) => void;
  onRemove: () => void;
  onAsk: () => void;
  canAsk: boolean;
  isOwner: boolean;
}) {
  const { t, number } = useI18n();
  const r = line.result;
  const approved = r?.tier === "blocked" && line.approval?.status === "approved";
  const shownTier = r ? (approved ? "approved" : r.tier) : "none";
  const tint = shownTier === "sand" ? "bg-sand-bg/60" : shownTier === "red" ? "bg-red-bg/70" : shownTier === "blocked" ? "bg-red-bg" : shownTier === "approved" ? "bg-ok-bg/50" : "";
  const p = line.product;
  const discountId = `disc-${line.draft.key}`;
  return (
    <li className={cx("px-4 py-3.5 transition-colors", tint)} data-tier={shownTier} data-testid={`line-${index + 1}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-semibold leading-snug">{p?.name ?? "…"}</div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-ink-3">
            <span className="inline-flex items-center gap-1">
              <Lock className="size-3" aria-hidden />
              <Money minor={p?.price_usd_minor} currency="USD" /> {t("order.line.each")}
            </span>
            {p && line.draft.qty > p.on_hand - p.committed && <span className="text-warn-ink">{t("order.line.stock_short", { n: Math.max(0, p.on_hand - p.committed) })}</span>}
          </div>
        </div>
        <button className="btn btn-ghost btn-sm -me-2 text-ink-3" onClick={onRemove} aria-label={t("order.line.remove", { name: p?.name ?? "" })}>
          <Trash2 className="size-4" aria-hidden />
        </button>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-[auto_1fr_auto] sm:items-end">
        <div>
          <span className="mb-1 block text-xs font-medium text-ink-3" id={`qty-${line.draft.key}`}>
            {t("order.line.qty")}
          </span>
          <div className="flex items-center" role="group" aria-labelledby={`qty-${line.draft.key}`}>
            <button className="btn btn-secondary btn-sm rounded-e-none px-2.5" onClick={() => onQty(line.draft.qty - 1)} aria-label={t("order.line.less")}>
              <Minus className="size-4" aria-hidden />
            </button>
            <input
              className="input num h-9 min-h-9 w-14 rounded-none border-x-0 px-1 text-center"
              inputMode="numeric"
              value={line.draft.qty}
              onChange={(e) => onQty(Number(e.target.value.replace(/\D/g, "")) || 1)}
              aria-label={t("order.line.qty")}
            />
            <button className="btn btn-secondary btn-sm rounded-s-none px-2.5" onClick={() => onQty(line.draft.qty + 1)} aria-label={t("order.line.more")}>
              <Plus className="size-4" aria-hidden />
            </button>
          </div>
        </div>
        <div>
          <label htmlFor={discountId} className="mb-1 block text-xs font-medium text-ink-3">
            {t("order.line.discount")}
          </label>
          <div className="relative">
            <span className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-ink-3">$</span>
            <input
              id={discountId}
              className="input num h-9 min-h-9 ps-6"
              inputMode="decimal"
              placeholder="0"
              value={line.draft.discount}
              onChange={(e) => onDiscount(e.target.value.replace(/[^\d.,]/g, ""))}
              aria-invalid={!!line.problem}
            />
          </div>
        </div>
        <div className="col-span-2 text-end sm:col-span-1">
          <div className="text-xs text-ink-3">{t("order.line.total")}</div>
          <div className="text-lg font-bold">{r ? <Money minor={r.totalMinor} currency="USD" /> : "—"}</div>
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-2">
        <span>
          {t("order.line.value")} <Money minor={r?.valueMinor} currency="USD" />
        </span>
        {r && r.discountMinor > 0 && (
          <span className="num">
            {t("order.line.pct", { pct: number(r.discountPct, 2) })}
          </span>
        )}
        <TierChip tier={shownTier as "none"} />
        {line.problem && <span className="font-medium text-red-ink">{t(line.problem)}</span>}
      </div>

      {r?.tier === "blocked" && !approved && (
        <div className="mt-3 rounded-lg border border-red-ink/30 bg-white/70 p-3 text-sm">
          <p className="font-semibold text-red-ink">{t("order.blocked.title")}</p>
          <p className="mt-0.5 text-ink-2">{isOwner ? t("order.blocked.owner") : t("order.blocked.explain")}</p>
          {!isOwner &&
            (line.approval?.status === "pending" ? (
              <p className="mt-2 inline-flex items-center gap-1.5 font-medium text-warn-ink">
                <Clock className="size-4" aria-hidden />
                {t("order.blocked.waiting")}
              </p>
            ) : line.approval?.status === "rejected" ? (
              <p className="mt-2 inline-flex items-center gap-1.5 font-medium text-red-ink">
                <XCircle className="size-4" aria-hidden />
                {t("order.blocked.rejected")}
              </p>
            ) : (
              <button className="btn btn-secondary btn-sm mt-2" onClick={onAsk} disabled={!canAsk}>
                {t("order.blocked.ask")}
              </button>
            ))}
          {!isOwner && line.approval?.status === "pending" && <p className="mt-1 text-xs text-ink-3">{t("order.blocked.demo_hint")}</p>}
        </div>
      )}
      {approved && (
        <p className="mt-2 inline-flex items-center gap-1.5 text-sm font-medium text-ok-ink">
          <CheckCircle2 className="size-4" aria-hidden />
          {t("order.blocked.approved_by", { name: line.approval?.decided_by ?? "" })}
        </p>
      )}
    </li>
  );
}

// ------------------------------------------------------------------ product picker
function ProductPicker({ open, onClose, products, onPick }: { open: boolean; onClose: () => void; products: Product[]; onPick: (p: Product) => void }) {
  const { t, number } = useI18n();
  const [q, setQ] = useState("");
  const shown = products.filter((p) => !q || `${p.name} ${p.sku}`.toLowerCase().includes(q.toLowerCase()));
  const cats = [...new Set(shown.map((p) => p.category))];
  return (
    <Dialog open={open} onClose={onClose} title={t("order.add_product")}>
      <div className="relative mb-3">
        <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-ink-3" aria-hidden />
        <input className="input ps-9" placeholder={t("order.product.search")} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t("order.product.search")} autoFocus />
      </div>
      {cats.map((c) => (
        <div key={c} className="mb-3">
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-3">{t(`cat.${c}` as MessageKey)}</h3>
          <ul className="divide-y divide-line rounded-xl border border-line">
            {shown.filter((p) => p.category === c).map((p) => (
              <li key={p.id}>
                <button className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-start hover:bg-[#f1f5f2]" onClick={() => onPick(p)}>
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{p.name}</span>
                    <span className={cx("block text-xs", p.on_hand - p.committed > 0 ? "text-ink-3" : "text-red-ink")}>{t("order.product.available", { n: number(Math.max(0, p.on_hand - p.committed)) })}</span>
                  </span>
                  <Money minor={p.price_usd_minor} currency="USD" className="font-semibold" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </Dialog>
  );
}
