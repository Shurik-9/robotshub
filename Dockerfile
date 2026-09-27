FROM node:24-bookworm-slim AS build

WORKDIR /app
RUN npm install --global pnpm@10.26.1

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY artifacts/robotshub/package.json artifacts/robotshub/package.json
COPY lib/api-client-react/package.json lib/api-client-react/package.json
# Only the user-facing app and its one workspace dependency are needed.
# Keep install cached when documentation or frontend source changes.
RUN pnpm install --filter @workspace/robotshub... --frozen-lockfile
COPY tsconfig.base.json ./
COPY artifacts/robotshub/ artifacts/robotshub/
COPY lib/api-client-react/ lib/api-client-react/
ENV BASE_PATH=/ PORT=5173
RUN pnpm --filter @workspace/robotshub run build

FROM nginx:1.27-alpine
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/artifacts/robotshub/dist/public/ /usr/share/nginx/html/
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1