FROM node:24-alpine AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM dependencies AS build
COPY karui/tsconfig*.json ./karui/
COPY karui/src ./karui/src
RUN npm run build && npm prune --omit=dev

FROM node:24-alpine AS runtime
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 CONTENT_DIR=/app/content
WORKDIR /app
RUN apk add --no-cache su-exec
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/karui/dist ./dist
COPY --from=build --chown=node:node /app/karui/public ./public
COPY --chown=node:node package.json ./
COPY --chown=node:node karui/templates ./templates
COPY --chown=node:node karui/lang ./lang
COPY --chown=node:node karui/scripts/install-plugins.ts ./scripts/install-plugins.ts
COPY --chown=node:node karui/scripts/panel-account.ts ./scripts/panel-account.ts
COPY --chown=node:node karui/scripts/create-template.ts ./scripts/create-template.ts
COPY --chmod=755 karui/docker-entrypoint.sh /usr/local/bin/karui-entrypoint
RUN mkdir -p /app/content && chown node:node /app/content
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s CMD node -e "fetch('http://127.0.0.1:3000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["karui-entrypoint"]
CMD ["node", "dist/server.js"]
