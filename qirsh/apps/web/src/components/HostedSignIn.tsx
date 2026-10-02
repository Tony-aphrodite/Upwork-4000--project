"use client";

/**
 * Sign-in against a hosted project. The demo lets you step into any of the seeded people with one
 * click, which is right for a demo and wrong for a server: here the password is the proof, the
 * session comes from Supabase Auth, and every policy in the database reads its user from it.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useDb } from "@/lib/db";
import { useI18n, type MessageKey } from "@/i18n/i18n";

/**
 * The six people the seed data belongs to. They are listed because this is a demonstration and
 * whoever is looking at it has to be able to step into each role; a real deployment would have its
 * own people and no list.
 */
const PEOPLE = [
  { name: "Hamid Osman", email: "hamid@nileray.example", role: "owner" },
  { name: "Amira Hassan", email: "amira@nileray.example", role: "adviser" },
  { name: "Nusiba Ali", email: "nusiba@nileray.example", role: "adviser" },
  { name: "Salma Idris", email: "salma@nileray.example", role: "marketing" },
  { name: "Tarig Musa", email: "tarig@nileray.example", role: "warehouse" },
  { name: "Yasir Babiker", email: "yasir@dongolapower.example", role: "owner", at: "Dongola Power" },
] as const;
const DEMO_PASSWORD = "qirsh-demo";

export function HostedSignIn() {
  const { signInWithPassword } = useDb();
  const { t } = useI18n();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await signInWithPassword?.(email.trim(), password);
      router.replace("/dashboard");
    } catch (e) {
      setError((e as Error).message || t("signin.failed"));
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="card mx-auto w-full max-w-sm space-y-4 p-5">
      <div>
        <label className="label" htmlFor="email">{t("signin.email")}</label>
        <input
          id="email"
          type="email"
          autoComplete="email"
          required
          className="input mt-1"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>

      <div>
        <label className="label" htmlFor="password">{t("signin.password")}</label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          required
          className="input mt-1"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </div>

      {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">{error}</p>}

      <button type="submit" className="btn btn-primary w-full" disabled={busy}>
        {busy ? t("signin.signing_in") : t("signin.sign_in")}
      </button>

      <div className="border-t border-line pt-4">
        <p className="text-sm text-ink-3">{t("signin.hosted_people")}</p>
        <ul className="mt-2 space-y-1">
          {PEOPLE.map((person) => (
            <li key={person.email}>
              <button
                type="button"
                onClick={() => { setEmail(person.email); setPassword(DEMO_PASSWORD); setError(null); }}
                className="block w-full rounded-lg px-2 py-2 text-start text-sm hover:bg-[#eef2ef]"
              >
                <span className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-medium">{person.name}</span>
                  <span className="text-xs text-ink-3">
                    {t(`role.${person.role}` as MessageKey)}
                    {"at" in person ? ` · ${person.at}` : ""}
                  </span>
                </span>
                <span className="mt-0.5 block break-all text-xs text-ink-3" dir="ltr">{person.email}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </form>
  );
}
