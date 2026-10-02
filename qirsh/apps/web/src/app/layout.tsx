import type { Metadata, Viewport } from "next";
import { IBM_Plex_Sans_Arabic, Inter } from "next/font/google";
import { KeepOnPhone } from "@/components/KeepOnPhone";
import { Providers } from "@/components/Providers";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const arabic = IBM_Plex_Sans_Arabic({ subsets: ["arabic"], weight: ["400", "500", "600", "700"], variable: "--font-arabic", display: "swap" });

export const metadata: Metadata = {
  title: "Qirsh · Orders, money and stock for a solar distributor",
  description: "A working prototype of an all-in-one platform for a solar distributor and its dealers: orders at fixed dollar prices, receipts in pounds, reports in euros, stock and customers.",
  icons: { icon: "/icon.svg" },
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Qirsh", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#1e4d3b",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" dir="ltr" className={`${inter.variable} ${arabic.variable}`}>
      <body className="antialiased">
        <KeepOnPhone />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
