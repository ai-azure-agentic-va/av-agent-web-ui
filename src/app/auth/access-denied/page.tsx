import Link from "next/link";
import { AppLogo } from "@/components/icons/app-logo";

export default function AccessDeniedPage() {
  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-4 text-center">
        <AppLogo width={48} height={48} />
        <h1 className="text-xl font-semibold text-foreground">Access Denied</h1>
        <p className="max-w-sm text-sm text-muted-foreground">
          Your account is not authorised to use this application. Contact your
          administrator to request access.
        </p>
        <Link
          href="/api/auth/logout"
          className="mt-2 text-sm text-primary underline-offset-4 hover:underline"
        >
          Sign in with a different account
        </Link>
      </div>
    </div>
  );
}
