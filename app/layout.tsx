import type { Metadata, Viewport } from "next";
import Script from "next/script";
import "./globals.css";

export const metadata: Metadata = {
  title: "PayCore",
  description: "PayCore - Shift & pay calculator",
  manifest: "/manifest.json",

  icons: {
    icon: [
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: "/icon-192.png",
  },

  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "PayCore",
  },

  other: {
    "apple-touch-startup-image": "/apple-splash-1290x2796.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#0B2A6F",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <Script
          src="https://www.googletagmanager.com/gtag/js?id=G-DM4FPV8B7M"
          strategy="afterInteractive"
        />
        <Script id="google-analytics" strategy="afterInteractive">
          {`
            window.dataLayer = window.dataLayer || [];
            function gtag(){dataLayer.push(arguments);}
            window.gtag = gtag;
            gtag('js', new Date());
            gtag('config', 'G-DM4FPV8B7M', {
              page_path: window.location.pathname,
            });
          `}
        </Script>
      </head>

      <body>{children}</body>
    </html>
  );
}