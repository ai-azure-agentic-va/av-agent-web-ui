import type { Metadata } from "next";
import "./globals.css";
import { GeistMono } from "geist/font/mono";
import React from "react";
import { NuqsAdapter } from "nuqs/adapters/next/app";
import { ThemeProvider } from "next-themes";
import { AuthSessionProvider } from "@/components/auth/session-provider";
import { APP_NAME } from "@/lib/app-config";

export const metadata: Metadata = {
  title: APP_NAME,
  description: APP_NAME,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className="light"
      style={{colorScheme: "light"}}
      suppressHydrationWarning
    >
      <head>
        <link
          href="https://api.fontshare.com/v2/css?f[]=satoshi@400,500,700,900&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className={`font-satoshi ${GeistMono.variable}`}>
        <AuthSessionProvider>
          <ThemeProvider
            attribute="class"
            defaultTheme="light"
            forcedTheme="light"
            enableSystem={false}
            disableTransitionOnChange
          >
            <NuqsAdapter>{children}</NuqsAdapter>
          </ThemeProvider>
        </AuthSessionProvider>
      </body>
    </html>
  );
}
