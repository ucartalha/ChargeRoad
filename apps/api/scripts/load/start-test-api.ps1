# Local load test only (2026-11-20): starts a SEPARATE API instance on port 3001.
# - .env is not read or changed by this script; every override below applies to this PowerShell process only.
# - Production mode: NODE_ENV=production, the development planning trace cannot run, planning metrics are off.
# - Rate limits are lifted for this instance only, so a load run from 127.0.0.1 never collects strikes.
# - Weather and roads stay on the local self-hosted services (no public provider receives load).
# Stop with Ctrl+C. The normal API (port 3000) must be stopped while this runs: both share the planning_jobs
# table, and its worker would otherwise take jobs from this test.
param([int]$Port = 3001)
$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}
Set-Location (Resolve-Path (Join-Path $PSScriptRoot '..\..\..\..'))

# Extra instances (-Port 3002, 3003 ...) only add planning workers: they claim jobs from the same planning_jobs queue.
$env:API_PORT = [string]$Port
$env:NODE_ENV = 'production'
Remove-Item Env:PLANNING_DEBUG_TRACE -ErrorAction SilentlyContinue
$env:PLANNING_METRICS_ENABLED = 'false'
$env:WEATHER_ENABLED = 'true'
$env:WEATHER_PROVIDER_ID = 'open-meteo-local'
# Production refuses the public Photon demo (correctly); the planning flow does not geocode, so it is off here.
$env:GEOCODING_ENABLED = 'false'

$env:RATE_LIMIT_GENERAL_PER_MINUTE = '1000000'
$env:RATE_LIMIT_CATALOGUE_PER_MINUTE = '1000000'
$env:RATE_LIMIT_PLANNING_PER_MINUTE = '1000000'
$env:RATE_LIMIT_MAX_PENDING = '1000'
$env:RATE_LIMIT_DAILY_STRIKES = '100'

pnpm.cmd --filter @chargeroad/api start
