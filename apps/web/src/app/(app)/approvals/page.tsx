"use client";

import { useState } from "react";
import { Check, X } from "lucide-react";
import { Badge, Card, Empty, Loading, Money, PageHeader, Segmented, useToast } from "@/components/ui";
import { useI18n } from "@/i18n/i18n";
import { useAction, useRpc } from "@/lib/db";

interface Approval {
  id: string;
  status: "pending" | "approved" | "rejected";
  qty: number;
  unit_price_usd_minor: number;
  value_usd_minor: number;
  discount_usd_minor: number;
  customer: string;
  city: string;
  product: string;
  requested_by: string;
  requested_at: string;
  decided_by: string | null;
  decided_at: string | null;
  note: string | null;
  used_by_order: string | null;
}

export default function Approvals() {
  const { t, dateTime, number } = useI18n();
  const toast = useToast();
  const action = useAction();
  const [status, setStatus] = useState<"pending" | "all">("pending");
  const { data, loading } = useRpc<Approval[]>("approvals_list", { p_status: status });

  const decide = async (a: Approval, approve: boolean) => {
    try {
      await action("decide_discount_approval", { p_id: a.id, p_approve: approve });
      toast("ok", approve ? t("approvals.approved_toast", { name: a.requested_by }) : t("approvals.rejected_toast"));
    } catch (e) {
      toast("bad", (e as Error).message);
    }
  };

  return (
    <div className="fade-in">
      <PageHeader title={t("nav.approvals")} subtitle={t("approvals.subtitle")} />
      <div className="mb-4">
        <Segmented label={t("approvals.filter")} value={status} onChange={setStatus} options={[{ value: "pending", label: t("approvals.pending") }, { value: "all", label: t("approvals.recent") }]} />
      </div>
      {loading && !data ? (
        <Loading />
      ) : !data?.length ? (
        <Card>
          <Empty>{t("approvals.none")}</Empty>
        </Card>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {data.map((a) => {
            const pct = (a.discount_usd_minor * 100) / a.value_usd_minor;
            return (
              <li key={a.id} className="card p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-semibold">{a.customer}</div>
                    <div className="text-xs text-ink-3">{a.city} · {t("approvals.asked", { name: a.requested_by, when: dateTime(a.requested_at) })}</div>
                  </div>
                  <Badge tone={a.status === "approved" ? "ok" : a.status === "rejected" ? "bad" : "warn"}>{t(`approvals.status.${a.status}`)}</Badge>
                </div>
                <div className="mt-3 rounded-lg bg-[#f7faf8] p-3 text-sm">
                  <div className="font-medium">{a.product}</div>
                  <div className="mt-1 grid grid-cols-3 gap-2 text-xs text-ink-3">
                    <div>
                      {t("approvals.line")}
                      <div className="text-sm font-semibold text-ink">
                        {number(a.qty)} × <Money minor={a.unit_price_usd_minor} currency="USD" />
                      </div>
                    </div>
                    <div>
                      {t("approvals.discount")}
                      <div className="text-sm font-semibold text-red-ink">
                        <Money minor={a.discount_usd_minor} currency="USD" /> <span className="num">({number(pct, 2)}%)</span>
                      </div>
                    </div>
                    <div>
                      {t("approvals.line_total")}
                      <div className="text-sm font-semibold text-ink">
                        <Money minor={a.value_usd_minor - a.discount_usd_minor} currency="USD" />
                      </div>
                    </div>
                  </div>
                  {a.note && <p className="mt-2 text-xs text-ink-2">“{a.note}”</p>}
                </div>
                {a.status === "pending" ? (
                  <div className="mt-3 flex gap-2">
                    <button className="btn btn-primary btn-sm flex-1" onClick={() => decide(a, true)}>
                      <Check className="size-4" aria-hidden />
                      {t("approvals.approve")}
                    </button>
                    <button className="btn btn-secondary btn-sm flex-1" onClick={() => decide(a, false)}>
                      <X className="size-4" aria-hidden />
                      {t("approvals.reject")}
                    </button>
                  </div>
                ) : (
                  <p className="mt-3 text-xs text-ink-3">
                    {a.decided_by && t("approvals.decided", { name: a.decided_by, when: dateTime(a.decided_at) })}
                    {a.used_by_order ? ` · ${t("approvals.used")}` : a.status === "approved" ? ` · ${t("approvals.not_used")}` : ""}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
