/** @type {import('next').NextConfig} */
const nextConfig = {
  // Required for Docker standalone build
  output: "standalone",
  serverExternalPackages: ["@azure/msal-node"],
  experimental: {
    serverActions: {
      bodySizeLimit: "10mb",
    },
  },
};

export default nextConfig;
