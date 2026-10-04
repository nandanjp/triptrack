# syntax=docker/dockerfile:1

FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:24-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Compiled into the bundle, so /health can report which build is running.
ARG VERSION=dev
RUN VERSION="$VERSION" npm run build

# Distroless runs as UID 65532, which is what the chart's securityContext
# expects. No shell, so draining is handled in-process rather than by a
# preStop hook.
FROM gcr.io/distroless/nodejs24-debian12:nonroot AS production
WORKDIR /app
ENV NODE_ENV=production
# Only the bundles and the built SPA: dependencies are inlined by esbuild, so
# there is no node_modules in the image.
COPY --from=build /app/dist ./dist
# Drizzle migrations are SQL files read at runtime by the init container, so
# unlike code they cannot be bundled.
COPY --from=build /app/drizzle ./drizzle
EXPOSE 8080
CMD ["dist/server.js"]
