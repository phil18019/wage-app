import type { Metadata, Viewport } from "next";
import Script from "next/script";
import "./globals.css";
import AnalyticsUserId from "./components/AnalyticsUserId";

export const metadata: Metadata = {
  title: "PayCore",
  description: "PayCore - Shift & pay calculator",
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
      <body>
        {children}

        {/* Google Analytics */}
        <Script
          src="https://www.googletagmanager.com/gtag/js?id=G-DN4FPV087M"
          strategy="afterInteractive"
        />
        <Script id="google-analytics" strategy="afterInteractive">
          {`
            window.dataLayer = window.dataLayer || [];
            function gtag(){dataLayer.push(arguments);}
            window.gtag = gtag;
            gtag('js', new Date());
            gtag('config', 'G-DN4FPV087M');
          `}
        </Script>

        {/* ✅ NEW: user tracking */}
        <AnalyticsUserId />
      </body>
    </html>
  );
}