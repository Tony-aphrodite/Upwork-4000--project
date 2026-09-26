"use client";

/**
 * Sign-in against a hosted project. The demo lets you step into any of the seeded people with one
 * click, which is right for a demo and wrong for a server: here the password is the proof, the
 * session comes from Supabase Auth, and every policy in the database reads its user from it.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { KeyRound } from "lucide-react";
import { useDb } from "@/lib/db";
import { useI18n } from "@/i18n/i18n";

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
      <p className="flex items-center gap-2 text-sm text-muted">
        <KeyRound className="size-4" aria-hidden="true" />
        {t("signin.hosted_note")}
      </p>

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
    </form>
  );
}
