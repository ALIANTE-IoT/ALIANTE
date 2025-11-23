# syntax=docker/dockerfile:1

FROM node:20-alpine AS build
WORKDIR /app

COPY package*.json ./
RUN npm install

COPY tsconfig*.json vite.config.ts index.html ./
COPY src ./src
COPY public ./public

ARG VITE_SERVIENTS
ARG VITE_POLL_INTERVAL_MS
ENV VITE_SERVIENTS=${VITE_SERVIENTS}
ENV VITE_POLL_INTERVAL_MS=${VITE_POLL_INTERVAL_MS}

RUN npm run build

FROM nginx:1.27-alpine AS runner
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
