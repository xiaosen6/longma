Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public class WinEnum {
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr lp);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder sb, int max);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  public struct RECT { public int Left, Top, Right, Bottom; }
  public delegate bool EnumWindowsProc(IntPtr h, IntPtr lp);
}
'@
$electronPid = (Get-Process electron -ErrorAction SilentlyContinue | Select-Object -First 1).Id
if (-not $electronPid) { Write-Output 'no electron process'; exit }
$found = @()
$cb = {
  param($h, $lp)
  if ([WinEnum]::IsWindowVisible($h)) {
    $pid2 = 0
    [WinEnum]::GetWindowThreadProcessId($h, [ref]$pid2) | Out-Null
    if ($pid2 -eq $electronPid) {
      $sb = New-Object System.Text.StringBuilder 256
      [WinEnum]::GetWindowText($h, $sb, 256) | Out-Null
      $r = New-Object WinEnum+RECT
      [WinEnum]::GetWindowRect($h, [ref]$r) | Out-Null
      $script:found += "hwnd=$h title='$($sb.ToString())' rect=$($r.Left),$($r.Top) $($r.Right-$r.Left)x$($r.Bottom-$r.Top)"
    }
  }
  return $true
}
[WinEnum]::EnumWindows($cb, [IntPtr]::Zero) | Out-Null
$found | ForEach-Object { Write-Output $_ }
