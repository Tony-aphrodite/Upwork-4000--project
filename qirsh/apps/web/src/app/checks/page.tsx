"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, CheckCircle2, Loader2, Play, XCircle } from "lucide-react";
import type { CheckResult } from "@qirsh/db";
import { Logo } from "@/components/Shell";
import { Card, cx } from "@/components/ui";
import { useI18n, type MessageKey } from "@/i18n/i18n";

/**
 * The acceptance checks, live: a second, empty Postgres starts in this tab, the migrations run,
 * a small fixture is loaded, and each check runs against it. Nothing touches the demo data.
 */
export default function Checks() {
  const { t, number } = useI18n();
  const [results, setResults] = useState<CheckResult[]>([]);
  const [areas, setAreas] = useState<string[]>([]);
  const [titles, setTitles] = useState<{ id: string; area: string; title: string }[]>([]);
  const [state, setState] = useState<"idle" | "starting" | "running" | "done">("idle");
  const [ms, setMs] = useState(0);
  const started = useRef(false);

  const run = useCallback(async () => {
    setResults([]);
    setState("starting");
    const t0 = performance.now();
    const mod = await import("@qirsh/db");
    setAreas(mod.AREAS);
    setTitles(mod.CHECKS.map((c) => ({ id: c.id, area: c.area, title: c.title })));
    setState("running");
    await mod.runChecks(() => mod.Database.open(), (r) => setResults((x) => [...x, r]));
    setMs(Math.round(performance.now() - t0));
    setState("done");
  }, []);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void run();
  }, [run]);

  const passed = results.filter((r) => r.ok).length;
  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <Link href="/" className="mb-4 inline-flex items-center gap-1 text-sm text-ink-3 hover:text-brand">
        <ArrowLeft className="size-4 rtl:rotate-180" aria-hidden />
        {t("checks.back")}
      </Link>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <Logo initials="Q" color="#1e4d3b" size={40} />
          <div>
            <h1 className="text-2xl font-bold tracking-tight" tabIndex={-1}>{t("checks.title")}</h1>
            <p className="text-sm text-ink-3">{t("checks.subtitle")}</p>
          </div>
        </div>
        <button className="btn btn-secondary" onClick={run} disabled={state === "starting" || state === "running"}>
          {state === "starting" || state === "running" ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Play className="size-4" aria-hidden />}
          {t("checks.run")}
        </button>
      </div>

      <div className={cx("mb-6 rounded-xl px-4 py-3 text-sm font-medium", state === "done" ? (passed === titles.length ? "bg-ok-bg text-ok-ink" : "bg-red-bg text-red-ink") : "bg-info-bg text-info-ink")} role="status">
        {state === "starting"
          ? t("checks.starting")
          : state === "running"
            ? t("checks.running", { a: results.length, b: titles.length })
            : state === "done"
              ? t("checks.done", { a: passed, b: titles.length, s: number(ms / 1000, 1) })
              : ""}
      </div>

      <div className="space-y-5">
        {areas.map((area) => (
          <Card key={area} title={t(`checks.area.${area}` as MessageKey)} pad={false}>
            <ul className="divide-y divide-line">
              {titles.filter((c) => c.area === area).map((c) => {
                const r = results.find((x) => x.id === c.id);
                return (
                  <li key={c.id} className="flex items-start gap-3 px-4 py-3">
                    {!r ? (
                      <Loader2 className={cx("mt-0.5 size-5 shrink-0 text-ink-3", state === "running" && "animate-spin")} aria-hidden />
                    ) : r.ok ? (
                      <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-ok-ink" aria-label={t("checks.pass")} />
                    ) : (
                      <XCircle className="mt-0.5 size-5 shrink-0 text-red-ink" aria-label={t("checks.fail")} />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="font-medium">{c.title}</div>
                      {r && <p className={cx("mt-0.5 text-sm", r.ok ? "text-ink-3" : "text-red-ink")}>{r.detail}</p>}
                    </div>
                    {r && <span className="num shrink-0 text-xs text-ink-3">{number(r.ms)} ms</span>}
                  </li>
                );
              })}
            </ul>
          </Card>
        ))}
      </div>
      <p className="mt-6 text-xs text-ink-3">{t("checks.footer")}</p>
    </div>
  );
}
