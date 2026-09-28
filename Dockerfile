# The genealogy image for a remote machine.
#
# The build runs on the native architecture ($BUILDPLATFORM) and produces one
# html file; only that, server.mjs and the card format it imports
# (src/model/cards.ts, run by Node as it is) reach the final layer. The server
# has not a single dependency, so there is no node_modules in the image either —
# hence its size.
#
# Inside the container the server runs in memory mode: the tree is brought in
# and taken out as a zip archive, and nothing is left on the machine's disk.

# ---- build: the whole page in one file ----
FROM --platform=$BUILDPLATFORM node:26-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json vite.config.ts index.html ./
COPY src ./src
# The sample tree is a convenience for a first local run and has real names in it.
# The image must not carry anybody's names at all: an instance on someone else's
# machine holds only what was uploaded to it, so we empty the seed before building.
RUN echo '{}' > src/data/family.json
RUN npm run build

# ---- run ----
FROM node:26-alpine
ENV NODE_ENV=production \
    GENEALOGY_STORE=memory \
    HOST=0.0.0.0 \
    PORT=5179 \
    LOG_DIR=/app/logs
WORKDIR /app
COPY server.mjs ./
COPY src/model/cards.ts ./src/model/
COPY --from=build /app/dist ./dist

# The only thing written to disk: one line per request, rotated at 10 MB with
# three gzipped files kept. Bind-mount it from the host to keep it across
# restarts. The tree itself still never touches the disk.
RUN mkdir -p /app/logs && chown node:node /app/logs
VOLUME /app/logs

USER node
EXPOSE 5179

# /api/health is the only path without a password, and there are no people in the answer
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.mjs"]
