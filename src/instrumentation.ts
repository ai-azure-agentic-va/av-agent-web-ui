// Next.js runs register() once when the server boots, before any request is
// handled. We use it to hydrate secrets from Azure Key Vault into process.env.
export async function register() {
  // Key Vault / identity SDKs are Node-only — skip the Edge runtime so they're
  // never bundled there (middleware etc. run on Edge).
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { loadSecretsFromKeyVault } = await import("@/lib/secrets");
  await loadSecretsFromKeyVault();
}
