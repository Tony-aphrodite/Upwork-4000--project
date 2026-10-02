"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ArrowRight, Building2, KeyRound, RotateCcw, ShieldCheck } from "lucide-react";
import { Boot } from "@/components/Boot";
import { Logo } from "@/components/Shell";
import { useI18n, type MessageKey } from "@/i18n/i18n";
import { HostedSignIn } from "@/components/HostedSignIn";
import { useDb, type Role } from "@/lib/db";

interface DemoUser {
  id: string;
  full_name: string;
  email: string;
  role: Role;
  tenant_name: string;
  tenant_kind: "distributor" | "dealer";
}

export default function SignIn() {
  const { phase, db, userId, signIn, reset, hosted } = useDb();
  const { t, locale, setLocale } = useI18n();
  const router = useRouter();
  const [users, setUsers] = useState<DemoUser[]>([]);
  const [resetting, setResetting] = useState(false);

  useEffect(() => {
    if (phase === "ready" && userId) router.replace("/dashboard");
  }, [phase, userId, router]);
  useEffect(() => {
    // demo_users only exists in the in-browser demo; a hosted project signs in with a password.
    if (!db || hosted) return;
    db.as(null).rpc<DemoUser[]>("demo_users").then(setUsers);
  }, [db, hosted]);

  if (phase !== "ready") return <Boot />;

  const groups = [
    { kind: "distributor", title: t("signin.distributor"), note: t("signin.distributor_note") },
    { kind: "dealer", title: t("signin.dealer"), note: t("signin.dealer_note") },
  ] as const;

  return (
    <div className="min-h-dvh">
      <div className="mx-auto max-w-4xl px-4 py-8 sm:py-12">
        <div className="mb-8 flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <Logo initials="Q" color="#1e4d3b" size={44} />
            <div>
              <h1 className="text-2xl font-bold tracking-tight">{t("app.name")}</h1>
              <p className="text-sm text-ink-3">{t("app.tagline")}</p>
            </div>
          </div>
          <button className="btn btn-secondary btn-sm" onClick={() => setLocale(locale === "en" ? "ar" : "en")}>
            {locale === "en" ? "العربية" : "English"}
          </button>
        </div>

        <div className="card mb-6 p-5">
          <h2 className="mb-1 flex items-center gap-2 font-semibold">
            <KeyRound className="size-4 text-brand" aria-hidden />
            {t(hosted ? "signin.hosted_title" : "signin.title")}
          </h2>
          <p className="text-sm text-ink-2">{t(hosted ? "signin.hosted_explain" : "signin.explain")}</p>
          <p className="mt-2 text-sm text-ink-2">{t("signin.worked_example")}</p>
        </div>

        {hosted && <HostedSignIn />}

        {!hosted && groups.map((g) => (
          <section key={g.kind} className="mb-8">
            <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-ink-3">
              <Building2 className="size-4" aria-hidden />
              {g.title}
            </h2>
            <p className="mb-3 text-sm text-ink-3">{g.note}</p>
            <ul className="grid gap-3 sm:grid-cols-2">
              {users.filter((u) => u.tenant_kind === g.kind).map((u) => (
                <li key={u.id}>
                  <button onClick={() => signIn(u.id).then(() => router.push(u.role === "adviser" ? "/orders/new" : "/dashboard"))} className="card group flex w-full items-start gap-3 p-4 text-start transition hover:border-brand hover:shadow-md">
                    <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-brand/10 text-sm font-bold text-brand">
                      {u.full_name.split(" ").map((p) => p[0]).join("").slice(0, 2)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="font-semibold">{u.full_name}</span>
                        <span className="rounded-full bg-[#eef2ef] px-2 py-0.5 text-xs font-semibold text-ink-2">{t(`role.${u.role}` as MessageKey)}</span>
                      </span>
                      <span className="mt-1 block text-sm text-ink-3">{t(`role.${u.role}.can` as MessageKey)}</span>
                    </span>
                    <ArrowRight className="mt-2 size-4 text-ink-3 transition group-hover:text-brand rtl:rotate-180" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}

        <div className="flex flex-wrap items-center gap-3 border-t border-line pt-6 text-sm">
          <Link href="/checks" className="btn btn-secondary">
            <ShieldCheck className="size-4" aria-hidden />
            {t("signin.checks")}
          </Link>
          {/* Only the in-browser demo can be put back to the beginning; a server's data is its own. */}
          {!hosted && (
            <button className="btn btn-ghost" disabled={resetting} onClick={async () => { setResetting(true); await reset(); setResetting(false); }}>
              <RotateCcw className="size-4" aria-hidden />
              {resetting ? t("signin.resetting") : t("signin.reset")}
            </button>
          )}
          <p className="w-full text-xs text-ink-3">{t("signin.disclaimer")}</p>
        </div>
      </div>
    </div>
  );
}
