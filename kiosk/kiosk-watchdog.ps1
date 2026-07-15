<#
  kiosk-watchdog.ps1  -  GP Rotation Display System (Spin Gaming)
  -----------------------------------------------------------------
  Mantem o Chrome aberto em tela cheia (kiosk) na URL da TV.
  Se o navegador for fechado, travar ou sumir, o watchdog reabre sozinho.
  Roda em loop continuo; e iniciado automaticamente pelo Agendador de Tarefas
  (ver install-task.ps1).

  Pensado para um ThinClient/Mini-PC dedicado a TV do estudio.
#>

# -----------------------------------------------------------------------------
#  CONFIGURACAO  (ajuste aqui se necessario)
# -----------------------------------------------------------------------------
$TvUrl       = "http://172.16.20.10/tv/"        # URL da TV (modo Matriz)
# Para abrir com rolagem automatica, use: "http://172.16.20.10/tv/?autoscroll=1"

$ChromePath  = "C:\Program Files\Google\Chrome\Application\chrome.exe"
$ChromePathX = "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
# Se usar Microsoft Edge em vez do Chrome, comente as duas linhas acima e use:
# $ChromePath  = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"

$CheckEverySeconds = 5       # de quanto em quanto tempo o watchdog verifica
$DailyRestartHour  = -1      # reinicio diario do navegador (madrugada). -1 desliga
$ProfileDir        = "$env:LOCALAPPDATA\GpRotationKiosk"   # perfil isolado do Chrome
$LogFile           = "$env:LOCALAPPDATA\GpRotationKiosk\watchdog.log"

# -----------------------------------------------------------------------------
#  Nao precisa mexer daqui pra baixo
# -----------------------------------------------------------------------------

function Write-Log($msg) {
  $line = "{0}  {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $msg
  try {
    $dir = Split-Path $LogFile
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    Add-Content -Path $LogFile -Value $line
    # mantem o log enxuto (ultimas ~500 linhas)
    $all = Get-Content $LogFile -ErrorAction SilentlyContinue
    if ($all.Count -gt 600) { $all[-500..-1] | Set-Content $LogFile }
  } catch {}
  Write-Host $line
}

function Resolve-Browser {
  if (Test-Path $ChromePath)  { return $ChromePath }
  if (Test-Path $ChromePathX) { return $ChromePathX }
  return $null
}

function Get-KioskProcess {
  # processo do nosso kiosk = chrome/msedge usando o nosso perfil isolado
  Get-CimInstance Win32_Process -Filter "name = 'chrome.exe' OR name = 'msedge.exe'" |
    Where-Object { $_.CommandLine -and $_.CommandLine -like "*$ProfileDir*" }
}

function Start-Kiosk {
  $browser = Resolve-Browser
  if (-not $browser) {
    Write-Log "ERRO: navegador nao encontrado. Verifique `$ChromePath."
    return
  }
  if (-not (Test-Path $ProfileDir)) { New-Item -ItemType Directory -Path $ProfileDir -Force | Out-Null }

  # Flags de kiosk: tela cheia, sem barras, sem avisos de restauracao/atualizacao,
  # sem primeira execucao, sem traducao, sem economia de energia da aba.
  # IMPORTANTE: --kiosk e uma FLAG; a URL vai como argumento POSICIONAL no final.
  $chromeArgs = @(
    "--user-data-dir=$ProfileDir",
    "--kiosk",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-session-crashed-bubble",
    "--hide-crash-restore-bubble",
    "--restore-last-session=false",
    "--disable-infobars",
    "--disable-features=Translate,TranslateUI,MediaRouter",
    "--disable-pinch",
    "--overscroll-history-navigation=0",
    "--check-for-update-interval=31536000",
    "--noerrdialogs",
    "--disable-background-timer-throttling",
    "--disable-backgrounding-occluded-windows",
    "--autoplay-policy=no-user-gesture-required",
    "--start-fullscreen",
    "$TvUrl"
  )
  Write-Log "Abrindo kiosk em $TvUrl"
  Start-Process -FilePath $browser -ArgumentList $chromeArgs | Out-Null
}

function Stop-Kiosk {
  Get-KioskProcess | ForEach-Object {
    try { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue } catch {}
  }
  Start-Sleep -Seconds 2
}

# Impede sono/descanso de tela enquanto o watchdog roda (ES_CONTINUOUS|DISPLAY|SYSTEM)
function Prevent-Sleep {
  try {
    Add-Type -ErrorAction SilentlyContinue @"
using System;
using System.Runtime.InteropServices;
public static class Power {
  [DllImport("kernel32.dll")]
  public static extern uint SetThreadExecutionState(uint esFlags);
}
"@
    [Power]::SetThreadExecutionState(0x80000000 -bor 0x00000002 -bor 0x00000001) | Out-Null
  } catch {}
}

# -- loop principal -----------------------------------------------------------
Write-Log "==== Watchdog iniciado ===="
$lastRestartDay = (Get-Date).Date

while ($true) {
  Prevent-Sleep

  $proc = Get-KioskProcess
  if (-not $proc) {
    Write-Log "Kiosk nao esta rodando - iniciando."
    Stop-Kiosk          # garante que nao sobrou processo zumbi com o perfil
    Start-Kiosk
  }

  # Reinicio diario programado (limpa memoria; navegador 'fresco')
  if ($DailyRestartHour -ge 0) {
    $now = Get-Date
    if ($now.Hour -eq $DailyRestartHour -and $now.Date -ne $lastRestartDay) {
      Write-Log "Reinicio diario programado ($DailyRestartHour h)."
      Stop-Kiosk
      Start-Kiosk
      $lastRestartDay = $now.Date
    }
  }

  Start-Sleep -Seconds $CheckEverySeconds
}
