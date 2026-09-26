"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/i18n/i18n";
import { getProof } from "@/lib/proofs";

export interface ProofReceipt {
  number: string;
  txn_code: string;
  amount_sdg_minor: number;
  received_on: string;
  from_name: string;
  to_account: string;
  to_holder?: string | null;
  proof_path: string;
}

/**
 * The uploaded screenshot if this browser has it; for the demo's replayed history, a drawing of
 * the kind of Arabic bank-app screenshot that arrives on WhatsApp, made from the receipt's data.
 */
export function ProofView({ r }: { r: ProofReceipt }) {
  const { t } = useI18n();
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let revoke: string | null = null;
    if (!r.proof_path.startsWith("seed/")) {
      getProof(r.proof_path).then((b) => {
        if (b) {
          revoke = URL.createObjectURL(b);
          setUrl(revoke);
        }
      });
    }
    return () => {
      if (revoke) URL.revokeObjectURL(revoke);
    };
  }, [r.proof_path]);

  if (url) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt={t("proof.alt", { code: r.txn_code })} className="mx-auto max-h-[70vh] rounded-xl border border-line" />;
  }
  const amount = new Intl.NumberFormat("ar-SD").format(r.amount_sdg_minor / 100);
  const d = new Intl.DateTimeFormat("ar-SD", { day: "numeric", month: "long", year: "numeric" }).format(new Date(`${r.received_on}T12:00:00Z`));
  return (
    <figure>
      <div dir="rtl" lang="ar" className="mx-auto w-[280px] overflow-hidden rounded-[28px] border-[6px] border-[#1d1d1f] bg-[#f4f6f8] font-[var(--font-arabic)] shadow-xl">
        <div className="bg-[#0d4f8b] px-4 pb-6 pt-5 text-white">
          <div className="text-xs opacity-80">{r.to_account.split("·")[1]?.trim() ?? "بنكك"}</div>
          <div className="mt-3 flex items-center gap-2 text-sm font-semibold">
            <span className="inline-flex size-6 items-center justify-center rounded-full bg-[#2fb36f]">✓</span>
            تم التحويل بنجاح
          </div>
          <div className="mt-2 text-2xl font-bold" dir="rtl">{amount} ج.س</div>
        </div>
        <dl className="-mt-3 space-y-2.5 rounded-t-2xl bg-white px-4 py-4 text-[13px]">
          <Row k="من" v={r.from_name} />
          <Row k="إلى" v={r.to_holder ?? r.to_account} />
          <Row k="رقم العملية" v={r.txn_code} ltr />
          <Row k="التاريخ" v={d} />
        </dl>
      </div>
      <figcaption className="mt-3 text-center text-xs text-ink-3">{t("proof.generated")}</figcaption>
    </figure>
  );
}

function Row({ k, v, ltr }: { k: string; v: string; ltr?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-[#eef1f4] pb-2 last:border-0">
      <dt className="text-[#6b7785]">{k}</dt>
      <dd className="font-semibold text-[#1d2733]" dir={ltr ? "ltr" : undefined}>
        {v}
      </dd>
    </div>
  );
}
