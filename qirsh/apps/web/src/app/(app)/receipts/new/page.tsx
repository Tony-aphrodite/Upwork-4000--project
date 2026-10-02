"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Camera, CheckCircle2, UserCheck, WifiOff } from "lucide-react";
import { parseMoney } from "@qirsh/money";
import type { DbError } from "@qirsh/db";
import { CustomerPicker, type PickedCustomer } from "@/components/CustomerPicker";
import { Card, cx, ErrorNote, Field, Money, Note, PageHeader, Progress } from "@/components/ui";
import { useI18n, type MessageKey } from "@/i18n/i18n";
import { useDb, useMe, useRpc } from "@/lib/db";
import { useOutbox } from "@/lib/outbox";
import { compress, saveProof, sha256 } from "@/lib/proofs";

interface OpenOrder {
  id: string;
  number: string;
  created_at: string;
  total_sdg_minor: number;
  paid_sdg_minor: number;
  outstanding_sdg_minor: number;
}
interface Today {
  max_transfer_minor: number;
  accounts: { id: string; name: string; holder: string; bank: string; number_masked: string; daily_limit_minor: number; intake_today_minor: number; remaining_minor: number }[];
}
interface Result {
  outcome: "recorded" | "conflict";
  message: string;
  receipt: { id: string; number: string; flags: string[]; amount_sdg_minor: number };
}

export default function RecordReceipt() {
  const me = useMe()!;
  const { db, userId, hosted } = useDb();
  const { t, money, date } = useI18n();
  const { submit, offline } = useOutbox();
  const [id, setId] = useState(() => crypto.randomUUID());
  const [customer, setCustomer] = useState<PickedCustomer | null>(null);
  const [photo, setPhoto] = useState<{ blob: Blob; url: string; sha: string } | null>(null);
  const [code, setCode] = useState("");
  const [amount, setAmount] = useState("");
  const [day, setDay] = useState(me.today);
  const [from, setFrom] = useState("");
  const [holder, setHolder] = useState<string | null>(null);
  const [account, setAccount] = useState("");
  const [alloc, setAlloc] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<DbError | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [queued, setQueued] = useState(false);
  const [photoWaiting, setPhotoWaiting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const today = useRpc<Today>("accounts_today");
  const open = useRpc<OpenOrder[]>(customer ? "open_orders" : null, { p_customer: customer?.id });
  const amountMinor = parseMoney(amount);

  // Suggest: pay the oldest open orders first.
  useEffect(() => {
    if (!open.data || amountMinor === null) return;
    let left = amountMinor;
    const next: Record<string, string> = {};
    for (const o of open.data) {
      const take = Math.min(left, o.outstanding_sdg_minor);
      next[o.id] = take > 0 ? String(take / 100) : "";
      left -= Math.max(0, take);
    }
    setAlloc(next);
  }, [open.data, amountMinor]);

  // Who sent it? Match the name on the screenshot against every known spelling.
  useEffect(() => {
    if (!db || !userId || from.trim().length < 3) return setHolder(null);
    const h = setTimeout(() => {
      db.as(userId).rpc<{ display_name: string }[]>("match_holder", { p_name: from }).then((r) => setHolder(r[0]?.display_name ?? null)).catch(() => setHolder(null));
    }, 250);
    return () => clearTimeout(h);
  }, [from, db, userId]);

  const allocations = useMemo(
    () => Object.entries(alloc).map(([order_id, v]) => ({ order_id, sdg_minor: parseMoney(v) ?? -1 })).filter((a) => a.sdg_minor !== 0),
    [alloc],
  );
  const allocated = allocations.reduce((s, a) => s + Math.max(0, a.sdg_minor), 0);
  const acc = today.data?.accounts.find((a) => a.id === account);
  const maxTransfer = today.data?.max_transfer_minor ?? 300000000;

  const problems: string[] = [];
  if (!customer) problems.push(t("rec.need.customer"));
  if (!photo) problems.push(t("rec.need.photo"));
  if (code.replace(/[^0-9A-Za-z]/g, "").length < 4) problems.push(t("rec.need.code"));
  if (!amountMinor) problems.push(t("rec.need.amount"));
  else if (amountMinor > maxTransfer) problems.push(t("rec.need.cap", { max: money(maxTransfer, "SDG") }));
  if (!account) problems.push(t("rec.need.account"));
  if (!from.trim()) problems.push(t("rec.need.from"));
  if (allocations.some((a) => a.sdg_minor < 0)) problems.push(t("rec.need.alloc_bad"));
  if (amountMinor && allocated > amountMinor) problems.push(t("rec.need.alloc_over"));

  const onPhoto = async (f: File | undefined) => {
    if (!f) return;
    const blob = await compress(f);
    setPhoto({ blob, url: URL.createObjectURL(blob), sha: await sha256(blob) });
  };

  const save = async () => {
    if (problems.length || !photo || !customer || !amountMinor) return;
    setSaving(true);
    setError(null);
    // The name of the object in the "proofs" bucket, which is also what the receipt stores: the
    // storage policy compares the two, so they have to be the same string.
    const path = `${me.tenant.id}/${id}.jpg`;
    try {
      setPhotoWaiting((await saveProof(path, photo.blob, hosted)) === "waiting");
      const r = await submit<Result>(
        "record_receipt",
        {
          p_id: id, p_customer: customer.id, p_txn_code: code, p_amount_sdg_minor: amountMinor, p_received_on: day, p_from_name: from,
          p_to_account: account, p_proof_path: path, p_proof_sha256: photo.sha, p_allocations: allocations.filter((a) => a.sdg_minor > 0),
        },
        `${customer.name} · ${code}`,
      );
      if (r === null) setQueued(true);
      else setResult(r);
    } catch (e) {
      setError(e as DbError);
    } finally {
      setSaving(false);
    }
  };

  const again = () => {
    setId(crypto.randomUUID());
    setPhoto(null);
    setCode("");
    setAmount("");
    setFrom("");
    setResult(null);
    setQueued(false);
    setError(null);
  };

  if (result) {
    const conflict = result.outcome === "conflict";
    return (
      <div className="fade-in mx-auto max-w-lg">
        <PageHeader title={conflict ? t("rec.conflict_title") : t("rec.saved_title", { number: result.receipt.number })} />
        <Note tone={conflict ? "warn" : "ok"}>
          <p className="font-semibold">{result.message}</p>
          {!conflict && result.receipt.flags.includes("over_daily_limit") && <p className="mt-1">{t("rec.over_limit")}</p>}
          {!conflict && <p className="mt-1">{t("rec.next_forward")}</p>}
        </Note>
        <div className="mt-4 flex flex-wrap gap-2">
          <button className="btn btn-primary" onClick={again}>
            {t("rec.another")}
          </button>
          <Link href="/receipts" className="btn btn-secondary">
            {t("nav.receipts")}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="fade-in pb-24">
      <PageHeader title={t("receipts.record")} subtitle={t("rec.subtitle")} />
      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <div className="space-y-4">
          <Card title={t("rec.customer")}>
            <CustomerPicker value={customer} onChange={setCustomer} />
          </Card>

          <Card title={t("rec.screenshot")}>
            <input ref={fileRef} type="file" accept="image/*" capture="environment" className="sr-only" onChange={(e) => onPhoto(e.target.files?.[0])} id="proof" />
            {photo ? (
              <div className="flex items-start gap-4">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={photo.url} alt={t("rec.screenshot")} className="h-40 w-auto rounded-lg border border-line object-contain" />
                <div className="text-sm">
                  <p className="font-medium text-ok-ink">{t("rec.photo_ok")}</p>
                  <p className="mt-1 break-all text-xs text-ink-3">SHA-256 {photo.sha.slice(0, 16)}…</p>
                  <button className="btn btn-secondary btn-sm mt-2" onClick={() => fileRef.current?.click()}>
                    {t("rec.photo_change")}
                  </button>
                </div>
              </div>
            ) : (
              <label htmlFor="proof" className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed border-line px-4 py-8 text-sm text-ink-3 hover:border-brand hover:text-brand">
                <Camera className="size-7" aria-hidden />
                {t("rec.photo_add")}
              </label>
            )}
            <p className="mt-3 text-xs text-ink-3">{t("rec.photo_note")}</p>
          </Card>

          <Card title={t("rec.details")}>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t("rec.code")} htmlFor="code" hint={t("rec.code_hint")}>
                <input id="code" className="input num uppercase" value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" />
              </Field>
              <Field label={t("rec.amount")} htmlFor="amount" hint={t("rec.amount_hint", { max: money(maxTransfer, "SDG") })} error={amountMinor && amountMinor > maxTransfer ? t("rec.need.cap", { max: money(maxTransfer, "SDG") }) : amountMinor === null ? t("rec.amount_bad") : null}>
                <input id="amount" className="input num" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="3,000,000" />
              </Field>
              <Field label={t("rec.date")} htmlFor="date">
                <input id="date" type="date" className="input" value={day} max={me.today} onChange={(e) => setDay(e.target.value)} />
              </Field>
              <Field label={t("rec.from")} htmlFor="from" hint={holder ? undefined : t("rec.from_hint")}>
                <input id="from" className="input" value={from} onChange={(e) => setFrom(e.target.value)} autoComplete="off" />
                {holder && (
                  <p className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-ok-ink">
                    <UserCheck className="size-3.5" aria-hidden />
                    {t("rec.recognised", { name: holder })}
                  </p>
                )}
              </Field>
            </div>
          </Card>

          <Card title={t("rec.to_account")}>
            <fieldset>
              <legend className="sr-only">{t("rec.to_account")}</legend>
              <ul className="space-y-2">
                {(today.data?.accounts ?? []).map((a) => {
                  const pct = a.daily_limit_minor ? a.intake_today_minor / a.daily_limit_minor : 0;
                  const would = (amountMinor ?? 0) > a.remaining_minor;
                  return (
                    <li key={a.id}>
                      <label className={cx("flex cursor-pointer items-start gap-3 rounded-xl border px-3 py-2.5", account === a.id ? "border-brand bg-brand/5" : "border-line hover:bg-[#f7faf8]")}>
                        <input type="radio" name="account" className="mt-1 size-4 accent-[var(--brand)]" checked={account === a.id} onChange={() => setAccount(a.id)} />
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium">{a.holder}</span>
                          <span className="block text-xs text-ink-3">
                            {a.bank} {a.number_masked}
                          </span>
                          <span className="mt-1.5 block">
                            <Progress value={a.intake_today_minor} max={a.daily_limit_minor} tone={pct >= 1 ? "bad" : pct >= 0.8 ? "warn" : "brand"} label={a.name} />
                          </span>
                          <span className={cx("mt-1 block text-xs", would ? "font-medium text-red-ink" : "text-ink-3")}>
                            {t("rec.room", { left: money(a.remaining_minor, "SDG"), limit: money(a.daily_limit_minor, "SDG") })}
                            {would && ` · ${t("rec.would_exceed")}`}
                          </span>
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </fieldset>
          </Card>
        </div>

        <aside className="space-y-4 lg:sticky lg:top-6 lg:self-start">
          <Card title={t("rec.pays")}>
            {!customer ? (
              <p className="text-sm text-ink-3">{t("rec.pays_pick")}</p>
            ) : !open.data?.length ? (
              <p className="text-sm text-ink-3">{t("rec.pays_none")}</p>
            ) : (
              <ul className="space-y-3">
                {open.data.map((o) => (
                  <li key={o.id}>
                    <label className="block text-sm" htmlFor={`a-${o.id}`}>
                      <span className="font-medium">{o.number}</span> <span className="text-xs text-ink-3">· {date(o.created_at, "short")}</span>
                      <span className="block text-xs text-ink-3">
                        {t("rec.outstanding")} <Money minor={o.outstanding_sdg_minor} currency="SDG" />
                      </span>
                    </label>
                    <input id={`a-${o.id}`} className="input num mt-1" inputMode="decimal" value={alloc[o.id] ?? ""} onChange={(e) => setAlloc({ ...alloc, [o.id]: e.target.value })} />
                  </li>
                ))}
              </ul>
            )}
            {amountMinor ? (
              <p className={cx("mt-3 text-xs", allocated > amountMinor ? "font-semibold text-red-ink" : "text-ink-3")}>
                {t("rec.allocated", { a: money(allocated, "SDG"), b: money(amountMinor, "SDG") })}
              </p>
            ) : null}
          </Card>
          <div className="card p-4">
            <button className="btn btn-primary w-full" disabled={saving || problems.length > 0} onClick={save}>
              {offline ? <WifiOff className="size-4" aria-hidden /> : <CheckCircle2 className="size-4" aria-hidden />}
              {t("rec.save")}
            </button>
            {problems.length > 0 && <p className="mt-2 text-xs text-ink-3">{problems.join(" · ")}</p>}
            {queued && (
              <div className="mt-2">
                <Note tone="warn">{t("rec.queued")}</Note>
              </div>
            )}
            {photoWaiting && !queued && (
              <div className="mt-2">
                <Note tone="warn">{t("rec.photo_waiting")}</Note>
              </div>
            )}
            {error && (
              <div className="mt-2">
                {error.hint === "duplicate" ? (
                  <Note tone="bad" icon={<AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />}>
                    <p className="font-semibold">{t("rec.duplicate")}</p>
                    <p className="mt-0.5">{error.message}</p>
                  </Note>
                ) : (
                  <ErrorNote error={error} />
                )}
              </div>
            )}
          </div>
          {acc && acc.remaining_minor < (amountMinor ?? 0) && <Note tone="warn">{t("rec.limit_note")}</Note>}
          <p className="text-xs text-ink-3">{t(`rec.rules` as MessageKey)}</p>
        </aside>
      </div>
    </div>
  );
}
