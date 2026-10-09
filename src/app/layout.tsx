import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { cookies } from "next/headers";
import "./globals.css";
import { PwaInstallPrompt } from "@/components/pwa/pwa-install-prompt";
import { AuthHashForwarder } from "@/components/auth/auth-hash-forwarder";
import { OutboxResumer } from "@/components/chat/outbox-resumer";
import { THEME_COOKIE, parseTheme, themeClass } from "@/lib/theme";
import { ACCENT_COOKIE, accentStyle, parseAccent } from "@/lib/accent";
import { I18nProvider } from "@/lib/i18n/client";
import { INTL_LOCALES } from "@/lib/i18n/config";
import { MESSAGES } from "@/lib/i18n/messages";
import { getLocale, getT } from "@/lib/i18n/server";

const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-geist-sans",
  weight: "100 900",
});
const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-geist-mono",
  weight: "100 900",
});

// Falls back to localhost so `next build` never fails when the env var is
// unset (e.g. a preview build); NEXT_PUBLIC_SITE_URL is what's actually used
// in production (set it to https://encrypted-pigeon.com in Vercel).
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  const locale = await getLocale();
  const description = t("common.appDescription");
  return {
    metadataBase: new URL(siteUrl),
    title: "Encrypted Pigeon",
    description,
    manifest: "/manifest.json",
    icons: {
      icon: [
        { url: "/favicon-32.png", sizes: "32x32", type: "image/png" },
        { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
        { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      ],
      apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
    },
    appleWebApp: {
      capable: true,
      statusBarStyle: "default",
      title: "Pigeon",
    },
    openGraph: {
      title: "Encrypted Pigeon",
      description,
      url: "/",
      siteName: "Encrypted Pigeon",
      images: [{ url: "/icons/icon-512.png", width: 512, height: 512 }],
      locale: INTL_LOCALES[locale].replace("-", "_"),
      type: "website",
    },
    twitter: {
      card: "summary",
      title: "Encrypted Pigeon",
      description,
      images: ["/icons/icon-512.png"],
    },
    robots: {
      // Private messenger, not a marketing site — keep it out of search results.
      index: false,
      follow: false,
    },
  };
}

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#c1643a" },
    { media: "(prefers-color-scheme: dark)", color: "#17130f" },
  ],
  colorScheme: "light dark",
  width: "device-width",
  initialScale: 1,
  // Lets the layout extend under the iPhone home indicator / notch; the
  // chat header and composer pad themselves with env(safe-area-inset-*).
  viewportFit: "cover",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const cookieStore = await cookies();
  const theme = parseTheme(cookieStore.get(THEME_COOKIE)?.value);
  const accent = parseAccent(cookieStore.get(ACCENT_COOKIE)?.value);
  const locale = await getLocale();

  return (
    // suppressHydrationWarning: <ThemeSync /> may adjust class/style client-side.
    <html
      lang={locale}
      className={themeClass(theme) || undefined}
      style={accentStyle(accent)}
      suppressHydrationWarning
    >
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <I18nProvider locale={locale} messages={MESSAGES[locale]}>
          <AuthHashForwarder />
          <OutboxResumer />
          {children}
          <PwaInstallPrompt />
        </I18nProvider>
      </body>
    </html>
  );
}
