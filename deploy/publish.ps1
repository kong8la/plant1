# 发布 PLANT-1 到 kong8la.com/plant1/
#   .\deploy\publish.ps1            # 构建 + 上传 + 挂 nginx
#   .\deploy\publish.ps1 -NoBuild   # 跳过 build（只传页面上已有的产物）
param([switch]$NoBuild)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$key = Join-Path $env:USERPROFILE ".ssh\dsh_kong8la"
$remote = "root@45.76.107.67"
$site = "/var/www/northline/plant1"
$stage = Join-Path $root ".deploy\plant1"

if (-not (Test-Path $key)) { throw "缺少部署密钥: $key" }

if (-not $NoBuild) {
  Write-Host "== build"
  node (Join-Path $root "build.mjs")
}

Write-Host "== stage"
if (Test-Path (Join-Path $root ".deploy")) { Remove-Item (Join-Path $root ".deploy") -Recurse -Force }
New-Item -ItemType Directory -Force -Path $stage | Out-Null
Copy-Item (Join-Path $root "index.html") $stage
foreach ($d in @("install", "play", "flash", "assets")) {
  Copy-Item (Join-Path $root $d) $stage -Recurse
}

Write-Host "== upload"
ssh -i $key -o IdentitiesOnly=yes $remote "mkdir -p $site"
scp -i $key -o IdentitiesOnly=yes -r "$stage\*" "${remote}:$site/"

Write-Host "== remote install"
scp -i $key -o IdentitiesOnly=yes (Join-Path $PSScriptRoot "remote-install.sh") "${remote}:/root/plant1-remote-install.sh"
ssh -i $key -o IdentitiesOnly=yes $remote "bash /root/plant1-remote-install.sh"

Write-Host "`n线上: https://kong8la.com/plant1/"
