# RepoReady API server. Build from the repo root:
#   docker build -t repoready-server .
#   docker run --env-file .env -p 4000:4000 repoready-server
#
# Single instance only: private reports live in this process's memory (see README).

# ---- build: compile the server (and bundle the shared package) with tsup ----
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci --workspace server --workspace packages/shared --include-workspace-root
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY server server
RUN npm run build --workspace server

# ---- runtime: production dependencies + compiled output only ----
FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY server/package.json server/
COPY client/package.json client/
# `typescript` is a server runtime dependency: madge uses it to parse analyzed TS repos.
RUN npm ci --workspace server --omit=dev && npm cache clean --force
COPY --from=build /app/server/dist server/dist

# Never run as root: analyzed repositories are untrusted input (they are only read, never run).
USER node
WORKDIR /app/server
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD wget -qO- "http://127.0.0.1:${PORT:-4000}/api/health" || exit 1
CMD ["node", "dist/index.js"]
