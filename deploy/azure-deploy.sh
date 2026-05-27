#!/usr/bin/env bash
# =============================================================================
# Deploy open-web-ui to Azure Container Apps
#
# Prerequisites:
#   az login  (or use a service principal / managed identity in CI)
#   Docker running locally (for the `az acr build` step)
#
# Usage:
#   chmod +x deploy/azure-deploy.sh
#   ./deploy/azure-deploy.sh
#
# All variables below can be overridden as environment variables:
#   ACR_NAME=myregistry ./deploy/azure-deploy.sh
# =============================================================================
set -euo pipefail

# ---------------------------------------------------------------------------
# Configuration — edit these or export as env vars before running
# ---------------------------------------------------------------------------
RESOURCE_GROUP="${RESOURCE_GROUP:-rg-open-web-ui}"
LOCATION="${LOCATION:-eastus2}"
ACR_NAME="${ACR_NAME:-openwebuiacr}"           # must be globally unique, lowercase
ACA_ENV="${ACA_ENV:-open-web-ui-env}"          # Container Apps environment name
APP_NAME="${APP_NAME:-open-web-ui}"            # Container App name
IMAGE_TAG="${IMAGE_TAG:-latest}"

# Runtime secrets — set these before running or export from a key vault
AUTH_SECRET="${AUTH_SECRET:?Set AUTH_SECRET (32+ char random string)}"
ENTRA_TENANT_ID="${ENTRA_TENANT_ID:?Set ENTRA_TENANT_ID}"
ENTRA_CLIENT_ID="${ENTRA_CLIENT_ID:?Set ENTRA_CLIENT_ID}"
ENTRA_CLIENT_SECRET="${ENTRA_CLIENT_SECRET:?Set ENTRA_CLIENT_SECRET}"
PARENT_AGENT_API_URL="${PARENT_AGENT_API_URL:-}"   # backend URL; leave blank if not ready

# Auth bypass — set to "true" only for dev/test deployments
DISABLE_AUTH="${DISABLE_AUTH:-false}"

# ---------------------------------------------------------------------------
# Derived values
# ---------------------------------------------------------------------------
IMAGE="${ACR_NAME}.azurecr.io/${APP_NAME}:${IMAGE_TAG}"
APP_URL="https://${APP_NAME}.${LOCATION}.azurecontainerapps.io"   # approximate; update after deploy

# ---------------------------------------------------------------------------
# Step 1 — Resource group
# ---------------------------------------------------------------------------
echo "▶ Creating resource group: ${RESOURCE_GROUP}"
az group create \
  --name "${RESOURCE_GROUP}" \
  --location "${LOCATION}" \
  --output none

# ---------------------------------------------------------------------------
# Step 2 — Azure Container Registry
# ---------------------------------------------------------------------------
echo "▶ Creating / verifying ACR: ${ACR_NAME}"
az acr create \
  --resource-group "${RESOURCE_GROUP}" \
  --name "${ACR_NAME}" \
  --sku Basic \
  --admin-enabled true \
  --output none 2>/dev/null || echo "  ACR already exists, continuing."

# ---------------------------------------------------------------------------
# Step 3 — Build & push the image using ACR Tasks (no local Docker daemon needed)
# NEXT_PUBLIC_* vars must be baked in at build time.
# ---------------------------------------------------------------------------
echo "▶ Building and pushing image: ${IMAGE}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

az acr build \
  --registry "${ACR_NAME}" \
  --image "${APP_NAME}:${IMAGE_TAG}" \
  --build-arg NEXT_PUBLIC_API_URL=/api \
  --build-arg NEXT_PUBLIC_ASSISTANT_ID=agent \
  "${REPO_ROOT}"

# ---------------------------------------------------------------------------
# Step 4 — Container Apps environment
# ---------------------------------------------------------------------------
echo "▶ Creating Container Apps environment: ${ACA_ENV}"
az containerapp env create \
  --resource-group "${RESOURCE_GROUP}" \
  --name "${ACA_ENV}" \
  --location "${LOCATION}" \
  --output none 2>/dev/null || echo "  Environment already exists, continuing."

# ---------------------------------------------------------------------------
# Step 5 — Deploy the Container App
# Secrets are stored in Container Apps secret store (not env vars) for safety.
# ---------------------------------------------------------------------------
echo "▶ Deploying Container App: ${APP_NAME}"

# Retrieve ACR credentials
ACR_SERVER="${ACR_NAME}.azurecr.io"
ACR_USERNAME=$(az acr credential show --name "${ACR_NAME}" --query username -o tsv)
ACR_PASSWORD=$(az acr credential show --name "${ACR_NAME}" --query "passwords[0].value" -o tsv)

az containerapp create \
  --resource-group "${RESOURCE_GROUP}" \
  --environment "${ACA_ENV}" \
  --name "${APP_NAME}" \
  --image "${IMAGE}" \
  --registry-server "${ACR_SERVER}" \
  --registry-username "${ACR_USERNAME}" \
  --registry-password "${ACR_PASSWORD}" \
  --target-port 3000 \
  --ingress external \
  --min-replicas 1 \
  --max-replicas 3 \
  --cpu 0.5 \
  --memory 1Gi \
  --secrets \
      "auth-secret=${AUTH_SECRET}" \
      "entra-client-secret=${ENTRA_CLIENT_SECRET}" \
  --env-vars \
      "NODE_ENV=production" \
      "PORT=3000" \
      "DISABLE_AUTH=${DISABLE_AUTH}" \
      "AUTH_SECRET=secretref:auth-secret" \
      "ENTRA_TENANT_ID=${ENTRA_TENANT_ID}" \
      "ENTRA_CLIENT_ID=${ENTRA_CLIENT_ID}" \
      "ENTRA_CLIENT_SECRET=secretref:entra-client-secret" \
      "PARENT_AGENT_API_URL=${PARENT_AGENT_API_URL}" \
  --output none

# ---------------------------------------------------------------------------
# Step 6 — Retrieve the deployed URL and print instructions
# ---------------------------------------------------------------------------
FQDN=$(az containerapp show \
  --resource-group "${RESOURCE_GROUP}" \
  --name "${APP_NAME}" \
  --query "properties.configuration.ingress.fqdn" \
  -o tsv)

echo ""
echo "✅ Deployment complete!"
echo "   App URL : https://${FQDN}"
echo ""
echo "Next steps:"
echo "  1. Add this redirect URI to your Entra ID app registration:"
echo "       https://${FQDN}/api/auth/callback/microsoft-entra-id"
echo "  2. Update AUTH_URL in the Container App environment vars:"
echo "       az containerapp update --name ${APP_NAME} --resource-group ${RESOURCE_GROUP} \\"
echo "         --set-env-vars AUTH_URL=https://${FQDN}"
echo "  3. Set PARENT_AGENT_API_URL once your backend is deployed:"
echo "       az containerapp update --name ${APP_NAME} --resource-group ${RESOURCE_GROUP} \\"
echo "         --set-env-vars PARENT_AGENT_API_URL=https://<your-backend-fqdn>"
