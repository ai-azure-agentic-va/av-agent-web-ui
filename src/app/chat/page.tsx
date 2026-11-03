import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/msal-auth";
import { toPublicUser, type PublicUser } from "@/lib/public-user";
import { SessionUserProvider } from "@/providers/SessionUser";
import ChatUI from "./chat-ui";

export default async function ChatPage() {
  let user: PublicUser | null = null;
  if (process.env.DISABLE_AUTH !== "true") {
    const session = await getSessionUser();
    if (!session) redirect("/api/auth/login");
    // Only name and email cross to the client. The session also holds the
    // access token, oid and expiry, which must stay on the server.
    user = toPublicUser(session);
  }

  return (
    <SessionUserProvider user={user}>
      <ChatUI />
    </SessionUserProvider>
  );
}
