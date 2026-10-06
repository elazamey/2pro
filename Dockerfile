# syntax=docker/dockerfile:1.6
# ---------- Build stage ---------------------------------------------------
FROM node:22-alpine AS builder
WORKDIR /app

# Install root deps first for better layer caching
COPY package*.json tsconfig.json ./
RUN npm install --include-workspace-root --no-audit --no-fund

# Copy all workspace sources and build
COPY packages ./packages
COPY apps ./apps
COPY actions ./actions
RUN npm run build --workspaces --if-present

# Prune dev dependencies for the runtime image
RUN npm prune --omit=dev --workspaces --include-workspace-root

# ---------- Runtime stage -------------------------------------------------
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0

RUN apk add --no-cache wget tini \
 && addgroup -S app && adduser -S -G app app

COPY --from=builder --chown=app:app /app ./

USER app
EXPOSE 3000
ENTRYPOINT ["/sbin/tini", "--"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/auth/session >/dev/null || exit 1
CMD ["npm", "start", "-w", "@2pro/dashboard"]
