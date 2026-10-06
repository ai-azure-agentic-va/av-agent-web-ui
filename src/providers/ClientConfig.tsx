"use client";

import { createContext, ReactNode, useContext } from "react";
import type { ClientConfig } from "@/lib/client-config";

const ClientConfigContext = createContext<ClientConfig | undefined>(undefined);

export function ClientConfigProvider({
  config,
  children,
}: {
  config: ClientConfig;
  children: ReactNode;
}) {
  return (
    <ClientConfigContext.Provider value={config}>
      {children}
    </ClientConfigContext.Provider>
  );
}

export function useClientConfig(): ClientConfig {
  const context = useContext(ClientConfigContext);
  if (context === undefined) {
    throw new Error(
      "useClientConfig must be used within a ClientConfigProvider",
    );
  }
  return context;
}
