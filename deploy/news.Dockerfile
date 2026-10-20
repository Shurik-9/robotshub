FROM node:24-bookworm-slim
WORKDIR /app
# better-sqlite3 can compile locally if a prebuilt binary is unavailable.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/* \
    && npm install --global pnpm@10.26.1
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY artifacts/api-server/package.json artifacts/api-server/package.json
COPY lib/api-zod/package.json lib/api-zod/package.json
COPY lib/db/package.json lib/db/package.json
RUN pnpm install --prod --filter @workspace/api-server... --frozen-lockfile
COPY artifacts/api-server/src/news-engine/ artifacts/api-server/src/news-engine/
COPY artifacts/robotshub/src/data/solutions.json /app/catalog-seed.json
COPY deploy/news-entrypoint.sh /app/news-entrypoint.sh
ENV NODE_ENV=production PORT=8099 NEWS_DATA_DIR=/data/news CATALOG_FILE=/data/news/catalog.json
RUN mkdir -p /data/news && chown -R node:node /data
USER node
EXPOSE 8099
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8099/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
# Only the standalone SQLite news engine, not the PostgreSQL API scaffold.
CMD ["sh", "/app/news-entrypoint.sh"]
