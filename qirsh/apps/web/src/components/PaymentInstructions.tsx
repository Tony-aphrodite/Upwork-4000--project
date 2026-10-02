"use client";

import { MessageCircle } from "lucide-react";
import { transferPlan } from "@qirsh/money";
import { useI18n } from "@/i18n/i18n";
import { useRpc } from "@/lib/db";
import { Card, Loading, Money, Note } from "./ui";
import { whatsappLink } from "@/lib/whatsapp";

interface Today {
  max_transfer_minor: number;
  accounts: { id: string; name: string; kind: string; bank: string; number_masked: string; holder: string; remaining_minor: number; daily_limit_minor: number }[];
}

/**
 * Step 2's payment instructions: which accounts to pay into today, in how many transfers of at
 * most 3,000,000, given how much room each account still has today.
 */
export function PaymentInstructions({ orderNumber, outstanding, customer, phone }: { orderNumber: string; outstanding: number; customer: string; phone?: string | null }) {
  const { t, money } = useI18n();
  const today = useRpc<Today>("accounts_today");
  if (!today.data) return <Loading />;
  // Exchangers' accounts first; our own and pass-through accounts only if they are full.
  const toPlan = (kinds: (k: string) => boolean) =>
    today.data!.accounts.filter((a) => kinds(a.kind)).map((a) => ({ id: a.id, label: `${a.holder} · ${a.bank} ${a.number_masked}`, remainingToday: a.remaining_minor }));
  const first = transferPlan(outstanding, toPlan((k) => k === "exchanger"), today.data.max_transfer_minor);
  const rest = first.carryOver > 0 ? transferPlan(first.carryOver, toPlan((k) => k !== "exchanger"), today.data.max_transfer_minor) : { transfers: [], carryOver: 0 };
  const plan = { transfers: [...first.transfers, ...rest.transfers], carryOver: rest.carryOver };
  const grouped = new Map<string, { label: string; amounts: number[] }>();
  for (const tr of plan.transfers) {
    const g = grouped.get(tr.accountId) ?? { label: tr.label, amounts: [] };
    g.amounts.push(tr.amount);
    grouped.set(tr.accountId, g);
  }
  const message = [
    t("pay.msg.greeting", { customer }),
    t("pay.msg.order", { number: orderNumber, amount: money(outstanding, "SDG") }),
    ...[...grouped.values()].map((g) => `• ${g.label}: ${g.amounts.map((a) => money(a, "SDG")).join(" + ")}`),
    plan.carryOver > 0 ? t("pay.msg.tomorrow", { amount: money(plan.carryOver, "SDG") }) : "",
    t("pay.msg.screenshot"),
  ].filter(Boolean).join("\n");

  return (
    <Card title={t("pay.title")} action={<span className="text-xs text-ink-3">{t("pay.transfers", { n: plan.transfers.length })}</span>}>
      <p className="mb-3 text-sm text-ink-2">{t("pay.explain", { max: money(today.data.max_transfer_minor, "SDG") })}</p>
      <ul className="space-y-2">
        {[...grouped.values()].map((g) => (
          <li key={g.label} className="rounded-lg border border-line px-3 py-2">
            <div className="text-sm font-medium">{g.label}</div>
            <div className="mt-0.5 flex flex-wrap gap-x-2 text-sm text-ink-2">
              {g.amounts.map((a, i) => (
                <Money key={i} minor={a} currency="SDG" />
              ))}
            </div>
          </li>
        ))}
      </ul>
      {plan.carryOver > 0 && (
        <div className="mt-3">
          <Note tone="warn">{t("pay.carry", { amount: money(plan.carryOver, "SDG") })}</Note>
        </div>
      )}
      <a className="btn btn-secondary mt-3 w-full sm:w-auto" href={whatsappLink(phone, message)} target="_blank" rel="noreferrer">
        <MessageCircle className="size-4" aria-hidden />
        {t("pay.share")}
      </a>
    </Card>
  );
}
