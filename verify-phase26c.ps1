$base = "https://trading-journey-backend.onrender.com"
$results = @{}

Write-Host "`n=== PHASE 26C PRODUCTION VERIFICATION ===" -ForegroundColor Cyan

# 1. Auth
try {
    $auth = Invoke-RestMethod "$base/api/indian/dhan/auth" -TimeoutSec 30
    $results["auth"] = $auth | ConvertTo-Json -Depth 5
    Write-Host "`n[AUTH]" -ForegroundColor Green
    Write-Host $results["auth"]
} catch {
    Write-Host "[AUTH FAILED] $_" -ForegroundColor Red
    $results["auth"] = "ERROR: $_"
}

Start-Sleep -Seconds 4

# 2. Status
try {
    $status = Invoke-RestMethod "$base/api/indian/dhan/option-chain/status" -TimeoutSec 30
    $results["status"] = $status | ConvertTo-Json -Depth 5
    Write-Host "`n[STATUS]" -ForegroundColor Green
    Write-Host $results["status"]
} catch {
    Write-Host "[STATUS FAILED] $_" -ForegroundColor Red
    $results["status"] = "ERROR: $_"
}

Start-Sleep -Seconds 4

# 3. Expiry
try {
    $expiry = Invoke-RestMethod "$base/api/indian/dhan/option-chain/expiry" -TimeoutSec 30
    $results["expiry"] = $expiry | ConvertTo-Json -Depth 5
    Write-Host "`n[EXPIRY]" -ForegroundColor Green
    Write-Host $results["expiry"]
} catch {
    Write-Host "[EXPIRY FAILED] $_" -ForegroundColor Red
    $results["expiry"] = "ERROR: $_"
}

Start-Sleep -Seconds 4

# 4. Data health
try {
    $health = Invoke-RestMethod "$base/api/indian/dhan/data-health" -TimeoutSec 30
    $results["health"] = $health | ConvertTo-Json -Depth 5
    Write-Host "`n[DATA HEALTH]" -ForegroundColor Green
    Write-Host $results["health"]
} catch {
    Write-Host "[HEALTH FAILED] $_" -ForegroundColor Red
    $results["health"] = "ERROR: $_"
}

Start-Sleep -Seconds 4

# 5. Option chain (heaviest call — last)
try {
    $chain = Invoke-RestMethod "$base/api/indian/dhan/option-chain" -TimeoutSec 30
    $results["chain"] = $chain | ConvertTo-Json -Depth 5
    Write-Host "`n[OPTION CHAIN]" -ForegroundColor Green
    Write-Host ($chain | ConvertTo-Json -Depth 3)
} catch {
    Write-Host "[OPTION CHAIN FAILED] $_" -ForegroundColor Red
    $results["chain"] = "ERROR: $_"
}

Write-Host "`n=== VERIFICATION COMPLETE ===" -ForegroundColor Cyan
