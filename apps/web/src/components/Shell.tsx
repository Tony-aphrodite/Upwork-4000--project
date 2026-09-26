"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  BadgeCheck, BarChart3, Boxes, ClipboardCheck, FileText, Gauge, Languages, LogOut, Menu, Plus, Receipt, Settings, Ship, ShieldCheck, Tag, Users, Wallet, WifiOff, X,
} from "lucide-react";
import { useI18n, type MessageKey } from "@/i18n/i18n";
import { useDb, type Role } from "@/lib/db";
import { useOutbox } from "@/lib/outbox";
import { cx } from "./ui";

interface NavItem {
  href: string;
  key: MessageKey;
  icon: typeof Gauge;
  roles: Role[];
  primary?: boolean; // shown in the phone's bottom bar
}
export const NAV: NavItem[] = [
  { href: "/dashboard", key: "nav.dashboard", icon: Gauge, roles: ["owner", "marketing", "adviser", "warehouse"], primary: true },
  { href: "/orders/new", key: "nav.new_order", icon: Plus, roles: ["owner", "adviser"], primary: true },
  { href: "/orders", key: "nav.orders", icon: FileText, roles: ["owner", "marketing", "adviser"], primary: true },
  { href: "/approvals", key: "nav.approvals", icon: BadgeCheck, roles: ["owner"] },
  { href: "/receipts", key: "nav.receipts", icon: Receipt, roles: ["owner", "adviser"], primary: true },
  { href: "/accounts", key: "nav.accounts", icon: Wallet, roles: ["owner"] },
  { href: "/stock", key: "nav.stock", icon: Boxes, roles: ["owner", "marketing", "adviser", "warehouse"], primary: true },
  { href: "/shipments", key: "nav.shipments", icon: Ship, roles: ["owner", "warehouse", "marketing"], primary: true },
  { href: "/customers", key: "nav.customers", icon: Users, roles: ["owner", "marketing", "adviser"], primary: true },
  { href: "/price-list", key: "nav.price_list", icon: Tag, roles: ["owner", "marketing", "adviser"] },
  { href: "/profit", key: "nav.profit", icon: BarChart3, roles: ["owner"] },
  { href: "/closing", key: "nav.closing", icon: ClipboardCheck, roles: ["owner"] },
  { href: "/settings", key: "nav.settings", icon: Settings, roles: ["owner"] },
];

export function Logo({ initials, color, size = 36 }: { initials: string; color: string; size?: number }) {
  return (
    <span className="inline-flex shrink-0 items-center justify-center rounded-[10px] font-bold text-white" style={{ background: color, width: size, height: size, fontSize: size * 0.38 }} aria-hidden>
      {initials}
    </span>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const { me, signOut } = useDb();
  const { t, locale, setLocale, date } = useI18n();
  const { offline, simulated, setSimulated, pending } = useOutbox();
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const mainRef = useRef<HTMLElement>(null);

  // Route change: close the menu, move focus to the new page title for screen readers.
  useEffect(() => {
    setOpen(false);
    const h = mainRef.current?.querySelector<HTMLElement>("[data-page-title]");
    h?.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }, [path]);

  if (!me) return null;
  const items = NAV.filter((n) => n.roles.includes(me.role));
  const active = (href: string) => (href === "/orders" ? path === "/orders" || (path.startsWith("/orders/") && path !== "/orders/new") : path === href || path.startsWith(href + "/"));
  const primary = items.filter((n) => n.primary).slice(0, 4);

  const nav = (
    <nav aria-label={t("nav.label")} className="flex flex-col gap-0.5">
      {items.map((n) => (
        <Link
          key={n.href}
          href={n.href}
          aria-current={active(n.href) ? "page" : undefined}
          className={cx("flex min-h-10 items-center gap-3 rounded-lg px-3 text-sm font-medium", active(n.href) ? "bg-brand text-brand-ink" : "text-ink-2 hover:bg-[#e9eeea]")}
        >
          <n.icon className="size-[18px] shrink-0" aria-hidden />
          {t(n.key)}
        </Link>
      ))}
    </nav>
  );

  const footer = (
    <div className="mt-6 space-y-2 border-t border-line pt-4 text-sm">
      <div className="px-3">
        <div className="font-semibold text-ink">{me.full_name}</div>
        <div className="text-xs text-ink-3">{t(`role.${me.role}` as MessageKey)} · {me.tenant.name}</div>
      </div>
      <button className="btn btn-ghost btn-sm w-full justify-start" onClick={() => setLocale(locale === "en" ? "ar" : "en")}>
        <Languages className="size-4" aria-hidden />
        {locale === "en" ? t("shell.arabic_preview") : t("shell.english")}
      </button>
      <label className="flex min-h-9 cursor-pointer items-center gap-2 rounded-lg px-3 text-ink-2 hover:bg-[#e9eeea]">
        <input type="checkbox" checked={simulated} onChange={(e) => setSimulated(e.target.checked)} className="size-4 accent-[var(--brand)]" />
        {t("shell.simulate_offline")}
      </label>
      <Link href="/checks" className="flex min-h-9 items-center gap-2 rounded-lg px-3 text-ink-2 hover:bg-[#e9eeea]">
        <ShieldCheck className="size-4" aria-hidden />
        {t("nav.checks")}
      </Link>
      <button className="btn btn-ghost btn-sm w-full justify-start" onClick={signOut}>
        <LogOut className="size-4" aria-hidden />
        {t("shell.switch_person")}
      </button>
    </div>
  );

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[248px_1fr]">
      <a href="#main" className="sr-only z-50 rounded bg-brand px-3 py-2 text-brand-ink focus:not-sr-only focus:fixed focus:start-3 focus:top-3">
        {t("shell.skip")}
      </a>
      {/* desktop sidebar */}
      <aside className="sticky top-0 hidden h-dvh flex-col overflow-y-auto border-e border-line bg-[#f9fbfa] px-3 py-4 lg:flex">
        <Link href="/dashboard" className="mb-5 flex items-center gap-2.5 px-2">
          <Logo initials={me.settings.logo_initials} color={me.settings.brand_color} />
          <div className="min-w-0 leading-tight">
            <div className="truncate font-bold text-ink">{me.settings.brand_name}</div>
            <div className="text-xs text-ink-3">{date(me.today, "day")}</div>
          </div>
        </Link>
        {nav}
        <div className="mt-auto">{footer}</div>
      </aside>

      <div className="min-w-0">
        {/* phone top bar */}
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-line bg-[#f9fbfa]/95 px-4 py-2.5 backdrop-blur lg:hidden">
          <Logo initials={me.settings.logo_initials} color={me.settings.brand_color} size={32} />
          <div className="min-w-0 flex-1 leading-tight">
            <div className="truncate text-sm font-bold">{me.settings.brand_name}</div>
            <div className="truncate text-xs text-ink-3">{me.full_name} · {t(`role.${me.role}` as MessageKey)}</div>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={() => setOpen(true)} aria-label={t("shell.menu")} aria-expanded={open}>
            <Menu className="size-5" aria-hidden />
          </button>
        </header>

        {offline && (
          <div className="flex items-center gap-2 bg-[#3a2a00] px-4 py-2 text-sm font-medium text-[#ffe7a8]" role="status">
            <WifiOff className="size-4" aria-hidden />
            {pending.length ? t("shell.offline_pending", { n: pending.length }) : t("shell.offline")}
          </div>
        )}

        <main id="main" ref={mainRef} className="mx-auto w-full max-w-6xl px-4 pb-28 pt-5 sm:px-6 lg:pb-12 lg:pt-8">
          {children}
        </main>
      </div>

      {/* phone bottom bar */}
      <nav aria-label={t("nav.quick")} className="fixed inset-x-0 bottom-0 z-30 grid border-t border-line bg-white/95 backdrop-blur lg:hidden" style={{ gridTemplateColumns: `repeat(${primary.length + 1}, minmax(0, 1fr))` }}>
        {primary.map((n) => (
          <Link key={n.href} href={n.href} aria-current={active(n.href) ? "page" : undefined} className={cx("flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-medium", active(n.href) ? "text-brand" : "text-ink-3")}>
            <n.icon className="size-5" aria-hidden />
            <span className="max-w-full truncate px-1">{t(n.key)}</span>
          </Link>
        ))}
        <button onClick={() => setOpen(true)} className="flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-medium text-ink-3">
          <Menu className="size-5" aria-hidden />
          {t("shell.more")}
        </button>
      </nav>

      {/* phone drawer */}
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label={t("shell.menu")}>
          <button className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} aria-label={t("common.close")} />
          <div className="absolute inset-y-0 end-0 flex w-[82%] max-w-xs flex-col overflow-y-auto bg-[#f9fbfa] px-3 py-4 shadow-2xl">
            <div className="mb-4 flex items-center justify-between px-2">
              <span className="font-bold">{me.settings.brand_name}</span>
              <button className="btn btn-ghost btn-sm" onClick={() => setOpen(false)} aria-label={t("common.close")}>
                <X className="size-5" aria-hidden />
              </button>
            </div>
            {nav}
            {footer}
          </div>
        </div>
      )}
    </div>
  );
}
