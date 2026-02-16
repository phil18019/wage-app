import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Phil's Wage App",
  description: "Shift & wage calculator",
  manifest: "/manifest.json",
  themeColor: "#0B2A6F",
  icons: {
    icon: [
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: "/icon-192.png",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}