param(
  [string]$ProjectPath = "C:\Users\LOSAN\Documents\Codex\2026-05-23\i-created-an-ai-agent-using\gov-jobs-agent",
  [string]$TaskName = "GovJobsAgentCollector",
  [string]$EveryMinutes = "60"
)

$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -Command cd '$ProjectPath'; `$env:NODE_OPTIONS='--use-system-ca'; npm run collect:once; npm run notify:teams"
$trigger = New-ScheduledTaskTrigger -Daily -At "12:00 AM"
$trigger.Repetition = (New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes ([int]$EveryMinutes)) -RepetitionDuration (New-TimeSpan -Days 3650)).Repetition
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Force | Out-Null
Write-Host "Scheduled task '$TaskName' created. Runs every $EveryMinutes minutes."
