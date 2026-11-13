# =============================================================================
# Open Web UI — Next.js Docker image
# Multi-stage build: deps → builder → runner (standalone)
# =============================================================================

# ---- Stage 1: install dependencies ------------------------------------------
FROM node:24-alpine AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app

# Copy package manager files
COPY package.json pnpm-lock.yaml* ./

# Enable corepack (ships with Node 24; Node 25+ no longer bundles it) and install.
# --frozen-lockfile makes the image install EXACTLY what pnpm-lock.yaml pins and
# fails the build if package.json and the lockfile disagree — so a rebuild can
# never silently float dependencies within caret ranges. If you change deps, run
# `pnpm install` locally to refresh the lockfile and commit it before building.
RUN corepack enable pnpm && pnpm install --frozen-lockfile

# ---- Stage 2: build ---------------------------------------------------------
FROM node:24-alpine AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Suppress Next.js telemetry in CI/build
ENV NEXT_TELEMETRY_DISABLED=1

# Build args baked into the client bundle (NEXT_PUBLIC_*)
# These can be overridden at build time: docker build --build-arg NEXT_PUBLIC_API_URL=/api
ARG NEXT_PUBLIC_API_URL=/api
ARG NEXT_PUBLIC_ASSISTANT_ID=chat
ARG NEXT_PUBLIC_APP_NAME="IVY"
ARG NEXT_PUBLIC_APP_TAGLINE="An incident virtual assistant which answers from tickets, pipelines and docs."
# Design system (colour tokens + mark): ps (default) or ets. Baked in at build;
# an unknown value fails the build. e.g. --build-arg NEXT_PUBLIC_DESIGN_SYSTEM=ets
ARG NEXT_PUBLIC_DESIGN_SYSTEM=ps
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
ENV NEXT_PUBLIC_ASSISTANT_ID=${NEXT_PUBLIC_ASSISTANT_ID}
ENV NEXT_PUBLIC_APP_NAME=${NEXT_PUBLIC_APP_NAME}
ENV NEXT_PUBLIC_APP_TAGLINE=${NEXT_PUBLIC_APP_TAGLINE}
ENV NEXT_PUBLIC_DESIGN_SYSTEM=${NEXT_PUBLIC_DESIGN_SYSTEM}

RUN corepack enable pnpm && pnpm build

# ---- Stage 3: run (minimal image) -------------------------------------------
FROM node:24-alpine AS runner
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
