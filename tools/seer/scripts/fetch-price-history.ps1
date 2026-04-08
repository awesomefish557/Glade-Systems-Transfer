$workerUrl = "https://seer-worker.gladesystems.workers.dev"
$adminSecret = $env:SEER_ADMIN_SECRET
if (-not $adminSecret) { Write-Host "ERROR: Set SEER_ADMIN_SECRET first"; exit 1 }
Write-Host "Starting price history sync..."
$offset = 0
$total = 0
$hasMore = $true
while ($hasMore) {
    Start-Sleep -Milliseconds 1500
    $raw = Invoke-WebRequest -Uri "$workerUrl/admin/sync-market-price-history?limit=30&offset=$offset" -Method POST -Headers @{"X-Seer-Admin"=$adminSecret} -UseBasicParsing
    $r = $raw.Content | ConvertFrom-Json
    $total += [int]$r.fetched
    Write-Host "Offset $offset fetched=$($r.fetched) written=$($r.written) total=$total"
    $hasMore = [bool]$r.hasMore
    $offset = [int]$r.nextOffset
}
Write-Host "Done! Total: $total"
