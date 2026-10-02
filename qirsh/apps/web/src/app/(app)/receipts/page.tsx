"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { AlertTriangle, CheckCheck, Image as ImageIcon, Plus, Search, Send } from "lucide-react";
import { ProofView, type ProofReceipt } from "@/components/ProofView";
import { Badge, Card, cx, Dialog, Empty, Field, Loading, Money, PageHeader, Segmented, TableWrap, td, th, useToast } from "@/components/ui";
import { useI18n, type MessageKey } from "@/i18n/i18n";
import { useAction, useMe, useRpc } from "@/lib/db";

interface Row extends ProofReceipt {
  id: string;
  customer_id: string;
  customer: string;
  from_holder: string | null;
  status: "received" | "forwarded" | "confirmed";
  flags: string[];
  allocated_sdg_minor: number;
  recorded_by: string;
  recorded_at: string;
  orders: { number: string; sdg_minor: number }[];
}
interface Conflict {
  id: string;
  txn_code: string;
  attempted_amount_sdg_minor: number;
  attempted_on: string;
  receipt_number: string;
  receipt_amount_sdg_minor: number;
  raised_by: string;
  raised_at: string;
  resolved_at: string | null;
  resolution: string | null;
}
type Filter = "all" | "to_forward" | "to_confirm" | "unmatched" | "flagged" | "conflicts";

export default function ReceiptsPage() {
  return (
    <Suspense fallback={<Loading />}>
      <Receipts />
    </Suspense>
  );
}

function Receipts() {
  const me = useMe()!;
  const params = useSearchParams();
  const { t, date, dateTime } = useI18n();
  const toast = useToast();
  const action = useAction();
  const [filter, setFilter] = useState<Filter>((params.get("f") as Filter) ?? "all");
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [proof, setProof] = useState<Row | null>(null);
  const list = useRpc<Row[]>(filter === "conflicts" ? null : "receipts_list", { p_filter: filter, p_search: q.trim() || null });
  const conflicts = useRpc<Conflict[]>(filter === "conflicts" ? "conflicts_list" : null);
  useEffect(() => setPicked(new Set()), [filter, q]);

  const setStatus = async (status: "forwarded" | "confirmed") => {
    try {
      const n = await action<number>("set_receipt_status", { p_ids: [...picked], p_status: status });
      toast("ok", t(status === "forwarded" ? "receipts.forwarded_n" : "receipts.confirmed_n", { n }));
      setPicked(new Set());
    } catch (e) {
      toast("bad", (e as Error).message);
    }
  };

  const filters: { value: Filter; label: string }[] = [
    { value: "all", label: t("receipts.f.all") },
    { value: "to_forward", label: t("receipts.f.to_forward") },
    { value: "to_confirm", label: t("receipts.f.to_confirm") },
    { value: "unmatched", label: t("receipts.f.unmatched") },
    { value: "flagged", label: t("receipts.f.flagged") },
    ...(me.role === "owner" ? [{ value: "conflicts" as Filter, label: t("receipts.f.conflicts") }] : []),
  ];
  const rows = list.data ?? [];

  return (
    <div className="fade-in">
      <PageHeader
        title={t("nav.receipts")}
        subtitle={t("receipts.subtitle")}
        actions={
          <Link href="/receipts/new" className="btn btn-primary">
            <Plus className="size-4" aria-hidden />
            {t("receipts.record")}
          </Link>
        }
      />
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Segmented label={t("receipts.filter")} value={filter} onChange={setFilter} options={filters} />
        {filter !== "conflicts" && (
          <div className="relative sm:w-64">
            <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-ink-3" aria-hidden />
            <input className="input ps-9" placeholder={t("receipts.search")} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t("receipts.search")} />
          </div>
        )}
      </div>

      {filter === "conflicts" ? (
        <Conflicts rows={conflicts.data} loading={conflicts.loading} />
      ) : (
        <Card pad={false}>
          {picked.size > 0 && (
            <div className="sticky top-14 z-10 flex flex-wrap items-center gap-2 border-b border-line bg-[#f2f7f4] px-4 py-2 lg:top-0">
              <span className="text-sm font-medium">{t("receipts.selected", { n: picked.size })}</span>
              <button className="btn btn-secondary btn-sm" onClick={() => setStatus("forwarded")}>
                <Send className="size-4" aria-hidden />
                {t("receipts.mark_forwarded")}
              </button>
              {me.role === "owner" && (
                <button className="btn btn-primary btn-sm" onClick={() => setStatus("confirmed")}>
                  <CheckCheck className="size-4" aria-hidden />
                  {t("receipts.mark_confirmed")}
                </button>
              )}
            </div>
          )}
          {list.loading && !list.data ? (
            <Loading />
          ) : rows.length === 0 ? (
            <Empty>{t("receipts.none")}</Empty>
          ) : (
            <TableWrap label={t("nav.receipts")}>
              <table className="w-full min-w-[820px]">
                <thead className="border-b border-line bg-[#f9fbfa]">
                  <tr>
                    <th className={`${th} w-10`}>
                      <input
                        type="checkbox"
                        className="size-4 accent-[var(--brand)]"
                        aria-label={t("receipts.select_all")}
                        checked={picked.size > 0 && picked.size === rows.filter((r) => r.status !== "confirmed").length}
                        onChange={(e) => setPicked(e.target.checked ? new Set(rows.filter((r) => r.status !== "confirmed").map((r) => r.id)) : new Set())}
                      />
                    </th>
                    <th className={th}>{t("receipts.col.receipt")}</th>
                    <th className={th}>{t("receipts.col.customer")}</th>
                    <th className={th}>{t("receipts.col.route")}</th>
                    <th className={`${th} text-end`}>{t("receipts.col.amount")}</th>
                    <th className={th}>{t("receipts.col.orders")}</th>
                    <th className={th}>{t("receipts.col.status")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {rows.map((r) => (
                    <tr key={r.id} className={cx(picked.has(r.id) && "bg-[#f2f7f4]")}>
                      <td className={td}>
                        {r.status !== "confirmed" && (
                          <input
                            type="checkbox"
                            className="size-4 accent-[var(--brand)]"
                            aria-label={t("receipts.select", { number: r.number })}
                            checked={picked.has(r.id)}
                            onChange={(e) => {
                              const next = new Set(picked);
                              if (e.target.checked) next.add(r.id);
                              else next.delete(r.id);
                              setPicked(next);
                            }}
                          />
                        )}
                      </td>
                      <td className={td}>
                        <button className="flex items-center gap-1.5 font-semibold hover:text-brand" onClick={() => setProof(r)}>
                          <ImageIcon className="size-3.5 text-ink-3" aria-hidden />
                          {r.number}
                        </button>
                        <div className="num text-xs text-ink-3">{r.txn_code}</div>
                        <div className="text-xs text-ink-3">{date(r.received_on, "short")}</div>
                      </td>
                      <td className={td}>
                        <Link href={`/customers/${r.customer_id}`} className="hover:text-brand">
                          {r.customer}
                        </Link>
                        <div className="text-xs text-ink-3">{t("receipts.recorded_by", { name: r.recorded_by, when: dateTime(r.recorded_at) })}</div>
                      </td>
                      <td className={td}>
                        <div className="text-xs">
                          <span className="text-ink-3">{t("receipts.from")}</span> {r.from_name}
                          {r.from_holder && r.from_holder !== r.from_name && <span className="text-ink-3"> ({r.from_holder})</span>}
                        </div>
                        <div className="text-xs">
                          <span className="text-ink-3">{t("receipts.to")}</span> {r.to_account}
                        </div>
                      </td>
                      <td className={`${td} text-end font-semibold`}>
                        <Money minor={r.amount_sdg_minor} currency="SDG" />
                      </td>
                      <td className={td}>
                        {r.orders.length === 0 ? (
                          <Badge tone="warn">{t("receipts.unmatched")}</Badge>
                        ) : (
                          <ul className="text-xs">
                            {r.orders.map((o) => (
                              <li key={o.number}>
                                {o.number} · <Money minor={o.sdg_minor} currency="SDG" />
                              </li>
                            ))}
                          </ul>
                        )}
                      </td>
                      <td className={td}>
                        <div className="flex flex-wrap gap-1">
                          <Badge tone={r.status === "confirmed" ? "ok" : r.status === "forwarded" ? "info" : "warn"}>{t(`receipt.status.${r.status}` as MessageKey)}</Badge>
                          {r.flags.map((f) => (
                            <Badge key={f} tone="bad">
                              <AlertTriangle className="size-3" aria-hidden />
                              {t(`receipt.flag.${f}` as MessageKey)}
                            </Badge>
                          ))}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          )}
        </Card>
      )}

      <Dialog open={!!proof} onClose={() => setProof(null)} title={proof ? `${proof.number} · ${proof.txn_code}` : ""}>
        {proof && <ProofView r={proof} />}
      </Dialog>
    </div>
  );
}

function Conflicts({ rows, loading }: { rows: Conflict[] | null; loading: boolean }) {
  const { t, dateTime } = useI18n();
  const toast = useToast();
  const action = useAction();
  const [open, setOpen] = useState<Conflict | null>(null);
  const [text, setText] = useState("");
  if (loading && !rows) return <Loading />;
  return (
    <Card pad={false}>
      {!rows?.length ? (
        <Empty>{t("receipts.no_conflicts")}</Empty>
      ) : (
        <ul className="divide-y divide-line">
          {rows.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div>
                <div className="font-semibold num">{c.txn_code}</div>
                <div className="text-sm text-ink-2">
                  {t("receipts.conflict_line", { number: c.receipt_number })} <Money minor={c.receipt_amount_sdg_minor} currency="SDG" className="font-medium" /> · {t("receipts.conflict_again")}{" "}
                  <Money minor={c.attempted_amount_sdg_minor} currency="SDG" className="font-medium text-red-ink" />
                </div>
                <div className="text-xs text-ink-3">{t("receipts.raised", { name: c.raised_by, when: dateTime(c.raised_at) })}</div>
                {c.resolution && <div className="mt-1 text-xs text-ok-ink">{t("receipts.resolved", { text: c.resolution })}</div>}
              </div>
              {!c.resolved_at ? (
                <button className="btn btn-secondary btn-sm" onClick={() => setOpen(c)}>
                  {t("receipts.resolve")}
                </button>
              ) : (
                <Badge tone="ok">{t("receipts.resolved_badge")}</Badge>
              )}
            </li>
          ))}
        </ul>
      )}
      <Dialog
        open={!!open}
        onClose={() => setOpen(null)}
        title={t("receipts.resolve")}
        footer={
          <button
            className="btn btn-primary"
            disabled={!text.trim()}
            onClick={async () => {
              try {
                await action("resolve_conflict", { p_id: open!.id, p_resolution: text });
                setOpen(null);
                setText("");
              } catch (e) {
                toast("bad", (e as Error).message);
              }
            }}
          >
            {t("receipts.resolve")}
          </button>
        }
      >
        <Field label={t("receipts.resolution")} htmlFor="resolution" hint={t("receipts.resolution_hint")}>
          <textarea id="resolution" className="input min-h-24" value={text} onChange={(e) => setText(e.target.value)} />
        </Field>
      </Dialog>
    </Card>
  );
}
