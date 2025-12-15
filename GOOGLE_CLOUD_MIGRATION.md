# C.Point: PythonAnywhere to Google Cloud Migration Guide

This guide walks through migrating the C.Point app from PythonAnywhere to Google Cloud Platform, including updating the iOS Capacitor app.

## Table of Contents
1. [Prerequisites](#1-prerequisites)
2. [Google Cloud Setup](#2-google-cloud-setup)
3. [Database Migration](#3-database-migration)
4. [Deploy to Cloud Run](#4-deploy-to-cloud-run)
5. [Set Up Custom Domain](#5-set-up-custom-domain)
6. [iOS App Update](#6-ios-app-update)
7. [Post-Migration Checklist](#7-post-migration-checklist)
8. [Cost Optimization](#8-cost-optimization)
9. [Rollback Plan](#9-rollback-plan)

---

## 1. Prerequisites

### Install Required Tools

```bash
# macOS
brew install google-cloud-sdk
brew install mysql-client

# Linux
curl https://sdk.cloud.google.com | bash
exec -l $SHELL
sudo apt install mysql-client

# Verify installation
gcloud version
```

### Ensure You Have
- [ ] Google account for Cloud Console
- [ ] Credit card for billing (you get $300 free credits)
- [ ] Access to your domain's DNS settings
- [ ] Xcode installed (for iOS app update)
- [ ] Apple Developer account access

---

## 2. Google Cloud Setup

### 2.1 Create Account & Project

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Sign in with your Google account
3. If prompted, set up billing (you get $300 free credits for 90 days)
4. Create a new project:
   ```bash
   gcloud projects create cpoint-production --name="C.Point Production"
   gcloud config set project cpoint-production
   ```

### 2.2 Enable Required APIs

```bash
gcloud services enable \
    run.googleapis.com \
    sqladmin.googleapis.com \
    secretmanager.googleapis.com \
    cloudbuild.googleapis.com \
    containerregistry.googleapis.com
```

### 2.3 Set Up Cloud SQL (MySQL)

```bash
# Create MySQL 8.0 instance
gcloud sql instances create cpoint-db \
    --database-version=MYSQL_8_0 \
    --tier=db-f1-micro \
    --region=us-central1 \
    --root-password=YOUR_ROOT_PASSWORD \
    --storage-size=10GB \
    --storage-auto-increase

# Create the database
gcloud sql databases create cpoint --instance=cpoint-db

# Create application user
gcloud sql users create app_user \
    --instance=cpoint-db \
    --password=YOUR_APP_USER_PASSWORD
```

**Save these credentials! You'll need them later.**

### 2.4 Set Up Secret Manager

```bash
# Store sensitive credentials securely
echo -n "YOUR_FLASK_SECRET_KEY" | \
    gcloud secrets create flask-secret-key --data-file=-

echo -n "YOUR_APP_USER_PASSWORD" | \
    gcloud secrets create mysql-password --data-file=-

echo -n "YOUR_STRIPE_KEY" | \
    gcloud secrets create stripe-api-key --data-file=-

# Add your Firebase credentials JSON
gcloud secrets create firebase-credentials \
    --data-file=/path/to/firebase-credentials.json
```

---

## 3. Database Migration

### 3.1 Export from PythonAnywhere

SSH into PythonAnywhere or use their MySQL console:

```bash
# Export the database
mysqldump -h puntz08.mysql.pythonanywhere-services.com \
    -u puntz08 \
    -p \
    'puntz08$C-Point' > cpoint_backup.sql
```

Or use the PythonAnywhere web interface:
1. Go to Databases tab
2. Click on your database
3. Use phpMyAdmin to export

### 3.2 Import to Cloud SQL

```bash
# Get the Cloud SQL instance connection name
gcloud sql instances describe cpoint-db --format='value(connectionName)'
# Output: PROJECT_ID:us-central1:cpoint-db

# Option 1: Import via Cloud Storage (recommended for large databases)
# First upload to Cloud Storage
gsutil mb gs://cpoint-migration-temp
gsutil cp cpoint_backup.sql gs://cpoint-migration-temp/

# Grant Cloud SQL access to the bucket
SA_EMAIL=$(gcloud sql instances describe cpoint-db --format='value(serviceAccountEmailAddress)')
gsutil iam ch serviceAccount:${SA_EMAIL}:objectViewer gs://cpoint-migration-temp

# Import
gcloud sql import sql cpoint-db gs://cpoint-migration-temp/cpoint_backup.sql \
    --database=cpoint

# Option 2: Direct import via Cloud SQL Proxy (for smaller databases)
# Download and run Cloud SQL Proxy
curl -o cloud-sql-proxy https://storage.googleapis.com/cloud-sql-connectors/cloud-sql-proxy/v2.8.0/cloud-sql-proxy.linux.amd64
chmod +x cloud-sql-proxy
./cloud-sql-proxy PROJECT_ID:us-central1:cpoint-db &

# Then import via mysql client
mysql -h 127.0.0.1 -u root -p cpoint < cpoint_backup.sql
```

### 3.3 Verify Migration

```bash
# Connect to Cloud SQL
./cloud-sql-proxy PROJECT_ID:us-central1:cpoint-db &
mysql -h 127.0.0.1 -u app_user -p cpoint

# Check tables
SHOW TABLES;
SELECT COUNT(*) FROM users;
SELECT COUNT(*) FROM communities;
```

---

## 4. Deploy to Cloud Run

### 4.1 Build the Frontend

```bash
cd client
npm install
npm run build
cd ..
```

### 4.2 Build and Push Docker Image

```bash
# Build the image
gcloud builds submit --tag gcr.io/cpoint-production/cpoint-app

# Or build locally and push
docker build -t gcr.io/cpoint-production/cpoint-app .
docker push gcr.io/cpoint-production/cpoint-app
```

### 4.3 Deploy to Cloud Run

```bash
# Get your project number (needed for service account)
PROJECT_NUMBER=$(gcloud projects describe cpoint-production --format='value(projectNumber)')

# Grant Secret Manager access to Cloud Run service account
gcloud secrets add-iam-policy-binding flask-secret-key \
    --member="serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
    --role="roles/secretmanager.secretAccessor"

gcloud secrets add-iam-policy-binding mysql-password \
    --member="serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
    --role="roles/secretmanager.secretAccessor"

# Deploy
gcloud run deploy cpoint-app \
    --image gcr.io/cpoint-production/cpoint-app \
    --platform managed \
    --region us-central1 \
    --allow-unauthenticated \
    --add-cloudsql-instances cpoint-production:us-central1:cpoint-db \
    --memory 1Gi \
    --cpu 1 \
    --min-instances 0 \
    --max-instances 10 \
    --timeout 300 \
    --set-env-vars "FLASK_ENV=production" \
    --set-env-vars "USE_MYSQL=true" \
    --set-env-vars "MYSQL_HOST=/cloudsql/cpoint-production:us-central1:cpoint-db" \
    --set-env-vars "MYSQL_USER=app_user" \
    --set-env-vars "MYSQL_DB=cpoint" \
    --set-secrets "FLASK_SECRET_KEY=flask-secret-key:latest" \
    --set-secrets "MYSQL_PASSWORD=mysql-password:latest" \
    --set-secrets "STRIPE_API_KEY=stripe-api-key:latest"
```

### 4.4 Test the Deployment

```bash
# Get the Cloud Run URL
gcloud run services describe cpoint-app --region us-central1 --format='value(status.url)'

# Test health endpoint
curl https://cpoint-app-xxxxx-uc.a.run.app/health
```

---

## 5. Set Up Custom Domain

### 5.1 Map Domain to Cloud Run

```bash
gcloud run domain-mappings create \
    --service cpoint-app \
    --domain app.c-point.co \
    --region us-central1
```

### 5.2 Configure DNS

The command above will show you the required DNS records. Add these to your domain registrar:

| Type | Name | Value |
|------|------|-------|
| CNAME | app | ghs.googlehosted.com |

Or for apex domain:
| Type | Name | Value |
|------|------|-------|
| A | @ | (IP addresses shown by gcloud) |

### 5.3 Verify SSL Certificate

SSL is automatically provisioned. Check status:
```bash
gcloud run domain-mappings describe \
    --domain app.c-point.co \
    --region us-central1
```

---

## 6. iOS App Update

### 6.1 Update Capacitor Config (If Changing Domain)

If your domain stays the same (`app.c-point.co`), **no changes needed** to capacitor.config.ts.

If you're using a new domain, update `client/capacitor.config.ts`:

```typescript
const config: CapacitorConfig = {
  appId: 'co.cpoint.app',
  appName: 'C.Point',
  webDir: 'dist',
  server: {
    url: 'https://app.c-point.co',  // Update if domain changes
    cleartext: false,
  },
  // ... rest of config
};
```

### 6.2 Rebuild iOS App

```bash
cd client

# Ensure frontend is built
npm run build

# Sync with iOS project
npx cap sync ios

# Open in Xcode
npx cap open ios
```

### 6.3 In Xcode

1. **Update Version Number**:
   - Select the App target
   - Go to "General" tab
   - Increment the Version (e.g., 1.2.0 → 1.3.0) and Build number

2. **Verify Signing**:
   - Go to "Signing & Capabilities"
   - Ensure your Team is selected
   - Bundle Identifier should be `co.cpoint.app`

3. **Check Associated Domains** (for Universal Links):
   - In "Signing & Capabilities"
   - Verify `applinks:app.c-point.co` is present

4. **Archive and Upload**:
   - Select "Any iOS Device" as build target
   - Product → Archive
   - Once complete, click "Distribute App"
   - Choose "App Store Connect"
   - Upload

### 6.4 App Store Connect

1. Go to [App Store Connect](https://appstoreconnect.apple.com)
2. Select your app
3. Create a new version if needed
4. Select the uploaded build
5. Add release notes mentioning backend improvements
6. Submit for review

### 6.5 Update AASA File (If Needed)

The Apple App Site Association file at `static/.well-known/apple-app-site-association` should still work. Verify it's accessible:

```bash
curl https://app.c-point.co/.well-known/apple-app-site-association
```

---

## 7. Post-Migration Checklist

### Critical Tests

- [ ] **User Authentication**
  - [ ] Login works
  - [ ] Signup works
  - [ ] Password reset works

- [ ] **Core Features**
  - [ ] Communities load
  - [ ] Posts display correctly
  - [ ] Creating posts works
  - [ ] Comments/replies work
  - [ ] Stories upload and display

- [ ] **Media**
  - [ ] Images upload
  - [ ] Videos upload
  - [ ] CDN URLs work

- [ ] **Push Notifications**
  - [ ] Web push works
  - [ ] iOS push works

- [ ] **Payments**
  - [ ] Stripe checkout works (use test mode first!)

- [ ] **iOS App**
  - [ ] App connects to backend
  - [ ] All features work
  - [ ] Universal links work

### Monitoring Setup

```bash
# Set up error alerting
gcloud monitoring alert-policies create \
    --display-name="Cloud Run Error Rate" \
    --condition-display-name="Error rate > 1%" \
    --condition-filter='resource.type="cloud_run_revision" AND metric.type="run.googleapis.com/request_count" AND metric.labels.response_code_class="5xx"'

# View logs
gcloud logging read "resource.type=cloud_run_revision" --limit 50
```

---

## 8. Cost Optimization

### Estimated Monthly Costs

| Service | Configuration | Est. Cost |
|---------|--------------|-----------|
| Cloud Run | 0-10 instances, 1 CPU, 1GB RAM | $0-50 |
| Cloud SQL | db-f1-micro (shared) | $7-10 |
| Secret Manager | ~10 secrets | <$1 |
| Cloud Storage | 10GB | <$1 |
| **Total** | | **~$10-60/month** |

### Cost-Saving Tips

1. **Use min-instances=0**: Scales to zero when not in use
2. **Use Redis Cloud free tier** instead of Memorystore
3. **Keep Cloud SQL on db-f1-micro** (smallest tier)
4. **Set up budget alerts**:
   ```bash
   gcloud billing budgets create \
       --billing-account=BILLING_ACCOUNT_ID \
       --display-name="C.Point Budget" \
       --budget-amount=50USD \
       --threshold-rule=percent=50 \
       --threshold-rule=percent=90
   ```

---

## 9. Rollback Plan

If something goes wrong, you can quickly rollback:

### Revert to PythonAnywhere

1. Your PythonAnywhere deployment should still be running
2. Update DNS to point back to PythonAnywhere:
   ```
   app.c-point.co → CNAME → puntz08.pythonanywhere.com
   ```
3. Wait for DNS propagation (5-30 minutes)

### Rollback Cloud Run Deployment

```bash
# List revisions
gcloud run revisions list --service cpoint-app --region us-central1

# Route traffic to previous revision
gcloud run services update-traffic cpoint-app \
    --region us-central1 \
    --to-revisions PREVIOUS_REVISION=100
```

---

## Quick Reference Commands

```bash
# View Cloud Run logs
gcloud logging read "resource.type=cloud_run_revision AND resource.labels.service_name=cpoint-app" --limit 100

# SSH to Cloud SQL (via proxy)
./cloud-sql-proxy cpoint-production:us-central1:cpoint-db &
mysql -h 127.0.0.1 -u app_user -p cpoint

# Redeploy after code changes
cd client && npm run build && cd ..
gcloud builds submit --tag gcr.io/cpoint-production/cpoint-app
gcloud run deploy cpoint-app --image gcr.io/cpoint-production/cpoint-app --region us-central1

# Check service status
gcloud run services describe cpoint-app --region us-central1

# View secret values (careful!)
gcloud secrets versions access latest --secret=flask-secret-key
```

---

## Support

If you encounter issues:
1. Check Cloud Run logs: `gcloud logging read "resource.type=cloud_run_revision" --limit 50`
2. Verify environment variables are set correctly
3. Test database connection independently
4. Check the `/health` endpoint

Good luck with your migration! 🚀
