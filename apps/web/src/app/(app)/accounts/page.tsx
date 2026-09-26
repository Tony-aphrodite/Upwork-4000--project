"use client";

import { useMemo, useState } from "react";
import { ArrowRight, Banknote, CircleAlert, FileCheck2, Plus } from "lucide-react";
import { parseMoney, type Currency } from "@qirsh/money";
import { Badge, Card, cx, Dialog, ErrorNote, Field, Loading, Money, PageHeader, Progress, Segmented, TableWrap, td, th, useToast } from "@/components/ui";
import { useI18n, type MessageKey } from "@/i18n/i18n";
import { useAction, useMe, useRpc } from "@/lib/db";

interface Account {
  id: string;
  name: string;
  kind: string;
  kind_label: string;
  bank: string | null;
  number_masked: string | null;
  currency: Currency;
  holder: string | null;
  holder_id: string | null;
  route: string | null;
  pass_through: boolean;
  external: boolean;
  balance_minor: number;
  daily_limit_minor: number | null;
  intake_today_minor: number | null;
  statement: { as_of: string; balance_minor: number; ledger_minor: number } | null;
  unconfirmed_minor: number;
}
interface Line {
  id: string;
  occurred_on: string;
  kind: string;
  memo: string | null;
  category: string | null;
  from_account: string;
  from_amount_minor: number;
  from_currency: Currency;
  to_account: string;
  to_amount_minor: number;
  to_currency: Currency;
  usd_minor: number;
}
type Form = null | "payout" | "movement" | "statement";

export default function Accounts() {
  const { t, date } = useI18n();
  const accounts = useRpc<Account[]>("accounts_overview");
  const [filter, setFilter] = useState<string | null>(null);
  const ledger = useRpc<Line[]>("ledger_lines", { p_account: filter, p_limit: 120 });
  const [form, setForm] = useState<Form>(null);

  const groups = useMemo(() => {
    const a = (accounts.data ?? []).filter((x) => !x.external);
    return [
      { key: "exchanger", title: t("acc.exchangers"), rows: a.filter((x) => x.kind === "exchanger") },
      { key: "own", title: t("acc.own"), rows: a.filter((x) => x.kind === "own" || x.kind === "staff_cash") },
      { key: "pass", title: t("acc.pass_through"), rows: a.filter((x) => x.pass_through) },
      { key: "foreign", title: t("acc.foreign"), rows: a.filter((x) => x.kind === "foreign") },
    ];
  }, [accounts.data, t]);

  const byHolder = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of accounts.data ?? []) if (a.kind === "exchanger" && a.holder) m.set(a.holder, (m.get(a.holder) ?? 0) + a.balance_minor);
    return [...m.entries()];
  }, [accounts.data]);

  if (!accounts.data) return <Loading />;
  return (
    <div className="fade-in">
      <PageHeader
        title={t("nav.accounts")}
        subtitle={t("acc.subtitle")}
        actions={
          <>
            <button className="btn btn-primary btn-sm" onClick={() => setForm("payout")}>
              <Banknote className="size-4" aria-hidden />
              {t("acc.payout")}
            </button>
            <button className="btn btn-secondary btn-sm" onClick={() => setForm("movement")}>
              <Plus className="size-4" aria-hidden />
              {t("acc.movement")}
            </button>
            <button className="btn btn-secondary btn-sm" onClick={() => setForm("statement")}>
              <FileCheck2 className="size-4" aria-hidden />
              {t("acc.statement")}
            </button>
          </>
        }
      />

      <Card title={t("acc.outstanding_per_exchanger")} className="mb-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {byHolder.map(([h, v]) => (
            <div key={h}>
              <div className="text-xs text-ink-3">{h}</div>
              <div className="num text-lg font-bold">
                <Money minor={v} currency="SDG" />
              </div>
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-ink-3">{t("acc.outstanding_note")}</p>
      </Card>

      <div className="space-y-4">
        {groups.map((g) =>
          g.rows.length ? (
            <Card key={g.key} title={g.title} pad={false}>
              <ul className="divide-y divide-line">
                {g.rows.map((a) => {
                  const diff = a.statement ? a.statement.balance_minor - a.statement.ledger_minor : 0;
                  return (
                    <li key={a.id} className="grid gap-3 px-4 py-3 sm:grid-cols-[1fr_260px_230px] sm:items-center">
                      <div className="min-w-0">
                        <button className="text-start font-semibold hover:text-brand" onClick={() => setFilter(filter === a.id ? null : a.id)} aria-pressed={filter === a.id}>
                          {a.name}
                        </button>
                        <div className="text-xs text-ink-3">
                          {[a.bank, a.number_masked, a.route && t("acc.route", { route: a.route })].filter(Boolean).join(" · ")}
                        </div>
                        {a.unconfirmed_minor > 0 && (
                          <div className="mt-0.5 text-xs text-warn-ink">
                            {t("acc.unconfirmed", { amount: "" })}
                            <Money minor={a.unconfirmed_minor} currency="SDG" />
                          </div>
                        )}
                      </div>
                      <div>
                        {a.daily_limit_minor ? (
                          <>
                            <div className="mb-1 flex justify-between gap-2 text-xs text-ink-3">
                              <span>{t("acc.today")}</span>
                              <span className="num">
                                <Money minor={a.intake_today_minor ?? 0} currency="SDG" /> / <Money minor={a.daily_limit_minor} currency="SDG" />
                              </span>
                            </div>
                            <Progress value={a.intake_today_minor ?? 0} max={a.daily_limit_minor} tone={(a.intake_today_minor ?? 0) >= a.daily_limit_minor ? "bad" : (a.intake_today_minor ?? 0) >= a.daily_limit_minor * 0.8 ? "warn" : "brand"} label={a.name} />
                          </>
                        ) : (
                          <span className="text-xs text-ink-3">{a.kind_label}</span>
                        )}
                      </div>
                      <div className="sm:text-end">
                        <div className={cx("text-lg font-bold", a.pass_through && a.balance_minor !== 0 && "text-red-ink")}>
                          <Money minor={a.balance_minor} currency={a.currency} />
                        </div>
                        {a.pass_through && a.balance_minor !== 0 && <div className="text-xs font-medium text-red-ink">{t("acc.pass_not_zero")}</div>}
                        {a.statement && (
                          <div className={cx("mt-0.5 text-xs", diff === 0 ? "text-ok-ink" : "font-semibold text-red-ink")}>
                            {diff === 0 ? t("acc.statement_ok", { date: date(a.statement.as_of, "short") }) : (
                              <span className="inline-flex flex-wrap items-center justify-end gap-1">
                                <CircleAlert className="size-3" aria-hidden />
                                {t("acc.statement_diff", { date: date(a.statement.as_of, "short") })}
                                <Money minor={diff} currency={a.currency} sign />
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </Card>
          ) : null,
        )}

        <Card
          title={filter ? t("acc.ledger_for", { name: accounts.data.find((a) => a.id === filter)?.name ?? "" }) : t("acc.ledger")}
          action={filter && <button className="text-xs font-medium text-brand" onClick={() => setFilter(null)}>{t("acc.ledger_all")}</button>}
          pad={false}
        >
          {!ledger.data ? (
            <Loading />
          ) : (
            <TableWrap label={t("acc.ledger")}>
              <table className="w-full min-w-[760px]">
                <thead className="border-b border-line bg-[#f9fbfa]">
                  <tr>
                    <th className={th}>{t("acc.col.date")}</th>
                    <th className={th}>{t("acc.col.kind")}</th>
                    <th className={th}>{t("acc.col.movement")}</th>
                    <th className={`${th} text-end`}>{t("acc.col.amount")}</th>
                    <th className={`${th} text-end`}>{t("acc.col.usd")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {ledger.data.map((l) => (
                    <tr key={l.id}>
                      <td className={`${td} whitespace-nowrap text-ink-3`}>{date(l.occurred_on, "short")}</td>
                      <td className={td}>
                        <Badge tone={l.kind === "payout" || l.kind === "conversion" ? "info" : l.kind === "expense" || l.kind === "refund" ? "warn" : "neutral"}>{t(`ledger.${l.kind}` as MessageKey)}</Badge>
                      </td>
                      <td className={td}>
                        <div className="flex flex-wrap items-center gap-1 text-sm">
                          {l.from_account} <ArrowRight className="size-3.5 text-ink-3 rtl:rotate-180" aria-hidden /> {l.to_account}
                        </div>
                        {(l.memo || l.category) && <div className="text-xs text-ink-3">{[l.category, l.memo].filter(Boolean).join(" · ")}</div>}
                      </td>
                      <td className={`${td} text-end`}>
                        <Money minor={l.from_amount_minor} currency={l.from_currency} />
                        {l.from_currency !== l.to_currency && (
                          <div className="text-xs text-ink-3">
                            → <Money minor={l.to_amount_minor} currency={l.to_currency} />
                          </div>
                        )}
                      </td>
                      <td className={`${td} text-end text-ink-3`}>
                        <Money minor={l.usd_minor} currency="USD" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          )}
        </Card>
      </div>

      <MovementForms form={form} onClose={() => setForm(null)} accounts={accounts.data} />
    </div>
  );
}

function MovementForms({ form, onClose, accounts }: { form: Form; onClose: () => void; accounts: Account[] }) {
  const me = useMe()!;
  const { t, money } = useI18n();
  const toast = useToast();
  const action = useAction();
  const [kind, setKind] = useState("transfer");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [toAmount, setToAmount] = useState("");
  const [memo, setMemo] = useState("");
  const [category, setCategory] = useState("");
  const [day, setDay] = useState(me.today);
  const [error, setError] = useState<Error | null>(null);
  const fromAcc = accounts.find((a) => a.id === from);
  const toAcc = accounts.find((a) => a.id === to);

  const reset = () => {
    setFrom("");
    setTo("");
    setAmount("");
    setToAmount("");
    setMemo("");
    setCategory("");
    setError(null);
  };
  const close = () => {
    reset();
    onClose();
  };

  const submit = async () => {
    setError(null);
    const a = parseMoney(amount);
    const b = parseMoney(toAmount);
    try {
      if (form === "payout") {
        await action("record_payout", { p_day: day, p_from_account: from, p_sdg_minor: a, p_to_account: to, p_to_amount: b, p_memo: memo || null });
        toast("ok", t("acc.payout_done"));
      } else if (form === "statement") {
        await action("record_statement", { p_account: from, p_as_of: day, p_balance_minor: a });
        toast("ok", t("acc.statement_done"));
      } else {
        await action("record_movement", {
          p_kind: kind, p_day: day, p_from: from, p_from_amount: a, p_to: to, ...(kind === "conversion" ? { p_to_amount: b } : {}), p_memo: memo || null, p_category: category || null,
        });
        toast("ok", t("acc.movement_done"));
      }
      close();
    } catch (e) {
      setError(e as Error);
    }
  };

  const options = (filterFn: (a: Account) => boolean) =>
    accounts.filter(filterFn).map((a) => (
      <option key={a.id} value={a.id}>
        {a.name} ({a.currency})
      </option>
    ));

  const title = form === "payout" ? t("acc.payout") : form === "statement" ? t("acc.statement") : t("acc.movement");
  return (
    <Dialog open={form !== null} onClose={close} title={title} footer={<button className="btn btn-primary" onClick={submit}>{t("common.save")}</button>}>
      <div className="space-y-4">
        {form === "payout" && <p className="text-sm text-ink-2">{t("acc.payout_explain")}</p>}
        {form === "statement" && <p className="text-sm text-ink-2">{t("acc.statement_explain")}</p>}
        {form === "movement" && (
          <Segmented
            label={t("acc.kind")}
            value={kind}
            onChange={setKind}
            options={["transfer", "cash_withdrawal", "expense", "refund", "conversion"].map((k) => ({ value: k, label: t(`ledger.${k}` as MessageKey) }))}
          />
        )}
        <Field label={form === "statement" ? t("acc.account") : t("acc.from")} htmlFor="from">
          <select id="from" className="input" value={from} onChange={(e) => setFrom(e.target.value)}>
            <option value="">—</option>
            {options((a) => (form === "payout" ? a.kind === "exchanger" : form === "statement" ? !a.external : !a.external))}
          </select>
        </Field>
        {form !== "statement" && (
          <Field label={t("acc.to")} htmlFor="to">
            <select id="to" className="input" value={to} onChange={(e) => setTo(e.target.value)}>
              <option value="">—</option>
              {options((a) =>
                form === "payout" ? a.currency !== "SDG" : kind === "expense" ? a.kind === "expenses" : kind === "refund" ? a.kind === "customers" : kind === "cash_withdrawal" ? a.kind === "staff_cash" : a.id !== from && !a.external,
              )}
            </select>
          </Field>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={form === "statement" ? t("acc.actual_balance") : t("acc.amount", { currency: fromAcc?.currency ?? "" })} htmlFor="amt">
            <input id="amt" className="input num" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
          {(form === "payout" || kind === "conversion") && form !== "statement" && (
            <Field label={t("acc.received", { currency: toAcc?.currency ?? "" })} htmlFor="amt2">
              <input id="amt2" className="input num" inputMode="decimal" value={toAmount} onChange={(e) => setToAmount(e.target.value)} />
            </Field>
          )}
          <Field label={t("acc.date")} htmlFor="day">
            <input id="day" type="date" className="input" value={day} max={me.today} onChange={(e) => setDay(e.target.value)} />
          </Field>
          {form === "movement" && kind === "expense" && (
            <Field label={t("acc.category")} htmlFor="cat">
              <input id="cat" className="input" value={category} onChange={(e) => setCategory(e.target.value)} placeholder={t("acc.category_ph")} />
            </Field>
          )}
        </div>
        {form !== "statement" && (
          <Field label={t("acc.memo")} htmlFor="memo">
            <input id="memo" className="input" value={memo} onChange={(e) => setMemo(e.target.value)} />
          </Field>
        )}
        {form === "payout" && parseMoney(amount) && parseMoney(toAmount) ? (
          <p className="text-xs text-ink-3">
            {t("acc.effective_rate", { rate: money(Math.round(((parseMoney(amount) ?? 0) / (parseMoney(toAmount) || 1)) * 100), "SDG", { decimals: "auto" }), currency: toAcc?.currency ?? "" })}
          </p>
        ) : null}
        <ErrorNote error={error} />
      </div>
    </Dialog>
  );
}
