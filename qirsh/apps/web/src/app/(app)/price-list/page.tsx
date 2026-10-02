"use client";

import { FileDown } from "lucide-react";
import { Card, isRefusal, Loading, Money, PageHeader, Refused, useToast } from "@/components/ui";
import { useI18n, type MessageKey } from "@/i18n/i18n";
import { useMe, useRpc } from "@/lib/db";
import { priceListPdf, shareOrDownload } from "@/lib/pdf";

interface Item {
  sku: string;
  name: string;
  category: string;
  brand: string | null;
  spec: string | null;
  price_usd_minor: number;
}

/** Step 8: the price list, from the same catalogue as orders, as a branded PDF. */
export default function PriceList() {
  const me = useMe()!;
  const { t, date } = useI18n();
  const toast = useToast();
  const { data, error } = useRpc<Item[]>("price_list");
  const cats = [...new Set((data ?? []).map((i) => i.category))];
  const pdf = async () => {
    const names = Object.fromEntries(cats.map((c) => [c, t(`cat.${c}` as MessageKey)]));
    const blob = await priceListPdf(data ?? [], { name: me.settings.brand_name, color: me.settings.brand_color, initials: me.settings.logo_initials, paymentTerms: me.settings.payment_terms }, names, date(me.today));
    const how = await shareOrDownload(blob, `price-list-${me.today}.pdf`, t("price.share_text"));
    toast("ok", how === "shared" ? t("orderpage.pdf_shared") : t("orderpage.pdf_downloaded"));
  };
  if (isRefusal(error)) return <Refused title={t("nav.price_list")} error={error} />;
  return (
    <div className="fade-in">
      <PageHeader
        title={t("nav.price_list")}
        subtitle={t("price.subtitle", { date: date(me.today) })}
        actions={
          <button className="btn btn-primary" onClick={pdf} disabled={!data}>
            <FileDown className="size-4" aria-hidden />
            {t("price.pdf")}
          </button>
        }
      />
      {!data ? (
        <Loading />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {cats.map((c) => (
            <Card key={c} title={t(`cat.${c}` as MessageKey)} pad={false}>
              <ul className="divide-y divide-line">
                {data.filter((i) => i.category === c).map((i) => (
                  <li key={i.sku} className="flex items-start justify-between gap-3 px-4 py-2.5">
                    <div className="min-w-0">
                      <div className="text-sm font-medium">{i.name}</div>
                      <div className="text-xs text-ink-3">{[i.brand, i.spec].filter(Boolean).join(" · ")}</div>
                    </div>
                    <Money minor={i.price_usd_minor} currency="USD" className="font-semibold" />
                  </li>
                ))}
              </ul>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
