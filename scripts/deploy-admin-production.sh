#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-cpoint-127c2}"
REGION="${REGION:-europe-west1}"
SERVICE_NAME="${SERVICE_NAME:-cpoint-admin}"
IMAGE="gcr.io/${PROJECT_ID}/${SERVICE_NAME}:latest"
API_BASE="${API_BASE:-https://app.c-point.co}"
BUILD_CONFIG="$(mktemp /tmp/cloudbuild-admin-production.XXXXXX.yaml)"

cleanup() {
  rm -f "${BUILD_CONFIG}"
}
trap cleanup EXIT

echo "Setting gcloud project to ${PROJECT_ID}..."
gcloud config set project "${PROJECT_ID}"

cat > "${BUILD_CONFIG}" <<EOF
steps:
  - name: 'gcr.io/cloud-builders/docker'
    args:
      - 'build'
      - '--build-arg=VITE_API_BASE=${API_BASE}'
      - '-t'
      - '${IMAGE}'
      - '-f'
      - 'admin-web/Dockerfile'
      - 'admin-web'

  - name: 'gcr.io/cloud-builders/docker'
    args:
      - 'push'
      - '${IMAGE}'

  - name: 'google/cloud-sdk:slim'
    entrypoint: 'gcloud'
    args:
      - 'run'
      - 'deploy'
      - '${SERVICE_NAME}'
      - '--image=${IMAGE}'
      - '--region=${REGION}'
      - '--platform=managed'
      - '--allow-unauthenticated'

options:
  machineType: 'E2_HIGHCPU_8'
  logging: CLOUD_LOGGING_ONLY
EOF

echo "Deploying ${SERVICE_NAME} with API base ${API_BASE}..."
gcloud builds submit --config="${BUILD_CONFIG}" .

echo
echo "Deployment complete. Service URL:"
gcloud run services describe "${SERVICE_NAME}" --region="${REGION}" --format='value(status.url)'
