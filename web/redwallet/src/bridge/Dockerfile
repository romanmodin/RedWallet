# RedWallet HTTPS-to-Fulcrum bridge.
#
# Multi-stage build: compile TypeScript with dev dependencies, then ship only
# the compiled output and production dependencies. The runtime image runs as a
# non-root user and contains no secrets.
#
# Build:
#   docker build -t redwallet-fulcrum-bridge ./src/bridge
#
# Run with --network host, LISTEN_HOST=127.0.0.1, and the operator's
# environment file. A TLS reverse proxy exposes the loopback listener.

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci --no-audit --no-fund
COPY src ./src
RUN npm run build

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package.json ./
COPY --from=build /app/dist ./dist
USER node
EXPOSE 8080
# The bridge refuses to start without BRIDGE_SECRET; FULCRUM_HOST may be
# omitted, in which case reads return not_configured until it is set.
CMD ["node", "dist/index.js"]
