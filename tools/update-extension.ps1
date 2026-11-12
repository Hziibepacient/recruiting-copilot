param([Parameter(Mandatory=$true)][string]$InstalledPath)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$sourceRoot = (Resolve-Path -LiteralPath (Join-Path $projectRoot 'extension')).Path
$targetRoot = (Resolve-Path -LiteralPath $InstalledPath).Path
if ($sourceRoot -eq $targetRoot) { throw 'Source and installation must be different directories.' }
$installedManifest = Get-Content -LiteralPath (Join-Path $targetRoot 'manifest.json') -Raw | ConvertFrom-Json
$sourceManifest = Get-Content -LiteralPath (Join-Path $sourceRoot 'manifest.json') -Raw | ConvertFrom-Json
if ($installedManifest.name -ne $sourceManifest.name) { throw 'The installation is a different extension.' }
$backupRoot = Join-Path $projectRoot ('.runtime\installed-backups\' + (Get-Date -Format 'yyyyMMdd-HHmmss-fff'))
New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null
$files = Get-ChildItem -LiteralPath $sourceRoot -File | Where-Object { $_.Name -notin 'bridge-config.json','outreach-scope.json' -and $_.Extension -in '.js','.mjs','.html','.css','.json' }
$updated = @()
foreach ($file in $files) {
    $destination = Join-Path $targetRoot $file.Name
    if (Test-Path -LiteralPath $destination) { Copy-Item -LiteralPath $destination -Destination (Join-Path $backupRoot $file.Name) }
    Copy-Item -LiteralPath $file.FullName -Destination $destination -Force
    if ((Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash -ne (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash) { throw "Verification failed: $($file.Name)" }
    $updated += $file.Name
}
[pscustomobject]@{version=$sourceManifest.version;updated=$updated.Count;backup=$backupRoot;target=$targetRoot;configPreserved=$true;runtimeReloaded=$false} | ConvertTo-Json
