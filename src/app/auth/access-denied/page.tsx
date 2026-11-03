import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { AppLogo } from "@/components/icons/app-logo";

export default function AccessDeniedPage() {
  return (
    <div className="bg-background flex min-h-dvh w-full items-center justify-center px-6">
      <div className="flex w-full max-w-[460px] flex-col items-start gap-6">
        <AppLogo
          width={40}
          height={40}
        />
        <div className="flex flex-col gap-3">
          <h1 className="text-foreground text-[32px] leading-[1.15] font-semibold tracking-[-0.025em]">
            Access denied
          </h1>
          <p className="text-foreground text-[17px] leading-7 font-light">
            Your account is not authorised to use this application. Contact
            your administrator to request access.
          </p>
        </div>
        <Link
          href="/api/auth/logout"
          className="group border-foreground hover:bg-foreground hover:text-background focus-visible:ring-ring inline-flex items-center gap-2 rounded-full border px-5 py-2.5 text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
        >
          Sign in with a different account
          <ArrowRight
            aria-hidden="true"
            className="size-4 transition-transform group-hover:translate-x-0.5"
          />
        </Link>
      </div>
    </div>
  );
}
