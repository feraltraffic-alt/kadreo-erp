# Kadreo back office: static build served by nginx, /api proxied to the backend.
# Build from the repository root: docker build -f apps/backoffice/Dockerfile .
FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /src
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY packages packages
COPY apps/backoffice apps/backoffice
RUN pnpm install --frozen-lockfile
# "/" = same origin: nginx forwards /api to the backend container.
ARG VITE_API_URL=/
ARG VITE_DEMO_EMAIL=marta.kowalska@demo-outsourcing.pl
RUN VITE_API_URL=$VITE_API_URL VITE_DEMO_EMAIL=$VITE_DEMO_EMAIL pnpm --filter @kadreo/backoffice build

FROM nginx:1.27-alpine
COPY infra/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /src/apps/backoffice/dist /usr/share/nginx/html
EXPOSE 80
