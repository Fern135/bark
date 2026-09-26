# Build-only image: compiles @bark/engine and keeps just what a consumer needs.
# It is never run as a container; web/'s image build copies /packages/engine out of it.

FROM node:22-alpine AS build
WORKDIR /packages/engine
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM scratch
COPY --from=build /packages/engine/package.json /packages/engine/package.json
COPY --from=build /packages/engine/dist /packages/engine/dist
COPY --from=build /packages/engine/node_modules /packages/engine/node_modules
