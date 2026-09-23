import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { PwaInstallPrompt } from "@/components/pwa/pwa-install-prompt";

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

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "Encrypted Pigeon",
  description: "Verschlüsselte Nachrichten, zugestellt per Taubenpost.",
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
    description: "Verschlüsselte Nachrichten, zugestellt per Taubenpost.",
    url: "/",
    siteName: "Encrypted Pigeon",
    images: [{ url: "/icons/icon-512.png", width: 512, height: 512 }],
    locale: "de_DE",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "Encrypted Pigeon",
    description: "Verschlüsselte Nachrichten, zugestellt per Taubenpost.",
    images: ["/icons/icon-512.png"],
  },
  robots: {
    // Private messenger, not a marketing site — keep it out of search results.
    index: false,
    follow: false,
  },
};

export const viewport: Viewport = {
  themeColor: "#c1643a",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
        <PwaInstallPrompt />
      </body>
    </html>
  );
}
