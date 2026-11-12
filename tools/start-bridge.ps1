param([switch]$ReadOnly)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$listener = Get-NetTCPConnection -State Listen -LocalAddress 127.0.0.1 -LocalPort 18763 -ErrorAction SilentlyContinue
if ($listener) {
    Write-Output 'Port 18763 is already in use. Check python bridge.py status; no process was stopped.'
    exit 0
}
$python = (Get-Command python -ErrorAction Stop).Source
$runtime = Join-Path $projectRoot '.runtime'
New-Item -ItemType Directory -Path $runtime -Force | Out-Null
$bridgeArgs = @('bridge.py','serve')
if ($ReadOnly) { $bridgeArgs += '--read-only' }
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
$process = Start-Process -FilePath $python -ArgumentList $bridgeArgs -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $runtime "bridge-$stamp-stdout.log") -RedirectStandardError (Join-Path $runtime "bridge-$stamp-stderr.log") -PassThru
[pscustomobject]@{pid=$process.Id;started=$true;readOnly=[bool]$ReadOnly;sending=$false} | ConvertTo-Json
