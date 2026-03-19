import type { Metadata } from "next";
import type { ReactNode } from "react";

import "./globals.css";

const appName = process.env.NEXT_PUBLIC_APP_NAME ?? "AutoPilot Agent";

export const metadata: Metadata = {
  title: appName,
  description:
    process.env.NEXT_PUBLIC_APP_SUBTITLE ??
    "Give a URL and instructions — the agent handles the rest.",
};

type RootLayoutProps = {
  children: ReactNode;
};

export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
