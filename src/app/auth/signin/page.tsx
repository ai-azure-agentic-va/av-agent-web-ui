"use client";

import { signIn } from "next-auth/react";
import { useEffect } from "react";
import { AppLogo } from "@/components/icons/app-logo";
import { APP_NAME } from "@/lib/app-config";

export default function SignInPage() {
  useEffect(() => {
    // Auto-redirect to Microsoft Entra ID — no intermediate sign-in page needed
    signIn("microsoft-entra-id", { callbackUrl: "/chat" });
  }, []);

  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-4 text-center">
        <AppLogo width={48} height={48} />
        <h1 className="text-xl font-semibold text-foreground">
          {APP_NAME}
        </h1>
        <p className="text-sm text-muted-foreground">
          Redirecting to Microsoft sign-in...
        </p>
        <div className="mt-2 h-1 w-32 overflow-hidden rounded-full bg-muted">
          <div className="h-full animate-pulse rounded-full bg-primary" />
        </div>
      </div>
    </div>
  );
}
