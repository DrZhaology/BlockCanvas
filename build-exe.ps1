# =========================================================
# BlockCanvas - one-click build (green portable folder)
#   Usage:  powershell -ExecutionPolicy Bypass -File build-exe.ps1
#   Output:
#     dist\win-unpacked\               the runnable app folder (run BlockCanvas.exe)
#     dist\BlockCanvas-0.0.1-win64.zip the whole folder zipped (unzip & run)
#     plus a copy of the zip at E:\Develop\
#   Notes:
#     - Portable: no install, no AppData.
#     - data/extensions/ inside zip provides built-in plugins & templates.
#     - Native processes (electron-builder) required -> run in a NORMAL terminal.
# =========================================================
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$destDir = 'E:\Develop'
$ver = '0.3.1'
$appDir = Join-Path $root 'dist\win-unpacked'
$zipName = "BlockCanvas-$ver-win64.zip"
$zipPath = Join-Path $root "dist\$zipName"
Set-Location $root

Write-Host '[1/5] install deps...' -ForegroundColor Cyan
pnpm install

Write-Host '[2/5] build app (main/preload/renderer)...' -ForegroundColor Cyan
pnpm build

Write-Host '[3/5] package app folder (dir target)...' -ForegroundColor Cyan
pnpm exec electron-builder --win dir --publish never

Write-Host '[4/5] copy data/extensions/ from source into app dir...' -ForegroundColor Cyan
$dstExtDir = Join-Path $appDir 'data'
if (-not (Test-Path $dstExtDir)) { New-Item -ItemType Directory -Path $dstExtDir -Force | Out-Null }
Copy-Item -Recurse -Force (Join-Path $root 'data\extensions') (Join-Path $dstExtDir 'extensions')

Write-Host '[5/5] compress to zip...' -ForegroundColor Cyan
Remove-Item $zipPath -Force -ErrorAction SilentlyContinue
Compress-Archive -Path (Join-Path $appDir '*') -DestinationPath $zipPath

Write-Host 'copy zip to ' -NoNewline -ForegroundColor Cyan
Write-Host "$destDir\" -ForegroundColor Cyan
$destZip = Join-Path $destDir $zipName
Copy-Item $zipPath -Destination $destZip -Force
Write-Host ("done -> " + $destZip) -ForegroundColor Green
