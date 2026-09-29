"use client";

import { CheckCircle2, CircleAlert, Lock } from "lucide-react";
import { Badge, Card, cx, isRefusal, Loading, Money, PageHeader, Refused, useToast } from "@/components/ui";
import { useI18n, type MessageKey } from "@/i18n/i18n";
import { useAction, useMe, useRpc } from "@/lib/db";

interface Check {
  code: string;
  status: "ok" | "warn" | "fail";
  items: { label: string; value?: number; currency?: "SDG" | "EUR" | "AED" | "USD"; as_of?: string; actual?: number; ledger?: number; since?: string; on?: string }[];
}

/** Step 7's closing checks: each proves one thing about the books; failures are listed, never hidden. */
export default function Closing() {
  const me = useMe()!;
  const { t, date, dateTime } = useI18n();
  const toast = useToast();
  const action = useAction();
  const { data, error } = useRpc<Check[]>("closing_checks");
  const lock = useRpc<{ closed_through: string; closed_at: string; by: string } | null>("period_lock");
  if (isRefusal(error)) return <Refused title={t("nav.closing")} error={error} />;
  if (!data) return <Loading />;
  const failing = data.filter((c) => c.status !== "ok").length;
  const today = new Date(`${me.today}T12:00:00Z`);
  const lastMonthEnd = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 0)).toISOString().slice(0, 10);
  const closed = lock.data?.closed_through ?? null;
  return (
    <div className="fade-in">
      <PageHeader title={t("nav.closing")} subtitle={failing ? t("closing.subtitle_issues", { n: failing, total: data.length }) : t("closing.subtitle_ok", { total: data.length })} />
      <Card className="mb-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-start gap-2 text-sm">
            <Lock className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden />
            <div>
              <p className="font-semibold">{closed ? t("closing.closed_through", { date: date(closed) }) : t("closing.nothing_closed")}</p>
              <p className="text-ink-3">{t("closing.lock_why")}</p>
            </div>
          </div>
          {(!closed || closed < lastMonthEnd) && (
            <button
              className="btn btn-secondary btn-sm"
              onClick={async () => {
                if (failing && !window.confirm(t("closing.confirm_with_issues", { n: failing }))) return;
                try {
                  await action("close_period", { p_through: lastMonthEnd });
                  toast("ok", t("closing.closed_toast", { date: date(lastMonthEnd) }));
                } catch (e) {
                  toast("bad", (e as Error).message);
                }
              }}
            >
              {t("closing.close_month", { date: date(lastMonthEnd, "month") })}
            </button>
          )}
        </div>
      </Card>
      <ul className="space-y-3">
        {data.map((c) => (
          <li key={c.code}>
            <Card>
              <div className="flex items-start gap-3">
                {c.status === "ok" ? <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-ok-ink" aria-hidden /> : <CircleAlert className={cx("mt-0.5 size-5 shrink-0", c.status === "fail" ? "text-red-ink" : "text-warn-ink")} aria-hidden />}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="font-semibold">{t(`closing.${c.code}` as MessageKey)}</h2>
                    <Badge tone={c.status === "ok" ? "ok" : c.status === "fail" ? "bad" : "warn"}>{t(`closing.status.${c.status}` as MessageKey)}</Badge>
                  </div>
                  <p className="mt-0.5 text-sm text-ink-3">{t(`closing.${c.code}.why` as MessageKey)}</p>
                  {c.items.length > 0 && (
                    <ul className="mt-2 divide-y divide-line rounded-lg border border-line">
                      {c.items.slice(0, 12).map((i, n) => (
                        <li key={n} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                          <span>
                            {i.label}
                            {i.as_of && <span className="text-ink-3"> · {t("closing.as_of", { date: date(i.as_of) })}</span>}
                            {i.since && <span className="text-ink-3"> · {t("closing.since", { when: dateTime(i.since) })}</span>}
                            {i.on && <span className="text-ink-3"> · {date(i.on)}</span>}
                          </span>
                          {i.actual !== undefined && i.currency ? (
                            <span className="text-xs">
                              {t("closing.actual")} <Money minor={i.actual} currency={i.currency} /> · {t("closing.ledger")} <Money minor={i.ledger} currency={i.currency} /> ·{" "}
                              <Money minor={i.value} currency={i.currency} sign className="font-semibold text-red-ink" />
                            </span>
                          ) : i.value !== undefined && i.currency ? (
                            <Money minor={i.value} currency={i.currency} className="font-medium" />
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}
