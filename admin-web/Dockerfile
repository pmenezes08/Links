# Build stage
FROM node:20-slim AS builder
WORKDIR /app

ARG VITE_API_BASE=
ENV VITE_API_BASE=${VITE_API_BASE}

COPY package.json package-lock.json* ./
RUN npm install
COPY . .
RUN npm run build

# Serve stage
FROM nginx:alpine
ARG API_PROXY_ORIGIN=https://app.c-point.co
ARG API_PROXY_HOST=app.c-point.co
ENV API_PROXY_ORIGIN=${API_PROXY_ORIGIN}
ENV API_PROXY_HOST=${API_PROXY_HOST}
COPY --from=builder /app/dist /usr/share/nginx/html
COPY admin-nginx.conf.template /etc/nginx/templates/default.conf.template
EXPOSE 8080
CMD ["nginx", "-g", "daemon off;"]
