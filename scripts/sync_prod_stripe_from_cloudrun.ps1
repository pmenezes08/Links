# Copy live Stripe values from cpoint-app plain env vars into Secret Manager,
# fix STRIPE_PERISHABLE_KEY -> STRIPE_PUBLISHABLE_KEY, and mount secrets on Cloud Run.

param(
    [string]$Project = "cpoint-127c2",
    [string]$Region = "europe-west1",
    [string]$Service = "cpoint-app"
)

$ErrorActionPreference = "Stop"

function Ensure-Secret {
    param([string]$Name, [string]$Value)
    gcloud secrets describe $Name --project=$Project 2>$null | Out-Null
    if ($LASTEXITCODE -ne 0) {
        $Value | gcloud secrets create $Name --project=$Project --data-file=-
    } else {
        $Value | gcloud secrets versions add $Name --project=$Project --data-file=-
    }
}

$json = gcloud run services describe $Service --region=$Region --project=$Project --format=json | Out-String
$parsed = $json | python -c @"
import json, sys
d = json.load(sys.stdin)
env = d['spec']['template']['spec']['containers'][0].get('env', [])
by = {e.get('name'): e.get('value', '') for e in env if 'value' in e}
api = (by.get('STRIPE_API_KEY') or '').strip()
pk = (by.get('STRIPE_PUBLISHABLE_KEY') or by.get('STRIPE_PERISHABLE_KEY') or '').strip()
wh = (by.get('STRIPE_WEBHOOK_SECRET') or '').strip()
if not api.startswith('sk_live_'):
    raise SystemExit('STRIPE_API_KEY on Cloud Run is not sk_live_*')
if not pk.startswith('pk_live_'):
    raise SystemExit('Publishable key on Cloud Run is not pk_live_*')
if not wh.startswith('whsec_'):
    raise SystemExit('STRIPE_WEBHOOK_SECRET on Cloud Run is not whsec_*')
print(api)
print(pk)
print(wh)
"@

if ($LASTEXITCODE -ne 0) { throw "Failed to read Stripe env from Cloud Run." }

$lines = ($parsed -split "`n").Where({ $_ -ne "" })
$apiKey = $lines[0].Trim()
$pubKey = $lines[1].Trim()
$whsec = $lines[2].Trim()

Write-Host "Read sk_live / pk_live / whsec from $Service (values not logged)."
Write-Host "Adding Secret Manager versions..."
Ensure-Secret "stripe-api-key" $apiKey
Ensure-Secret "stripe-publishable-key" $pubKey
Ensure-Secret "stripe-webhook-secret" $whsec

$Sa = "739552904126-compute@developer.gserviceaccount.com"
foreach ($SecretName in @("stripe-api-key", "stripe-publishable-key", "stripe-webhook-secret")) {
    gcloud secrets add-iam-policy-binding $SecretName `
        --project=$Project `
        --member="serviceAccount:$Sa" `
        --role="roles/secretmanager.secretAccessor" | Out-Null
}

Write-Host "Removing plain Stripe env vars (one at a time — batch remove is unreliable on Windows)..."
foreach ($var in @("STRIPE_API_KEY", "STRIPE_PERISHABLE_KEY", "STRIPE_PUBLISHABLE_KEY", "STRIPE_WEBHOOK_SECRET")) {
    gcloud run services update $Service `
        --project=$Project `
        --region=$Region `
        --remove-env-vars=$var 2>$null | Out-Null
}

Write-Host "Mounting Stripe secrets on $Service..."
gcloud run services update $Service `
    --project=$Project `
    --region=$Region `
    --update-secrets="STRIPE_API_KEY=stripe-api-key:latest,STRIPE_PUBLISHABLE_KEY=stripe-publishable-key:latest,STRIPE_WEBHOOK_SECRET=stripe-webhook-secret:latest"

Write-Host "Done. $Service uses STRIPE_PUBLISHABLE_KEY from Secret Manager."
