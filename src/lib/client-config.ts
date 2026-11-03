import "server-only";

// Runtime UI config handed to the client via <ClientConfigProvider>. Read from
// process.env on the server at request time (NOT NEXT_PUBLIC_*, which Next.js
// inlines at build), so the same image can be configured per environment.
export type ClientConfig = {
  // When true, tool calls / tool results are hidden in the chat. This is the
  // only control; there is no UI toggle or URL param.
  hideToolCalls: boolean;
  // When true, the composer accepts image / PDF attachments (paperclip button,
  // paste, drag-and-drop). Opt-in: off unless explicitly enabled.
  enableFileUpload: boolean;
};

export function getClientConfig(): ClientConfig {
  return {
    hideToolCalls: process.env.HIDE_TOOL_CALLS === "true",
    enableFileUpload: process.env.ENABLE_FILE_UPLOAD === "true",
  };
}
