param([string]$BaseUrl='http://127.0.0.1:8003')
$ErrorActionPreference='Stop'
$taskEndpoint=[uri]$BaseUrl
if($taskEndpoint.Scheme -ne 'http' -or $taskEndpoint.Host -notin @('127.0.0.1','localhost') -or $taskEndpoint.UserInfo -or $taskEndpoint.Query){throw 'Smoke only targets an explicit loopback pilot endpoint'}
$taskStatus=Invoke-RestMethod -Uri ($BaseUrl+'/status') -TimeoutSec 10
$taskHeightBody=@{shape=@(@{lat=39.9;lon=32.8},@{lat=39.91;lon=32.8})} | ConvertTo-Json -Depth 5 -Compress
$taskHeight=Invoke-RestMethod -Method Post -Uri ($BaseUrl+'/height') -ContentType 'application/json' -Body $taskHeightBody -TimeoutSec 15
$taskRouteBody=@{locations=@(@{lat=39.9;lon=32.8},@{lat=39.91;lon=32.8});costing='auto';units='kilometers';elevation_interval=30} | ConvertTo-Json -Depth 5 -Compress
$taskRoute=Invoke-RestMethod -Method Post -Uri ($BaseUrl+'/route') -ContentType 'application/json' -Body $taskRouteBody -TimeoutSec 30
if(!$taskRoute.trip.legs -or !($taskRoute.trip.legs[0].elevation.Count -gt 1)){throw 'No route elevation profile'}
$taskValues=@($taskRoute.trip.legs | ForEach-Object {$_.elevation})
$taskNoData=@($taskValues | Where-Object {$null -eq $_ -or $_ -eq -500 -or $_ -eq -32768}).Count
if($taskNoData -gt 0){throw ('DEM no-data samples: '+$taskNoData)}
[pscustomobject]@{evidence='live_smoke';endpoint=$BaseUrl;version=$taskStatus.version;distanceKm=$taskRoute.trip.summary.length;rawIntervalMeters=30;rawSamples=$taskValues.Count;noDataSamples=$taskNoData;height=$taskHeight.height;quality='modelled_not_field_verified'} | ConvertTo-Json -Depth 4
