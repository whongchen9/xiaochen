# 一键准备本机开发环境（云函数 npm 依赖 + 可选本机 AppID 配置）
$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $RepoRoot

Write-Host "==> 安装云函数 service 依赖 (npm install --prefix cloudfunctions/service)"
npm install --prefix cloudfunctions/service

$priv = Join-Path $RepoRoot "project.private.config.json"
$privEx = Join-Path $RepoRoot "project.private.config.json.example"
if (-not (Test-Path $priv) -and (Test-Path $privEx)) {
  Copy-Item $privEx $priv
  Write-Host "==> 已生成 project.private.config.json（请编辑 appid）"
}

if (-not (Test-Path (Join-Path $RepoRoot ".git"))) {
  git init
  if (-not (git config user.email)) {
    git config user.email "xiaoChen-dao@local"
    git config user.name "xiaoChen-dao"
  }
  Write-Host "==> 已 git init（仅本目录无 .git 时）；首次提交请自行: git add -A && git commit"
}

Write-Host "完成。请在微信开发者工具中对 cloudfunctions/service 执行「上传并安装依赖」。"
