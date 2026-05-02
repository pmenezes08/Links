#requires -Version 5.0
<#
.SYNOPSIS
  PR 2 smoke test: verify /api/profile_me returns a `login_id`, /api/check_admin
  is anonymous-safe, and /logout flushes site data.

.DESCRIPTION
  Run after `gcloud builds submit` finishes. Exits non-zero if any required
  contract is broken.

  The endpoints we call here go through the new blueprints:
  - /api/profile_me  -> backend/blueprints/profile_me.py
  - /api/check_admin -> backend/blueprints/me.py

  Unauthenticated calls are expected; we only validate response shape, status,
  and headers. The full login_id round-trip is covered by tests/test_login_epoch.py.

.PARAMETER BaseUrl
  Staging URL, e.g. https://cpoint-app-staging-xyz.europe-west1.run.app

.EXAMPLE
  .\scripts\smoke\pr2_login_epoch.ps1 -BaseUrl https://cpoint-app-staging-739552904126.europe-west1.run.app
#>

param(
    [Parameter(Mandatory = $true)]
    [string]$BaseUrl
)

$ErrorActionPreference = 'Stop'
$BaseUrl = $BaseUrl.TrimEnd('/')

$failures = @()

Write-Host "PR 2 smoke: $BaseUrl" -ForegroundColor Cyan

# 1. /api/check_admin must be registered (not 404) and must NOT 200 with is_admin
#    info to an anonymous caller. The global `_block_unverified_users` gate
#    intercepts before the blueprint and returns 401 for unauthenticated calls,
#    which is the desired behaviour: the client tolerates 401 and falls back to
#    "not admin" (see PremiumDashboard.tsx). We just want to make sure:
#      a) the route still exists,
#      b) it never leaks an authenticated payload to anonymous callers.
Write-Host "  checking /api/check_admin (anonymous)"
try {
    $resp = Invoke-WebRequest -Uri "$BaseUrl/api/check_admin" -Method Get -MaximumRedirection 0 -UseBasicParsing -ErrorAction Stop
    if ($resp.StatusCode -eq 200) {
        # If the gate ever opens for anonymous, make sure the body cannot reveal
        # admin state — only is_admin:false is acceptable.
        $body = $null
        try { $body = $resp.Content | ConvertFrom-Json } catch {}
        if ($null -ne $body -and $body.is_admin -eq $true) {
            $failures += "LEAK: /api/check_admin returned is_admin=true to anonymous caller"
        }
    }
} catch [System.Net.WebException] {
    $resp = $_.Exception.Response
    $code = [int]$resp.StatusCode
    if ($code -eq 404) {
        $failures += "REGRESSED: /api/check_admin returned 404 (blueprint not registered?)"
    } elseif ($code -ne 401 -and $code -ne 302 -and $code -ne 403) {
        $failures += "WRONG STATUS: /api/check_admin anonymous returned $code; expected 401/403/302"
    }
}

# 2. /api/profile_me must require auth: anonymous calls should 401 (or 302 redirect
#    to login). It must NOT 200 with someone else's profile.
Write-Host "  checking /api/profile_me (anonymous)"
try {
    $resp = Invoke-WebRequest -Uri "$BaseUrl/api/profile_me" -Method Get -MaximumRedirection 0 -UseBasicParsing -ErrorAction Stop
    if ($resp.StatusCode -eq 200) {
        $failures += "LEAK: /api/profile_me returned 200 to anonymous caller (body=$($resp.Content))"
    }
} catch [System.Net.WebException] {
    $resp = $_.Exception.Response
    $code = [int]$resp.StatusCode
    if ($code -ne 302 -and $code -ne 401 -and $code -ne 403) {
        $failures += "WRONG STATUS: /api/profile_me anonymous returned $code; expected 302/401/403"
    }
}

# 3. /logout must continue to emit Clear-Site-Data (PR 1 invariant; we re-check
#    here because PR 2 reshuffled the auth blueprint and could have regressed it).
Write-Host "  checking /logout Clear-Site-Data still present"
$curlExe = (Get-Command curl.exe -ErrorAction SilentlyContinue).Source
if (-not $curlExe) {
    $failures += "SKIPPED: /logout check (curl.exe not on PATH)"
} else {
    $headOutput = & $curlExe -I -s "$BaseUrl/logout" 2>&1
    if (-not ($headOutput -match '(?im)^clear-site-data:\s*"cache".*"cookies".*"storage"')) {
        $failures += "REGRESSED: /logout response no longer includes Clear-Site-Data"
    }
}

# 4. The signed-in /api/profile_me response shape is asserted by Python tests.
#    Here we sanity-check that the route is registered (returns a recognisable
#    auth-required response, not a 404 from a missing blueprint).
Write-Host "  checking /api/profile_me is registered (not 404)"
try {
    $resp = Invoke-WebRequest -Uri "$BaseUrl/api/profile_me" -Method Get -MaximumRedirection 0 -UseBasicParsing -ErrorAction Stop
    if ($resp.StatusCode -eq 404) {
        $failures += "REGRESSED: /api/profile_me returned 404 (blueprint not registered?)"
    }
} catch [System.Net.WebException] {
    $resp = $_.Exception.Response
    $code = [int]$resp.StatusCode
    if ($code -eq 404) {
        $failures += "REGRESSED: /api/profile_me returned 404 (blueprint not registered?)"
    }
}

if ($failures.Count -gt 0) {
    Write-Host "`nSMOKE FAILED:" -ForegroundColor Red
    foreach ($f in $failures) { Write-Host "  $f" -ForegroundColor Red }
    exit 1
}

Write-Host "`nAll PR 2 login-epoch / blueprint invariants OK." -ForegroundColor Green
exit 0
