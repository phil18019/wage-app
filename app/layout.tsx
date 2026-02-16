import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});


  export const metadata = {
  title: "Phil's Wage App",
  description: "Shift & wage calculator",
  manifest: "/manifest.json",
  themeColor: "#0B2A6F",

  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Phil's Wage App",
  },

  icons: {
    apple: "/icon-192.png",
  },

  other: {
    "apple-touch-startup-image": "/apple-splash-1290-2796.png",
  },
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
      </body>
    </html>
  );
}
