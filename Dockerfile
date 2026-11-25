# Mess Management API — production image.
#   build:  docker build -t mess-api .
#   run:    docker run --env-file .env.production -p 8080:8080 mess-api
#
# Stages: deps (all deps) -> build (tsc) -> prod-deps (runtime deps only) -> runtime.
# A `dev` stage is used by docker-compose.yml for local development only.

ARG NODE_VERSION=22

# ---------------------------------------------------------------- base
FROM node:${NODE_VERSION}-alpine AS base
WORKDIR /app
ENV NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_FUND=false \
    NPM_CONFIG_AUDIT=false

# ---------------------------------------------------------------- deps (dev + prod, for building/testing)
FROM base AS deps
COPY package.json package-lock.json ./
# No dependency needs an install script, so they are disabled (smaller attack surface).
RUN --mount=type=cache,target=/root/.npm \
    npm ci --ignore-scripts

# ---------------------------------------------------------------- build
FROM deps AS build
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

# ---------------------------------------------------------------- prod-deps (runtime dependencies only)
FROM base AS prod-deps
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev --ignore-scripts

# ---------------------------------------------------------------- dev (local docker-compose only)
FROM deps AS dev
ENV NODE_ENV=development
COPY . .
USER node
EXPOSE 8080
CMD ["npm", "run", "dev"]

# ---------------------------------------------------------------- runtime (production)
FROM node:${NODE_VERSION}-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=8080 \
    NPM_CONFIG_UPDATE_NOTIFIER=false

COPY --chown=node:node package.json ./
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist

ARG GIT_SHA=unknown
ENV APP_VERSION=${GIT_SHA}
LABEL org.opencontainers.image.title="mess-api" \
      org.opencontainers.image.revision="${GIT_SHA}"

USER node
EXPOSE 8080

# Liveness only (no DB call), so a Supabase blip never marks the container unhealthy.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

# Run node directly (not via npm/sh) so SIGTERM reaches the app, whose handlers drain connections and
# stop cron jobs (src/server.ts). The app spawns no child processes; compose adds `init: true` anyway.
CMD ["node", "dist/server.js"]
