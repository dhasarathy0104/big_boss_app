Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class Win32Ctx {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  [DllImport("user32.dll")] public static extern bool GetLastInputInfo(ref LASTINPUTINFO plii);
  [StructLayout(LayoutKind.Sequential)]
  public struct LASTINPUTINFO { public uint cbSize; public uint dwTime; }
}
"@

$hwnd = [Win32Ctx]::GetForegroundWindow()
$sb = New-Object System.Text.StringBuilder 512
[Win32Ctx]::GetWindowText($hwnd, $sb, 512) | Out-Null
$title = $sb.ToString()

$procId = 0
[Win32Ctx]::GetWindowThreadProcessId($hwnd, [ref]$procId) | Out-Null
$proc = Get-Process -Id $procId -ErrorAction SilentlyContinue
$procName = if ($proc) { $proc.ProcessName } else { "" }

$lii = New-Object Win32Ctx+LASTINPUTINFO
$lii.cbSize = [System.Runtime.InteropServices.Marshal]::SizeOf($lii)
[Win32Ctx]::GetLastInputInfo([ref]$lii) | Out-Null
$idleMs = [Environment]::TickCount - $lii.dwTime
$idleSeconds = [math]::Round($idleMs / 1000)

$result = [ordered]@{
  title = $title
  process = $procName
  idleSeconds = $idleSeconds
}
$result | ConvertTo-Json -Compress
