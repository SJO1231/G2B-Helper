param(
    [string[]]$ExtensionId = @(),
    [string]$HostExecutable = '',
    [switch]$Preview
)
$ErrorActionPreference = 'Stop'
# The build validates the public key with Node createPublicKey. Installation
# checks the bounded package fields and canonical Base64 before computing its ID.
function Get-PackagedExtensionId([string]$Path) {
    try {
        $file = Get-Item -LiteralPath $Path -ErrorAction Stop
        if ($file.PSIsContainer -or $file.Length -gt 1048576 -or $file.Length -eq 0) { throw 'Extension manifest must be a nonempty file at most 1MB.' }
        $utf8 = [System.Text.UTF8Encoding]::new($false, $true)
        $package = [System.IO.File]::ReadAllText($file.FullName, $utf8) | ConvertFrom-Json -ErrorAction Stop
        if ($null -eq $package -or $package -isnot [System.Management.Automation.PSCustomObject] -or
            $package.manifest_version -isnot [int] -or $package.manifest_version -ne 3 -or
            $package.name -isnot [string] -or -not $package.name.Trim() -or $package.name.Length -gt 200 -or
            $package.version -isnot [string] -or $package.version -cnotmatch '^(0|[1-9][0-9]{0,4})(\.(0|[1-9][0-9]{0,4})){0,3}$') {
            throw 'Invalid extension manifest name, version or manifest_version.'
        }
        $versionParts = @($package.version.Split('.') | ForEach-Object { [int]$_ })
        if (@($versionParts | Where-Object { $_ -gt 65535 }).Count -gt 0 -or ($versionParts | Measure-Object -Sum).Sum -eq 0) { throw 'Invalid extension manifest version range.' }
        # A valid legacy package without a key retains the explicit-ID prompt.
        if (-not $package.PSObject.Properties['key']) { return $null }
        if ($package.key -isnot [string] -or $package.key.Length -gt 8192 -or
            $package.key.Length % 4 -ne 0 -or $package.key -cnotmatch '^[A-Za-z0-9+/]+={0,2}$') { throw 'Invalid extension public key Base64.' }
        $der = [Convert]::FromBase64String($package.key)
        if ($der.Length -lt 128 -or $der.Length -gt 4096 -or [Convert]::ToBase64String($der) -cne $package.key) { throw 'Invalid extension public key size or Base64 encoding.' }
        $sha256 = [System.Security.Cryptography.SHA256]::Create()
        try { $hash = $sha256.ComputeHash($der) } finally { $sha256.Dispose() }
        $id = [System.Text.StringBuilder]::new(32)
        for ($i = 0; $i -lt 16; $i++) {
            [void]$id.Append([char](97 + ($hash[$i] -shr 4)))
            [void]$id.Append([char](97 + ($hash[$i] -band 15)))
        }
        return $id.ToString()
    } catch {
        throw ('Packaged extension manifest is invalid; registration was not changed: ' + $_.Exception.Message)
    }
}
$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$hostDirectory = if (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'G2BHelperHost\G2BHelperHost.exe') -PathType Leaf) { [System.IO.Path]::GetFullPath($PSScriptRoot) } else { [System.IO.Path]::GetFullPath((Join-Path $repoRoot 'dist\mvp-host')) }
if (-not $hostDirectory.StartsWith($repoRoot + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) { throw 'Native Host output directory is outside the project.' }
if (-not $HostExecutable) { $HostExecutable = Join-Path $hostDirectory 'G2BHelperHost\G2BHelperHost.exe' }
$hostPath = [System.IO.Path]::GetFullPath($HostExecutable)
if (-not (Test-Path -LiteralPath $hostPath -PathType Leaf) -or [System.IO.Path]::GetExtension($hostPath) -ne '.exe') { throw 'A packaged G2BHelperHost/G2BHelperHost.exe is required. Run package-mvp.ps1 -BuildHost or supply -HostExecutable with its runtime folder intact.' }
if ($ExtensionId.Count -eq 0) {
    $extensionManifest = Join-Path (Split-Path -Parent $hostDirectory) 'mvp-extension\manifest.json'
    $packagedId = if (Test-Path -LiteralPath $extensionManifest) { Get-PackagedExtensionId $extensionManifest } else { $null }
    if ($packagedId) {
        $ExtensionId = @($packagedId)
        Write-Output ('Detected packaged Chrome/Edge extension ID: ' + $packagedId)
    } else {
        $ExtensionId = @(Read-Host 'Paste Chrome and/or Edge extension IDs (separate with spaces, commas or semicolons)')
    }
}
$ids = @($ExtensionId | ForEach-Object { $_ -split '[\s,;]+' } | Where-Object { $_ -ne '' })
if ($ids.Count -eq 0) { throw 'At least one Chrome or Edge extension ID is required.' }
foreach ($id in $ids) {
    if ($id -cnotmatch '^[a-p]{32}$') { throw ('Invalid extension ID: ' + $id + '. Copy the 32-letter ID from chrome://extensions or edge://extensions.') }
}
$manifestPath = Join-Path $hostDirectory 'com.sjo1231.g2b_helper.json'
$origins = [System.Collections.Generic.List[string]]::new()
if (Test-Path -LiteralPath $manifestPath) {
    try {
        $existing = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json -ErrorAction Stop
        if ($null -eq $existing -or $existing -isnot [System.Management.Automation.PSCustomObject] -or
            $existing.name -cne 'com.sjo1231.g2b_helper' -or $existing.type -cne 'stdio' -or
            $existing.path -isnot [string] -or -not [System.IO.Path]::IsPathRooted($existing.path) -or
            [System.IO.Path]::GetExtension($existing.path) -ine '.exe' -or
            $existing.allowed_origins -isnot [array] -or $existing.allowed_origins.Count -eq 0) {
            throw 'Invalid Native Host manifest structure.'
        }
        foreach ($origin in $existing.allowed_origins) {
            if ($origin -isnot [string] -or $origin -cnotmatch '^chrome-extension://[a-p]{32}/$') { throw 'Invalid allowed_origins entry.' }
            if (-not $origins.Contains($origin)) { $origins.Add($origin) }
        }
    } catch {
        throw ('Existing Native Host manifest is invalid; registration was not changed: ' + $_.Exception.Message)
    }
}
foreach ($id in $ids) {
    $origin = 'chrome-extension://' + $id + '/'
    if (-not $origins.Contains($origin)) { $origins.Add($origin) }
}
$manifest = @{ name = 'com.sjo1231.g2b_helper'; description = 'G2B Helper MVP SQLite Gateway'; path = $hostPath; type = 'stdio'; allowed_origins = @($origins.ToArray()) }
if ($Preview) {
    Write-Output ($manifest | ConvertTo-Json -Depth 4)
    Write-Output ('Preview only; no files or Chrome/Edge registrations changed: ' + $manifestPath)
    return
}
New-Item -ItemType Directory -Path $hostDirectory -Force | Out-Null
$temporaryManifest = Join-Path $hostDirectory ([System.IO.Path]::GetRandomFileName())
try {
    [System.IO.File]::WriteAllText($temporaryManifest, ($manifest | ConvertTo-Json -Depth 4), [System.Text.UTF8Encoding]::new($false))
    if (Test-Path -LiteralPath $manifestPath) {
        # PowerShell 5.1 binds $null to an empty string for this .NET overload.
        [System.IO.File]::Replace($temporaryManifest, $manifestPath, [System.Management.Automation.Language.NullString]::Value)
    } else {
        [System.IO.File]::Move($temporaryManifest, $manifestPath)
    }
} finally {
    if (Test-Path -LiteralPath $temporaryManifest) { Remove-Item -LiteralPath $temporaryManifest -Force }
}
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
