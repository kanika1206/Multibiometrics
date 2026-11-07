param([string]$RunId=(Get-Date -Format 'yyyyMMdd-HHmmss'))
$ErrorActionPreference='Stop'
if ($RunId -notmatch '^[a-zA-Z0-9-]+$') { throw 'Invalid run ID' }
$Dest=Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) ('MultimodalOffline\acceptance-evidence\sessions\'+$RunId)
if (Test-Path -LiteralPath $Dest) { throw 'Run directory already exists' }
New-Item -ItemType Directory -Path $Dest | Out-Null
@{os=Get-CimInstance Win32_OperatingSystem | Select-Object Caption,Version,BuildNumber; cpu=Get-CimInstance Win32_Processor | Select-Object Name; memory=Get-CimInstance Win32_ComputerSystem | Select-Object TotalPhysicalMemory; adapters=Get-NetAdapter -IncludeHidden | Select-Object Name,Status,InterfaceDescription; status='RECORDED_NOT_ACCEPTED'} | ConvertTo-Json -Depth 5 | Set-Content (Join-Path $Dest 'target-inventory.json')
Copy-Item (Join-Path $PSScriptRoot 'templates\*') $Dest
Write-Output $Dest
