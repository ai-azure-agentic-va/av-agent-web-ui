import type { Metadata } from "next";
import { connection } from "next/server";
import "./globals.css";
import localFont from "next/font/local";
import React from "react";
import { NuqsAdapter } from "nuqs/adapters/next/app";
import { ThemeProvider } from "next-themes";
import { AuthSessionProvider } from "@/components/auth/session-provider";
import { APP_NAME, APP_TAGLINE } from "@/lib/app-config";
import { getClientConfig } from "@/lib/client-config";
import { ClientConfigProvider } from "@/providers/ClientConfig";

// Type: Lexend Deca carries every string a
// person reads, numbers and IDs included; Roboto Mono is for code only. Both
// are self-hosted so builds never reach out to a font CDN.
const lexendDeca = localFont({
  src: [
    {
      path: "../../public/fonts/LexendDeca-Light.ttf",
      weight: "300",
      style: "normal",
    },
    {
      path: "../../public/fonts/LexendDeca-Regular.ttf",
      weight: "400",
      style: "normal",
    },
    {
      path: "../../public/fonts/LexendDeca-Medium.ttf",
      weight: "500",
      style: "normal",
    },
    {
      path: "../../public/fonts/LexendDeca-SemiBold.ttf",
      weight: "600",
      style: "normal",
    },
  ],
  variable: "--font-lexend-deca",
  display: "swap",
});

const robotoMono = localFont({
  src: "../../public/fonts/RobotoMono-Variable.woff2",
  weight: "400 500",
  variable: "--font-roboto-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: APP_NAME,
  description: APP_TAGLINE || APP_NAME,
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
      <body className={`${lexendDeca.variable} ${robotoMono.variable}`}>
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
