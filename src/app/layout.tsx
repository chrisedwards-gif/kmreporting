import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "HOS Kitchen Reports",
    template: "%s · HOS Kitchen Reports",
  },
  description: "Secure weekly kitchen reporting, cost control, approvals and management summaries.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en-GB">
      <body>{children}</body>
    </html>
  );
}
