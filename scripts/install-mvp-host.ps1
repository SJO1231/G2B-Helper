param(
    [Parameter(Mandatory = $true)][ValidatePattern('^[a-p]{32}$')][string]$ExtensionId,
    [string]$HostExecutable = ''
)
$ErrorActionPreference = 'Stop'
$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$hostDirectory = if (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'G2BHelperHost\G2BHelperHost.exe') -PathType Leaf) { [System.IO.Path]::GetFullPath($PSScriptRoot) } else { [System.IO.Path]::GetFullPath((Join-Path $repoRoot 'dist\mvp-host')) }
if (-not $hostDirectory.StartsWith($repoRoot + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) { throw 'Native Host output directory is outside the project.' }
if (-not $HostExecutable) { $HostExecutable = Join-Path $hostDirectory 'G2BHelperHost\G2BHelperHost.exe' }
$hostPath = [System.IO.Path]::GetFullPath($HostExecutable)
if (-not (Test-Path -LiteralPath $hostPath -PathType Leaf) -or [System.IO.Path]::GetExtension($hostPath) -ne '.exe') { throw 'A packaged G2BHelperHost/G2BHelperHost.exe is required. Run package-mvp.ps1 -BuildHost or supply -HostExecutable with its runtime folder intact.' }
$manifestPath = Join-Path $hostDirectory 'com.sjo1231.g2b_helper.json'
$manifest = @{ name = 'com.sjo1231.g2b_helper'; description = 'G2B Helper MVP SQLite Gateway'; path = $hostPath; type = 'stdio'; allowed_origins = @('chrome-extension://' + $ExtensionId + '/') }
New-Item -ItemType Directory -Path $hostDirectory -Force | Out-Null
[System.IO.File]::WriteAllText($manifestPath, ($manifest | ConvertTo-Json -Depth 4), [System.Text.UTF8Encoding]::new($false))
# Per-user installation; this script is explicit and is never executed by the build.
# Source: https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging#native-messaging-host-location
# Edge: https://learn.microsoft.com/en-us/microsoft-edge/extensions/developer-guide/native-messaging#step-3-copy-the-native-messaging-host-manifest-file-to-your-system
foreach ($browser in @('Google\Chrome', 'Microsoft\Edge')) {
    $registryPath = 'HKCU:\Software\' + $browser + '\NativeMessagingHosts\com.sjo1231.g2b_helper'
    New-Item -Path $registryPath -Force | Out-Null
    Set-Item -LiteralPath $registryPath -Value $manifestPath
}
Write-Output ('Registered G2B Helper Native Host for Chrome and Edge: ' + $manifestPath)
Write-Output 'Reload the extension and verify DB connection. This installer does not open or modify any database.'
