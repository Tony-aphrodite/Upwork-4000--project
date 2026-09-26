"use client";

import { useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { Boot } from "@/components/Boot";
import { Shell } from "@/components/Shell";
import { Loading } from "@/components/ui";
import { useDb } from "@/lib/db";

export default function AppLayout({ children }: { children: ReactNode }) {
  const { phase, userId, me } = useDb();
  const router = useRouter();
  useEffect(() => {
    if (phase === "ready" && !userId) router.replace("/");
  }, [phase, userId, router]);
  if (phase !== "ready") return <Boot />;
  if (!me) return <Loading />;
  return <Shell>{children}</Shell>;
}
