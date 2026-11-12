# ============================================================
# Captura una ventana a PNG sin depender del orden Z.
# Usa PrintWindow con PW_RENDERFULLCONTENT, así funciona aunque
# la ventana esté detrás de otras.
#
# Uso:
#   powershell -ExecutionPolicy Bypass -File scripts/captura-ventana.ps1
#   ... -Proceso "electron" -Salida "ui.png" -Tecla "^4"
# ============================================================

param(
  [string]$Proceso = 'Discord Archive Pro',
  [string]$Salida = 'captura-ui.png',
  # Atajo a enviar antes de capturar, en formato SendKeys (p. ej. "^2" = Ctrl+2).
  [string]$Tecla = ''
)

Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms

Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Ventana {
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hWnd, IntPtr hdcBlt, uint nFlags);
  [StructLayout(LayoutKind.Sequential)]
  public struct RECT { public int Left, Top, Right, Bottom; }
}
"@

$proc = Get-Process -Name $Proceso -ErrorAction SilentlyContinue |
        Where-Object { $_.MainWindowHandle -ne 0 } |
        Select-Object -First 1

if (-not $proc) {
  Write-Error "No se encontró ninguna ventana de '$Proceso'."
  exit 1
}

$hwnd = $proc.MainWindowHandle

# Se intenta traer al frente; si Windows lo impide, PrintWindow igual funciona.
[void][Ventana]::ShowWindow($hwnd, 9)   # SW_RESTORE
[void][Ventana]::SetForegroundWindow($hwnd)
Start-Sleep -Milliseconds 500

if ($Tecla -ne '') {
  [System.Windows.Forms.SendKeys]::SendWait($Tecla)
  Start-Sleep -Milliseconds 900
}

$rect = New-Object Ventana+RECT
[void][Ventana]::GetWindowRect($hwnd, [ref]$rect)

$ancho = $rect.Right - $rect.Left
$alto = $rect.Bottom - $rect.Top

if ($ancho -le 0 -or $alto -le 0) {
  Write-Error "La ventana no tiene tamaño válido."
  exit 1
}

$bitmap = New-Object System.Drawing.Bitmap $ancho, $alto
$grafico = [System.Drawing.Graphics]::FromImage($bitmap)
$hdc = $grafico.GetHdc()

# 2 = PW_RENDERFULLCONTENT (necesario para ventanas compuestas por DWM).
$ok = [Ventana]::PrintWindow($hwnd, $hdc, 2)

$grafico.ReleaseHdc($hdc)

if (-not $ok) {
  # Respaldo: captura de pantalla en el rectángulo de la ventana.
  $grafico.CopyFromScreen($rect.Left, $rect.Top, 0, 0, $bitmap.Size)
}

$ruta = Join-Path (Get-Location) $Salida
$bitmap.Save($ruta, [System.Drawing.Imaging.ImageFormat]::Png)
$grafico.Dispose()
$bitmap.Dispose()

Write-Output "Captura guardada en $ruta ($ancho x $alto)"
