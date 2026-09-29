"use client";

import { useEffect, useState } from "react";
import { History, Plus, Save } from "lucide-react";
import { parseMoney } from "@qirsh/money";
import { Logo } from "@/components/Shell";
import { Badge, Card, ErrorNote, Field, isRefusal, Loading, Money, PageHeader, Refused, useToast } from "@/components/ui";
import { useI18n, type MessageKey } from "@/i18n/i18n";
import { useAction, useRpc } from "@/lib/db";

interface Full {
  settings: {
    brand_name: string; brand_color: string; brand_accent: string; logo_initials: string;
    sand_max_bps: number; red_max_bps: number; min_rate_sdg: number; max_transfer_sdg_minor: number; default_daily_limit_sdg_minor: number;
    quote_validity_days: number; payment_terms: string; landed_uplift_bps: number; forward_alert_hours: number; currencies: string[];
  };
  account_kinds: { code: string; label: string; receives_customer_payments: boolean; pass_through: boolean; is_external: boolean }[];
  history: { changed_at: string; by: string | null; old: Record<string, unknown>; new: Record<string, unknown> }[];
  users: { id: string; full_name: string; email: string; role: string; active: boolean }[];
  holders: { id: string; name: string; kind: string; aliases: string[] | null }[];
}

export default function Settings() {
  const { t, number, dateTime } = useI18n();
  const toast = useToast();
  const action = useAction();
  const { data, error } = useRpc<Full>("settings_full");
  const [f, setF] = useState<Record<string, string>>({});
  const [err, setErr] = useState<Error | null>(null);
  const [alias, setAlias] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!data) return;
    const s = data.settings;
    setF({
      brand_name: s.brand_name, brand_color: s.brand_color, brand_accent: s.brand_accent, logo_initials: s.logo_initials,
      sand: String(s.sand_max_bps / 100), red: String(s.red_max_bps / 100), min_rate: String(s.min_rate_sdg),
      max_transfer: String(s.max_transfer_sdg_minor / 100), daily: String(s.default_daily_limit_sdg_minor / 100),
      validity: String(s.quote_validity_days), uplift: String(s.landed_uplift_bps / 100), alert: String(s.forward_alert_hours),
      terms: s.payment_terms, currencies: s.currencies.join(", "),
    });
  }, [data]);

  if (isRefusal(error)) return <Refused title={t("nav.settings")} error={error} />;
  if (!data || !f.brand_name) return <Loading />;
  const set = (k: string) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  const save = async () => {
    setErr(null);
    try {
      await action("update_settings", {
        p: {
          brand_name: f.brand_name, brand_color: f.brand_color, brand_accent: f.brand_accent, logo_initials: f.logo_initials,
          sand_max_bps: Math.round(Number(f.sand) * 100), red_max_bps: Math.round(Number(f.red) * 100), min_rate_sdg: Number(f.min_rate!.replace(/\D/g, "")),
          max_transfer_sdg_minor: parseMoney(f.max_transfer!), default_daily_limit_sdg_minor: parseMoney(f.daily!), quote_validity_days: Number(f.validity),
          landed_uplift_bps: Math.round(Number(f.uplift) * 100), forward_alert_hours: Number(f.alert), payment_terms: f.terms,
          currencies: f.currencies!.split(",").map((c) => c.trim().toUpperCase()).filter(Boolean),
        },
      });
      toast("ok", t("settings.saved"));
    } catch (e) {
      setErr(e as Error);
    }
  };

  return (
    <div className="fade-in">
      <PageHeader
        title={t("nav.settings")}
        subtitle={t("settings.subtitle")}
        actions={
          <button className="btn btn-primary" onClick={save}>
            <Save className="size-4" aria-hidden />
            {t("common.save")}
          </button>
        }
      />
      <ErrorNote error={err} />
      <div className="mt-2 grid gap-4 lg:grid-cols-2">
        <Card title={t("settings.brand")}>
          <div className="mb-4 flex items-center gap-3 rounded-xl border border-line p-3">
            <Logo initials={f.logo_initials || "?"} color={/^#[0-9a-f]{6}$/i.test(f.brand_color!) ? f.brand_color! : "#999999"} size={40} />
            <div>
              <div className="font-bold">{f.brand_name}</div>
              <div className="text-xs" style={{ color: f.brand_accent }}>{t("settings.preview")}</div>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("settings.brand_name")} htmlFor="bn"><input id="bn" className="input" value={f.brand_name} onChange={set("brand_name")} /></Field>
            <Field label={t("settings.initials")} htmlFor="in"><input id="in" className="input" maxLength={3} value={f.logo_initials} onChange={set("logo_initials")} /></Field>
            <Field label={t("settings.color")} htmlFor="bc"><input id="bc" type="color" className="input h-11 p-1" value={f.brand_color} onChange={set("brand_color")} /></Field>
            <Field label={t("settings.accent")} htmlFor="ba"><input id="ba" type="color" className="input h-11 p-1" value={f.brand_accent} onChange={set("brand_accent")} /></Field>
          </div>
          <p className="mt-3 text-xs text-ink-3">{t("settings.brand_note")}</p>
        </Card>

        <Card title={t("settings.rules")}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("settings.sand")} htmlFor="sa" hint={t("settings.pct")}><input id="sa" className="input num" inputMode="decimal" value={f.sand} onChange={set("sand")} /></Field>
            <Field label={t("settings.red")} htmlFor="re" hint={t("settings.red_hint")}><input id="re" className="input num" inputMode="decimal" value={f.red} onChange={set("red")} /></Field>
            <Field label={t("settings.min_rate")} htmlFor="mr" hint={t("settings.min_rate_hint")}><input id="mr" className="input num" inputMode="numeric" value={f.min_rate} onChange={set("min_rate")} /></Field>
            <Field label={t("settings.quote_validity")} htmlFor="qv"><input id="qv" className="input num" inputMode="numeric" value={f.validity} onChange={set("validity")} /></Field>
            <Field label={t("settings.max_transfer")} htmlFor="mt"><input id="mt" className="input num" inputMode="decimal" value={f.max_transfer} onChange={set("max_transfer")} /></Field>
            <Field label={t("settings.daily")} htmlFor="dl"><input id="dl" className="input num" inputMode="decimal" value={f.daily} onChange={set("daily")} /></Field>
            <Field label={t("settings.uplift")} htmlFor="up" hint={t("settings.pct")}><input id="up" className="input num" inputMode="decimal" value={f.uplift} onChange={set("uplift")} /></Field>
            <Field label={t("settings.alert")} htmlFor="al"><input id="al" className="input num" inputMode="numeric" value={f.alert} onChange={set("alert")} /></Field>
            <Field label={t("settings.currencies")} htmlFor="cu"><input id="cu" className="input" value={f.currencies} onChange={set("currencies")} /></Field>
          </div>
          <div className="mt-4">
            <Field label={t("settings.terms")} htmlFor="te"><textarea id="te" className="input min-h-20" value={f.terms} onChange={set("terms")} /></Field>
          </div>
        </Card>

        <Card title={t("settings.history")} action={<History className="size-4 text-ink-3" aria-hidden />}>
          {data.history.length === 0 ? (
            <p className="text-sm text-ink-3">{t("settings.no_history")}</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {data.history.map((h, i) => (
                <li key={i} className="rounded-lg border border-line px-3 py-2">
                  <div className="text-xs text-ink-3">{dateTime(h.changed_at)} · {h.by ?? "—"}</div>
                  {Object.keys(h.new).map((k) => (
                    <div key={k}>
                      <span className="text-ink-3">{k}</span>: <span className="line-through opacity-60">{String(h.old[k])}</span> → <span className="font-medium">{String(h.new[k])}</span>
                    </div>
                  ))}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title={t("settings.users")}>
          <ul className="divide-y divide-line text-sm">
            {data.users.map((u) => (
              <li key={u.id} className="flex items-center justify-between gap-3 py-2">
                <span>
                  <span className="font-medium">{u.full_name}</span>
                  <span className="block text-xs text-ink-3">{u.email}</span>
                </span>
                <Badge tone={u.role === "owner" ? "brand" : "neutral"}>{t(`role.${u.role}` as MessageKey)}</Badge>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-ink-3">{t("settings.users_note")}</p>
        </Card>

        <Card title={t("settings.holders")}>
          <ul className="space-y-3 text-sm">
            {data.holders.map((h) => (
              <li key={h.id}>
                <div className="flex items-center gap-2">
                  <span className="font-medium">{h.name}</span>
                  <Badge>{t(`holder.${h.kind}` as MessageKey)}</Badge>
                </div>
                <div className="mt-1 flex flex-wrap gap-1">
                  {(h.aliases ?? []).map((a) => (
                    <span key={a} className="rounded bg-[#eef2ef] px-1.5 py-0.5 text-xs text-ink-2">{a}</span>
                  ))}
                </div>
                <div className="mt-1.5 flex gap-2">
                  <input className="input h-9 min-h-9 text-sm" placeholder={t("settings.alias_ph")} value={alias[h.id] ?? ""} onChange={(e) => setAlias({ ...alias, [h.id]: e.target.value })} aria-label={t("settings.alias_for", { name: h.name })} />
                  <button
                    className="btn btn-secondary btn-sm"
                    disabled={!alias[h.id]?.trim()}
                    onClick={async () => {
                      await action("add_holder_alias", { p_holder: h.id, p_alias: alias[h.id] });
                      setAlias({ ...alias, [h.id]: "" });
                    }}
                    aria-label={t("settings.add_alias")}
                  >
                    <Plus className="size-4" aria-hidden />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </Card>

        <Card title={t("settings.kinds")}>
          <ul className="space-y-2 text-sm">
            {data.account_kinds.map((k) => (
              <li key={k.code} className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{k.label}</span>
                {k.receives_customer_payments && <Badge tone="info">{t("settings.kind_receives")}</Badge>}
                {k.pass_through && <Badge tone="warn">{t("settings.kind_pass")}</Badge>}
                {k.is_external && <Badge>{t("settings.kind_external")}</Badge>}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-ink-3">
            {t("settings.kinds_note")} <Money minor={data.settings.default_daily_limit_sdg_minor} currency="SDG" />.
          </p>
          <p className="mt-1 text-xs text-ink-3">{t("settings.min_rate_now", { rate: number(data.settings.min_rate_sdg) })}</p>
        </Card>
      </div>
    </div>
  );
}
