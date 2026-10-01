param([switch]$BuildHost)
$ErrorActionPreference = 'Stop'
$packagingScript = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot 'package-mvp.mjs'))
$nodeExecutable = (Get-Command node.exe -ErrorAction Stop).Source
if ($BuildHost) { & $nodeExecutable $packagingScript --build-host } else { & $nodeExecutable $packagingScript }
if ($LASTEXITCODE -ne 0) { throw 'MVP packaging failed.' }
