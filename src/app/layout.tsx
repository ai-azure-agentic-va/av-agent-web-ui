import type { Metadata } from "next";
import { connection } from "next/server";
import "./globals.css";
import { GeistMono } from "geist/font/mono";
import React from "react";
import { NuqsAdapter } from "nuqs/adapters/next/app";
import { ThemeProvider } from "next-themes";
import { AuthSessionProvider } from "@/components/auth/session-provider";
import { APP_NAME } from "@/lib/app-config";
import { getClientConfig } from "@/lib/client-config";
import { ClientConfigProvider } from "@/providers/ClientConfig";

export const metadata: Metadata = {
  title: APP_NAME,
  description: APP_NAME,
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Render per request so runtime env (not build-time env) drives the config.
  await connection();
  const clientConfig = getClientConfig();

  return (
    <html
      lang="en"
      className="light"
      style={{ colorScheme: "light" }}
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
            <ClientConfigProvider config={clientConfig}>
              <NuqsAdapter>{children}</NuqsAdapter>
            </ClientConfigProvider>
          </ThemeProvider>
        </AuthSessionProvider>
      </body>
    </html>
  );
}
