# Wire production Cloud Run (cpoint-app) with Stripe secrets from Secret Manager.
#
# LIVE keys (required for real charges + live price IDs on /api/kb/pricing):
#   1. Open https://dashboard.stripe.com/apikeys (live mode toggle ON).
#   2. Set env vars below, then run this script.
#
#   $env:STRIPE_API_KEY = "sk_live_..."
#   $env:STRIPE_PUBLISHABLE_KEY = "pk_live_..."
#   $env:STRIPE_WEBHOOK_SECRET = "whsec_..."
#
# Without those env vars, copies staging test secrets so checkout works on prod
# (test mode only - rotate to live before marketing launch).

param(
    [string]$Project = "cpoint-127c2",
    [string]$Region = "europe-west1",
    [string]$Service = "cpoint-app"
)

$ErrorActionPreference = "Stop"

function Ensure-Secret {
    param([string]$Name, [string]$Value)
    $exists = $false
    try {
        gcloud secrets describe $Name --project=$Project 2>$null | Out-Null
        if ($LASTEXITCODE -eq 0) { $exists = $true }
    } catch {
        $exists = $false
    }
    if (-not $exists) {
        Write-Host "Creating secret $Name ..."
        $Value | gcloud secrets create $Name --project=$Project --data-file=-
    } else {
        Write-Host "Adding version to secret $Name ..."
        $Value | gcloud secrets versions add $Name --project=$Project --data-file=-
    }
}

function Get-SecretValue {
    param([string]$Name)
    gcloud secrets versions access latest --secret=$Name --project=$Project
}

if ($env:STRIPE_API_KEY -and $env:STRIPE_API_KEY.StartsWith("sk_live_")) {
    Write-Host "Using live STRIPE_API_KEY from environment."
    Ensure-Secret "stripe-api-key" $env:STRIPE_API_KEY
} else {
    Write-Warning "STRIPE_API_KEY not sk_live - copying staging test secret."
    $staging = Get-SecretValue "stripe-api-key-staging"
    Ensure-Secret "stripe-api-key" $staging
}

if ($env:STRIPE_PUBLISHABLE_KEY -and $env:STRIPE_PUBLISHABLE_KEY.StartsWith("pk_live_")) {
    Ensure-Secret "stripe-publishable-key" $env:STRIPE_PUBLISHABLE_KEY
} else {
    Write-Warning "STRIPE_PUBLISHABLE_KEY not pk_live - copying staging publishable key."
    $stagingPk = Get-SecretValue "stripe-publishable-key-staging"
    Ensure-Secret "stripe-publishable-key" $stagingPk
}

if ($env:STRIPE_WEBHOOK_SECRET) {
    Ensure-Secret "stripe-webhook-secret" $env:STRIPE_WEBHOOK_SECRET
} else {
    Write-Warning "STRIPE_WEBHOOK_SECRET not set - copying staging webhook secret."
    $stagingWh = Get-SecretValue "stripe-webhook-secret-staging"
    Ensure-Secret "stripe-webhook-secret" $stagingWh
}

$Sa = "739552904126-compute@developer.gserviceaccount.com"
foreach ($SecretName in @("stripe-api-key", "stripe-publishable-key", "stripe-webhook-secret")) {
    gcloud secrets add-iam-policy-binding $SecretName `
        --project=$Project `
        --member="serviceAccount:$Sa" `
        --role="roles/secretmanager.secretAccessor" | Out-Null
}

Write-Host "Updating Cloud Run service $Service (remove legacy plain env, then mount secrets)..."
foreach ($var in @("STRIPE_API_KEY", "STRIPE_PERISHABLE_KEY", "STRIPE_PUBLISHABLE_KEY", "STRIPE_WEBHOOK_SECRET")) {
    gcloud run services update $Service `
        --project=$Project `
        --region=$Region `
        --remove-env-vars=$var 2>$null | Out-Null
}
gcloud run services update $Service `
    --project=$Project `
    --region=$Region `
    --update-secrets="STRIPE_API_KEY=stripe-api-key:latest,STRIPE_PUBLISHABLE_KEY=stripe-publishable-key:latest,STRIPE_WEBHOOK_SECRET=stripe-webhook-secret:latest"

Write-Host "Done. Use sk_live keys in Secret Manager for live billing on app.c-point.co."
