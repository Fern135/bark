FROM node:22-alpine AS base
WORKDIR /app/web
ENV NEXT_TELEMETRY_DISABLED=1

# ---- deps: install exactly what's in package-lock.json ----
FROM base AS deps
COPY engine/package.json engine/package-lock.json /app/engine/
COPY scripting/package.json scripting/package-lock.json /app/scripting/
COPY scripting/scripts /app/scripting/scripts
RUN cd /app/engine && npm ci
RUN cd /app/scripting && npm ci
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY engine /app/engine
COPY scripting /app/scripting

# ---- dev: hot-reloading dev server (source is bind-mounted by docker-compose.dev.yml) ----
FROM deps AS dev
ENV NODE_ENV=development
# docker-compose.dev.yml keeps node_modules in a volume that outlives rebuilds, so after
# `up --build` it can hide newer packages (e.g. a rebuilt engine/scripting). Keep a pristine
# copy plus a stamp that changes whenever this layer is rebuilt; on start, a volume with an
# old stamp is refreshed from the copy. This replaces having to remember `up -V`.
RUN for package in engine scripting web; do \
      mkdir -p /opt/dependencies/$package; \
      cp -a /app/$package/node_modules/. /opt/dependencies/$package/; \
      date +%s%N | tee /opt/dependencies/$package/.image-stamp > /app/$package/node_modules/.image-stamp; \
    done
COPY web/scripts/docker-dev.sh /usr/local/bin/bark-web-dev
EXPOSE 3000
CMD ["sh", "/usr/local/bin/bark-web-dev"]

# ---- build ----
FROM deps AS builder
COPY web .
RUN mkdir -p public
RUN npm run build

# ---- runner: minimal standalone production image, non-root ----
FROM base AS runner
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 --ingroup nodejs nextjs
COPY --from=builder --chown=nextjs:nodejs /app/web/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/web/.next/standalone /app/
COPY --from=builder --chown=nextjs:nodejs /app/web/.next/static ./.next/static
USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
