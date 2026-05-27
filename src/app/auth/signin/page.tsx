"use client";

import { signIn } from "next-auth/react";
import { useEffect } from "react";
import { ETSLogo } from "@/components/icons/ets-logo";

export default function SignInPage() {
  useEffect(() => {
    // Auto-redirect to Microsoft Entra ID — no intermediate sign-in page needed
    signIn("microsoft-entra-id", { callbackUrl: "/chat" });
  }, []);

  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-4 text-center">
        <ETSLogo width={48} height={48} />
        <h1 className="text-xl font-semibold text-foreground">
          Enterprise Technology Services
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
