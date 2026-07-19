/* eslint-disable @next/next/no-page-custom-font -- App Router root layout applies globally. */
import type { Metadata } from "next";
import "./globals.css";
import "./uat006.css";
import "./uat008.css";
import "./uat009.css";
import "./uat010.css";
import "./uat011.css";
import "./uat012.css";

export const metadata: Metadata = {
  title: { default: "HOS Kitchen Reports", template: "%s · HOS Kitchen Reports" },
  description: "Secure weekly kitchen reporting, cost control, approvals and management summaries.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en-GB">
      <head>
        <link href="https://fonts.googleapis.com" rel="preconnect" />
        <link crossOrigin="anonymous" href="https://fonts.gstatic.com" rel="preconnect" />
        <link href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700;800&family=Spline+Sans+Mono:wght@400;500;600&display=swap" rel="stylesheet" />
      </head>
      <body>{children}</body>
    </html>
  );
}
