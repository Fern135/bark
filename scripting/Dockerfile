# Build-only image: compiles @bark/scripting against the built engine image and keeps
# just what a consumer needs. It is never run as a container; web/'s image build copies
# /packages/scripting out of it. The `engine` build context is the engine image (see docker-compose.yml).

FROM node:22-alpine AS build
# scripting depends on file:../engine, so the built engine sits next to it.
COPY --from=engine /packages/engine /packages/engine
WORKDIR /packages/scripting
COPY package.json package-lock.json ./
# postinstall copies the pinned Pyodide files into public/pyodide.
COPY scripts ./scripts
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM scratch
COPY --from=build /packages/scripting/package.json /packages/scripting/package.json
COPY --from=build /packages/scripting/dist /packages/scripting/dist
COPY --from=build /packages/scripting/public/pyodide /packages/scripting/public/pyodide
COPY --from=build /packages/scripting/node_modules /packages/scripting/node_modules
