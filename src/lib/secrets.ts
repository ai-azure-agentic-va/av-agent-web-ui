import "server-only";
import { SecretClient } from "@azure/keyvault-secrets";
import { DefaultAzureCredential } from "@azure/identity";
import { logger } from "@/lib/logger";

// Maps the process.env variable we want populated -> the secret name in Key
// Vault. Secret names are configurable so they can follow whatever naming
// convention the vault uses (defaults are kebab-case of the env var).
const SECRET_MAP: Record<string, string> = {
  AUTH_SECRET: process.env.AUTH_SECRET_KV_NAME || "auth-secret",
  ENTRA_CLIENT_SECRET:
    process.env.ENTRA_CLIENT_SECRET_KV_NAME || "entra-client-secret",
  LANGSMITH_API_KEY:
    process.env.LANGSMITH_API_KEY_KV_NAME || "langsmith-api-key",
};

// register() can fire more than once across HMR / route compilation in dev, so
// the fetch is idempotent — secrets are pulled at most once per process.
let loaded = false;

/**
 * Fetches secrets from Azure Key Vault at server startup and writes them onto
 * process.env so the rest of the app can keep reading plain env vars.
 *
 * Auth uses DefaultAzureCredential: a managed identity in Azure, or local
 * dev credentials (`az login` / env / VS Code) otherwise — no secret needed
 * to read the vault.
 *
 * When AZURE_KEY_VAULT_URL is unset the loader is a no-op, so local dev and
 * DISABLE_AUTH=true keep working off the .env file as before.
 */
export async function loadSecretsFromKeyVault(): Promise<void> {
  if (loaded) return;
  loaded = true;

  const vaultUrl = process.env.AZURE_KEY_VAULT_URL?.trim();
  if (!vaultUrl) {
    logger.info(
      "[secrets] AZURE_KEY_VAULT_URL not set — using environment variables as-is",
    );
    return;
  }

  const client = new SecretClient(vaultUrl, new DefaultAzureCredential());

  await Promise.all(
    Object.entries(SECRET_MAP).map(async ([envVar, secretName]) => {
      try {
        const { value } = await client.getSecret(secretName);
        if (value) {
          process.env[envVar] = value;
          logger.info(
            `[secrets] loaded ${envVar} from Key Vault secret "${secretName}"`,
          );
        } else {
          logger.warn(`[secrets] Key Vault secret "${secretName}" is empty`);
        }
      } catch (err) {
        // Non-fatal: log loudly but don't crash startup. A missing
        // ENTRA_CLIENT_SECRET will surface as an auth failure at request time.
        logger.error(
          `[secrets] failed to load "${secretName}" for ${envVar}:`,
          (err as Error).message,
        );
      }
    }),
  );
}
