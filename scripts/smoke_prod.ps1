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
    $headersFile = [System.IO.Path]::GetTempFileName()
    $bodyFile = [System.IO.Path]::GetTempFileName()
    try {
        $curlArgs = @('-sS', '-m', '30', '-D', $headersFile, '-o', $bodyFile, '-w', '%{http_code}', '-X', $Method)
        foreach ($key in $Headers.Keys) {
            $curlArgs += @('-H', "${key}: $($Headers[$key])")
        }
        if ($Body -and $Method -notin @('GET', 'HEAD')) {
            $curlArgs += @('--data-raw', $Body)
        }
        $curlArgs += $Uri

        $statusText = (& curl.exe @curlArgs).Trim()
        if ($LASTEXITCODE -ne 0) {
            throw "curl failed with exit code $LASTEXITCODE for $Uri"
        }
        $bodyText = if (Test-Path $bodyFile) { Get-Content -Raw -Path $bodyFile } else { '' }
        $headerMap = @{}
        foreach ($line in (Get-Content -Path $headersFile)) {
            if ($line -notmatch '^\s*([^:]+):\s*(.*)$') { continue }
            $name = $Matches[1]
            $value = $Matches[2].Trim()
            if ($headerMap.ContainsKey($name)) {
                $headerMap[$name] = @($headerMap[$name]) + $value
            } else {
                $headerMap[$name] = @($value)
            }
        }
        return @{ Status = [int]$statusText; Body = $bodyText; Headers = $headerMap }
    } catch {
        throw
    } finally {
        Remove-Item -ErrorAction SilentlyContinue -Path $headersFile, $bodyFile
    }
}

Write-Host "Production smoke: $BaseUrl" -ForegroundColor Cyan

$r = Invoke-Http -Method GET -Uri "$BaseUrl/health"
if ($r.Body -match '"status"\s*:\s*"healthy"') { Pass '/health' } else { Fail '/health' }

$r = Invoke-Http -Method GET -Uri "$BaseUrl/welcome_cards"
if ($r.Body -match '"success"\s*:\s*true') {
    Pass '/welcome_cards (MySQL reachable)'
} else {
    $preview = if ($r.Body) { $r.Body.Substring(0, [Math]::Min(200, $r.Body.Length)) } else { '' }
    Fail "/welcome_cards - expected success:true (got: $preview)"
    Write-Host '  -> Likely missing MYSQL_PASSWORD. See docs/PROD_CLOUD_RUN_RECOVERY.md' -ForegroundColor Yellow
}

$r = Invoke-Http -Method GET -Uri "$BaseUrl/api/invitation/verify?token=smoke-invalid-token"
if ($r.Status -eq 404 -or $r.Body -match 'Invalid invitation') {
    Pass '/api/invitation/verify (DB query works)'
} elseif ($r.Body -match 'Server error') {
    Fail '/api/invitation/verify - server error (DB/env)'
} else {
    Fail "/api/invitation/verify - status=$($r.Status)"
}

$r = Invoke-Http -Method POST -Uri "$BaseUrl/login" `
    -Body 'username=__smoke_nonexistent_user__' `
    -Headers @{ 'Content-Type' = 'application/x-www-form-urlencoded' }
$setCookie = ($r.Headers['Set-Cookie'] -join '; ')
if ($r.Status -eq 302 -or $r.Status -eq 303) {
    if ($setCookie -match 'Domain=app\.c-point\.co') {
        Fail 'login Set-Cookie - invalid Domain=app.c-point.co'
    } else {
        Pass 'login step 1 (unknown user -> redirect, no 500)'
    }
} elseif ($r.Status -eq 500) {
    Fail "login - server error (status $($r.Status))"
} else {
    Fail "login - unexpected status $($r.Status)"
}

Write-Host ''
if ($failed -eq 0) {
    Write-Host 'All production smoke checks passed.' -ForegroundColor Green
    exit 0
}
Write-Host 'See docs/PROD_CLOUD_RUN_RECOVERY.md' -ForegroundColor Yellow
exit 1
