param(
  [Parameter(Mandatory=$true)][string]$TeamsWebhookUrl
)

$project = "C:\Users\LOSAN\Documents\Codex\2026-05-23\i-created-an-ai-agent-using\gov-jobs-agent"
Set-Location $project

if (!(Test-Path .env)) {
  Copy-Item .env.example .env
}

$envText = Get-Content .env -Raw
if ($envText -match "(?m)^TEAMS_WEBHOOK_URL=") {
  $envText = [regex]::Replace($envText, "(?m)^TEAMS_WEBHOOK_URL=.*$", "TEAMS_WEBHOOK_URL=$TeamsWebhookUrl")
} else {
  $envText += "`r`nTEAMS_WEBHOOK_URL=$TeamsWebhookUrl`r`n"
}
Set-Content -Encoding UTF8 .env $envText

npm run notify:teams
