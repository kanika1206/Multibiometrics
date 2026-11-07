# Candidate installer SOURCE. No production payload is implied by this file.
param([Parameter(Mandatory=$true)][string]$PayloadDirectory,
      [Parameter(Mandatory=$true)][ValidatePattern('^[a-zA-Z0-9.-]+$')][string]$Version)
$ErrorActionPreference='Stop'
$principal=[Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Run installer as administrator; launch app as standard target user' }
$Source=(Resolve-Path -LiteralPath $PayloadDirectory).Path
$Inventory=Get-Content -Raw -LiteralPath (Join-Path $Source 'candidate-inventory.json') | ConvertFrom-Json
if (-not (Test-Path -LiteralPath (Join-Path $Source 'runtime\python.exe'))) { throw 'Windows runtime absent' }
$Dest=Join-Path ([Environment]::GetFolderPath('ProgramFiles')) ('MultimodalOffline\'+$Version)
if (Test-Path -LiteralPath $Dest) { throw 'Refusing overwrite; use a new version directory' }
$Expected=@{}
foreach ($Row in $Inventory) {
 $Path=[IO.Path]::GetFullPath((Join-Path $Source $Row.path))
 if (-not $Path.StartsWith($Source+'\',[StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe inventory path' }
 if ($Expected.ContainsKey($Row.path)) { throw 'Duplicate inventory path' }
 $Expected[$Row.path]=$Row.sha256
 if ((Get-FileHash -Algorithm SHA256 -LiteralPath $Path).Hash -ne $Row.sha256) { throw 'Payload hash mismatch' }
}
foreach ($File in Get-ChildItem -LiteralPath $Source -Recurse -Force) {
 if ($File.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Reparse points forbidden' }
 if (-not $File.PSIsContainer) {
  $Relative=$File.FullName.Substring($Source.Length+1).Replace('\','/')
  if ($Relative -ne 'candidate-inventory.json' -and -not $Expected.ContainsKey($Relative)) { throw "Uninventoried file: $Relative" }
 }
}
New-Item -ItemType Directory -Path $Dest | Out-Null
try {
 Copy-Item -Path (Join-Path $Source '*') -Destination $Dest -Recurse -Force
 & icacls $Dest /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' '*S-1-5-32-545:(OI)(CI)RX' /T | Out-Null
 if ($LASTEXITCODE -ne 0) { throw 'Install ACL failed' }
 foreach ($Row in $Inventory) { if ((Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $Dest $Row.path)).Hash -ne $Row.sha256) { throw 'Installed hash mismatch' } }
 Write-Output "Installed candidate at $Dest. UNVERIFIED-ON-TARGET; launcher stays gated. No state migration performed."
} catch { throw "Installation failed; do not launch partial directory $Dest. $($_.Exception.Message)" }
