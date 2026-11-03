"use client";

import { createContext, ReactNode, useContext } from "react";
import type { PublicUser } from "@/lib/public-user";

// Unlike ClientConfigContext, `null` is a real value here, not "missing
// provider": it means nobody is signed in (no session, or DISABLE_AUTH=true).
// So the hook returns it instead of throwing, and consumers simply render
// nothing.
const SessionUserContext = createContext<PublicUser | null>(null);

export function SessionUserProvider({
  user,
  children,
}: {
  user: PublicUser | null;
  children: ReactNode;
}) {
  return (
    <SessionUserContext.Provider value={user}>
      {children}
    </SessionUserContext.Provider>
  );
}

export function useSessionUser(): PublicUser | null {
  return useContext(SessionUserContext);
}
