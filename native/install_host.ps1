param(
    [Parameter(Mandatory=$true)][ValidatePattern('^[a-p]{32}$')][string]$ExtensionId,
    [string]$PythonExe = 'python',
    [string]$HostExe,
    [ValidateSet('Chrome','Edge','Both')][string]$Browser = 'Both',
    [string]$InstallDirectory = "$env:LOCALAPPDATA\PCE\native-host"
)
$ErrorActionPreference = 'Stop'
$hostRoot = [System.IO.Path]::GetFullPath($InstallDirectory)
New-Item -ItemType Directory -Path $hostRoot -Force | Out-Null
if ($HostExe) {
    $launcherPath = (Resolve-Path -LiteralPath $HostExe -ErrorAction Stop).Path
    if (-not (Test-Path -LiteralPath $launcherPath -PathType Leaf)) { throw 'HostExe must be an executable file.' }
} else {
    $packagedHost = Join-Path $PSScriptRoot '..\dist\desktop-v4\PCE.NativeHost\PCE.NativeHost.exe'
    if (-not (Test-Path -LiteralPath $packagedHost -PathType Leaf)) {
        throw 'Pass -HostExe with the packaged PCE.NativeHost.exe. CMD launchers are not supported by this installer.'
    }
    $launcherPath = (Resolve-Path -LiteralPath $packagedHost).Path
}
$manifest = @{
    name = 'com.pce.gateway'; description = 'PCE local SQLite Gateway'; path = $launcherPath;
    type = 'stdio'; allowed_origins = @("chrome-extension://$ExtensionId/")
}
$manifestPath = Join-Path $hostRoot 'com.pce.gateway.json'
[System.IO.File]::WriteAllText($manifestPath, ($manifest | ConvertTo-Json -Depth 4), (New-Object System.Text.UTF8Encoding($false)))
$registryPaths = @()
if ($Browser -in @('Chrome','Both')) { $registryPaths += 'HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.pce.gateway' }
if ($Browser -in @('Edge','Both')) { $registryPaths += 'HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\com.pce.gateway' }
foreach ($registryPath in $registryPaths) {
    New-Item -Path $registryPath -Force | Out-Null
    Set-Item -Path $registryPath -Value $manifestPath
}
Write-Output "Installed PCE host for extension $ExtensionId at $manifestPath"
