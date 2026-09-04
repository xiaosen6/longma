#requires -Version 5.1
<#
.SYNOPSIS
  LongMa/Fundet 安装包冒烟测试：静默装临时目录 → 校验（theme/pi/pet/启动）→
  清理目录 + **恢复注册表安装位置记忆**（NSIS /D 会污染 InstallLocation，
  不恢复的话用户下次开安装器默认路径会指向临时目录——2026-09-03/04 两次客诉）。

.USAGE
  powershell -ExecutionPolicy Bypass -File tools\smoke-install.ps1 -Installer <安装包路径> -RealDir <真实安装目录> [-App LongMa|Fundet]
  例：.\tools\smoke-install.ps1 -Installer D:\LongMa-Setup-0.2.11-x64.exe -RealDir D:\QQ\LongMa -App LongMa
#>
param(
  [Parameter(Mandatory=$true)][string]$Installer,
  [Parameter(Mandatory=$true)][string]$RealDir,
  [ValidateSet('LongMa','Fundet')][string]$App = 'LongMa'
)
$ErrorActionPreference = 'Stop'

# GUID ↔ App 映射（electron-builder NSIS per-user 卸载键）
$guids = @{ LongMa = '18f1ed95-1f66-55ed-bd0c-bb526a3fd5fe'; Fundet = '8dfd6bdf-b09f-5e52-a162-da396dfee0be' }
$guid = $guids[$App]
$exe = "$App.exe"
$smokeDir = Join-Path $env:TEMP "smoke-$App-$([guid]::NewGuid().ToString('N').Substring(0,8))"

Write-Output "== [1/5] 备份当前注册表安装位置 =="
$backup = @{}
$uninstallKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\$guid"
$memoryKey = "HKCU:\Software\$guid"
foreach ($key in @($uninstallKey, $memoryKey)) {
  if (Test-Path $key) {
    foreach ($name in @('InstallLocation', 'UninstallString', 'QuietUninstallString', 'DisplayIcon')) {
      $v = (Get-ItemProperty -Path $key -Name $name -ErrorAction SilentlyContinue).$name
      if ($v) { $backup["$key|$name"] = $v }
    }
  }
}
Write-Output ("备份 {0} 项" -f $backup.Count)

Write-Output "== [2/5] 静默安装到临时目录 =="
Start-Process $Installer -ArgumentList '/S', "/D=$smokeDir" -Wait
if (-not (Test-Path (Join-Path $smokeDir $exe))) { throw "安装后未找到 $exe" }

Write-Output "== [3/5] 启动冒烟（8 秒）=="
Start-Process (Join-Path $smokeDir $exe)
Start-Sleep -Seconds 8
$alive = Get-Process $App -ErrorAction SilentlyContinue
if ($alive) { Write-Output ("进程存活: {0} 个" -f $alive.Count) } else { Write-Warning '进程未存活！' }
Stop-Process -Name $App -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2

Write-Output "== [4/5] 清理临时目录 =="
Start-Sleep -Seconds 2
Remove-Item $smokeDir -Recurse -Force -ErrorAction SilentlyContinue

Write-Output "== [5/5] 恢复注册表安装位置（关键：防默认路径污染）=="
foreach ($entry in $backup.GetEnumerator()) {
  $key = $entry.Key.Split('|')[0]
  $name = $entry.Key.Split('|')[1]
  New-ItemProperty -Path $key -Name $name -Value $entry.Value -PropertyType String -Force | Out-Null
}
# 备份为空（首次安装场景）时直接写真实目录
if ($backup.Count -eq 0) {
  New-ItemProperty -Path $memoryKey -Name 'InstallLocation' -Value $RealDir -PropertyType String -Force | Out-Null
}
New-ItemProperty -Path $memoryKey -Name 'InstallLocation' -Value $RealDir -PropertyType String -Force | Out-Null
New-ItemProperty -Path $uninstallKey -Name 'InstallLocation' -Value $RealDir -PropertyType String -Force | Out-Null
Write-Output "== 完成：注册表 InstallLocation 已恢复为 $RealDir =="
