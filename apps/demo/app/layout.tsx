import type { Metadata } from "next";
import type { ReactNode } from "react";

import "./globals.css";
import { DesignFonts } from "@repo/ui/components/design-fonts";
import { ThemeProvider } from "@repo/ui/components/theme-provider";

export const metadata: Metadata = {
  title: "Settle Kit",
  description: "Deposits from any token, any chain, any exchange — settled as USDC.",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning className="font-sans antialiased">
      <head>
        <DesignFonts />
      </head>
      <body>
        <ThemeProvider defaultTheme="dark" storageKey="settle-kit-theme">
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
