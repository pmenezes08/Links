#requires -Version 5.0
<#
.SYNOPSIS
  PR 1 smoke test: verify Cache-Control: no-store on authenticated /api/* and
  Clear-Site-Data on /logout against a deployed staging URL.

.DESCRIPTION
  Run after `gcloud builds submit` finishes. Exits non-zero if any required
  header is missing so CI/manual runs can gate on it.

  This script is unauthenticated by design — it only checks the response
  headers, not body content. The auth-gated endpoints will return 302/401,
  but the after-request hooks still attach the cache headers, which is the
  invariant we care about for the leak fix.

.PARAMETER BaseUrl
  Staging URL, e.g. https://cpoint-app-staging-xyz.europe-west1.run.app

.EXAMPLE
  .\scripts\smoke\pr1_cache_headers.ps1 -BaseUrl https://cpoint-app-staging-xyz.europe-west1.run.app
#>

param(
    [Parameter(Mandatory = $true)]
    [string]$BaseUrl
)

$ErrorActionPreference = 'Stop'
$BaseUrl = $BaseUrl.TrimEnd('/')

# Endpoints that MUST return Cache-Control: no-store regardless of auth state.
# Each is tested with HEAD when possible and GET otherwise; we only inspect
# headers, never the body.
$AuthenticatedEndpoints = @(
    '/api/me/entitlements',
    '/api/me/billing',
    '/api/me/ai-usage',
    '/api/chat_threads',
    '/api/group_chat/list',
    '/api/notifications',
    '/api/check_admin',
    '/api/admin/users',
    '/api/profile_me',
    '/api/onboarding/state',
    '/api/dashboard_unread_feed',
    '/api/user_communities_hierarchical',
    '/api/premium_dashboard_summary'
)

# Endpoints that should NOT carry no-store (truly public).
$PublicEndpoints = @(
    '/api/stripe/config',
    '/api/kb/pricing',
    '/api/push/public_key',
    '/api/about/tutorial_videos'
)

$failures = @()

function Test-Header {
    param(
        [string]$Url,
        [string]$ExpectedDirective,
        [bool]$ShouldContain
    )

    try {
        $resp = Invoke-WebRequest -Uri $Url -Method Get -MaximumRedirection 0 -UseBasicParsing -ErrorAction Stop
    } catch [System.Net.WebException] {
        $resp = $_.Exception.Response
        if ($resp -isnot [System.Net.HttpWebResponse]) { throw }
    }

    $headerValue = ''
    if ($resp.Headers) {
        $headerValue = ($resp.Headers['Cache-Control'] | Out-String).Trim().ToLowerInvariant()
    } elseif ($resp.RawContentStream) {
        # Invoke-WebRequest caught a 4xx/5xx — pull headers from the inner response.
        $headerValue = ($resp.GetResponseHeader('Cache-Control') | Out-String).Trim().ToLowerInvariant()
    }

    $present = $headerValue.Contains($ExpectedDirective.ToLowerInvariant())
    if ($ShouldContain -and -not $present) {
        return "MISSING: $Url has Cache-Control='$headerValue'; expected '$ExpectedDirective'"
    }
    if ((-not $ShouldContain) -and $present) {
        return "UNEXPECTED: $Url has Cache-Control='$headerValue'; should NOT contain '$ExpectedDirective'"
    }
    return $null
}

Write-Host "PR 1 smoke: $BaseUrl" -ForegroundColor Cyan

foreach ($path in $AuthenticatedEndpoints) {
    $url = "$BaseUrl$path"
    Write-Host "  checking no-store on $path"
    $err = Test-Header -Url $url -ExpectedDirective 'no-store' -ShouldContain $true
    if ($err) { $failures += $err }
}

foreach ($path in $PublicEndpoints) {
    $url = "$BaseUrl$path"
    Write-Host "  checking absence of no-store on $path"
    $err = Test-Header -Url $url -ExpectedDirective 'no-store' -ShouldContain $false
    if ($err) { $failures += $err }
}

# /logout must redirect AND carry Clear-Site-Data.
# We use curl rather than Invoke-WebRequest because PowerShell's web cmdlet
# refuses to surface the headers of a 30x response cleanly (it follows by
# default, and -MaximumRedirection 0 still throws). curl's `-I` returns the
# raw response head we actually want to inspect.
Write-Host "  checking /logout Clear-Site-Data"
$curlExe = (Get-Command curl.exe -ErrorAction SilentlyContinue).Source
if (-not $curlExe) {
    $failures += "SKIPPED: /logout check (curl.exe not on PATH)"
} else {
    $headOutput = & $curlExe -I -s "$BaseUrl/logout" 2>&1
    if (-not ($headOutput -match '(?im)^clear-site-data:\s*"cache".*"cookies".*"storage"')) {
        $failures += "MISSING: /logout response did not include Clear-Site-Data with cache/cookies/storage"
    }
    if (-not ($headOutput -match '(?im)^cache-control:\s*[^\r\n]*no-store')) {
        $failures += "MISSING: /logout response did not include Cache-Control: no-store"
    }
}

if ($failures.Count -gt 0) {
    Write-Host "`nSMOKE FAILED:" -ForegroundColor Red
    foreach ($f in $failures) { Write-Host "  $f" -ForegroundColor Red }
    exit 1
}

Write-Host "`nAll PR 1 cache-header invariants OK." -ForegroundColor Green
exit 0
