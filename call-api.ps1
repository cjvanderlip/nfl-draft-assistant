$base = "http://localhost:3001"

function Invoke-JsonEndpoint {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Method,
        [Parameter(Mandatory = $true)]
        [string]$Uri,
        [Parameter(Mandatory = $true)]
        [string]$Body
    )

    try {
        $response = Invoke-RestMethod -Method $Method -Uri $Uri -ContentType "application/json" -Body $Body
        return $response
    }
    catch {
        $message = $_.Exception.Message
        if ($_.Exception.Response -and $_.Exception.Response.Content) {
            try {
                $message = $_.Exception.Response.Content.ReadAsStringAsync().Result
            }
            catch {}
        }
        return @{ error = $message }
    }
}

$backtestBody = @'
{
  "picks": [
    { "managerId": "m1", "playerId": "p1", "position": "RB", "overallPick": 1 },
    { "managerId": "m2", "playerId": "p2", "position": "WR", "overallPick": 2 },
    { "managerId": "m3", "playerId": "p3", "position": "QB", "overallPick": 3 }
  ]
}
'@

$heuristicBody = @'
{
  "candidates": [
    {
      "playerId": "p1",
      "baseRank": 5,
      "signals": {
        "contractYear": 0.5,
        "targetShareVolatility": 0.2,
        "olineUpgrade": 0,
        "rzRegression": 0.1,
        "gameScriptLeverage": 0.1
      }
    }
  ],
  "weightOverrides": {
    "contractYearBump": 0.7
  }
}
'@

$rosterBody = @'
{
  "strategyProfile": "BALANCED",
  "starters": {
    "RB": 2,
    "WR": 2,
    "QB": 1
  },
  "draftedPlayers": [
    { "playerId": "rb-a", "position": "RB" }
  ],
  "candidates": [
    { "playerId": "wr-1", "position": "WR", "compositeScore": 0.8 },
    { "playerId": "rb-1", "position": "RB", "compositeScore": 0.4 }
  ]
}
'@

$backtestResp = Invoke-JsonEndpoint -Method "POST" -Uri "$base/predictions/backtest" -Body $backtestBody
$heuristicResp = Invoke-JsonEndpoint -Method "POST" -Uri "$base/heuristics/score" -Body $heuristicBody
$rosterResp = Invoke-JsonEndpoint -Method "POST" -Uri "$base/roster/recommendations" -Body $rosterBody

$backtestResp | ConvertTo-Json -Depth 20 | Set-Content -Path "C:\Users\cjevi\nfl-draft-assistant\backtest.json"
$heuristicResp | ConvertTo-Json -Depth 20 | Set-Content -Path "C:\Users\cjevi\nfl-draft-assistant\heuristics.json"
$rosterResp | ConvertTo-Json -Depth 20 | Set-Content -Path "C:\Users\cjevi\nfl-draft-assistant\roster.json"

Write-Output "Saved: backtest.json"
Write-Output "Saved: heuristics.json"
Write-Output "Saved: roster.json"

Write-Output "--- backtest ---"
$backtestResp | ConvertTo-Json -Depth 20
Write-Output "--- heuristics ---"
$heuristicResp | ConvertTo-Json -Depth 20
Write-Output "--- roster ---"
$rosterResp | ConvertTo-Json -Depth 20