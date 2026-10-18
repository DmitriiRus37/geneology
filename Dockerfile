# The genealogy image for a remote machine.
#
# The build runs on the native architecture ($BUILDPLATFORM) and produces one
# html file; only that and the server reach the final layer: server.mjs,
# server/*.ts and the card format they import (src/model/cards.ts), all run by
# Node as they are. The server has not a single dependency, so there is no
# node_modules in the image either — hence its size.
#
# Inside the container the server keeps the tree on disk, in /app/data, which
# compose mounts from the host: a restart, a reboot or a deploy keeps it. A new,
# empty folder takes the first tree as a zip archive ("Upload archive").

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
    GENEALOGY_STORE=disk \
    GENEALOGY_DIR=/app/data \
    HOST=0.0.0.0 \
    PORT=5179 \
    LOG_DIR=/app/logs
WORKDIR /app
COPY server.mjs ./
# the tests and their harness stay out: .dockerignore drops them from the context
COPY server/*.ts ./server/
COPY src/model/cards.ts ./src/model/
COPY --from=build /app/dist ./dist

# Two folders are written to: the tree (a card per person, photos/ beside them)
# and the request log, rotated at 10 MB with three gzipped files kept. Both are
# bind-mounted from the host so they outlive the container.
RUN mkdir -p /app/logs /app/data && chown node:node /app/logs /app/data
VOLUME /app/logs /app/data

USER node
EXPOSE 5179

# /api/health is the only path without a password, and there are no people in the answer
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.mjs"]
