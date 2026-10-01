param()
$ErrorActionPreference='Stop'
function Read-Sha256([string]$Path) {
    $inputStream=[System.IO.File]::OpenRead($Path)
    $algorithm=[System.Security.Cryptography.SHA256]::Create()
    try {return ([System.BitConverter]::ToString($algorithm.ComputeHash($inputStream))).Replace('-','')}
    finally {$inputStream.Dispose();$algorithm.Dispose()}
}
$projectRoot=[System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$packageRoot=Join-Path $projectRoot 'dist\PCE-extension-0.4.0'
$extensionRoot=Join-Path $projectRoot 'dist\extension'
$nativeRoot=Join-Path $projectRoot 'dist\desktop-v4\PCE.NativeHost'
if (-not (Test-Path -LiteralPath (Join-Path $extensionRoot 'manifest.json'))) {throw 'Build the extension first'}
if (-not (Test-Path -LiteralPath (Join-Path $nativeRoot 'PCE.NativeHost.exe'))) {throw 'Build the Native Host first'}
New-Item -ItemType Directory -Path $packageRoot -Force | Out-Null
# Replace generated extension assets only; stale hashed bundles must not enter a release.
$stagedExtension=[System.IO.Path]::GetFullPath((Join-Path $packageRoot 'extension'))
if ($stagedExtension -ne ([System.IO.Path]::GetFullPath($packageRoot)+'\extension')) {throw 'Invalid extension staging path'}
if (Test-Path -LiteralPath $stagedExtension) {Remove-Item -LiteralPath $stagedExtension -Recurse -Force}
Copy-Item -LiteralPath $extensionRoot -Destination $packageRoot -Recurse -Force
Copy-Item -LiteralPath $nativeRoot -Destination $packageRoot -Recurse -Force
Copy-Item -LiteralPath (Join-Path $projectRoot 'native\install_host.ps1') -Destination (Join-Path $packageRoot 'install_host.ps1') -Force
Copy-Item -LiteralPath (Join-Path $projectRoot 'docs\EXTENSION_INSTALL.md') -Destination (Join-Path $packageRoot 'README.md') -Force
$installer=@'
param([Parameter(Mandatory=$true)][ValidatePattern('^[a-p]{32}$')][string]$ExtensionId,[ValidateSet('Chrome','Edge','Both')][string]$Browser='Chrome')
$ErrorActionPreference='Stop'
& (Join-Path $PSScriptRoot 'install_host.ps1') -ExtensionId $ExtensionId -Browser $Browser -HostExe (Join-Path $PSScriptRoot 'PCE.NativeHost\PCE.NativeHost.exe')
'@
[System.IO.File]::WriteAllText((Join-Path $packageRoot 'install.ps1'),$installer,(New-Object System.Text.UTF8Encoding($false)))
$archive=Join-Path $projectRoot 'dist\PCE-extension-0.4.0.zip'
Compress-Archive -Path (Join-Path $packageRoot '*') -DestinationPath $archive -Force
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip=[System.IO.Compression.ZipFile]::OpenRead($archive)
try {
    $entries=$zip.Entries.FullName
    foreach($required in @('extension/manifest.json','extension/widget.js','extension/feature.html','PCE.NativeHost/PCE.NativeHost.exe','install.ps1','README.md')) {
        if (-not ($entries -contains $required -or $entries -contains $required.Replace('/','\'))) {throw "Missing package entry: $required"}
    }
    $verified=0
    foreach($entry in $zip.Entries) {
        if (-not $entry.Name) {continue}
        $relative=$entry.FullName.Replace('/','\')
        $original=Join-Path $packageRoot $relative
        $stream=$entry.Open()
        $hasher=[System.Security.Cryptography.SHA256]::Create()
        try {$actual=([System.BitConverter]::ToString($hasher.ComputeHash($stream))).Replace('-','')}
        finally {$stream.Dispose();$hasher.Dispose()}
        if ($actual -ne (Read-Sha256 $original)) {throw "ZIP content mismatch: $relative"}
        $verified++
    }
    [pscustomobject]@{archive=$archive;entries=$zip.Entries.Count;verifiedFiles=$verified;sha256=(Read-Sha256 $archive)} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $projectRoot 'dist\evidence\extension\package.json') -Encoding UTF8
} finally {$zip.Dispose()}
Write-Output "Created $archive"
