"use client";

import { signIn } from "next-auth/react";
import { useEffect } from "react";
import { AppLogo } from "@/components/icons/app-logo";
import { LiveLine } from "@/components/thread/turn-chain";
import { APP_NAME } from "@/lib/app-config";

export default function SignInPage() {
  useEffect(() => {
    // Auto-redirect to Microsoft Entra ID — no intermediate sign-in page needed
    signIn("microsoft-entra-id", { callbackUrl: "/chat" });
  }, []);

  return (
    <div className="bg-background flex min-h-dvh w-full items-center justify-center px-6">
      <div className="flex w-full max-w-[420px] flex-col items-start gap-6">
        <AppLogo
          width={40}
          height={40}
        />
        <h1 className="text-foreground text-[32px] leading-[1.15] font-semibold tracking-[-0.025em]">
          {APP_NAME}
        </h1>
        <LiveLine label="Redirecting to Microsoft sign-in…" />
      </div>
    </div>
  );
}
