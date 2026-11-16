# 发布 PLANT-1 到 kong8la.com/plant1/
#   pwsh -File .\deploy\publish.ps1            # 构建 + 上传 + 挂 nginx
#   pwsh -File .\deploy\publish.ps1 -NoBuild   # 跳过 build，只上传已有产物
param([switch]$NoBuild)

$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $PSScriptRoot
$key = Join-Path $env:USERPROFILE ".ssh\dsh_kong8la"
$remote = "root@45.76.107.67"
$site = "/var/www/northline/plant1"
$stage = Join-Path $root ".deploy\plant1"

if (-not (Test-Path $key)) { Write-Host "缺少部署密钥: $key" -ForegroundColor Red; exit 1 }

if (-not $NoBuild) {
  Write-Host "== build"
  node (Join-Path $root "build.mjs")
  if ($LASTEXITCODE -ne 0) { Write-Host "构建失败" -ForegroundColor Red; exit 1 }
}

Write-Host "== firmware meta"
node (Join-Path $root "tools\sync-firmware.mjs")
if ($LASTEXITCODE -ne 0) { Write-Host "固件清单校验失败" -ForegroundColor Red; exit 1 }

Write-Host "== stage"
if (Test-Path (Join-Path $root ".deploy")) { Remove-Item (Join-Path $root ".deploy") -Recurse -Force }
New-Item -ItemType Directory -Force -Path $stage | Out-Null
Copy-Item (Join-Path $root "index.html") $stage
foreach ($d in @("install", "play", "flash", "assets", "downloads")) {
  Copy-Item (Join-Path $root $d) $stage -Recurse
}

Write-Host "== upload"
& ssh -i $key -o IdentitiesOnly=yes $remote "mkdir -p $site" 2>&1
& scp -q -i $key -o IdentitiesOnly=yes -r "$stage\*" "${remote}:$site/" 2>&1
if ($LASTEXITCODE -ne 0) { Write-Host "上传失败" -ForegroundColor Red; exit 1 }

Write-Host "== remote install"
& scp -i $key -o IdentitiesOnly=yes (Join-Path $PSScriptRoot "remote-install.sh") "${remote}:/root/plant1-remote-install.sh"
& ssh -i $key -o IdentitiesOnly=yes $remote "bash /root/plant1-remote-install.sh 2>&1"
if ($LASTEXITCODE -ne 0) { Write-Host "服务端安装失败" -ForegroundColor Red; exit 1 }

Write-Host ""
Write-Host "线上: https://kong8la.com/plant1/" -ForegroundColor Green
