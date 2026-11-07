param([Parameter(Mandatory=$true)][string]$EvidenceDirectory)
$ErrorActionPreference = 'Stop'
$Root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$Dest = [IO.Path]::GetFullPath($EvidenceDirectory)
if (-not $Dest.StartsWith($Root + [IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)) { throw 'Evidence must be inside offline-prototype' }
New-Item -ItemType Directory -Force -Path $Dest | Out-Null
@{os=Get-CimInstance Win32_OperatingSystem | Select-Object Caption,Version,BuildNumber; cpu=Get-CimInstance Win32_Processor | Select-Object Name; memory=Get-CimInstance Win32_ComputerSystem | Select-Object TotalPhysicalMemory; adapters=Get-NetAdapter | Select-Object Name,Status; status='UNVERIFIED-ON-TARGET'} | ConvertTo-Json -Depth 5 | Set-Content (Join-Path $Dest 'target-inventory.json')
