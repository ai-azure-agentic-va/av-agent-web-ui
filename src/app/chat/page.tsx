import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/msal-auth";
import ChatUI from "./chat-ui";

export default async function ChatPage() {
  if (process.env.DISABLE_AUTH !== "true") {
    const user = await getSessionUser();
    if (!user) redirect("/api/auth/login");
  }

  return <ChatUI />;
}
