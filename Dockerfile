# The genealogy image for a remote machine.
#
# The build runs on the native architecture ($BUILDPLATFORM) and produces one
# html file; only that and server.mjs reach the final layer. The server has not
# a single dependency, so there is no node_modules in the image either — hence
# its size.
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
RUN npm run build

# ---- run ----
FROM node:26-alpine
ENV NODE_ENV=production \
    GENEALOGY_STORE=memory \
    HOST=0.0.0.0 \
    PORT=5179
WORKDIR /app
COPY server.mjs ./
COPY --from=build /app/dist ./dist

# it writes to memory, not to disk — it does not need the container file system
USER node
EXPOSE 5179

# /api/health is the only path without a password, and there are no people in the answer
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.mjs"]
