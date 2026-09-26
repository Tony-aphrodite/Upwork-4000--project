"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Info, Loader2, X, XCircle } from "lucide-react";
import type { Currency } from "@qirsh/money";
import { useI18n, type MessageKey } from "@/i18n/i18n";

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

export function PageHeader({ title, subtitle, actions, back }: { title: string; subtitle?: ReactNode; actions?: ReactNode; back?: ReactNode }) {
  return (
    <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        {back}
        <h1 className="text-[1.45rem] font-bold leading-tight tracking-tight text-ink" tabIndex={-1} data-page-title>
          {title}
        </h1>
        {subtitle && <p className="mt-1 text-sm text-ink-3">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </header>
  );
}

export function Card({ title, action, children, className, pad = true }: { title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string; pad?: boolean }) {
  return (
    <section className={cx("card", className)}>
      {title && (
        <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
          <h2 className="text-sm font-semibold text-ink">{title}</h2>
          {action}
        </div>
      )}
      <div className={pad ? "p-4" : ""}>{children}</div>
    </section>
  );
}

type Tone = "neutral" | "brand" | "ok" | "warn" | "bad" | "info" | "sand" | "red";
const TONES: Record<Tone, string> = {
  neutral: "bg-[#eef2ef] text-ink-2",
  brand: "bg-brand/10 text-brand",
  ok: "bg-ok-bg text-ok-ink",
  warn: "bg-warn-bg text-warn-ink",
  bad: "bg-red-bg text-red-ink",
  info: "bg-info-bg text-info-ink",
  sand: "bg-sand-bg text-sand-ink",
  red: "bg-red-bg text-red-ink",
};
export function Badge({ tone = "neutral", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <span className={cx("inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold", TONES[tone], className)}>{children}</span>;
}

export function Money({ minor, currency, className, sign, decimals }: { minor: number | null | undefined; currency: Currency; className?: string; sign?: boolean; decimals?: "auto" | "always" }) {
  const { money } = useI18n();
  return <span className={cx("num", className)}>{money(minor, currency, { sign, decimals })}</span>;
}

export function Stat({ label, value, hint, tone, icon }: { label: string; value: ReactNode; hint?: ReactNode; tone?: "ok" | "warn" | "bad"; icon?: ReactNode }) {
  return (
    <div className="card min-w-0 p-3.5 sm:p-4">
      <div className="flex items-center justify-between gap-2 text-xs font-medium text-ink-3">
        <span>{label}</span>
        {icon}
      </div>
      <div className={cx("mt-1.5 text-base font-bold tracking-tight sm:text-xl [&_.num]:whitespace-normal sm:[&_.num]:whitespace-nowrap", tone === "bad" ? "text-red-ink" : tone === "warn" ? "text-warn-ink" : tone === "ok" ? "text-ok-ink" : "text-ink")}>{value}</div>
      {hint && <div className="mt-1 text-xs text-ink-3">{hint}</div>}
    </div>
  );
}

export function Empty({ children, icon }: { children: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-4 py-10 text-center text-sm text-ink-3">
      {icon}
      {children}
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-10 text-sm text-ink-3" role="status">
      <Loader2 className="size-4 animate-spin" aria-hidden />
      {label}
    </div>
  );
}

export function Loading() {
  const { t } = useI18n();
  return <Spinner label={t("common.loading")} />;
}

export function ErrorNote({ error }: { error: { message: string } | null | undefined }) {
  if (!error) return null;
  return (
    <div className="flex items-start gap-2 rounded-lg bg-red-bg px-3 py-2 text-sm text-red-ink" role="alert">
      <XCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>{error.message}</span>
    </div>
  );
}

export function Note({ tone = "info", children, icon }: { tone?: "info" | "warn" | "ok" | "bad" | "sand"; children: ReactNode; icon?: ReactNode }) {
  const cls = { info: "bg-info-bg text-info-ink", warn: "bg-warn-bg text-warn-ink", ok: "bg-ok-bg text-ok-ink", bad: "bg-red-bg text-red-ink", sand: "bg-sand-bg text-sand-ink" }[tone];
  const Icon = tone === "ok" ? CheckCircle2 : tone === "bad" || tone === "warn" ? AlertTriangle : Info;
  return (
    <div className={cx("flex items-start gap-2 rounded-lg px-3 py-2.5 text-sm", cls)}>
      {icon ?? <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />}
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export function Field({ label, hint, error, children, htmlFor }: { label: string; hint?: ReactNode; error?: string | null; children: ReactNode; htmlFor?: string }) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-1 block text-sm font-medium text-ink-2">
        {label}
      </label>
      {children}
      {error ? <p className="mt-1 text-xs font-medium text-red-ink" role="alert">{error}</p> : hint ? <p className="mt-1 text-xs text-ink-3">{hint}</p> : null}
    </div>
  );
}

export function Segmented<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; label: string }) {
  return (
    <div role="group" aria-label={label} className="inline-flex max-w-full overflow-x-auto rounded-xl border border-line bg-surface p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={cx("min-h-9 whitespace-nowrap rounded-lg px-3 text-sm font-medium", value === o.value ? "bg-brand text-brand-ink" : "text-ink-2 hover:bg-[#eef2ef]")}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Progress({ value, max, tone = "brand", label }: { value: number; max: number; tone?: "brand" | "ok" | "warn" | "bad"; label?: string }) {
  const pct = max <= 0 ? 0 : Math.min(100, Math.round((value / max) * 100));
  const color = { brand: "bg-brand", ok: "bg-ok-ink", warn: "bg-[#d99a1e]", bad: "bg-red-ink" }[tone];
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-[#e8ede9]" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={label}>
      <div className={cx("h-full rounded-full", color)} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function TierChip({ tier }: { tier: "none" | "sand" | "red" | "blocked" | "approved" }) {
  const { t } = useI18n();
  if (tier === "none") return null;
  const tone: Record<string, string> = {
    sand: "bg-sand-bg text-sand-ink",
    red: "bg-red-bg text-red-ink",
    blocked: "bg-red-ink text-white",
    approved: "bg-ok-bg text-ok-ink",
  };
  return <span className={cx("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-bold", tone[tier])}>{t(`tier.${tier}` as MessageKey)}</span>;
}

export function PaymentChip({ status }: { status: "unpaid" | "partial" | "paid" }) {
  const { t } = useI18n();
  const tone = status === "paid" ? "ok" : status === "partial" ? "warn" : "neutral";
  return <Badge tone={tone}>{t(`pay.${status}` as MessageKey)}</Badge>;
}

// ------------------------------------------------------------------ dialog
export function Dialog({ open, onClose, title, children, footer, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  const { t } = useI18n();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      className={cx("m-auto w-[calc(100%-1.5rem)] rounded-2xl border border-line p-0 shadow-2xl backdrop:bg-black/40", wide ? "max-w-3xl" : "max-w-lg")}
    >
      {open && (
        <div className="flex max-h-[85vh] flex-col">
          <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
            <h2 className="font-semibold">{title}</h2>
            <button className="btn btn-ghost btn-sm" onClick={onClose} aria-label={t("common.close")}>
              <X className="size-4" aria-hidden />
            </button>
          </div>
          <div className="overflow-y-auto px-4 py-4">{children}</div>
          {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-line px-4 py-3">{footer}</div>}
        </div>
      )}
    </dialog>
  );
}

// ------------------------------------------------------------------ toasts
interface Toast {
  id: number;
  tone: "ok" | "bad" | "info" | "warn";
  text: string;
}
const ToastCtx = createContext<(tone: Toast["tone"], text: string) => void>(() => {});
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((tone: Toast["tone"], text: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, tone, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === "bad" ? 7000 : 4500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-20 z-50 flex flex-col items-center gap-2 px-3 lg:bottom-6" aria-live="polite">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={cx(
              "fade-in pointer-events-auto flex max-w-md items-start gap-2 rounded-xl px-4 py-3 text-sm font-medium shadow-lg",
              t.tone === "ok" ? "bg-[#163a2b] text-white" : t.tone === "bad" ? "bg-red-ink text-white" : t.tone === "warn" ? "bg-[#7a5200] text-white" : "bg-ink text-white",
            )}
          >
            {t.tone === "ok" ? <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden /> : t.tone === "bad" ? <XCircle className="mt-0.5 size-4 shrink-0" aria-hidden /> : <Info className="mt-0.5 size-4 shrink-0" aria-hidden />}
            <span>{t.text}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
export function useToast() {
  return useContext(ToastCtx);
}

/** A scrollable table region that keyboard users can reach. */
export function TableWrap({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="overflow-x-auto" role="region" aria-label={label} tabIndex={0}>
      {children}
    </div>
  );
}

export const th = "px-3 py-2 text-start text-xs font-semibold uppercase tracking-wide text-ink-3 whitespace-nowrap";
export const td = "px-3 py-2.5 text-sm align-top";
