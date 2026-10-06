import "server-only";

// Runtime UI config handed to the client via <ClientConfigProvider>. Read from
// process.env on the server at request time (NOT NEXT_PUBLIC_*, which Next.js
// inlines at build), so the same image can be configured per environment.
export type ClientConfig = {
  // When true, tool calls / tool results are force-hidden in the chat and the
  // "Hide tool calls" toggle is removed from the composer.
  hideToolCalls: boolean;
};

export function getClientConfig(): ClientConfig {
  return {
    hideToolCalls: process.env.HIDE_TOOL_CALLS === "true",
  };
}
