# syntax=docker/dockerfile:1.7

ARG NODE_IMAGE=node:24.17.0-bookworm-slim@sha256:862263c612aa437e3037674b85419622a9d93bff80aa1eee5398dfe686375532

FROM ${NODE_IMAGE} AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm install --global npm@11.13.0 \
  && npm ci

FROM ${NODE_IMAGE} AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=dependencies /app/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY next.config.ts tsconfig.json next-env.d.ts ./
COPY src ./src
COPY test/fixtures ./test/fixtures
COPY scripts/prepare-standalone.mjs ./scripts/prepare-standalone.mjs
RUN npm run build \
  && npm run prepare:standalone

FROM ${NODE_IMAGE} AS runner
WORKDIR /app
ENV NODE_ENV=production \
  NEXT_TELEMETRY_DISABLED=1 \
  HOSTNAME=0.0.0.0 \
  PORT=3000 \
  HS_TRACKER_RELEASE_VOLUME_PATH=/data/releases
ARG APP_BUILD_ID
RUN test -n "${APP_BUILD_ID}"
ENV APP_BUILD_ID=${APP_BUILD_ID}
LABEL org.opencontainers.image.source="https://github.com/huangyingting/HSTracker" \
  org.opencontainers.image.revision="${APP_BUILD_ID}"
COPY --chown=node:node --from=builder /app/.next/standalone ./
COPY docker-entrypoint.sh /usr/local/bin/hs-tracker-entrypoint
RUN chmod 0755 /usr/local/bin/hs-tracker-entrypoint \
  && mkdir -p /data/releases \
  && chown -R node:node /app /data
EXPOSE 3000
ENTRYPOINT ["/usr/local/bin/hs-tracker-entrypoint"]
CMD ["node", "server.js"]
