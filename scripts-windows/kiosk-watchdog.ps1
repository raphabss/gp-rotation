# ============================================================
#  GP Rotation Display — Kiosk Watchdog
#  Spin Gaming Brasil
#
#  Coloque este arquivo em: C:\SpinGaming\kiosk-watchdog.ps1
#  Configure o Task Scheduler para executar no login do usuário
# ============================================================

param(
    [string]$DisplayUrl   = "http://192.168.1.100/tv",   # <<< TROQUE pelo IP do seu LXC
    [int]   $CheckInterval = 30,                          # segundos entre verificações
    [string]$ChromePath    = "",                          # deixe vazio para autodetectar
    [string]$LogFile       = "C:\SpinGaming\watchdog.log"
)

# ── Config ────────────────────────────────────────────────────────────────────
$ErrorActionPreference = "SilentlyContinue"

function Write-Log {
    param([string]$Message, [string]$Level = "INFO")
    $ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $line = "[$ts] [$Level] $Message"
    Write-Host $line
    Add-Content -Path $LogFile -Value $line -ErrorAction SilentlyContinue
}

function Find-Chrome {
    $paths = @(
        "${env:ProgramFiles}\Google\Chrome\Application\chrome.exe",
        "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
        "${env:LocalAppData}\Google\Chrome\Application\chrome.exe",
        # Microsoft Edge como fallback
        "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
        "${env:ProgramFiles}\Microsoft\Edge\Application\msedge.exe"
    )
    foreach ($p in $paths) {
        if (Test-Path $p) { return $p }
    }
    return $null
}

function Get-ChromeArgs {
    param([string]$Url)
    return @(
        "--kiosk",
        "--kiosk-printing",
        "--no-first-run",
        "--disable-translate",
        "--disable-infobars",
        "--disable-session-crashed-bubble",
        "--disable-features=TranslateUI",
        "--disable-background-networking",
        "--disable-sync",
        "--disable-default-apps",
        "--password-store=basic",
        "--autoplay-policy=no-user-gesture-required",
        "--start-maximized",
        "--window-position=0,0",
        "--disable-pinch",
        "--overscroll-history-navigation=0",
        "--disable-pull-to-refresh-effect",
        "--noerrdialogs",
        "--check-for-update-interval=31536000",
        $Url
    )
}

function Start-KioskBrowser {
    param([string]$BrowserPath, [string]$Url)

    Write-Log "Iniciando browser kiosk: $BrowserPath"
    Write-Log "URL: $Url"

    $args = Get-ChromeArgs -Url $Url
    $proc = Start-Process -FilePath $BrowserPath -ArgumentList $args -PassThru
    Write-Log "Browser PID: $($proc.Id)"
    return $proc
}

function Test-ServerReachable {
    param([string]$Url)
    try {
        $uri = [System.Uri]$Url
        $request = [System.Net.WebRequest]::Create("$($uri.Scheme)://$($uri.Host):$($uri.Port)/health")
        $request.Timeout = 5000
        $response = $request.GetResponse()
        $response.Close()
        return $true
    } catch {
        return $false
    }
}

# ── Disable screensaver and sleep ─────────────────────────────────────────────
Write-Log "Desabilitando screensaver e sleep..."
powercfg -change standby-timeout-ac 0 2>$null
powercfg -change monitor-timeout-ac 0 2>$null
reg add "HKCU\Control Panel\Desktop" /v ScreenSaveActive /t REG_SZ /d "0" /f 2>$null
reg add "HKCU\Control Panel\Desktop" /v SCRNSAVE.EXE /t REG_SZ /d "" /f 2>$null

# ── Hide taskbar ──────────────────────────────────────────────────────────────
$taskbar = [AppBar]::new()
# Simple registry approach
reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Explorer\StuckRects3" /f 2>$null

# ── Find browser ─────────────────────────────────────────────────────────────
if (-not $ChromePath) {
    $ChromePath = Find-Chrome
}

if (-not $ChromePath) {
    Write-Log "ERRO: Chrome/Edge não encontrado. Instale o Google Chrome." "ERROR"
    [System.Windows.Forms.MessageBox]::Show("Chrome ou Edge não encontrado. Instale o Google Chrome.", "GP Rotation - Erro")
    exit 1
}

Write-Log "Browser encontrado: $ChromePath"

# ── Wait for network ──────────────────────────────────────────────────────────
Write-Log "Aguardando rede..."
$netRetries = 0
while ($netRetries -lt 20) {
    if (Test-NetConnection -ComputerName "8.8.8.8" -Port 53 -InformationLevel Quiet -WarningAction SilentlyContinue) {
        Write-Log "Rede disponível"
        break
    }
    Start-Sleep -Seconds 3
    $netRetries++
}

# ── Wait for server ───────────────────────────────────────────────────────────
Write-Log "Aguardando servidor GP Rotation..."
$srvRetries = 0
while ($srvRetries -lt 30) {
    if (Test-ServerReachable -Url $DisplayUrl) {
        Write-Log "Servidor disponível"
        break
    }
    Write-Log "Servidor indisponível, aguardando... ($srvRetries/30)"
    Start-Sleep -Seconds 5
    $srvRetries++
}

# ── Start browser ─────────────────────────────────────────────────────────────
$browserProc = Start-KioskBrowser -BrowserPath $ChromePath -Url $DisplayUrl
Start-Sleep -Seconds 5

# ── Watchdog loop ─────────────────────────────────────────────────────────────
Write-Log "Watchdog iniciado. Verificando a cada $CheckInterval segundos."

while ($true) {
    Start-Sleep -Seconds $CheckInterval

    # Check if browser process is still running
    $running = Get-Process -Id $browserProc.Id -ErrorAction SilentlyContinue

    if (-not $running) {
        Write-Log "Browser encerrou inesperadamente. Reiniciando..." "WARN"
        Start-Sleep -Seconds 2
        $browserProc = Start-KioskBrowser -BrowserPath $ChromePath -Url $DisplayUrl
        Start-Sleep -Seconds 5
        continue
    }

    # Check if server is reachable (soft check — don't restart browser if server is down)
    $serverOk = Test-ServerReachable -Url $DisplayUrl
    if (-not $serverOk) {
        Write-Log "Servidor inacessível — browser mantido (exibe cache offline)" "WARN"
    }

    # Check for hung window (no response to message for 10s)
    # This catches white screen / frozen browser situations
    $windows = Get-Process chrome -ErrorAction SilentlyContinue
    if ($windows) {
        $responding = $windows | Where-Object { $_.Responding -eq $false }
        if ($responding) {
            Write-Log "Browser não responde. Encerrando e reiniciando..." "WARN"
            Stop-Process -Name chrome -Force -ErrorAction SilentlyContinue
            Stop-Process -Name msedge -Force -ErrorAction SilentlyContinue
            Start-Sleep -Seconds 3
            $browserProc = Start-KioskBrowser -BrowserPath $ChromePath -Url $DisplayUrl
            Start-Sleep -Seconds 5
        }
    }
}
