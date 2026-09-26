"use client";

import { useState } from "react";
import { Search } from "lucide-react";
import { useI18n } from "@/i18n/i18n";
import { useRpc } from "@/lib/db";
import { useOutbox } from "@/lib/outbox";
import { Badge } from "./ui";

export interface PickedCustomer {
  id: string;
  name: string;
  city: string;
  segment: string;
  code: string;
}

const matches = (c: PickedCustomer, q: string) =>
  [c.name, c.city, c.code].some((field) => field.toLowerCase().includes(q));

/**
 * Search among the customers this person may see (an adviser: her own).
 *
 * With a connection the server does the searching, which is right: it knows who she may see and it
 * does not have to send her the whole book. With no connection the phone searches the copy it
 * already has - the same list, fetched in one go while there was a connection - because an adviser
 * in a dead spot still has to be able to choose the dealer in front of her.
 */
export function CustomerPicker({ value, onChange }: { value: PickedCustomer | null; onChange: (c: PickedCustomer | null) => void }) {
  const { t } = useI18n();
  const { offline } = useOutbox();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const search = q.trim();
  const live = useRpc<{ total: number; rows: PickedCustomer[] }>(open && !offline ? "customers_list" : null, { p_search: search || null, p_limit: 8 });
  // Kept for the dead spot: one unfiltered read, which the phone remembers. It runs when the screen
  // opens, not when the search box is tapped, because by the time she taps it the connection may
  // already be gone.
  const book = useRpc<{ total: number; rows: PickedCustomer[] }>("customers_list", { p_search: null, p_limit: 400 });
  const list = offline
    ? { ...book, data: book.data ? { ...book.data, rows: book.data.rows.filter((c) => matches(c, search.toLowerCase())).slice(0, 8) } : null }
    : live;
  if (value && !open) {
    return (
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="font-semibold">{value.name}</div>
          <div className="text-sm text-ink-3">
            {value.city} · {value.code} · <Badge tone="brand">{value.segment}</Badge>
          </div>
        </div>
        <button className="btn btn-secondary btn-sm" onClick={() => setOpen(true)}>
          {t("order.customer.change")}
        </button>
      </div>
    );
  }
  return (
    <div>
      <label htmlFor="customer-search" className="sr-only">
        {t("order.customer.search")}
      </label>
      <div className="relative">
        <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-ink-3" aria-hidden />
        <input
          id="customer-search"
          className="input ps-9"
          placeholder={t("order.customer.search")}
          value={q}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          autoComplete="off"
        />
      </div>
      {open && (
        <ul className="mt-2 divide-y divide-line overflow-hidden rounded-xl border border-line" role="listbox" aria-label={t("order.customer")}>
          {(list.data?.rows ?? []).map((c) => (
            <li key={c.id}>
              <button
                role="option"
                aria-selected={value?.id === c.id}
                className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-start hover:bg-[#f1f5f2]"
                onClick={() => {
                  onChange(c);
                  setOpen(false);
                  setQ("");
                }}
              >
                <span>
                  <span className="block font-medium">{c.name}</span>
                  <span className="block text-xs text-ink-3">
                    {c.city} · {c.code}
                  </span>
                </span>
                <Badge tone="brand">{c.segment}</Badge>
              </button>
            </li>
          ))}
          {list.data && list.data.rows.length === 0 && <li className="px-3 py-3 text-sm text-ink-3">{t("order.customer.none")}</li>}
        </ul>
      )}
    </div>
  );
}

