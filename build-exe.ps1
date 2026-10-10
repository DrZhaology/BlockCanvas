# =========================================================
# BlockCanvas - one-click build (green portable folder)
#   ⚠ 本文件必须保存为「UTF-8 带 BOM」：Windows PowerShell 5.1 对无 BOM 的文件按 ANSI(GBK) 解码，
#     下面的中文会变成乱码、连字符串引号都被截断，报一堆莫名语法错误（踩过一次）。改完确认 BOM 还在。
#   Usage:  powershell -ExecutionPolicy Bypass -File build-exe.ps1
#   Output:
#     dist\win-unpacked\                 the runnable app folder (run BlockCanvas.exe)
#     dist\BlockCanvas-<version>-win64.zip   the whole folder zipped (unzip & run)
#     plus a copy of the zip at E:\Develop\
#   Version:
#     版本号只有一个来源 —— 根目录 version.json（改它就等于改版本）。
#     本脚本第 0 步会调 tools/sync-version.mjs 把它同步进 package.json，
#     安装包元数据 / 应用内「关于」/ 更新中心都读 package.json，所以不会对不上。
#   Notes:
#     - Portable: no install, no AppData.
#     - data/extensions/ inside zip provides built-in plugins & templates.
#     - Native processes (electron-builder) required -> run in a NORMAL terminal.
# =========================================================
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$destDir = 'E:\Develop'
Set-Location $root

# native 命令（pnpm / node / electron-builder）失败时 PowerShell 不会自己抛错，这里统一检查
function Assert-LastExit([string]$step) {
  if ($LASTEXITCODE -ne 0) { throw "[$step] 失败（exit $LASTEXITCODE），已中止打包。" }
}

Write-Host '[0/6] sync version from version.json...' -ForegroundColor Cyan
node tools/sync-version.mjs
Assert-LastExit 'sync-version'
$ver = (node -p "require('./version.json').version").Trim()
$stage = (node -p "require('./version.json').stage || ''").Trim()
$appDir = Join-Path $root 'dist\win-unpacked'
$zipName = "BlockCanvas-$ver-win64.zip"
$zipPath = Join-Path $root "dist\$zipName"
Write-Host ("      version = {0}{1}" -f $ver, $(if ($stage) { "  ($stage)" } else { '' })) -ForegroundColor DarkGray

Write-Host '[1/6] install deps...' -ForegroundColor Cyan
pnpm install
Assert-LastExit 'pnpm install'

Write-Host '[2/6] build app (main/preload/renderer)...' -ForegroundColor Cyan
pnpm build
Assert-LastExit 'pnpm build'

Write-Host '[3/6] package app folder (dir target)...' -ForegroundColor Cyan
pnpm exec electron-builder --win dir --publish never
Assert-LastExit 'electron-builder'

if (-not (Test-Path (Join-Path $appDir 'BlockCanvas.exe'))) {
  throw "[3/6] 没有生成 $appDir\BlockCanvas.exe，打包失败。"
}

Write-Host '[4/6] copy data/extensions/ from source into app dir...' -ForegroundColor Cyan
$srcExt = Join-Path $root 'data\extensions'
if (Test-Path $srcExt) {
  $dstExtDir = Join-Path $appDir 'data'
  if (-not (Test-Path $dstExtDir)) { New-Item -ItemType Directory -Path $dstExtDir -Force | Out-Null }
  Copy-Item -Recurse -Force $srcExt (Join-Path $dstExtDir 'extensions')
} else {
  Write-Host '      (no data/extensions/ in source tree, skipped)' -ForegroundColor DarkYellow
}

Write-Host '[5/6] compress to zip...' -ForegroundColor Cyan
Remove-Item $zipPath -Force -ErrorAction SilentlyContinue
Compress-Archive -Path (Join-Path $appDir '*') -DestinationPath $zipPath
if (-not (Test-Path $zipPath)) { throw "[5/6] 压缩失败：$zipPath 不存在。" }

Write-Host '[6/6] copy zip to destination folder...' -ForegroundColor Cyan
$destZip = Join-Path $destDir $zipName
Copy-Item $zipPath -Destination $destZip -Force
if (-not (Test-Path $destZip)) { throw "[6/6] 复制失败：$destZip 不存在。" }

Write-Host ''
Write-Host ("done -> " + $destZip) -ForegroundColor Green
Write-Host ("      version {0} · {1:N1} MB" -f $ver, ((Get-Item $zipPath).Length / 1MB)) -ForegroundColor Green
Write-Host '      发布提醒：main 上留一个 v<版本> 提交（或 tag），远程 Release 由你手动发。' -ForegroundColor DarkGray
