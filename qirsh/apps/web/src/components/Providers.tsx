"use client";

import type { ReactNode } from "react";
import { I18nProvider } from "@/i18n/i18n";
import { DbProvider } from "@/lib/db";
import { OutboxProvider } from "@/lib/outbox";
import { ToastProvider } from "./ui";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <I18nProvider>
      <ToastProvider>
        <DbProvider>
          <OutboxProvider>{children}</OutboxProvider>
        </DbProvider>
      </ToastProvider>
    </I18nProvider>
  );
}
