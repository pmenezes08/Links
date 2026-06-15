#!/usr/bin/env bash
# Wire Secret Manager refs onto production Cloud Run (cpoint-app).
# Safe to re-run: only updates secret bindings, does not change the image.
#
# Usage (repo root):
#   bash scripts/wire_prod_cloud_run_secrets.sh
#
# Called automatically from cloudbuild-production.yaml after image deploy.

set -euo pipefail

PROJECT="${GCP_PROJECT:-cpoint-127c2}"
REGION="${GCP_REGION:-europe-west1}"
SERVICE="${CLOUD_RUN_SERVICE:-cpoint-app}"

# Keep in sync with docs/PROD_CLOUD_RUN_RECOVERY.md
UPDATE_SECRETS="MYSQL_PASSWORD=mysql-password:latest"
UPDATE_SECRETS+=",FLASK_SECRET_KEY=flask-secret-key:latest"
UPDATE_SECRETS+=",CLOUDFLARE_R2_SECRET_KEY=r2-secret-key:latest"
UPDATE_SECRETS+=",VAPID_PRIVATE_KEY=vapid-private-key:latest"
UPDATE_SECRETS+=",RESEND_API_KEY=resend-api-key:latest"
UPDATE_SECRETS+=",OPENAI_API_KEY=openai-api-key:latest"
UPDATE_SECRETS+=",REDIS_PASSWORD=redis-password:latest"
UPDATE_SECRETS+=",CRON_SHARED_SECRET=cron-shared-secret:latest"
UPDATE_SECRETS+=",STRIPE_API_KEY=stripe-api-key:latest"
UPDATE_SECRETS+=",STRIPE_PUBLISHABLE_KEY=stripe-publishable-key:latest"
UPDATE_SECRETS+=",STRIPE_WEBHOOK_SECRET=stripe-webhook-secret:latest"
UPDATE_SECRETS+=",GOOGLE_PLAY_SERVICE_ACCOUNT_JSON=google-play-service-account-json:latest"
UPDATE_SECRETS+=",APPLE_IAP_KEY_ID=apple-iap-key-id:latest"
UPDATE_SECRETS+=",APPLE_IAP_ISSUER_ID=apple-iap-issuer-id:latest"
UPDATE_SECRETS+=",APPLE_IAP_PRIVATE_KEY=apple-iap-private-key:latest"

echo "Updating ${SERVICE} (${PROJECT}/${REGION}) secret bindings..."
gcloud run services update "${SERVICE}" \
  --project="${PROJECT}" \
  --region="${REGION}" \
  --update-secrets="${UPDATE_SECRETS}"

echo "Done. Run: bash scripts/smoke_prod.sh"
