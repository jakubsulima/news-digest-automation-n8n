import type { Metadata, Viewport } from "next";

import { ReaderLocaleProvider } from "@/components/reader-locale-provider";
import { getReaderLocale } from "@/lib/reader-locale-server";

import "./globals.css";

export const metadata: Metadata = {
  title: "Daily News Digest",
  description: "Private news reader",
  appleWebApp: {
    capable: true,
    title: "News Digest",
    statusBarStyle: "default",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

const themeInitScript = `
(() => {
  try {
    const stored = window.localStorage.getItem("reader-theme");
    const mode = stored === "light" || stored === "dark" || stored === "system" ? stored : "system";
    const dark = mode === "dark" || (mode === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.classList.toggle("dark", dark);
    document.documentElement.style.colorScheme = dark ? "dark" : "light";
  } catch {
  }
})();
`;

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await getReaderLocale();

  return (
    <html lang={locale} suppressHydrationWarning>
      <body>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        <ReaderLocaleProvider locale={locale}>{children}</ReaderLocaleProvider>
      </body>
    </html>
  );
}
