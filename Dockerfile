# =============================================================================
# Open Web UI — Next.js Docker image
# Multi-stage build: deps → builder → runner (standalone)
# =============================================================================

# ---- Stage 1: install dependencies ------------------------------------------
FROM node:20-alpine AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app

# Copy package manager files
COPY package.json pnpm-lock.yaml* ./

# Enable corepack (ships with Node 20) and install.
# Use --no-frozen-lockfile so Docker builds succeed even when pnpm-lock.yaml
# hasn't been regenerated locally after adding next-auth.
# Run `pnpm install` locally first to keep the lockfile up to date.
RUN corepack enable pnpm && pnpm install --no-frozen-lockfile

# ---- Stage 2: build ---------------------------------------------------------
FROM node:20-alpine AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Suppress Next.js telemetry in CI/build
ENV NEXT_TELEMETRY_DISABLED=1

# Build args baked into the client bundle (NEXT_PUBLIC_*)
# These can be overridden at build time: docker build --build-arg NEXT_PUBLIC_API_URL=/api
ARG NEXT_PUBLIC_API_URL=/api
ARG NEXT_PUBLIC_ASSISTANT_ID=agent
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
ENV NEXT_PUBLIC_ASSISTANT_ID=${NEXT_PUBLIC_ASSISTANT_ID}

RUN corepack enable pnpm && pnpm build

# ---- Stage 3: run (minimal image) -------------------------------------------
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Create non-root user
RUN addgroup --system --gid 1001 nodejs && \
    adduser  --system --uid 1001 nextjs

# Copy the standalone output produced by next build (requires output: 'standalone')
COPY --from=builder /app/public                        ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone  ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static      ./.next/static

USER nextjs

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

CMD ["node", "server.js"]
