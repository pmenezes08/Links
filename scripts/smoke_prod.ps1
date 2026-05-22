<#
.SYNOPSIS
    Production smoke checks for https://app.c-point.co (cpoint-app).

.DESCRIPTION
    Verifies health, MySQL-backed routes, and session cookie issuance after deploy.
    Exits non-zero on failure.

.NOTES
    pwsh scripts/smoke_prod.ps1
#>

$ErrorActionPreference = 'Stop'
$BaseUrl = if ($env:PROD_BASE_URL) { $env:PROD_BASE_URL } else { 'https://app.c-point.co' }
$failed = 0

function Pass($msg) { Write-Host "[PASS] $msg" -ForegroundColor Green }
function Fail($msg) {
    Write-Host "[FAIL] $msg" -ForegroundColor Red
    $script:failed = 1
}

function Invoke-Http {
    param([string]$Method, [string]$Uri, [string]$Body = $null, [hashtable]$Headers = @{})
    try {
        $args = @{ Method = $Method; Uri = $Uri; Headers = $Headers; ErrorAction = 'Stop' }
        if ($Body -and $Method -notin @('GET', 'HEAD')) { $args.Body = $Body }
        if ($PSVersionTable.PSVersion.Major -ge 7) {
            $resp = Invoke-WebRequest @args -SkipHttpErrorCheck
        } else {
            $resp = Invoke-WebRequest @args -UseBasicParsing
        }
        return @{ Status = [int]$resp.StatusCode; Body = $resp.Content; Headers = $resp.Headers }
    } catch [System.Net.WebException] {
        $r = $_.Exception.Response
        if ($null -eq $r) { throw }
        $reader = New-Object System.IO.StreamReader($r.GetResponseStream())
        $body = $reader.ReadToEnd()
        return @{ Status = [int]$r.StatusCode; Body = $body; Headers = @{} }
    }
}

Write-Host "Production smoke: $BaseUrl" -ForegroundColor Cyan

$r = Invoke-Http -Method GET -Uri "$BaseUrl/health"
if ($r.Body -match '"status"\s*:\s*"healthy"') { Pass '/health' } else { Fail '/health' }

$r = Invoke-Http -Method GET -Uri "$BaseUrl/welcome_cards"
if ($r.Body -match '"success"\s*:\s*true') {
    Pass '/welcome_cards (MySQL reachable)'
} else {
    Fail "/welcome_cards — expected success:true (got: $($r.Body.Substring(0, [Math]::Min(200, $r.Body.Length))))"
    Write-Host '  → Likely missing MYSQL_PASSWORD. See docs/PROD_CLOUD_RUN_RECOVERY.md' -ForegroundColor Yellow
}

$r = Invoke-Http -Method GET -Uri "$BaseUrl/api/invitation/verify?token=smoke-invalid-token"
if ($r.Status -eq 404 -or $r.Body -match 'Invalid invitation') {
    Pass '/api/invitation/verify (DB query works)'
} elseif ($r.Body -match 'Server error') {
    Fail '/api/invitation/verify — server error (DB/env)'
} else {
    Fail "/api/invitation/verify — status=$($r.Status)"
}

$r = Invoke-Http -Method POST -Uri "$BaseUrl/login" `
    -Body 'username=__smoke_nonexistent_user__' `
    -Headers @{ 'Content-Type' = 'application/x-www-form-urlencoded' }
$setCookie = ($r.Headers['Set-Cookie'] -join '; ')
if ($setCookie -match 'cpoint_session') {
    if ($setCookie -match 'Domain=app\.c-point\.co') {
        Fail 'login Set-Cookie — invalid Domain=app.c-point.co'
    } else {
        Pass 'login issues Set-Cookie'
    }
} else {
    Fail 'login — no cpoint_session Set-Cookie'
}

Write-Host ''
if ($failed -eq 0) {
    Write-Host 'All production smoke checks passed.' -ForegroundColor Green
    exit 0
}
Write-Host 'See docs/PROD_CLOUD_RUN_RECOVERY.md' -ForegroundColor Yellow
exit 1
