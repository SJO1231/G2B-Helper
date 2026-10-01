param([switch]$SkipFrontend)
$ErrorActionPreference = 'Stop'
$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
Push-Location -LiteralPath $projectRoot
try {
    if (-not $SkipFrontend) {
        & npm run build
        if ($LASTEXITCODE -ne 0) { throw 'Frontend build failed' }
    }
    $pythonExe = Join-Path $projectRoot '.venv\Scripts\python.exe'
    if (-not (Test-Path -LiteralPath $pythonExe)) { throw 'Create .venv and install native/requirements.txt plus pyinstaller==6.20.0 first.' }
    $webAssets = Join-Path $projectRoot 'dist\extension'
    $windowManifest = Join-Path $projectRoot 'native\windows.manifest'
    & $pythonExe -m PyInstaller --noconfirm --onedir --windowed --name PCE --manifest $windowManifest --distpath dist/desktop --workpath build/desktop --specpath build --add-data "$webAssets;web" native/desktop.py
    if ($LASTEXITCODE -ne 0) { throw 'Desktop packaging failed' }
    & $pythonExe -m PyInstaller --noconfirm --onedir --console --name PCE.NativeHost --distpath dist/desktop-v4 --workpath build/native-host-v4 --specpath build native/host.py
    if ($LASTEXITCODE -ne 0) { throw 'Native Host packaging failed' }
} finally { Pop-Location }
