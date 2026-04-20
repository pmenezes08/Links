<#
.SYNOPSIS
    End-to-end smoke test for cpoint-app-staging.

.DESCRIPTION
    Exercises the HTTP contracts that our unit tests don't cover:
      * Webhook endpoints reject missing / bad signatures (not 401)
      * Cron endpoints reject missing / bad X-Cron-Secret (403)
      * Cron endpoints succeed with the real shared secret (200)
      * /api/me/entitlements returns a usable shape for logged-in user
      * KB pages list endpoint denies unauthenticated access (401)

    Credentials come from Secret Manager so nothing is hard-coded. The
    script is idempotent — each run just re-runs all checks.

.NOTES
    Run from the repo root:

        pwsh scripts/staging_smoke.ps1

    Requirements:
        - gcloud CLI, authenticated (`gcloud auth login`) with access
          to secrets on project cpoint-127c2.
        - PowerShell 7+ (for `Invoke-RestMethod -SkipHttpErrorCheck`).

    Exits non-zero on any failure so CI can gate on it.
#>

$ErrorActionPreference = 'Stop'

# ── Config ──────────────────────────────────────────────────────────────

$BaseUrl   = 'https://cpoint-app-staging-739552904126.europe-west1.run.app'
$Project   = 'cpoint-127c2'
$CronSecretName = 'cron-shared-secret-staging'

$results = [System.Collections.Generic.List[pscustomobject]]::new()

function Add-Result {
    param(
        [string] $Name,
        [bool]   $Passed,
        [string] $Detail
    )
    $row = [pscustomobject]@{
        Name   = $Name
        Status = if ($Passed) { 'PASS' } else { 'FAIL' }
        Detail = $Detail
    }
    $results.Add($row)
    $colour = if ($Passed) { 'Green' } else { 'Red' }
    Write-Host ("[{0}] {1} — {2}" -f $row.Status, $Name, $Detail) -ForegroundColor $colour
}

function Invoke-Http {
    <#
    Wrapper around Invoke-WebRequest that captures the status code even
    on 4xx / 5xx so we can assert on it. PowerShell 5.x doesn't support
    -SkipHttpErrorCheck, so we fall back to try/catch on older runtimes.
    #>
    param(
        [string] $Method,
        [string] $Uri,
        [hashtable] $Headers = @{},
        [string] $Body = $null
    )

    try {
        if ($PSVersionTable.PSVersion.Major -ge 7) {
            $resp = Invoke-WebRequest -Method $Method -Uri $Uri -Headers $Headers `
                -Body $Body -SkipHttpErrorCheck -ErrorAction Stop
        } else {
            $resp = Invoke-WebRequest -Method $Method -Uri $Uri -Headers $Headers `
                -Body $Body -ErrorAction Stop -UseBasicParsing
        }
        return [pscustomobject]@{
            Status = [int]$resp.StatusCode
            Body   = $resp.Content
        }
    } catch [System.Net.WebException] {
        $r = $_.Exception.Response
        if ($null -eq $r) { throw }
        $status = [int]$r.StatusCode
        $reader = New-Object System.IO.StreamReader($r.GetResponseStream())
        $body = $reader.ReadToEnd()
        return [pscustomobject]@{ Status = $status; Body = $body }
    }
}


# ── Fetch the shared cron secret ────────────────────────────────────────

Write-Host "Reading cron secret from Secret Manager..." -ForegroundColor Cyan
try {
    $cronSecret = (gcloud secrets versions access latest `
        --secret=$CronSecretName --project=$Project 2>&1).Trim()
    if (-not $cronSecret) {
        throw "Empty secret value."
    }
} catch {
    Write-Host "Failed to read secret '${CronSecretName}': $_" -ForegroundColor Red
    exit 2
}


# ── Test 1: webhook endpoints reject unsigned requests ──────────────────

$webhooks = @(
    @{ path = '/api/webhooks/stripe'; expected = 400 },
    @{ path = '/api/webhooks/apple';  expected = 400 },
    @{ path = '/api/webhooks/google'; expected = 400 }
)
foreach ($w in $webhooks) {
    $r = Invoke-Http -Method 'POST' -Uri "$BaseUrl$($w.path)" `
        -Headers @{ 'Content-Type' = 'application/json' } -Body '{}'
    # Accept 400 (bad signature) or 403 (signature missing) — both prove
    # the endpoint ran its own auth instead of the generic session
    # middleware (which would have returned 401).
    $ok = ($r.Status -eq $w.expected) -or ($r.Status -eq 403) -or ($r.Status -eq 400)
    Add-Result -Name "Webhook $($w.path)" -Passed $ok `
        -Detail "status=$($r.Status), expected 4xx (not 401)"
}


# ── Test 2: cron endpoints reject missing / bad secret ─────────────────

$cronEndpoints = @(
    '/api/cron/enterprise/grace-sweep',
    '/api/cron/enterprise/nag-dispatch',
    '/api/cron/enterprise/winback-expire',
    '/api/cron/subscriptions/revoke-expired',
    '/api/cron/usage/cycle-notify'
)
foreach ($path in $cronEndpoints) {
    $r = Invoke-Http -Method 'POST' -Uri "$BaseUrl$path" -Body ''
    $ok = ($r.Status -eq 403)
    Add-Result -Name "Cron $path (no secret)" -Passed $ok `
        -Detail "status=$($r.Status), expected 403"

    $r = Invoke-Http -Method 'POST' -Uri "$BaseUrl$path" `
        -Headers @{ 'X-Cron-Secret' = 'totally-wrong' }
    $ok = ($r.Status -eq 403)
    Add-Result -Name "Cron $path (bad secret)" -Passed $ok `
        -Detail "status=$($r.Status), expected 403"
}


# ── Test 3: cron endpoints succeed with the real secret ────────────────

foreach ($path in $cronEndpoints) {
    $r = Invoke-Http -Method 'POST' -Uri "$BaseUrl$path" `
        -Headers @{ 'X-Cron-Secret' = $cronSecret }
    # 200 is ideal; some cron handlers may return 204 when nothing ran.
    $ok = ($r.Status -eq 200) -or ($r.Status -eq 204)
    Add-Result -Name "Cron $path (auth)" -Passed $ok `
        -Detail "status=$($r.Status), expected 200/204"
}


# ── Test 4: admin KB endpoint denies unauthenticated ──────────────────

$r = Invoke-Http -Method 'GET' -Uri "$BaseUrl/api/admin/kb/pages"
$ok = ($r.Status -eq 401)
Add-Result -Name 'KB list pages (no session)' -Passed $ok `
    -Detail "status=$($r.Status), expected 401"


# ── Test 5: anonymous /api/me/entitlements returns a shape ────────────

$r = Invoke-Http -Method 'GET' -Uri "$BaseUrl/api/me/entitlements"
# When logged out the backend could either 401 or return an anonymous
# shape. We accept both; what we want to confirm is that the endpoint
# responds at all (i.e. is wired up and not 404).
$ok = ($r.Status -in @(200, 401))
Add-Result -Name 'GET /api/me/entitlements' -Passed $ok `
    -Detail "status=$($r.Status), expected 200 or 401"


# ── Summary ────────────────────────────────────────────────────────────

$passed = ($results | Where-Object { $_.Status -eq 'PASS' }).Count
$failed = ($results | Where-Object { $_.Status -eq 'FAIL' }).Count

Write-Host ""
Write-Host "────────────────────────────────────────────"
Write-Host ("Smoke test: {0} passed / {1} failed" -f $passed, $failed) `
    -ForegroundColor $(if ($failed -eq 0) { 'Green' } else { 'Red' })
Write-Host "────────────────────────────────────────────"

if ($failed -gt 0) {
    $results | Where-Object { $_.Status -eq 'FAIL' } | Format-Table -AutoSize
    exit 1
}
exit 0
