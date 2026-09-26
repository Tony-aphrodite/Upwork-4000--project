"use client";

import { Database, Loader2 } from "lucide-react";
import { useI18n, type MessageKey } from "@/i18n/i18n";
import { useDb } from "@/lib/db";

/** First visit: Postgres starts in the tab, runs the migrations and replays three months. */
export function Boot() {
  const { phase, error } = useDb();
  const { t } = useI18n();
  const steps: { key: MessageKey; phase: string[] }[] = [
    { key: "boot.start", phase: ["loading"] },
    { key: "boot.migrations", phase: ["installing"] },
    { key: "boot.seed", phase: ["seeding"] },
  ];
  const order = ["loading", "installing", "seeding", "ready"];
  return (
    <div className="flex min-h-dvh items-center justify-center p-6">
      <div className="card w-full max-w-md p-6">
        <div className="mb-4 flex items-center gap-3">
          <span className="inline-flex size-10 items-center justify-center rounded-xl bg-brand text-brand-ink">
            <Database className="size-5" aria-hidden />
          </span>
          <div>
            <h1 className="font-bold">{t("boot.title")}</h1>
            <p className="text-sm text-ink-3">{t("boot.subtitle")}</p>
          </div>
        </div>
        {phase === "locked" ? (
          <p className="rounded-lg bg-warn-bg px-3 py-2 text-sm text-warn-ink">{t("boot.locked")}</p>
        ) : phase === "error" ? (
          <p className="rounded-lg bg-red-bg px-3 py-2 text-sm text-red-ink">{t("boot.error")} {error}</p>
        ) : (
          <ol className="space-y-2.5" aria-live="polite">
            {steps.map((s) => {
              const idx = order.indexOf(phase);
              const mine = order.indexOf(s.phase[0]!);
              const state = idx > mine ? "done" : idx === mine ? "now" : "todo";
              return (
                <li key={s.key} className="flex items-center gap-2.5 text-sm">
                  {state === "now" ? <Loader2 className="size-4 animate-spin text-brand" aria-hidden /> : <span className={`size-4 rounded-full ${state === "done" ? "bg-brand" : "border border-line"}`} aria-hidden />}
                  <span className={state === "todo" ? "text-ink-3" : "text-ink"}>{t(s.key)}</span>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </div>
  );
}
