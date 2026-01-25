# Cloud Run Keep-Warm Setup

This guide helps you eliminate cold starts on Google Cloud Run.

## Option 1: Cloud Scheduler (Recommended - Cost-Effective)

Cloud Scheduler pings your service every few minutes to keep instances warm.

### Step 1: Create a Service Account (Optional but Recommended)

```bash
# Create a service account for Cloud Scheduler
gcloud iam service-accounts create cloud-scheduler-invoker \
    --display-name="Cloud Scheduler Service Account"

# Grant the service account permission to invoke Cloud Run
gcloud run services add-iam-policy-binding YOUR_SERVICE_NAME \
    --region=YOUR_REGION \
    --member="serviceAccount:cloud-scheduler-invoker@YOUR_PROJECT_ID.iam.gserviceaccount.com" \
    --role="roles/run.invoker"
```

### Step 2: Create Cloud Scheduler Job

```bash
# Create a scheduler job that pings every 2 minutes
gcloud scheduler jobs create http keep-warm-job \
    --location=YOUR_REGION \
    --schedule="*/2 * * * *" \
    --uri="https://YOUR_CLOUD_RUN_URL/keep-warm" \
    --http-method=GET \
    --oidc-service-account-email="cloud-scheduler-invoker@YOUR_PROJECT_ID.iam.gserviceaccount.com" \
    --attempt-deadline=60s
```

**Replace these values:**
- `YOUR_SERVICE_NAME` - Your Cloud Run service name (e.g., `cpoint-app`)
- `YOUR_REGION` - Your region (e.g., `europe-west1`)
- `YOUR_PROJECT_ID` - Your GCP project ID
- `YOUR_CLOUD_RUN_URL` - Your Cloud Run URL (e.g., `https://cpoint-app-xxxxx.run.app`)

### Example Commands (for your setup):

```bash
# 1. Create service account
gcloud iam service-accounts create cloud-scheduler-invoker \
    --display-name="Cloud Scheduler Service Account"

# 2. Grant invoker permission
gcloud run services add-iam-policy-binding cpoint-app \
    --region=europe-west1 \
    --member="serviceAccount:cloud-scheduler-invoker@YOUR_PROJECT_ID.iam.gserviceaccount.com" \
    --role="roles/run.invoker"

# 3. Create the scheduler job (every 2 minutes)
gcloud scheduler jobs create http keep-warm-job \
    --location=europe-west1 \
    --schedule="*/2 * * * *" \
    --uri="https://YOUR_CLOUD_RUN_URL/keep-warm" \
    --http-method=GET \
    --oidc-service-account-email="cloud-scheduler-invoker@YOUR_PROJECT_ID.iam.gserviceaccount.com" \
    --attempt-deadline=60s
```

### Verify It's Working

```bash
# Check scheduler job status
gcloud scheduler jobs describe keep-warm-job --location=YOUR_REGION

# Manually trigger a run
gcloud scheduler jobs run keep-warm-job --location=YOUR_REGION

# View recent executions
gcloud scheduler jobs list --location=YOUR_REGION
```

---

## Option 2: Minimum Instances (Simplest - Higher Cost)

This keeps at least 1 instance running 24/7.

```bash
# Update your Cloud Run service to always have 1 instance
gcloud run services update YOUR_SERVICE_NAME \
    --region=YOUR_REGION \
    --min-instances=1
```

**Cost Impact:**
- Keeps 1 instance running 24/7 (~$25-50/month depending on CPU/memory)
- Completely eliminates cold starts
- Best if you have consistent traffic

---

## Option 3: Combined Approach (Best Performance)

Use both for optimal performance:

1. Set `--min-instances=1` for guaranteed warm instance
2. Add Cloud Scheduler as backup

```bash
# Set minimum instances
gcloud run services update YOUR_SERVICE_NAME \
    --region=YOUR_REGION \
    --min-instances=1

# Also create scheduler job for extra warmth
gcloud scheduler jobs create http keep-warm-job \
    --location=YOUR_REGION \
    --schedule="*/5 * * * *" \
    --uri="https://YOUR_CLOUD_RUN_URL/keep-warm" \
    --http-method=GET
```

---

## Quick Setup via Console (UI)

### Cloud Scheduler (Console):
1. Go to: https://console.cloud.google.com/cloudscheduler
2. Click "Create Job"
3. Fill in:
   - Name: `keep-warm-job`
   - Region: `europe-west1` (same as your Cloud Run)
   - Frequency: `*/2 * * * *` (every 2 minutes)
   - Target: HTTP
   - URL: `https://YOUR_CLOUD_RUN_URL/keep-warm`
   - HTTP Method: GET
   - Auth Header: Add OIDC token with your service account

### Minimum Instances (Console):
1. Go to: https://console.cloud.google.com/run
2. Click on your service
3. Click "Edit & Deploy New Revision"
4. Under "Container(s)", find "Minimum number of instances"
5. Set to `1`
6. Deploy

---

## Endpoints Available

| Endpoint | Purpose |
|----------|---------|
| `/health` | Basic health check (returns status) |
| `/keep-warm` | Keep-warm endpoint (also pings DB) |

---

## Troubleshooting

### Check if keep-warm is working:
```bash
curl https://YOUR_CLOUD_RUN_URL/keep-warm
```

Expected response:
```json
{"status": "warm", "timestamp": "2025-01-18T..."}
```

### View Cloud Run logs:
```bash
gcloud logging read "resource.type=cloud_run_revision AND resource.labels.service_name=YOUR_SERVICE_NAME" --limit=50
```

### Check for cold starts in logs:
Cold starts appear as logs with significantly longer response times on first request after idle period.

---

## Cost Comparison

| Method | Monthly Cost | Cold Start Elimination |
|--------|-------------|----------------------|
| Cloud Scheduler only | ~$0.10 | 95% (instances may still scale to 0 occasionally) |
| Min instances = 1 | ~$25-50 | 100% |
| Both combined | ~$25-50 | 100% + faster scale-up |

Choose based on your budget and performance requirements.
