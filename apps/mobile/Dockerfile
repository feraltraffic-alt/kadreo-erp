# Kadreo mobile app, web build (Expo, react-native-web) served by nginx; /api proxied to the backend.
# The same code runs on iOS and Android (dev client / EAS build); the web build is for the stand and tests.
# Build from the repository root: docker build -f apps/mobile/Dockerfile .
FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /src
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY packages packages
COPY apps/mobile apps/mobile
RUN pnpm install --frozen-lockfile --filter @kadreo/mobile...
# "/" = same origin: nginx forwards /api to the backend container. DEMO=1: simulated GPS on the stand.
ARG EXPO_PUBLIC_API_URL=/
ARG EXPO_PUBLIC_DEMO=1
RUN cd apps/mobile && EXPO_PUBLIC_API_URL=$EXPO_PUBLIC_API_URL EXPO_PUBLIC_DEMO=$EXPO_PUBLIC_DEMO npx expo export --platform web --output-dir dist

FROM nginx:1.27-alpine
COPY infra/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /src/apps/mobile/dist /usr/share/nginx/html
EXPOSE 80
