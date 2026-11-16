# 把仓库推到 GitHub（等你把公钥加进 GitHub 之后再跑）
#   pwsh -File .\deploy\push-github.ps1
#   pwsh -File .\deploy\push-github.ps1 -User kong8la -Repo plant1
param([string]$User, [string]$Repo = "plant1")

$ErrorActionPreference = 'Continue'
$key = Join-Path $env:USERPROFILE ".ssh\dsh_kong8la"
$kp = $key -replace '\\', '/'
$sshCmd = "ssh -i $kp -o IdentitiesOnly=yes"
$root = Split-Path -Parent $PSScriptRoot

Write-Host "== 检查 GitHub 是否认这把钥匙"
$probe = (& ssh -i $key -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new -T git@github.com 2>&1 | Out-String)
if ($probe -notmatch 'Hi ([^!\s]+)!') {
  Write-Host $probe
  Write-Host ""
  Write-Host "GitHub 还不认这把公钥。两步：" -ForegroundColor Yellow
  Write-Host "1) 打开 https://github.com/settings/ssh/new ，Key 里贴下面这行："
  Write-Host "   $(Get-Content "$key.pub")"
  Write-Host "2) 建一个空仓库（不要勾 README / .gitignore）： https://github.com/new?name=$Repo"
  Write-Host "做完再跑一次这个脚本。"
  exit 1
}
if (-not $User) { $User = $Matches[1]; Write-Host "   识别到 GitHub 用户: $User" }

$url = "git@github.com:$User/$Repo.git"
Write-Host "== 检查仓库 $url"
& git ls-remote $url *> $null
if ($LASTEXITCODE -ne 0) {
  Write-Host "仓库还不存在：去 https://github.com/new?name=$Repo 建一个空的（不要勾 README / .gitignore），然后重跑。" -ForegroundColor Yellow
  exit 1
}

Write-Host "== 推送"
& git -C $root remote remove origin 2>$null
& git -C $root remote add origin $url
& git -C $root -c core.sshCommand=$sshCmd push -u origin main
if ($LASTEXITCODE -ne 0) { Write-Host "推送失败，看上面的 git 输出。" -ForegroundColor Red; exit 1 }

Write-Host ""
Write-Host "完成。最后一步（网页上点两下）：" -ForegroundColor Green
Write-Host "  https://github.com/$User/$Repo/settings/pages"
Write-Host "  → Build and deployment → Source 选 GitHub Actions"
Write-Host "等 Actions 跑完，站点在： https://$User.github.io/$Repo/"
