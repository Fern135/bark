FROM node:22-alpine AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

# ---- deps: install exactly what's in package-lock.json ----
FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci
# engine/ and scripting/ are connected only through Docker: their build-only images
# (the `engine` and `scripting` build contexts, see docker-compose.yml) supply the built packages.
# Side by side in node_modules/@bark, scripting's link to ../engine resolves unchanged.
COPY --from=engine /packages/engine ./node_modules/@bark/engine
COPY --from=scripting /packages/scripting ./node_modules/@bark/scripting

# ---- dev: hot-reloading dev server (source is bind-mounted by docker-compose.dev.yml) ----
FROM deps AS dev
ENV NODE_ENV=development
EXPOSE 3000
CMD ["npm", "run", "dev", "--", "--hostname", "0.0.0.0", "--port", "3000"]

# ---- build ----
FROM deps AS builder
COPY . .
RUN mkdir -p public
RUN npm run build

# ---- runner: minimal standalone production image, non-root ----
FROM base AS runner
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 --ingroup nodejs nextjs
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
