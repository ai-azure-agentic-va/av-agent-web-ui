/** @type {import('next').NextConfig} */
const nextConfig = {
  // Required for Docker standalone build
  output: "standalone",
  serverExternalPackages: [
    "@azure/msal-node",
    "@azure/keyvault-secrets",
    "@azure/identity",
  ],
  experimental: {
    serverActions: {
      bodySizeLimit: "10mb",
    },
  },
};

export default nextConfig;
