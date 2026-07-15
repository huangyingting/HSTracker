import type { Metadata } from "next";

import "./globals.css";
import { themeInitScript } from "./theme-init";

export const metadata: Metadata = {
  title: "HS Tracker | Public trade evidence",
  description:
    "Explore public merchandise-trade evidence to identify candidate markets for deeper investigation.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
