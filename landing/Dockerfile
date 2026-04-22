# Dockerfile for C-Point Landing Page

# Build stage — produce fresh dist/ from source
FROM node:20-slim AS builder
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
COPY . .
RUN npm run build

# Runtime stage — Flask/gunicorn serving the built SPA
FROM python:3.11-slim
WORKDIR /app
RUN pip install --no-cache-dir flask gunicorn
COPY server.py /app/server.py
COPY --from=builder /app/dist /app/dist
EXPOSE 8080
CMD ["gunicorn", "--bind", "0.0.0.0:8080", "--workers", "2", "--threads", "4", "server:app"]
