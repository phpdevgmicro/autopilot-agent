import type { Metadata } from "next";
import type { ReactNode } from "react";

import "./globals.css";

export const metadata: Metadata = {
  title: "Browser Agent — Autonomous Web Automation",
  description:
    "Autonomous browser agent powered by GPT-5.4. Give it a URL and instructions — it handles the rest.",
};

type RootLayoutProps = {
  children: ReactNode;
};

export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
